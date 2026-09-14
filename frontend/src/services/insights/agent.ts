import {
  supportsNativeTools,
  type ChatMessage,
  type ToolCall,
  type ToolReply,
} from '@/services/ai/messages';
import { streamComplete } from '@/services/ai/stream';
import type { AiSettings } from '@/types/settings';
import type { Language } from '@/types/domain';

import {
  explainRejection,
  resolveAction,
  INSIGHT_ACTIONS,
  type InsightActionId,
  type ResolvedAction,
} from './actions';
import type { Block } from './blocks';
import { formatChange, formatFigure } from './figures';
import {
  createBlockStream,
  flush,
  previewText,
  pushChunk,
  takeProse,
  type Harvest,
  type Rejection,
} from './ndjson';
import { withOpenedDocuments } from './prompt';
import {
  describeToolkit,
  nativeToolSchemas,
  runReadTool,
  toolIdOfName,
  OPEN_TOOLKIT,
  type ToolContext,
} from './toolkit';
import { WIDGET_GUIDE } from './widgets';

/**
 * The conversation loop.
 *
 * The old chat ran a fixed three-step protocol — plan, retrieve, compose — with
 * every prompt carrying the whole fact table and the whole block vocabulary.
 * It worked, and it had the two failings that come with fixing the shape in
 * advance: the model got exactly one chance to decide what data it needed, and
 * every answer came out looking like every other answer, because every prompt
 * described the same layout in the same order.
 *
 * This is the same idea taken to its conclusion. The model starts with a small
 * prompt that says who it is and that a toolkit exists. It asks for what it
 * needs, reads the data a lookup returns, works out what the question needs from
 * it, asks again if the first answer raised a second question, and stops when it
 * has enough. Each request is one round; the documents and results it collected
 * stay in the message list, so nothing is re-read and nothing is re-sent that
 * was not asked for.
 *
 *     base system prompt          identity, boundaries, "ask for what you need"
 *       ↳ open the toolkit        the catalogue, once per thread
 *       ↳ call a lookup           run against the archive, answered with data
 *       ↳ open the widget guide   how to draw, once per thread
 *       ↳ blocks                  the answer, with its figures in it, streamed
 *
 * ## Two ways to ask, one loop
 *
 * Where the provider has a real tool API the calls come back parsed, and
 * progressive disclosure survives it: the first request declares exactly one
 * tool, `open_toolkit`, and the rest are declared only after it has been
 * called. Everywhere else — a self-hosted Ollama, a custom gateway — the same
 * conversation runs over lines of JSON the application reads itself. Both paths
 * meet here, and the rest of the loop cannot tell them apart.
 *
 * ## Bounds
 *
 * Rounds and calls are capped, a repeated lookup is served from a per-question
 * cache, and the last round is told it is the last and asked to answer with
 * what it has.
 */

/* ── protocol ───────────────────────────────────────────────────────────── */

export type Capability = 'tools' | 'widgets';

/** A lookup the model asked for, however it asked. */
interface Request {
  /** Registry id — `window.totals`, `product.price`, or `open_toolkit`. */
  readonly tool: string;
  readonly args: unknown;
  /** Present when the provider's own tool API carried the call. */
  readonly call: ToolCall | null;
}

/**
 * One line of the model's output, read as a protocol line.
 *
 * Deliberately forgiving about the wrapper and strict about the vocabulary: a
 * model that writes `{"need":"toolkit"}` gets the toolkit rather than being
 * ignored, which is the difference between a thread that recovers and one that
 * stalls silently.
 */
export function readDirective(value: unknown): Request | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const need = record['need'];
  if (typeof need === 'string') {
    const what = need.trim().toLowerCase();
    const capability =
      what === 'tools' || what === 'toolkit' || what === 'tool'
        ? 'tools'
        : what === 'widgets' || what === 'widget' || what === 'blocks'
          ? 'widgets'
          : null;

    return capability === null ? null : { tool: OPEN_TOOLKIT, args: { capability }, call: null };
  }

  const call = record['call'] ?? record['tool'] ?? record['run'];
  if (typeof call === 'string' && call.trim() !== '') {
    return { tool: call.trim(), args: record['args'] ?? {}, call: null };
  }

  return null;
}

/** The capability an `open_toolkit` call names, if it named a real one. */
export function capabilityOf(args: unknown): Capability | null {
  if (args === null || typeof args !== 'object') return null;
  const value = (args as Record<string, unknown>)['capability'];
  if (typeof value !== 'string') return null;

  const what = value.trim().toLowerCase();
  if (what === 'tools' || what === 'toolkit') return 'tools';
  if (what === 'widgets' || what === 'widget') return 'widgets';
  return null;
}

/** The document behind a capability, as the model is handed it. */
export function capabilityDocument(capability: Capability, context: ToolContext): string {
  return capability === 'tools' ? describeToolkit(context) : WIDGET_GUIDE;
}

/* ── options ────────────────────────────────────────────────────────────── */

export interface AgentMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AgentOptions {
  readonly settings: AiSettings;
  readonly system: string;
  /**
   * Everything this question has collected, carried between attempts.
   *
   * Built by `createSession` and owned by the caller precisely so that a run
   * which threw can be run again without losing what it had — see
   * `AgentSession`.
   */
  readonly session: AgentSession;
  readonly context: ToolContext;
  readonly language: Language;
  /**
   * Capabilities this thread has already been handed.
   *
   * Held by the caller and mutated here, so a follow-up question does not spend
   * a round re-asking for a document it already holds.
   */
  readonly granted: Set<Capability>;
  readonly signal: AbortSignal;
  /** Blocks, as they parse. The transcript grows while the model is writing. */
  readonly onBlocks: (blocks: readonly Block[]) => void;
  /**
   * The sentence being written, before the line carrying it has ended.
   *
   * Display only, and deliberately outside everything else this loop does: the
   * draft is never validated, never counted, never sent back to the model and
   * never becomes a block. The same text arrives a second time through
   * `onBlocks` when its line completes, which is the copy that counts — so a
   * caller that ignores this option gets exactly the behaviour it had before.
   */
  readonly onDraft?: (text: string) => void;
  /** An action the model may perform outright — navigation and the like. */
  readonly onRun: (action: ResolvedAction) => void;
  /**
   * How much looking-up this question may pay for.
   *
   * The panel's reasoning switch selects it. Off is not "answer from nothing" —
   * that would only produce a confident guess — it is a shorter leash: enough
   * rounds to fetch what a direct question needs, not enough to go exploring.
   */
  readonly budget?: { readonly rounds: number; readonly calls: number };
}

export interface AgentOutcome {
  readonly routes: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Prefix tokens the provider served from its cache rather than re-reading. */
  readonly cachedInputTokens: number;
  /** How many lines the seller never saw, after the rewrite had its turn. */
  readonly dropped: number;
  /** Why each of them was refused, in the same order. */
  readonly rejected: readonly string[];
  readonly rounds: number;
  readonly calls: number;
}

/**
 * Everything one question has collected so far.
 *
 * The loop used to hold all of this in local variables, which was fine while
 * the only two ways out were an answer and an error. A failure the seller can
 * *resume* needs a third: the work already done has to outlive the throw, or
 * "try again" means re-reading the archive, re-spending the tokens and asking
 * the model to write the same three paragraphs a second time.
 *
 * So the run's state is an object the caller owns. `runAgent` mutates it, and a
 * second call with the same session picks up at the round that failed — with
 * the documents it was handed and the lookups it ran all still there.
 */
export interface AgentSession {
  /** The conversation so far. A round is appended only once it has completed. */
  readonly messages: ChatMessage[];
  /**
   * Documents granted before this question began.
   *
   * Frozen at creation: they ride in the system prompt, and a document granted
   * *during* the question is already in the transcript as a tool reply — so a
   * resumed run must not print it a second time in the system prompt.
   */
  readonly carried: ReadonlySet<Capability>;
  readonly routes: Set<string>;
  /**
   * Lookups already answered during this question.
   *
   * A model three rounds deep does not always remember that it read the window
   * totals in round one, and asking again costs a worker job, possibly a fetch,
   * and the tokens of a result it already holds. Keyed on the arguments, so a
   * different window is a different lookup — and scoped to one question, so the
   * next question reads current rows rather than a stale answer.
   *
   * It is also what makes a resumed round cheap: the lookups it already ran are
   * served from here rather than from the archive.
   */
  readonly answered: Map<string, string>;
  /** The round to run next. Advanced only by a round that finished. */
  round: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /**
   * Lines the seller never saw, each with the reason it was refused.
   *
   * Kept for the whole question rather than the round, because the count under
   * the answer is about the question — and it *is* the count, so there is no
   * second number that can drift out of step with this list.
   */
  readonly rejected: Rejection[];
  /** Where this round's share of `rejected` begins. */
  rejectedAt: number;
  /** Whether the one rewrite this question is allowed has been spent. */
  corrected: boolean;
  /** Blocks handed to `onBlocks`, ever. */
  emitted: number;
  /**
   * What `emitted` was when the current round began.
   *
   * A round that fails part-way may have already put a paragraph or a trace on
   * screen, and resuming re-runs that round from its own beginning — so the
   * caller trims the transcript back to here first, and nothing is written
   * twice. See `truncate` in the chat store.
   */
  checkpoint: number;
}

export function createSession(input: {
  readonly question: string;
  readonly history: readonly AgentMessage[];
  /** Capabilities the thread already holds. Copied, never shared. */
  readonly carried?: ReadonlySet<Capability>;
}): AgentSession {
  return {
    messages: [...input.history, { role: 'user', content: input.question }],
    carried: new Set(input.carried ?? []),
    routes: new Set(),
    answered: new Map(),
    round: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    rejected: [],
    rejectedAt: 0,
    corrected: false,
    emitted: 0,
    checkpoint: 0,
  };
}

/** How many times the model may ask for something before it must answer. */
const MAX_ROUNDS = 5;
/** How many lookups one question may spend, across all rounds. */
const MAX_CALLS = 12;
/** How much of a round's own output is quoted back to it. */
const ECHO_LIMIT = 6_000;
/** How much of one refused line is quoted back — the whole of it is in the turn above. */
const LINE_ECHO_LIMIT = 300;

/**
 * The turn that asks for a discarded line back.
 *
 * The lines are quoted rather than counted. "A line was refused" is not
 * something a model can act on; the line it wrote beside the reason is, and
 * reading the two together is what makes the rewrite mechanical rather than a
 * guess.
 *
 * It is asked for only those lines because the rest of the round is already on
 * the seller's screen. A model that starts the answer over writes every
 * paragraph a second time, underneath the first.
 */
function rewriteRequest(rejected: readonly Rejection[]): string {
  return [
    'These lines were discarded before the seller saw them, each for the reason under it:',
    ...rejected.flatMap((rejection) => [
      `  ${rejection.line.slice(0, LINE_ECHO_LIMIT)}`,
      `    -> ${rejection.reason}`,
    ]),
    '',
    'Send them again, fixed: the same content in a shape the widget guide accepts — one JSON',
    'object per line, \\n for a line break inside a string, figures as plain numbers with a',
    "format, text within the limits. Send only these lines: the rest of your answer is already",
    "on the seller's screen.",
  ].join('\n');
}

/**
 * Buttons whose parameters the registry refuses, taken out before they are shown.
 *
 * The block schema accepts any `params`, because each action has its own and the
 * schema cannot know which. The renderer would then draw nothing for a malformed
 * one — silently, under a sentence telling the seller to press it. Checking here
 * turns that into a refused line with a reason, which the rewrite turn can fix.
 */
function checkActions(
  blocks: readonly Block[],
  reject: (line: string, reason: string) => void,
): readonly Block[] {
  const kept: Block[] = [];

  for (const block of blocks) {
    if (block.kind === 'action') {
      if (resolveAction(block.actionId, block.params) === null) {
        reject(
          JSON.stringify(block),
          `params: ${explainRejection(block.actionId, block.params)} — expected ${INSIGHT_ACTIONS[block.actionId].argsDoc}`,
        );
        continue;
      }
      kept.push(block);
      continue;
    }

    if (block.kind === 'callout') {
      const inner = checkActions(block.blocks, reject);
      if (inner.length > 0) kept.push({ ...block, blocks: inner });
      continue;
    }

    kept.push(block);
  }

  return kept;
}

/* ── the loop ───────────────────────────────────────────────────────────── */

export async function runAgent(options: AgentOptions): Promise<AgentOutcome> {
  const { session } = options;
  const { routes, answered, messages } = session;

  const native = supportsNativeTools(options.settings.provider);

  /* Documents granted by an earlier question, printed where the model can see
     them. The order is fixed so the prefix stays byte-identical between
     questions and a provider's prompt cache can serve it. */
  const system = withOpenedDocuments(
    options.system,
    (['tools', 'widgets'] as const)
      .filter((capability) => session.carried.has(capability))
      .map((capability) => ({
        name: capability === 'tools' ? 'TOOLKIT' : 'WIDGET GUIDE',
        text: capabilityDocument(capability, options.context),
      })),
  );

  /**
   * Blocks reach the transcript through here and nowhere else.
   *
   * Counting them is what makes a resume possible: the round that failed is
   * re-run from its beginning, so the caller has to know how much of the
   * transcript belongs to it.
   */
  const emit = (blocks: readonly Block[]): void => {
    if (blocks.length === 0) return;
    session.emitted += blocks.length;
    options.onBlocks(blocks);
  };

  /**
   * A resumed run rejoins the transcript where its last complete round left it.
   *
   * The caller has already trimmed the turn back to `checkpoint` — that is the
   * contract of resuming — so the counter comes back with it. Without this the
   * next checkpoint would be measured against blocks that are no longer on
   * screen, and a second failure would trim the wrong amount.
   */
  session.emitted = session.checkpoint;

  const maxRounds = Math.max(1, Math.min(MAX_ROUNDS, options.budget?.rounds ?? MAX_ROUNDS));
  const maxCalls = Math.max(1, Math.min(MAX_CALLS, options.budget?.calls ?? MAX_CALLS));

  /**
   * One place a line is lost, whatever lost it.
   *
   * A block shape the schema refuses, a line that never parsed, a button the
   * registry rejects and a request that read as nothing are different mistakes
   * with one remedy: say what happened and let the model write the line again.
   * Routing them through here is what lets a single turn fix any of them.
   */
  const reject = (line: string, reason: string): void => {
    session.rejected.push({ line, reason });
  };

  /**
   * One request per iteration, plus one at the end.
   *
   * The budget counts *rounds that may ask for something*. When it runs out the
   * model still gets a turn to answer with what it collected — without that,
   * the last thing it did was request a lookup, and the seller would watch a
   * question end on a tool result nobody wrote an answer for.
   */
  for (let round = session.round; ; round += 1) {
    const answering = round >= maxRounds;
    session.round = round;
    /* Where this round's output begins, so a failure can be rolled back to here
       and the round re-run without repeating a word of it. */
    session.checkpoint = session.emitted;
    session.rejectedAt = session.rejected.length;

    const stream = createBlockStream();
    const asked: Request[] = [];

    const harvest = (value: Harvest): void => {
      emit(checkActions(value.blocks, reject));

      for (const rejection of value.rejected) reject(rejection.line, rejection.reason);

      for (const entry of value.other) {
        const directive = readDirective(entry);
        if (directive === null) reject(JSON.stringify(entry), 'not a block and not a request');
        else asked.push(directive);
      }
    };

    const completion = await streamComplete({
      settings: options.settings,
      request: {
        system,
        messages,
        ...(native ? { tools: nativeToolSchemas(options.granted) } : {}),
        signal: options.signal,
      },
      onDelta: (chunk) => {
        harvest(pushChunk(stream, chunk));
        /* Read after the harvest, so a line that completed on this chunk has
           already left the buffer and the draft clears itself in the same call
           the finished block is emitted. */
        options.onDraft?.(previewText(stream));
      },
    });

    harvest(flush(stream));
    options.onDraft?.('');

    session.inputTokens += completion.inputTokens;
    session.outputTokens += completion.outputTokens;
    session.cachedInputTokens += completion.cachedInputTokens;

    /* Calls the provider parsed for us come first — a model that used both the
       tool API and the text protocol in one turn meant the tool API. */
    const parsed: Request[] = completion.calls.map((call) => ({
      tool: toolIdOfName(call.name),
      args: call.args,
      call,
    }));
    const requests = [...parsed, ...asked];

    /* A model that answered in a sentence despite being asked for objects has
       still answered, and a sentence is exactly what a text block holds. */
    const prose = takeProse(stream);
    if (requests.length === 0 && session.emitted === 0 && prose !== '') {
      emit([{ kind: 'text', text: prose }]);
    }

    if (answering || requests.length === 0) {
      /**
       * A line the seller never saw is worth one more turn.
       *
       * Whatever refused it — the block schema, a line that never parsed, a
       * button the registry rejected, a request that read as nothing — used to
       * tell nobody. A round whose only paragraph was refused therefore ended as
       * an empty answer with a warning underneath it, and the model, which could
       * have written the line another way, never learned there was anything to
       * write again.
       *
       * Once per question. A second failure means the model cannot say the
       * thing within the rule, and a third turn would spend tokens reaching the
       * same empty answer more slowly. The turn sits outside the lookup budget
       * on purpose: it asks for nothing and reads nothing.
       *
       * The assistant turn goes back without its tool calls. There are none on
       * this path unless the budget cut the round short, and a call left
       * unanswered in the transcript is a 400 from every provider that parses
       * one.
       */
      const mine = session.rejected.slice(session.rejectedAt);

      if (mine.length > 0 && !session.corrected) {
        session.corrected = true;
        /* Not losses yet — they are being asked for again, so they come off the
           count. A rewrite that fails too is counted when the next round ends. */
        session.rejected.length = session.rejectedAt;

        messages.push({ role: 'assistant', content: completion.text.slice(0, ECHO_LIMIT) });
        messages.push({ role: 'user', content: rewriteRequest(mine) });

        session.round = round + 1;
        continue;
      }

      /* Answered. Nothing is owed, and a session reused by accident would not
         re-ask the round that produced this. */
      session.round = round + 1;
      break;
    }

    /* ── serve what was asked for ──────────────────────────────────────── */

    /* The next turn is the answering one, so say so now — a model told after
       the fact that it is out of lookups has already spent the turn. */
    const last = round + 1 >= maxRounds;
    const nudge = last
      ? 'That was the last lookup for this question. Answer now with what you have, and say plainly if something is still missing.'
      : 'Continue with the seller’s question. Ask for another lookup only if the answer genuinely needs it.';

    const nativeReplies: ToolReply[] = [];
    const textReplies: string[] = [];

    for (const request of requests) {
      let text: string;

      if (request.tool === OPEN_TOOLKIT) {
        const capability = capabilityOf(request.args);

        if (capability === null) {
          text = `[${OPEN_TOOLKIT}] "capability" must be "tools" or "widgets".`;
        } else if (session.carried.has(capability)) {
          text = `[${capability}] already open — it is printed under OPENED DOCUMENTS in your instructions. Use it from there.`;
        } else if (options.granted.has(capability)) {
          text = `[${capability}] already open in this conversation — use what you were given above rather than asking again.`;
        } else {
          options.granted.add(capability);
          text = capabilityDocument(capability, options.context);
        }
      } else if (session.calls >= maxCalls) {
        text = `[${request.tool}] not run — this question has spent its ${maxCalls} lookups. Answer with what you have.`;
      } else {
        session.calls += 1;
        text = await serve(request, options, emit, { routes, answered });
      }

      if (request.call !== null) {
        nativeReplies.push({ id: request.call.id, name: request.call.name, content: text });
      } else {
        textReplies.push(text);
      }
    }

    /**
     * The nudge rides on the last result rather than in a message of its own.
     *
     * Every provider has an opinion about what may follow a tool result, and
     * none of them is "another user message" in every case. Appending is always
     * legal and says the same thing.
     */
    if (textReplies.length > 0) {
      textReplies.push(nudge);
    } else {
      const tail = nativeReplies[nativeReplies.length - 1];
      if (tail !== undefined) {
        nativeReplies[nativeReplies.length - 1] = {
          ...tail,
          content: `${tail.content}\n\n${nudge}`,
        };
      }
    }

    messages.push({
      role: 'assistant',
      content: completion.text.slice(0, ECHO_LIMIT),
      ...(completion.calls.length === 0 ? {} : { calls: completion.calls }),
    });

    if (nativeReplies.length > 0) messages.push({ role: 'tool', replies: nativeReplies });
    if (textReplies.length > 0) {
      messages.push({ role: 'user', content: textReplies.join('\n\n') });
    }

    /* The round is complete and in the transcript. A resume picks up at the
       next one rather than repeating this. */
    session.round = round + 1;
  }

  return {
    routes: [...routes],
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cachedInputTokens: session.cachedInputTokens,
    dropped: session.rejected.length,
    rejected: session.rejected.map((rejection) => rejection.reason),
    rounds: session.round,
    calls: session.calls,
  };
}

/* ── serving one call ───────────────────────────────────────────────────── */

interface Ledger {
  readonly routes: Set<string>;
  readonly answered: Map<string, string>;
}

/** Stable enough that `{limit:10}` asked twice is one question. */
export function cacheKey(tool: string, args: unknown): string {
  const value = args === null || typeof args !== 'object' ? {} : (args as Record<string, unknown>);
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `${tool}|${JSON.stringify(entries)}`;
}

/**
 * A call, run or offered.
 *
 * Reads run. Actions do not: an action with risk `none` reaches no network and
 * is performed at once, and everything else becomes a button in the answer with
 * the parameters the model chose already validated against the registry. Either
 * way the model is told exactly what happened, in the same plain-text envelope
 * a lookup answers in — including that a button is *not* a completed write, so
 * it does not go on to report a price change that has not happened.
 */
async function serve(
  request: Request,
  options: AgentOptions,
  /** The counting emitter — a trace or a button is transcript like any block. */
  emit: (blocks: readonly Block[]) => void,
  ledger: Ledger,
): Promise<string> {
  const { tool, args } = request;

  if (tool in INSIGHT_ACTIONS) {
    const definition = INSIGHT_ACTIONS[tool as InsightActionId];
    const resolved = resolveAction(tool, args);

    if (resolved === null) {
      return `[${tool}] rejected — ${explainRejection(tool, args)}. Expected ${definition.argsDoc}`;
    }

    /* A follow-up question called rather than placed. Running it would start a
       second question underneath the one still being answered, so it becomes
       the chip it was meant to be. */
    if (resolved.actionId === 'copilot.ask') {
      emit([{ kind: 'action', actionId: resolved.actionId, params: resolved.params }]);
      return `[${tool}] follow-up chip placed under your answer. Carry on with the answer itself.`;
    }

    if (definition.risk === 'none') {
      options.onRun(resolved);
      return `[${tool}] done. It changed nothing at Uzum — mention it in passing, do not make it the answer.`;
    }

    emit([{ kind: 'action', actionId: resolved.actionId, params: resolved.params }]);
    return [
      `[${tool}] button placed in your answer · ${definition.endpoint ?? 'local'} · risk ${definition.risk}.`,
      'The seller has NOT pressed it and may never. Say what it would do, never that it is done.',
      'Do not place the same button twice.',
    ].join('\n');
  }

  const key = cacheKey(tool, args);
  const cached = ledger.answered.get(key);
  if (cached !== undefined) {
    emit([{ kind: 'trace', tool, detail: 'cached' }]);
    return `${cached}\n\n(You already ran this lookup for this question — this is the same result.)`;
  }

  const result = await runReadTool(tool, args, options.context);

  /* The transcript shows what was read, in the order it was read. A figure the
     seller can trace back to a named lookup over a named window is a different
     claim from the same figure appearing on its own. */
  emit([{ kind: 'trace', tool, detail: result.trace ?? '' }]);

  for (const route of result.routes ?? []) ledger.routes.add(route);

  ledger.answered.set(key, result.text);
  return result.text;
}

/* ── history ────────────────────────────────────────────────────────────── */

/**
 * A previous answer, as prose.
 *
 * The obvious thing is to send the model its own blocks back. It is also the
 * wasteful thing: the JSON scaffolding is several times the size of what it
 * actually said, and the model does not need to re-read its own markup to
 * remember its own argument. So a past turn is flattened to its sentences and
 * the figures it showed — enough for "and what about that product?" to know
 * which product, and cheaper than the answer it summarises.
 */
export function summariseAnswer(blocks: readonly Block[], language: Language): string {
  const parts: string[] = [];
  const LIMIT = 10;

  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      if (parts.length >= LIMIT) return;

      switch (block.kind) {
        case 'text':
          if (typeof block.text === 'string') parts.push(block.text.slice(0, 600));
          break;
        case 'metric': {
          const label = typeof block.label === 'string' ? `${block.label}: ` : '';
          const change = block.change === undefined ? '' : ` (${formatChange(block.change)})`;
          parts.push(`${label}${formatFigure(block.value, block.format, language)}${change}`);
          break;
        }
        case 'kv':
          parts.push(
            block.rows
              .slice(0, 6)
              .map((row) => `${typeof row.label === 'string' ? row.label : ''}: ${formatFigure(row.value, row.format, language)}`)
              .join('; '),
          );
          break;
        case 'steps':
          parts.push(
            block.items
              .slice(0, 6)
              .map((item) =>
                `${typeof item.text === 'string' ? item.text : ''}${item.value === undefined ? '' : ` ${formatFigure(item.value, item.format, language)}`}`,
              )
              .join('; '),
          );
          break;
        case 'table':
          parts.push(
            `[table ${block.columns.filter((column) => typeof column === 'string').join(' | ')}: ${block.rows.length} rows, first: ${block.rows[0]?.map(String).join(' | ') ?? ''}]`,
          );
          break;
        case 'chart':
          parts.push(
            block.chart === 'line'
              ? `[line chart${typeof block.title === 'string' ? ` "${block.title}"` : ''} over ${block.labels?.length ?? 0} buckets]`
              : `[${block.chart} chart: ${(block.items ?? []).map((item) => `${typeof item.label === 'string' ? item.label : ''} ${formatFigure(item.value, block.format, language)}`).join('; ')}]`,
          );
          break;
        case 'callout':
          walk(block.blocks);
          break;
        default:
          break;
      }
    }
  };

  walk(blocks);
  return parts.join('\n');
}
