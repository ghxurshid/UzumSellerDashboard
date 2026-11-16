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

  it('shows a figure the model typed, because the block will too', () => {
    const state = createBlockStream();
    pushChunk(state, '{"kind":"text","text":"Sof foyda 457 924 so‘m');

    /* Prose used to be filtered here as well as at the block, so that a number
       nobody could check never reached the screen at all. The model writes its
       own figures now, and a draft that hid them showed a sentence the finished
       block would immediately contradict. */
    expect(previewText(state)).toBe('Sof foyda 457 924 so‘m');
  });

  it('never shows a sentence the finished block would not', () => {
    const line = '{"kind":"text","text":"Avgustda **457 924 so\'m** foyda."}\n';
    const { blocks, drafts } = drip(line);

    expect(blocks).toBe(1);
    /* Every draft is a prefix of the final text, so nothing appears mid-stream
       that the block itself does not go on to say. */
    const final = "Avgustda **457 924 so'm** foyda.";
    for (const draft of drafts) {
      expect(final.startsWith(draft)).toBe(true);
    }
  });
});

describe('a line that was meant to be a block', () => {
  /**
   * The reason is what the model is shown when it is asked to send the line
   * again, so a wrong reason is worse than none. The first version of this read
   * the wrong arm of the union and told a model with a malformed table that
   * `text` was required — a field it had not written, in a block it was not
   * sending — and the model obligingly sent the same table back.
   */
  const reasonFor = (value: unknown): string | undefined => {
    const state = createBlockStream();
    return pushChunk(state, `${JSON.stringify(value)}
`).rejected[0]?.reason;
  };

  it('names the field the author actually got wrong', () => {
    expect(
      reasonFor({ kind: 'table', columns: ['SKU', 'Foyda'], rows: [['Abaya', { value: 450_000 }]] }),
    ).toMatch(/^rows\.0\.1: /);

    expect(reasonFor({ kind: 'metric', label: 'Foyda' })).toBe(
      'value: must be a plain number, or a string of at most 60 characters',
    );

    expect(reasonFor({ kind: 'text', text: 'x'.repeat(5_000) })).toBe(
      'text: String must contain at most 4000 character(s)',
    );

    expect(
      reasonFor({ kind: 'chart', chart: 'donut', items: [{ label: 'a', value: 1 }] }),
    ).toBe('items: Array must contain at least 2 element(s)');
  });

  it('accepts a table whose cells are numbers', () => {
    const state = createBlockStream();
    const harvest = pushChunk(
      state,
      `${JSON.stringify({ kind: 'table', columns: ['SKU', 'Foyda'], rows: [['Abaya', 450_000]] })}\n`,
    );

    expect(harvest.blocks).toHaveLength(1);
    expect(harvest.rejected).toHaveLength(0);
  });

  it('refuses a chart that has nothing to draw', () => {
    expect(reasonFor({ kind: 'chart', chart: 'bar' })).toBe('items: a bar chart needs items');
    expect(reasonFor({ kind: 'chart', chart: 'line', labels: ['a', 'b'] })).toBe(
      'series: a line chart needs labels and series',
    );
  });

  it('counts a line chart against its labels', () => {
    expect(
      reasonFor({
        kind: 'chart',
        chart: 'line',
        labels: ['09-07', '09-08'],
        series: [{ name: 'Sotuv', values: [3] }],
      }),
    ).toBe('series.0.values: needs exactly one value per label (2)');
  });

  it('refuses a negative donut slice', () => {
    expect(
      reasonFor({
        kind: 'chart',
        chart: 'donut',
        items: [
          { label: 'Foyda', value: -10 },
          { label: 'Xarajat', value: 30 },
        ],
      }),
    ).toBe('items.0.value: a donut slice cannot be negative — use a bar chart');
  });

  /**
   * The three blocks whose last figure the application derives. What matters at
   * the wire is that a line carrying the derived figure instead of its inputs is
   * sent back with the reason, not drawn with a hole where the figure was.
   */
  it('accepts tiles, progress rows and a ranking written as the figures that were read', () => {
    const state = createBlockStream();
    const lines = [
      { kind: 'metrics', items: [{ label: 'Tushum', value: 457_924, format: 'money', previous: 400_000 }, { label: 'Buyurtma', value: 312, format: 'count' }] },
      { kind: 'progress', rows: [{ label: 'Qaytarilgan', value: 9, total: 17, format: 'count', tone: 'warning' }] },
      { kind: 'rank', title: 'Eng ko‘p sotilgan', format: 'count', items: [{ label: 'Abaya qora', value: 120, note: 'SKU-1' }, { label: 'Abaya oq', value: 85 }] },
    ];
    const harvest = pushChunk(state, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

    expect(harvest.rejected).toEqual([]);
    expect(harvest.blocks.map((block) => block.kind)).toEqual(['metrics', 'progress', 'rank']);
  });

  it('sends back a tile that carries a change instead of the figure it compares with', () => {
    expect(
      reasonFor({
        kind: 'metrics',
        items: [
          { label: 'Tushum', value: 457_924, change: 14.5 },
          { label: 'Buyurtma', value: 312 },
        ],
      }),
    ).toBe(
      'items.0: a tile takes label, value, format and previous — send "previous" (the figure compared with) and the change is derived',
    );
  });

  it('refuses a single tile — that is a metric', () => {
    expect(reasonFor({ kind: 'metrics', items: [{ label: 'Tushum', value: 1 }] })).toBe(
      'items: Array must contain at least 2 element(s)',
    );
  });

  it('refuses a progress row with no whole, or with a negative part', () => {
    expect(reasonFor({ kind: 'progress', rows: [{ label: 'Sotilgan', value: 5, total: 0 }] })).toBe(
      'rows.0.total: must be above zero — it is the whole that value is a part of',
    );
    expect(reasonFor({ kind: 'progress', rows: [{ label: 'Foyda', value: -5, total: 10 }] })).toBe(
      'rows.0.value: cannot be negative — a part of a whole has no negative fill; use a bar chart',
    );
    expect(reasonFor({ kind: 'progress', rows: [{ label: 'Ulush', value: '52.9%', total: 100 }] })).toBe(
      'rows.0.value: must be a plain JSON number — no quotes, %, spaces, currency or thousands separators',
    );
  });

  it('refuses a ranking of one, and an order that is not a direction', () => {
    expect(reasonFor({ kind: 'rank', items: [{ label: 'Abaya', value: 1 }] })).toBe(
      'items: Array must contain at least 2 element(s)',
    );
    expect(
      reasonFor({
        kind: 'rank',
        order: 'top',
        items: [
          { label: 'a', value: 1 },
          { label: 'b', value: 2 },
        ],
      }),
    ).toMatch(/^order: /);
  });

  /**
   * A product card, a comparison and a question asked back. Each has one thing
   * the wire must hold the line on: where a picture may come from, who works out
   * a difference, and that a pick can be told apart from every other pick.
   */
  it('accepts a product, a comparison and a choice', () => {
    const state = createBlockStream();
    const lines = [
      {
        kind: 'product',
        title: 'Abaya qora',
        note: 'ID 4000001',
        image: 'https://images.uzum.uz/yyyyyyyyyyyyyyyyyyyy/t_product_80_low.jpg',
        status: { text: 'Tugagan', tone: 'negative' },
        figures: [{ label: 'Narx', value: 120_000, format: 'money' }],
      },
      {
        kind: 'compare',
        a: 'Abaya qora',
        b: 'Abaya oq',
        rows: [{ label: 'Sotilgan', a: 120, b: 85, format: 'count', better: 'higher' }],
      },
      {
        kind: 'choice',
        question: 'Qaysi davr uchun?',
        options: [{ label: 'Oxirgi 7 kun', recommended: true }, { label: 'Oxirgi 30 kun' }],
      },
    ];
    const harvest = pushChunk(state, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

    expect(harvest.rejected).toEqual([]);
    expect(harvest.blocks.map((block) => block.kind)).toEqual(['product', 'compare', 'choice']);
  });

  it('refuses a product image from anywhere but the image host', () => {
    const reason =
      'image: must be a https://images.uzum.uz/… address copied from a result, with no query string — leave image out if you have none';

    for (const image of [
      'https://evil.example/pixel.png',
      'http://images.uzum.uz/a.jpg',
      'https://images.uzum.uz.evil.example/a.jpg',
      'https://images.uzum.uz/a.jpg?leak=457924',
      'https://images.uzum.uz/a.jpg#x',
      'https://images.uzum.uz@evil.example/a.jpg',
      'https://images.uzum.uz/',
    ]) {
      expect(reasonFor({ kind: 'product', title: 'Abaya', image })).toBe(reason);
    }
  });

  it('sends back a comparison row that carries its own difference', () => {
    expect(
      reasonFor({
        kind: 'compare',
        a: 'Bu oy',
        b: 'Oldingi oy',
        rows: [{ label: 'Sotilgan', a: 120, b: 85, diff: 41.2 }],
      }),
    ).toBe(
      'rows.0: a row takes label, a, b, format and better — send the two figures and the difference is derived',
    );
  });

  it('refuses a choice the seller could not answer unambiguously', () => {
    expect(
      reasonFor({ kind: 'choice', question: 'Qaysi biri?', options: [{ label: 'Abaya' }] }),
    ).toBe('options: Array must contain at least 2 element(s)');

    expect(
      reasonFor({
        kind: 'choice',
        question: 'Qaysi biri?',
        options: [{ label: 'Abaya' }, { label: ' abaya ' }],
      }),
    ).toBe(
      'options.1.label: repeats another option — every label must be different, the pick is sent back as its label',
    );

    expect(
      reasonFor({
        kind: 'choice',
        question: 'Qaysi biri?',
        options: [
          { label: 'Abaya qora', recommended: true },
          { label: 'Abaya oq', recommended: true },
        ],
      }),
    ).toBe('options.1.recommended: only one option can be recommended');

    expect(
      reasonFor({
        kind: 'choice',
        question: 'Qaysi biri?',
        options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }, { label: 'e' }],
      }),
    ).toBe('options: Array must contain at most 4 element(s)');
  });

  it('says so plainly when the kind is not a block at all', () => {
    expect(reasonFor({ kind: 'list', items: ['a'] })).toBe('not one of the block shapes');
  });

  it('leaves a protocol line alone', () => {
    const state = createBlockStream();
    const harvest = pushChunk(state, '{"call":"window.totals","args":{}}\n');

    expect(harvest.rejected).toHaveLength(0);
    expect(harvest.other).toHaveLength(1);
  });
});
