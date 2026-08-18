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
 * asked for **one complete block per line**, so a newline is a commit point: the
 * text before it either parses and validates or it does not, and there is never
 * a half-object to reason about. Splitting on `\n` and validating each line with
 * the schema the rail already uses is the entire implementation.
 *
 * A line that fails is dropped and counted. One malformed block costs its own
 * paragraph rather than the whole answer, which is the failure mode worth
 * having when the author is a language model.
 */

export interface BlockStreamState {
  /** Text seen so far that has not ended in a newline yet. */
  buffer: string;
  /** Lines that arrived but did not validate. Surfaced, never silently lost. */
  dropped: number;
}

export function createBlockStream(): BlockStreamState {
  return { buffer: '', dropped: 0 };
}

/**
 * One line, if it is a block.
 *
 * Fences and stray prose are tolerated rather than rejected: models wrap output
 * in ```ndjson more often than they should, and an answer that is correct apart
 * from its decoration is worth keeping. A line that is not JSON at all is not
 * counted as dropped, because it was never claiming to be a block.
 */
function parseLine(line: string): { block: Block | null; malformed: boolean } {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('```')) return { block: null, malformed: false };
  if (!trimmed.startsWith('{')) return { block: null, malformed: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { block: null, malformed: true };
  }

  const result = blockLineSchema.safeParse(parsed);
  return result.success
    ? { block: result.data as Block, malformed: false }
    : { block: null, malformed: true };
}

/**
 * Feed a fragment; get back whatever became complete because of it.
 *
 * The trailing fragment stays in the buffer — a chunk boundary lands mid-line
 * far more often than not, and treating a partial line as a failed one would
 * discard most of the answer.
 */
export function pushChunk(state: BlockStreamState, chunk: string): readonly Block[] {
  state.buffer += chunk;

  const lines = state.buffer.split('\n');
  /* The last element is either an unfinished line or an empty string after a
     terminating newline. Either way it is not ready. */
  state.buffer = lines.pop() ?? '';

  const blocks: Block[] = [];
  for (const line of lines) {
    const { block, malformed } = parseLine(line);
    if (block !== null) blocks.push(block);
    if (malformed) state.dropped += 1;
  }

  return blocks;
}

/** Whatever is left when the stream ends — the last line has no newline. */
export function flush(state: BlockStreamState): readonly Block[] {
  const remainder = state.buffer;
  state.buffer = '';

  const { block, malformed } = parseLine(remainder);
  if (malformed) state.dropped += 1;
  return block === null ? [] : [block];
}
