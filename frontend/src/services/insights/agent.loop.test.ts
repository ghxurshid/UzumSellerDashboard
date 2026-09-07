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
 * The round a question gets back when a line of it could not be drawn.
 *
 * A model writes NDJSON, and a line of it can fail in ways the seller has no
 * way to see: a table whose cells came out as numbers, a paragraph past the
 * schema's length, a line that is not JSON at all. Each of those used to end
 * the question — the line went, nothing replaced it, and the answer was an
 * empty bubble with a count underneath. The model was never told, so it could
 * not send the line again.
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

/** A table whose second cell is a number, which the schema takes for text. */
const NUMERIC_CELL =
  '{"kind":"table","columns":["SKU","Foyda"],"rows":[["Real Madrid Kit",457924]]}';

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

describe('a round that lost a line', () => {
  it('asks for it again and shows what comes back', async () => {
    const { blocks, outcome } = await ask(
      NUMERIC_CELL,
      '{"kind":"text","text":"**Real Madrid Kit** eng ko\'p foyda keltirdi."}',
    );

    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(1);
    /* Won back, so the seller is not warned about a line they can now read. */
    expect(outcome.dropped).toBe(0);
  });

  it('quotes the line and a reason the model can act on', async () => {
    await ask(NUMERIC_CELL, '{"kind":"text","text":"Real Madrid Kit."}');

    const second = streamComplete.mock.calls[1]?.[0] as StreamOptions;
    const sent = JSON.stringify(second.request.messages);

    expect(sent).toContain('Real Madrid Kit');
    expect(sent).toContain('rows.0.1: Expected string, received number');
  });

  it('asks once — a second failure is counted, not chased', async () => {
    const { blocks, outcome } = await ask(NUMERIC_CELL, NUMERIC_CELL, NUMERIC_CELL);

    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(0);
    expect(outcome.dropped).toBe(1);
    expect(outcome.rejected).toEqual(['rows.0.1: Expected string, received number']);
  });

  it('recovers a paragraph past the schema\'s length', async () => {
    const { blocks, outcome } = await ask(
      `{"kind":"text","text":"${'juda uzun matn '.repeat(300)}"}`,
      '{"kind":"text","text":"Qisqartirilgan javob."}',
    );

    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(1);
    expect(outcome.dropped).toBe(0);
  });

  it('costs nothing when every line was drawable', async () => {
    const { blocks, outcome } = await ask('{"kind":"text","text":"Uchta mahsulot zarar qilyapti."}');

    expect(streamComplete).toHaveBeenCalledTimes(1);
    expect(blocks).toHaveLength(1);
    expect(outcome.dropped).toBe(0);
  });
});

describe('a paragraph with figures in it', () => {
  /**
   * The change this file was rewritten for.
   *
   * Prose used to be filtered: a percent sign or a grouped thousand and the
   * sentence was discarded, whatever else it said. Every ranking answer lost
   * its paragraph that way, because a ranking is answered in shares. The model
   * writes its own figures now, and the sentence is drawn as written.
   */
  it('reaches the seller as the model wrote it', async () => {
    const { blocks, outcome } = await ask(
      '{"kind":"text","text":"Sof foyda **457 924 so\'m** — tushumning 9.2 %i."}',
    );

    expect(streamComplete).toHaveBeenCalledTimes(1);
    expect(outcome.dropped).toBe(0);
    expect(blocks[0]).toEqual({
      kind: 'text',
      text: "Sof foyda **457 924 so'm** — tushumning 9.2 %i.",
    });
  });
});
