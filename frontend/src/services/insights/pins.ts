import { blockLineSchema, type Block } from './blocks';

/**
 * An answer the seller decided to keep.
 *
 * A pin used to store the lookups behind an answer and replay them, so that the
 * blocks' refs re-resolved against whatever period was selected later. That only
 * worked because the figures lived outside the blocks. They now live inside
 * them — the model computed them from the rows it read — so there is nothing to
 * re-resolve, and replaying the lookups would refresh the data under an analysis
 * written about different data.
 *
 * So a pin is what it looks like: **the answer as it was, and when it was
 * written.** The card says its date out loud, because a snapshot that does not
 * look like one is the failure worth avoiding in a finance tool, and it offers to
 * ask the question again — which re-reads the rows *and* re-does the analysis,
 * the only refresh that keeps the sentences and the figures in step.
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
  /** The question that produced it — the card's heading, and what a refresh asks. */
  readonly title: string;
  readonly blocks: readonly Block[];
  readonly createdAt: number;
  /** The period the seller had selected when the answer was written. */
  readonly window?: { readonly fromMs: number; readonly toMs: number };
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

/**
 * A stored pin this build can draw, or null.
 *
 * Pins outlive builds. One written while blocks carried refs has metrics with no
 * value and charts with no items, and drawing it would put a card of dashes on
 * the dashboard. Every block is checked against the same schema a streamed line
 * is, and a pin with any block this build no longer understands is dropped whole
 * rather than shown with holes in it.
 */
export function readStoredPin(value: unknown): PinnedAnswer | null {
  if (value === null || typeof value !== 'object') return null;
  const pin = value as Record<string, unknown>;

  if (typeof pin['id'] !== 'string' || typeof pin['title'] !== 'string') return null;
  if (!Array.isArray(pin['blocks']) || pin['blocks'].length === 0) return null;

  const blocks: Block[] = [];
  for (const block of pin['blocks']) {
    const parsed = blockLineSchema.safeParse(block);
    if (!parsed.success) return null;
    blocks.push(parsed.data as Block);
  }

  const window = pin['window'] as { fromMs?: unknown; toMs?: unknown } | undefined;

  return {
    id: pin['id'],
    title: pin['title'],
    blocks,
    createdAt: typeof pin['createdAt'] === 'number' ? pin['createdAt'] : Date.now(),
    ...(window !== undefined && typeof window.fromMs === 'number' && typeof window.toMs === 'number'
      ? { window: { fromMs: window.fromMs, toMs: window.toMs } }
      : {}),
  };
}
