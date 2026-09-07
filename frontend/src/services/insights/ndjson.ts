import type { ZodError } from 'zod';

import { blockLineSchema, statesRawNumber, type Block } from './blocks';

/**
 * Reading a document that has not finished being written.
 *
 * A JSON object cannot be parsed until its closing brace arrives, which for a
 * chat answer means several seconds of nothing followed by everything. The
 * usual workaround is a partial-JSON parser that speculatively closes whatever
 * is open — it works, it needs a dependency or a few hundred lines of brace
 * bookkeeping, and it produces half-built objects that then have to be guarded
 * against everywhere downstream.
 *
 * The alternative is to change the format rather than the parser. The model is
 * asked for **one complete object per line**, so a newline is a commit point:
 * the text before it either parses or it does not, and there is never a
 * half-object to reason about. Splitting on `\n` and validating each line is the
 * entire implementation.
 *
 * ## Two kinds of line
 *
 * A line is either a **block** — something to draw — or something else the model
 * said to the application: a request for a capability, a tool call. This parser
 * does not know what those mean; it separates the lines that validate as blocks
 * from the JSON objects that do not and hands both on. `agent.ts` owns the
 * vocabulary of the second kind, which keeps the streaming parser ignorant of
 * the protocol and the protocol ignorant of chunk boundaries.
 *
 * A line that is not JSON at all is kept as prose. Models occasionally answer a
 * simple question in a sentence despite the instructions, and throwing that
 * away leaves the seller with an empty bubble; the agent turns leftover prose
 * into a text block when a round produced nothing else.
 */

export interface BlockStreamState {
  /** Text seen so far that has not ended in a newline yet. */
  buffer: string;
  /** Lines that were not JSON at all, kept in case the round produced nothing. */
  prose: string;
}

/**
 * A line the seller will not see, and why.
 *
 * A count on its own turned out not to be enough to act on. Three unrelated
 * failures reached the same counter — a figure typed into a sentence, a block
 * whose shape the schema refuses, a line that is not JSON — and the note under
 * the answer blamed unverifiable numbers whichever one it had been. The reason
 * now travels with the line, so the model can be told what to fix and the
 * seller can be told what happened.
 *
 * `line` is the model's own text and may hold the very figure the guard exists
 * to keep off the screen. It goes back to the model and nowhere else.
 */
export interface Rejection {
  readonly line: string;
  readonly reason: string;
}

/** What became complete because of the latest chunk. */
export interface Harvest {
  readonly blocks: readonly Block[];
  /** JSON objects that are not blocks — the protocol lines. */
  readonly other: readonly unknown[];
  /** Lines written to be drawn that were not drawable. */
  readonly rejected: readonly Rejection[];
}

const EMPTY: Harvest = { blocks: [], other: [], rejected: [] };

export function createBlockStream(): BlockStreamState {
  return { buffer: '', prose: '' };
}

/**
 * Why a line that was meant to be a block is not one.
 *
 * `blockLineSchema` is a union of shapes, so a failure arrives as a single
 * `invalid_union` issue carrying one complete error per branch — and all but
 * one of those branches failed only because `kind` was a different word. The
 * branch worth reading is the one whose `kind` matched, found by discarding
 * every branch that tripped on `kind` itself.
 *
 * The wording matters because it is what the model is shown. "not one of the
 * block shapes" is nothing it can act on; "text: String must contain at most
 * 600 character(s)" is a paragraph it can split in two.
 */
function whyNotABlock(error: ZodError): string {
  const branches = error.issues.flatMap((issue) =>
    issue.code === 'invalid_union' ? issue.unionErrors : [],
  );

  for (const branch of branches.length > 0 ? branches : [error]) {
    const issue = branch.issues.find((candidate) => candidate.path[0] !== 'kind');
    if (issue !== undefined) return `${issue.path.join('.') || 'line'}: ${issue.message}`;
  }

  return 'not one of the block shapes';
}

/** Whether a line was written as something to draw rather than as a request. */
function looksLikeBlock(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

/**
 * One line, classified.
 *
 * Fences and stray prose are tolerated rather than rejected: models wrap output
 * in ```ndjson more often than they should, and an answer that is correct apart
 * from its decoration is worth keeping.
 */
function parseLine(state: BlockStreamState, line: string): Harvest {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('```')) return EMPTY;

  if (!trimmed.startsWith('{')) {
    state.prose += state.prose === '' ? trimmed : ` ${trimmed}`;
    return EMPTY;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ...EMPTY, rejected: [{ line: trimmed, reason: 'not valid JSON' }] };
  }

  const result = blockLineSchema.safeParse(parsed);
  if (result.success) return { blocks: [result.data as Block], other: [], rejected: [] };

  /* A line carrying `kind` was written to be drawn, so its failure is a
     malformed block and has a reason worth passing on. Anything else may still
     be a protocol line, and the agent is the only thing that knows — so it goes
     on rather than being counted as a failure here. */
  if (looksLikeBlock(parsed)) {
    return { ...EMPTY, rejected: [{ line: trimmed, reason: whyNotABlock(result.error) }] };
  }

  return { blocks: [], other: [parsed], rejected: [] };
}

/**
 * Feed a fragment; get back whatever became complete because of it.
 *
 * The trailing fragment stays in the buffer — a chunk boundary lands mid-line
 * far more often than not, and treating a partial line as a failed one would
 * discard most of the answer.
 */
export function pushChunk(state: BlockStreamState, chunk: string): Harvest {
  state.buffer += chunk;

  const lines = state.buffer.split('\n');
  /* The last element is either an unfinished line or an empty string after a
     terminating newline. Either way it is not ready. */
  state.buffer = lines.pop() ?? '';

  const blocks: Block[] = [];
  const other: unknown[] = [];
  const rejected: Rejection[] = [];

  for (const line of lines) {
    const harvest = parseLine(state, line);
    blocks.push(...harvest.blocks);
    other.push(...harvest.other);
    rejected.push(...harvest.rejected);
  }

  return { blocks, other, rejected };
}

/** Whatever is left when the stream ends — the last line has no newline. */
export function flush(state: BlockStreamState): Harvest {
  const remainder = state.buffer;
  state.buffer = '';
  return parseLine(state, remainder);
}

/** The prose the model wrote outside a block, and forget it. */
export function takeProse(state: BlockStreamState): string {
  const prose = state.prose;
  state.prose = '';
  return prose;
}

/* ── the line still being written ───────────────────────────────────────── */

/**
 * The first `"kind"` a line declares, and where its `"text"` value begins.
 *
 * Read in that order on purpose. A callout carries text blocks inside itself,
 * so a line that opens as a callout would otherwise have its inner prose lifted
 * out and drawn as a bare paragraph — and then drawn again, correctly, inside
 * its box a moment later. Taking the first kind a line declares as the kind of
 * the line is what keeps the preview to the one shape it is safe for.
 */
const FIRST_KIND = /"kind"\s*:\s*"([a-z]+)"/;
const TEXT_FIELD = /"text"\s*:\s*"/;

/**
 * A JSON string body, decoded as far as it goes.
 *
 * `JSON.parse` is no help here: the string has no closing quote yet, which is
 * the entire point. So the escapes are walked by hand — and an escape split
 * across a chunk boundary (a trailing backslash, or half of a `\uXXXX`) ends
 * the decode rather than producing a wrong character. It arrives whole on the
 * next chunk, a few milliseconds later.
 */
function decodePartial(body: string): string {
  let out = '';

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    /* The value closed. What follows is another field, not more sentence. */
    if (char === '"') break;

    if (char !== '\\') {
      out += char;
      continue;
    }

    const escape = body[index + 1];
    if (escape === undefined) break;
    index += 1;

    switch (escape) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += ' ';
        break;
      case 'r':
        break;
      case 'u': {
        const hex = body.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
        break;
      }
      /* An escaped quote, backslash or solidus — the character itself. */
      default:
        out += escape;
    }
  }

  return out;
}

/**
 * The sentence in the buffer, before its line has ended.
 *
 * A block only becomes a block when its newline arrives, which is the property
 * the rest of this file is built on — and it is also why an answer appeared a
 * whole paragraph at a time however fast the model was actually writing.
 * Nothing was being buffered by the network. The words were simply inside a
 * JSON string that had not closed yet.
 *
 * So the unfinished line is read as well, for the one shape where a partial
 * value means anything: a `text` block. A half-built table has no honest
 * intermediate state — three of eight columns is not a smaller table, it is a
 * wrong one — and a chart missing its last step is a chart that does not
 * arrive. Prose is the exception, because half a sentence is exactly half a
 * sentence, and reading it as it is written is what the seller is waiting for.
 *
 * The draft is committed to nothing. When the line completes it parses as an
 * ordinary block, the buffer empties, and this returns `''` in the same call —
 * so the preview disappears in the frame the real block appears, and no
 * sentence is ever drawn twice.
 */
export function previewText(state: BlockStreamState): string {
  const line = state.buffer.trimStart();
  if (!line.startsWith('{')) return '';

  const kind = FIRST_KIND.exec(line);
  if (kind === null || kind[1] !== 'text') return '';

  const opening = TEXT_FIELD.exec(line.slice(kind.index));
  if (opening === null) return '';

  const body = line.slice(kind.index + opening.index + opening[0].length);

  /**
   * A placeholder is only worth showing whole.
   *
   * `{{totals.netPro` is a fact reference the model is halfway through typing.
   * Rendering it literally would flash braces into the middle of a sentence for
   * a frame or two, and cutting the fragment costs nothing — the next chunk
   * brings it back complete and it resolves to a figure.
   */
  const text = decodePartial(body).replace(/\{\{[^}]*$/, '');

  /* The number guard holds for a draft exactly as it holds for a block: a
     figure the model typed itself must not reach the screen, not even for the
     moment before the line carrying it is dropped. */
  return statesRawNumber(text) ? '' : text;
}
