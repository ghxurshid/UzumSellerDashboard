import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/constants/settings';
import type { AnthropicReasoningBlock, ToolCall } from '@/services/ai/messages';
import type { StreamOptions, StreamResult } from '@/services/ai/stream';
import type { AiSettings } from '@/types/settings';

import type { AgentSession, Capability } from './agent';
import type { Block } from './blocks';
import type * as Digest from './digest';
import type { ToolContext } from './toolkit';

const { streamComplete } = vi.hoisted(() => ({ streamComplete: vi.fn() }));
vi.mock('@/services/ai/stream', () => ({ streamComplete }));

/* The only part of the digest the loop reads for itself. Everything else in
   that module is the real thing, because the toolkit runs on it. */
const { freshnessNote } = vi.hoisted(() => ({ freshnessNote: vi.fn() }));
vi.mock('./digest', async (importOriginal) => ({
  ...(await importOriginal<typeof Digest>()),
  freshnessNote,
}));

const { createSession, runAgent } = await import('./agent');

/**
 * The round a question gets back when a line of it could not be drawn.
 *
 * A model writes NDJSON, and a line of it can fail in ways the seller has no
 * way to see: a line chart with a value missing, a paragraph past the schema's
 * length, a button whose parameters the registry refuses, a line that is not
 * JSON at all. Each of those used to end the question — the line went, nothing
 * replaced it, and the answer was an empty bubble with a count underneath.
 *
 * These pin what the turn that fixes it has to do: bring the answer back, ask
 * exactly once, carry a reason the model can act on, and cost nothing at all
 * when the answer was fine.
 */

/* Spread from the defaults so a field `AiSettings` gains later (as `saved`
   did) does not break a fixture that has no opinion about it. */
const SETTINGS: AiSettings = {
  ...DEFAULT_SETTINGS.ai,
  provider: 'gemini',
  baseUrl: 'https://example.invalid',
  apiKey: 'k',
  orgId: '',
  model: 'gemini-3.6-flash',
  timeoutMs: 30_000,
  temperature: 0.2,
  maxTokens: 2_000,
};

const CONTEXT: ToolContext = {
  scope: { storeKey: 'all', shopIds: [1], rangeKey: 'r30', fromMs: 0, toMs: 1 },
  products: [],
  shops: [{ id: 1, name: 'Shop' }],
  language: 'uz',
  now: 0,
  signal: undefined,
};

/** A line chart one value short of its labels — valid JSON, refused shape. */
const SHORT_LINE =
  '{"kind":"chart","chart":"line","labels":["09-07","09-08","09-09"],"series":[{"name":"Sotuv","values":[4,7]}]}';

/** Each string is one model turn, written in a single chunk. */
function answers(...turns: readonly string[]): void {
  let index = 0;
  streamComplete.mockImplementation(async (options: StreamOptions) => {
    const text = turns[index] ?? '';
    index += 1;
    options.onDelta(text);
    return { text, calls: [], inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  });
}

async function ask(
  turns: readonly string[],
  options: {
    readonly carried?: ReadonlySet<Capability>;
    readonly granted?: Set<Capability>;
    readonly budget?: { readonly rounds: number; readonly calls: number };
    readonly onRun?: () => void;
    /** A session from an attempt that stopped — the resume path. */
    readonly session?: AgentSession;
  } = {},
) {
  answers(...turns);

  const blocks: Block[] = [];
  const session =
    options.session ??
    createSession({
      question: 'oxirgi 7 kunlik sotuv qanday?',
      history: [],
      ...(options.carried === undefined ? {} : { carried: options.carried }),
    });

  const outcome = await runAgent({
    settings: SETTINGS,
    system: 'system',
    session,
    context: CONTEXT,
    language: 'uz',
    granted: options.granted ?? new Set(['tools', 'widgets']),
    signal: new AbortController().signal,
    onBlocks: (produced) => blocks.push(...produced),
    onRun: options.onRun ?? (() => {}),
    budget: options.budget ?? { rounds: 1, calls: 1 },
  });

  return { blocks, outcome, session };
}

const sentMessages = (call: number): string =>
  JSON.stringify((streamComplete.mock.calls[call]?.[0] as StreamOptions).request.messages);

const sentSystem = (call: number): string =>
  (streamComplete.mock.calls[call]?.[0] as StreamOptions).request.system;

beforeEach(() => {
  streamComplete.mockReset();
  freshnessNote.mockReset();
  /* Nothing to say about freshness unless a test says otherwise — the shape
     every other test in this file was written against. */
  freshnessNote.mockResolvedValue('');
});

describe('a round that lost a line', () => {
  it('asks for it again and shows what comes back', async () => {
    const { blocks, outcome } = await ask([
      SHORT_LINE,
      '{"kind":"chart","chart":"line","labels":["09-07","09-08","09-09"],"series":[{"name":"Sotuv","values":[4,7,5]}]}',
    ]);

    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(1);
    /* Won back, so the seller is not warned about a line they can now read. */
    expect(outcome.dropped).toBe(0);
  });

  it('quotes the line and a reason the model can act on', async () => {
    await ask([SHORT_LINE, '{"kind":"text","text":"Sotuv o‘sdi."}']);

    const sent = sentMessages(1);
    expect(sent).toContain('Sotuv');
    expect(sent).toContain('series.0.values: needs exactly one value per label (3)');
  });

  it('asks once — a second failure is counted, not chased', async () => {
    const { blocks, outcome } = await ask([SHORT_LINE, SHORT_LINE, SHORT_LINE]);

    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(0);
    expect(outcome.dropped).toBe(1);
    expect(outcome.rejected).toEqual(['series.0.values: needs exactly one value per label (3)']);
  });

  it("recovers a paragraph past the schema's length", async () => {
    const { blocks, outcome } = await ask([
      `{"kind":"text","text":"${'juda uzun matn '.repeat(300)}"}`,
      '{"kind":"text","text":"Qisqartirilgan javob."}',
    ]);

    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(1);
    expect(outcome.dropped).toBe(0);
  });

  it('refuses a button whose parameters the registry rejects, and says why', async () => {
    const { blocks, outcome } = await ask([
      '{"kind":"action","actionId":"stock.update","params":{"entries":[{"skuId":11,"amount":4}]}}',
      '{"kind":"action","actionId":"stock.update","params":{"entries":[{"skuId":11,"amount":4}]}}',
    ]);

    /* Drawn, it would have been nothing under a sentence telling the seller to
       press it. */
    expect(blocks).toHaveLength(0);
    expect(sentMessages(1)).toContain('barcode');
    expect(outcome.dropped).toBe(1);
  });

  it('costs nothing when every line was drawable', async () => {
    const { blocks, outcome } = await ask(['{"kind":"text","text":"Uchta mahsulot zarar qilyapti."}']);

    expect(streamComplete).toHaveBeenCalledTimes(1);
    expect(blocks).toHaveLength(1);
    expect(outcome.dropped).toBe(0);
  });
});

describe('an answer that carries its own figures', () => {
  /**
   * The change this file was rewritten for.
   *
   * Blocks used to cite refs into a fact table. They carry values now — the
   * model reads the rows, computes, and writes the result — so a metric, a
   * numeric table and a line of daily units all arrive exactly as written.
   */
  it('reaches the seller as the model wrote it', async () => {
    const { blocks, outcome } = await ask([
      [
        '{"kind":"text","text":"Sof foyda **457 924 so\'m** — tushumning 9.2 %i."}',
        '{"kind":"metric","label":"Sof foyda","value":457924,"format":"money","change":-12.4}',
        '{"kind":"table","columns":["Mahsulot","Sotildi"],"rows":[["Abaya",12]],"formats":["text","count"]}',
      ].join('\n'),
    ]);

    expect(streamComplete).toHaveBeenCalledTimes(1);
    expect(outcome.dropped).toBe(0);
    expect(blocks[1]).toEqual({
      kind: 'metric',
      label: 'Sof foyda',
      value: 457924,
      format: 'money',
      change: -12.4,
    });
    expect(blocks[2]).toMatchObject({ kind: 'table', rows: [['Abaya', 12]] });
  });

  it('refuses a ref where a value belongs, with a reason that says so', async () => {
    const { outcome } = await ask([
      '{"kind":"metric","ref":"totals.netProfit"}',
      '{"kind":"metric","ref":"totals.netProfit"}',
    ]);

    expect(outcome.rejected).toEqual([
      'value: must be a plain number, or a string of at most 60 characters',
    ]);
  });
});

describe('documents a thread already holds', () => {
  it('rides in the system prompt of a later question', async () => {
    await ask(['{"kind":"text","text":"Tayyor."}'], { carried: new Set(['widgets']) });

    const system = (streamComplete.mock.calls[0]?.[0] as StreamOptions).request.system;
    expect(system).toContain('OPENED DOCUMENTS');
    expect(system).toContain('WIDGETS — how your answer is drawn.');
    /* Only what was granted: the toolkit was not. */
    expect(system).not.toContain('TOOLKIT — what you may read');
  });

  it('is not printed when the thread holds nothing yet', async () => {
    await ask(['{"kind":"text","text":"Tayyor."}'], { granted: new Set() });

    const system = (streamComplete.mock.calls[0]?.[0] as StreamOptions).request.system;
    expect(system).toBe('system');
  });

  it('points a model that asks again at where the document already is', async () => {
    await ask(['{"need":"widgets"}', '{"kind":"text","text":"Tayyor."}'], {
      carried: new Set(['widgets']),
      budget: { rounds: 2, calls: 2 },
    });

    expect(sentMessages(1)).toContain('printed under OPENED DOCUMENTS');
  });
});

describe('how old this machine’s data is', () => {
  const NOTE = [
    '[freshness] now 14:12 UTC · stored here, auto-refreshes past 60min',
    'sales 14:08 · returns never',
  ].join('\n');

  it('ends the system prompt, behind the documents the thread holds', async () => {
    freshnessNote.mockResolvedValue(NOTE);
    await ask(['{"kind":"text","text":"Tayyor."}'], { carried: new Set(['widgets']) });

    const system = sentSystem(0);
    /* Last, so everything a prompt cache can serve stays in front of the one
       part that moves between questions. */
    expect(system.endsWith(`\n\n${NOTE}`)).toBe(true);
    expect(system.indexOf('OPENED DOCUMENTS')).toBeLessThan(system.indexOf('[freshness]'));
  });

  it('adds nothing when there is nothing to say', async () => {
    await ask(['{"kind":"text","text":"Tayyor."}'], { granted: new Set() });

    expect(sentSystem(0)).toBe('system');
  });

  it('is read once and reused by the run that resumes', async () => {
    freshnessNote.mockResolvedValueOnce(NOTE).mockResolvedValue('[freshness] a later sync');

    const session = createSession({ question: 'sotuv qanday?', history: [] });
    streamComplete.mockRejectedValueOnce(new Error('network'));
    await expect(
      runAgent({
        settings: SETTINGS,
        system: 'system',
        session,
        context: CONTEXT,
        language: 'uz',
        granted: new Set(['tools', 'widgets']),
        signal: new AbortController().signal,
        onBlocks: () => {},
        onRun: () => {},
        budget: { rounds: 1, calls: 1 },
      }),
    ).rejects.toThrow('network');

    await ask(['{"kind":"text","text":"Tayyor."}'], { session });

    expect(freshnessNote).toHaveBeenCalledTimes(1);
    /* The transcript the model is continuing was written against these stamps,
       so a sync in between must not rewrite them under it. */
    expect(sentSystem(1)).toContain(NOTE);
    expect(sentSystem(1)).not.toContain('a later sync');
  });

  it('answers without the block when freshness cannot be read', async () => {
    freshnessNote.mockRejectedValue(new Error('idb closed'));

    const { blocks } = await ask(['{"kind":"text","text":"Tayyor."}'], { granted: new Set() });

    expect(blocks).toHaveLength(1);
    expect(sentSystem(0)).toBe('system');
  });
});

describe('a follow-up question called rather than placed', () => {
  it('becomes a chip instead of starting a second question', async () => {
    const onRun = vi.fn();
    const { blocks } = await ask(
      [
        '{"call":"copilot.ask","args":{"question":"Qaysi SKU tugayapti?"}}',
        '{"kind":"text","text":"Tayyor."}',
      ],
      { onRun, budget: { rounds: 2, calls: 2 } },
    );

    expect(onRun).not.toHaveBeenCalled();
    expect(blocks[0]).toMatchObject({ kind: 'action', actionId: 'copilot.ask' });
  });
});

describe('Claude’s thinking on a turn that called a tool', () => {
  /**
   * Anthropic refuses the next request if the thinking behind a tool_use is
   * dropped or edited, and the transport can only replay what the loop hands
   * it back. An empty `thinking` and a redacted block are here on purpose:
   * both are what a tidy-minded copy would lose.
   */
  const REASONING: readonly AnthropicReasoningBlock[] = [
    { type: 'thinking', thinking: '', signature: 'sig-1' },
    { type: 'redacted_thinking', data: 'opaque-state' },
  ];

  const CALL: ToolCall = {
    id: 'toolu_1',
    name: 'open_toolkit',
    args: { capability: 'widgets' },
    reasoning: REASONING,
  };

  /** One model turn: `text` streamed in a single chunk, then `calls`. */
  const turn =
    (text: string, calls: readonly ToolCall[]) =>
    async (options: StreamOptions): Promise<StreamResult> => {
      options.onDelta(text);
      return { text, calls, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    };

  /** Every assistant turn the given request replayed with calls on it. */
  const replayedCalls = (call: number): readonly ToolCall[] =>
    (streamComplete.mock.calls[call]?.[0] as StreamOptions).request.messages.flatMap((message) =>
      message.role === 'assistant' ? (message.calls ?? []) : [],
    );

  it('goes back on the next request as the object that came off the wire', async () => {
    streamComplete.mockImplementationOnce(turn('', [CALL]));

    await ask(['{"kind":"text","text":"Tayyor."}'], {
      granted: new Set(),
      budget: { rounds: 2, calls: 2 },
    });

    expect(streamComplete).toHaveBeenCalledTimes(2);
    const [replayed] = replayedCalls(1);
    /* The same object, not a copy rebuilt from what the loop read off it. */
    expect(replayed).toBe(CALL);
    expect(replayed?.reasoning).toBe(REASONING);
  });

  it('is still there when the round after it failed and was resumed', async () => {
    const session = createSession({ question: 'sotuv qanday?', history: [] });
    streamComplete
      .mockImplementationOnce(turn('', [CALL]))
      .mockRejectedValueOnce(new Error('network'));

    await expect(
      runAgent({
        settings: SETTINGS,
        system: 'system',
        session,
        context: CONTEXT,
        language: 'uz',
        granted: new Set(),
        signal: new AbortController().signal,
        onBlocks: () => {},
        onRun: () => {},
        budget: { rounds: 2, calls: 2 },
      }),
    ).rejects.toThrow('network');

    await ask(['{"kind":"text","text":"Tayyor."}'], { session, budget: { rounds: 2, calls: 2 } });

    expect(streamComplete).toHaveBeenCalledTimes(3);
    expect(replayedCalls(2)).toEqual([CALL]);
    expect(replayedCalls(2)[0]?.reasoning).toBe(REASONING);
  });

  it('leaves only with its tool_use, on the rewrite of a round the budget cut short', async () => {
    /* Round 0 asks and is answered. Round 1 is the answering round, and it both
       called a tool and wrote a refused line. That call cannot be answered — a
       tool_use left without a result is a refused request — so the turn goes
       back as text, and the thinking, which belongs to the call rather than to
       the text, goes with it. The call round 0 made keeps its own. */
    const UNANSWERED: ToolCall = {
      id: 'toolu_2',
      name: 'window_totals',
      args: {},
      reasoning: [{ type: 'thinking', thinking: 'more', signature: 'sig-2' }],
    };
    streamComplete
      .mockImplementationOnce(turn('', [CALL]))
      .mockImplementationOnce(turn(SHORT_LINE, [UNANSWERED]));

    await ask(['{"kind":"text","text":"Tayyor."}'], {
      granted: new Set(),
      budget: { rounds: 1, calls: 1 },
    });

    expect(streamComplete).toHaveBeenCalledTimes(3);
    expect(replayedCalls(2)).toEqual([CALL]);
    expect(replayedCalls(2)[0]?.reasoning).toBe(REASONING);
    expect(sentMessages(2)).toContain('series.0.values');
  });
});
