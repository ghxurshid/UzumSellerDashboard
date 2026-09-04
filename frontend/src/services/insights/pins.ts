import type { Block } from './blocks';
import type { ExecutedCall } from './agent';
import type { Fact, FactSeries, FactTable, SeriesTable } from './facts';
import { runReadTool, type ToolContext } from './toolkit';

/**
 * An answer the seller decided to keep.
 *
 * The naive way to save a chat answer is to save what it said — the blocks and
 * the numbers that were in them. That produces a photograph: correct on the day
 * it was taken and quietly wrong every day after, which in a finance tool is
 * the worst of the two failure modes because nothing about it looks stale.
 *
 * A pin therefore stores **the blocks and the lookups behind them**, not the
 * figures. The blocks already cite by `ref` rather than carrying values — that
 * is what `facts.ts` exists for — so replaying the lookups against whatever
 * period is selected now re-resolves every figure in the card. The seller pins
 * "which products are losing money" once and reads it every morning against
 * this morning's rows.
 *
 * ## What is deliberately dropped
 *
 * `trace` blocks belong to the conversation, not to the card; they say what was
 * read in a moment that has passed. `action` blocks are dropped for a stronger
 * reason: a price-write button carries the SKUs and amounts that were right
 * when it was proposed, and a button that has been sitting on a dashboard for
 * three weeks proposing last month's prices is a trap. A pinned card states;
 * acting stays in the conversation where the parameters are fresh.
 */

export interface PinnedAnswer {
  readonly id: string;
  /** The question that produced it — the card's heading. */
  readonly title: string;
  readonly blocks: readonly Block[];
  /** The lookups to replay. Empty means the card cannot be refreshed. */
  readonly plan: readonly ExecutedCall[];
  readonly createdAt: number;
}

/** How many a dashboard can carry before it stops being a dashboard. */
export const MAX_PINS = 6;

/**
 * Blocks worth keeping on a dashboard.
 *
 * Recurses into callouts so a button nested inside one is dropped too — the
 * whole point is that nothing on a pinned card can be pressed into a write with
 * parameters nobody has looked at since.
 */
export function pinnableBlocks(blocks: readonly Block[]): readonly Block[] {
  const kept: Block[] = [];

  for (const block of blocks) {
    if (block.kind === 'trace' || block.kind === 'action') continue;

    if (block.kind === 'callout') {
      const inner = pinnableBlocks(block.blocks);
      if (inner.length > 0) kept.push({ ...block, blocks: inner });
      continue;
    }

    kept.push(block);
  }

  return kept;
}

export interface ReplayResult {
  readonly facts: FactTable;
  readonly series: SeriesTable;
  /** Lookups that failed — the card says so rather than showing dashes. */
  readonly failures: number;
}

/**
 * Run a pinned card's lookups again.
 *
 * The same call the chat made, through the same door: the archive answers if it
 * holds the period, and fetches the missing part if it does not. A card is
 * therefore as current as the screen it sits on, and costs nothing extra when
 * the screen has already loaded the window.
 */
export async function replayPlan(
  plan: readonly ExecutedCall[],
  context: ToolContext,
): Promise<ReplayResult> {
  const facts = new Map<string, Fact>();
  const series = new Map<string, FactSeries>();
  let failures = 0;

  for (const call of plan) {
    try {
      const result = await runReadTool(call.tool, call.args, context);
      for (const fact of result.facts ?? []) facts.set(fact.ref, fact);
      for (const entry of result.series ?? []) series.set(entry.ref, entry);
      if ((result.facts?.length ?? 0) === 0 && (result.series?.length ?? 0) === 0) failures += 1;
    } catch {
      /* One lookup failing costs its own figures, not the card. Whatever else
         resolved still renders, and the unresolved refs draw as dashes. */
      failures += 1;
    }
  }

  return { facts: facts as FactTable, series: series as SeriesTable, failures };
}
