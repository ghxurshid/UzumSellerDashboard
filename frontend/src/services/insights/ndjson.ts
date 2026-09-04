import { blockLineSchema, type Block } from './blocks';

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
  /** Lines that were JSON but validated as nothing. Surfaced, never lost. */
  dropped: number;
  /** Lines that were not JSON at all, kept in case the round produced nothing. */
  prose: string;
}

/** What became complete because of the latest chunk. */
export interface Harvest {
  readonly blocks: readonly Block[];
  /** JSON objects that are not blocks — the protocol lines. */
  readonly other: readonly unknown[];
}

const EMPTY: Harvest = { blocks: [], other: [] };

export function createBlockStream(): BlockStreamState {
  return { buffer: '', dropped: 0, prose: '' };
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
    state.dropped += 1;
    return EMPTY;
  }

  const result = blockLineSchema.safeParse(parsed);
  if (result.success) return { blocks: [result.data as Block], other: [] };

  /* Not a block. It may still be a protocol line, and the agent is the only
     thing that knows — so it goes on rather than being counted as a failure. */
  return { blocks: [], other: [parsed] };
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

  for (const line of lines) {
    const harvest = parseLine(state, line);
    blocks.push(...harvest.blocks);
    other.push(...harvest.other);
  }

  return { blocks, other };
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
