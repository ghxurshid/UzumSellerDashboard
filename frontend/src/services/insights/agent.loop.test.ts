import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamOptions } from '@/services/ai/stream';
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

const SETTINGS: AiSettings = {
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
