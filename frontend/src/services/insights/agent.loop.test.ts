import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamOptions } from '@/services/ai/stream';
import type { AiSettings } from '@/types/settings';

import type { Block } from './blocks';
import type { FactTable } from './facts';
import type { ToolContext } from './toolkit';

const { streamComplete } = vi.hoisted(() => ({ streamComplete: vi.fn() }));
vi.mock('@/services/ai/stream', () => ({ streamComplete }));

const { createSession, runAgent } = await import('./agent');

/**
 * The round a question gets back after the number guard takes a paragraph.
 *
 * The guard is an invariant: a figure the model typed itself never reaches the
 * seller, because nobody can check it. What it used to do as well was end the
 * question — the sentence went, nothing replaced it, and the answer was an
 * empty bubble with a warning under it. The model was never told, so it could
 * not write the same sentence against a ref.
 *
 * These pin the three things that has to be true of the turn that fixes it: the
 * answer comes back, it is asked for exactly once, and a clean answer pays for
 * nothing.
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

async function ask(...turns: readonly string[]) {
  answers(...turns);

  const blocks: Block[] = [];
  const session = createSession({
    question: 'qaysi mahsulotlar foyda keltiryapti?',
    history: [],
    seed: new Map() as FactTable,
  });

  const outcome = await runAgent({
    settings: SETTINGS,
    system: 'system',
    session,
    context: CONTEXT,
    language: 'uz',
    granted: new Set(['tools', 'widgets']),
    signal: new AbortController().signal,
    onBlocks: (produced) => blocks.push(...produced),
    onGround: () => {},
    onRun: () => {},
    budget: { rounds: 1, calls: 1 },
  });

  return { blocks, outcome };
}

beforeEach(() => {
  streamComplete.mockReset();
});

describe('a round that lost a paragraph to the number guard', () => {
  it('asks for it again and shows the rewrite', async () => {
    const { blocks, outcome } = await ask(
      '{"kind":"text","text":"Eng yaxshi uchtasi foydaning 62% ini beradi."}',
      '{"kind":"text","text":"Eng yaxshi uchtasi {{rank.profit}} dan katta qismini beradi."}',
    );

    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'text' });
    /* Won back, so the seller is not warned about a line they can now read. */
    expect(outcome.dropped).toBe(0);
  });

  it('quotes the discarded sentence back so the rewrite is mechanical', async () => {
    await ask(
      '{"kind":"text","text":"Marja 9.2% ga tushdi."}',
      '{"kind":"text","text":"Marja tushdi."}',
    );

    const second = streamComplete.mock.calls[1]?.[0] as StreamOptions;
    const last = second.request.messages[second.request.messages.length - 1];

    expect(last?.role).toBe('user');
    expect(JSON.stringify(last)).toContain('Marja 9.2% ga tushdi.');
  });

  it('asks once — a second failure is counted, not chased', async () => {
    const line = '{"kind":"text","text":"Foyda 1 250 000 sum."}';
    const { blocks, outcome } = await ask(line, line, line);

    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(0);
    expect(outcome.dropped).toBe(1);
  });

  it('covers a block the schema refused, not only a typed figure', async () => {
    /* A paragraph over the 600-character cap is the other way a line vanishes,
       and it used to be reported as an unverifiable number. */
    const { blocks, outcome } = await ask(
      `{"kind":"text","text":"${'shu yerda juda uzun matn '.repeat(40)}"}`,
      '{"kind":"text","text":"Qisqartirilgan javob."}',
    );

    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(1);
    expect(outcome.dropped).toBe(0);

    const second = streamComplete.mock.calls[1]?.[0] as StreamOptions;
    expect(JSON.stringify(second.request.messages)).toContain('600');
  });

  it('reports the reason it refused, not a guess at one', async () => {
    const line = '{"kind":"text","text":"Foyda 1 250 000 sum."}';
    const { outcome } = await ask(line, line);

    expect(outcome.rejected).toEqual(['it states a figure directly instead of citing a ref']);
  });

  it('costs nothing when the answer broke no rule', async () => {
    const { blocks, outcome } = await ask('{"kind":"text","text":"Uchta mahsulot zarar qilyapti."}');

    expect(streamComplete).toHaveBeenCalledTimes(1);
    expect(blocks).toHaveLength(1);
    expect(outcome.dropped).toBe(0);
  });
});
