import { describe, expect, it } from 'vitest';

import { createBlockStream, flush, previewText, pushChunk, takeProse } from './ndjson';

/**
 * The streaming parser, and the preview that sits beside it.
 *
 * The load-bearing property is that the preview changes nothing: the same
 * chunks produce the same blocks, in the same order, with the same drop count,
 * whether or not anybody reads the draft. So the tests below check the blocks
 * first and the draft second, over the same buffer.
 */

/** Feed a string one character at a time, the worst case a chunk boundary has. */
function drip(text: string): { blocks: number; drafts: string[] } {
  const state = createBlockStream();
  const drafts: string[] = [];
  let blocks = 0;

  for (const char of text) {
    blocks += pushChunk(state, char).blocks.length;
    drafts.push(previewText(state));
  }

  blocks += flush(state).blocks.length;
  return { blocks, drafts };
}

describe('pushChunk', () => {
  it('emits a block when its line ends, not before', () => {
    const state = createBlockStream();

    expect(pushChunk(state, '{"kind":"text","text":"Avgust').blocks).toHaveLength(0);
    expect(pushChunk(state, ' yaxshi o‘tdi."}').blocks).toHaveLength(0);
    expect(pushChunk(state, '\n').blocks).toHaveLength(1);
  });

  it('separates protocol lines from blocks', () => {
    const state = createBlockStream();
    const harvest = pushChunk(state, '{"call":"window.totals","args":{}}\n');

    expect(harvest.blocks).toHaveLength(0);
    expect(harvest.other).toHaveLength(1);
  });

  it('keeps prose that is not JSON at all', () => {
    const state = createBlockStream();
    pushChunk(state, 'Sorry, I cannot answer that.\n');

    expect(takeProse(state)).toBe('Sorry, I cannot answer that.');
  });
});

describe('previewText', () => {
  it('reads the sentence while it is being written', () => {
    const state = createBlockStream();

    pushChunk(state, '{"kind":"text","text":"Avgustda foyda');
    expect(previewText(state)).toBe('Avgustda foyda');

    pushChunk(state, ' oshdi');
    expect(previewText(state)).toBe('Avgustda foyda oshdi');
  });

  it('clears itself in the same call the block is emitted', () => {
    const state = createBlockStream();
    pushChunk(state, '{"kind":"text","text":"Tayyor"}');
    expect(previewText(state)).toBe('Tayyor');

    const harvest = pushChunk(state, '\n');
    expect(harvest.blocks).toHaveLength(1);
    /* The block is on screen now, so the draft must not also be. */
    expect(previewText(state)).toBe('');
  });

  it('leaves the parser untouched', () => {
    const state = createBlockStream();
    pushChunk(state, '{"kind":"text","text":"Yarim');

    const before = { buffer: state.buffer, prose: state.prose };
    previewText(state);
    previewText(state);

    expect(state.buffer).toBe(before.buffer);
    expect(state.prose).toBe(before.prose);
  });

  it('previews nothing but a text block', () => {
    const state = createBlockStream();

    pushChunk(state, '{"kind":"table","columns":["SKU"],"rows":[["Abaya');
    expect(previewText(state)).toBe('');

    /* A callout carries text inside it, and lifting that out would draw the
       sentence bare and then again inside its box. */
    const nested = createBlockStream();
    pushChunk(nested, '{"kind":"callout","tone":"warning","blocks":[{"kind":"text","text":"Diqqat');
    expect(previewText(nested)).toBe('');
  });

  it('previews nothing for a directive', () => {
    const state = createBlockStream();
    pushChunk(state, '{"call":"products.rank","args":{"limit":10');
    expect(previewText(state)).toBe('');
  });

  it('decodes escapes, and waits for one that is split', () => {
    const state = createBlockStream();

    pushChunk(state, '{"kind":"text","text":"He said \\"yes\\" and');
    expect(previewText(state)).toBe('He said "yes" and');

    const split = createBlockStream();
    pushChunk(split, '{"kind":"text","text":"Bir\\u04');
    /* Half a code point is not a character. It arrives on the next chunk. */
    expect(previewText(split)).toBe('Bir');
  });

  it('hides a placeholder that is still being typed', () => {
    const state = createBlockStream();

    pushChunk(state, '{"kind":"text","text":"Sof foyda {{totals.netPro');
    expect(previewText(state)).toBe('Sof foyda ');

    pushChunk(state, 'fit}} bo‘ldi');
    expect(previewText(state)).toBe('Sof foyda {{totals.netProfit}} bo‘ldi');
  });

  it('refuses a draft stating a figure the model typed itself', () => {
    const state = createBlockStream();
    pushChunk(state, '{"kind":"text","text":"Sof foyda 457 924 so‘m');

    /* The same guard that drops the block. A number nobody can check must not
       reach the screen even for the frame before its line is discarded. */
    expect(previewText(state)).toBe('');
  });

  it('never shows a sentence the finished block would not', () => {
    const line = '{"kind":"text","text":"Avgustda {{totals.netProfit}} foyda."}\n';
    const { blocks, drafts } = drip(line);

    expect(blocks).toBe(1);
    /* Every draft is a prefix of the final text, so nothing appears mid-stream
       that the block itself does not go on to say. */
    const final = 'Avgustda {{totals.netProfit}} foyda.';
    for (const draft of drafts) {
      expect(final.startsWith(draft)).toBe(true);
    }
  });
});
