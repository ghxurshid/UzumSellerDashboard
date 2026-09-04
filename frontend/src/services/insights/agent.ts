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
import { statesRawNumber, type Block } from './blocks';
import { formatFact, type Fact, type FactSeries, type FactTable, type SeriesTable } from './facts';
import { createBlockStream, flush, previewText, pushChunk, takeProse } from './ndjson';
import { renderTemplate } from './template';
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
 * needs, reads, thinks, asks again if the first answer raised a second
 * question, and stops when it has enough. Each request is one round; the
 * documents and results it collected stay in the message list, so nothing is
 * re-derived and nothing is re-sent that was not asked for.
 *
 *     base system prompt          identity, boundaries, "ask for what you need"
 *       ↳ open the toolkit        the catalogue, once per thread
 *       ↳ call a lookup           run against the archive
 *       ↳ open the widget guide   how to draw, once per thread
 *       ↳ blocks                  the answer, streamed
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

/* ── options ────────────────────────────────────────────────────────────── */

export interface AgentMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** A lookup that ran and produced figures — what a pinned answer replays. */
export interface ExecutedCall {
  readonly tool: string;
  readonly args: unknown;
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
   * a round re-asking for a document that is already in the transcript.
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
  /** The tables the answer's refs resolve against, after every round. */
  readonly onGround: (facts: FactTable, series: SeriesTable) => void;
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
  /** Lines the model sent that were neither a block nor a directive. */
  readonly dropped: number;
  readonly rounds: number;
  readonly calls: number;
  /** Lookups that ran, in order — enough to reproduce this answer later. */
  readonly plan: readonly ExecutedCall[];
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
 * the documents it was handed, the lookups it ran and the facts they produced
 * all still there.
 */
export interface AgentSession {
  /** The conversation so far. A round is appended only once it has completed. */
  readonly messages: ChatMessage[];
  readonly facts: Map<string, Fact>;
  readonly series: Map<string, FactSeries>;
  readonly routes: Set<string>;
  readonly plan: ExecutedCall[];
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
  dropped: number;
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
  /** Facts that resolve before any lookup runs — the screen's own totals. */
  readonly seed: FactTable;
}): AgentSession {
  return {
    messages: [...input.history, { role: 'user', content: input.question }],
    facts: new Map(input.seed),
    series: new Map(),
    routes: new Set(),
    plan: [],
    answered: new Map(),
    round: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    dropped: 0,
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

/* ── the loop ───────────────────────────────────────────────────────────── */

export async function runAgent(options: AgentOptions): Promise<AgentOutcome> {
  const { session } = options;
  const { facts, series, routes, plan, answered, messages } = session;

  const native = supportsNativeTools(options.settings.provider);

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
   * Blocks are filtered on the way in, not on the way out.
   *
   * `statesRawNumber` is the enforcement half of the "never type a figure"
   * rule: a model that slipped and wrote a percentage into a sentence loses
   * that block here rather than putting an unverifiable number in front of a
   * seller. Dropping is counted and reported under the answer.
   */
  const accept = (blocks: readonly Block[]): readonly Block[] =>
    blocks.filter((block) => {
      if (block.kind !== 'text' || typeof block.text !== 'string') return true;
      if (!statesRawNumber(block.text)) return true;
      session.dropped += 1;
      return false;
    });

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

    const stream = createBlockStream();
    const asked: Request[] = [];

    const harvest = (value: { blocks: readonly Block[]; other: readonly unknown[] }): void => {
      emit(accept(value.blocks));

      for (const entry of value.other) {
        const directive = readDirective(entry);
        if (directive === null) session.dropped += 1;
        else asked.push(directive);
      }
    };

    const completion = await streamComplete({
      settings: options.settings,
      request: {
        system: options.system,
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
       still answered. Keeping it is better than an empty bubble — and it goes
       through the same number guard as anything else it writes. */
    const prose = takeProse(stream);
    if (requests.length === 0 && session.emitted === 0 && prose !== '') {
      emit(accept([{ kind: 'text', text: prose }]));
    }

    if (answering || requests.length === 0) {
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
        } else if (options.granted.has(capability)) {
          text = `[${capability}] already open in this thread — use what you were given rather than asking again.`;
        } else {
          options.granted.add(capability);
          text = capability === 'tools' ? describeToolkit(options.context) : WIDGET_GUIDE;
        }
      } else if (session.calls >= maxCalls) {
        text = `[${request.tool}] not run — this question has spent its ${maxCalls} lookups. Answer with what you have.`;
      } else {
        session.calls += 1;
        text = await serve(request, options, emit, { facts, series, routes, plan, answered });
      }

      if (request.call !== null) {
        nativeReplies.push({ id: request.call.id, name: request.call.name, content: text });
      } else {
        textReplies.push(text);
      }
    }

    options.onGround(new Map(facts) as FactTable, new Map(series) as SeriesTable);

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

  options.onGround(new Map(facts) as FactTable, new Map(series) as SeriesTable);

  return {
    routes: [...routes],
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cachedInputTokens: session.cachedInputTokens,
    dropped: session.dropped,
    rounds: session.round,
    calls: session.calls,
    plan,
  };
}

/* ── serving one call ───────────────────────────────────────────────────── */

interface Ledger {
  readonly facts: Map<string, Fact>;
  readonly series: Map<string, FactSeries>;
  readonly routes: Set<string>;
  readonly plan: ExecutedCall[];
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

  for (const fact of result.facts ?? []) ledger.facts.set(fact.ref, fact);
  for (const entry of result.series ?? []) ledger.series.set(entry.ref, entry);
  for (const route of result.routes ?? []) ledger.routes.add(route);

  /* Only a lookup that produced figures is worth replaying later. */
  if ((result.facts?.length ?? 0) > 0 || (result.series?.length ?? 0) > 0) {
    ledger.plan.push({ tool, args });
  }

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
 * remember its own argument. So a past turn is flattened to a sentence or two
 * with the figures resolved — which is both cheaper and closer to what a person
 * would recall of the exchange.
 */
export function summariseAnswer(
  blocks: readonly Block[],
  facts: FactTable,
  language: Language,
): string {
  const parts: string[] = [];

  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      if (parts.length >= 6) return;

      switch (block.kind) {
        case 'text':
          if (typeof block.text === 'string') {
            parts.push(renderTemplate(block.text, facts, language));
          }
          break;
        case 'metric': {
          const fact = facts.get(block.ref);
          if (fact !== undefined) parts.push(`${fact.label}: ${formatFact(fact, language)}`);
          break;
        }
        case 'kv':
          for (const row of block.rows.slice(0, 4)) {
            const fact = facts.get(row.ref);
            if (fact !== undefined) parts.push(`${fact.label}: ${formatFact(fact, language)}`);
          }
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
  return parts.join(' ');
}
