import type { ResolvedAction } from '@core/agent/actionRegistry';
import type { Block } from '@core/agent/blocks';
import type { TranslationKey } from '@core/i18n/dictionary';
import type { AgentToolkit, BaseToolContext } from '@core/tools/contract';
import type { Language } from '@core/types/common';

/**
 * Everything the Copilot panel needs from the page it sits in.
 *
 * The panel and the conversation logic under it are the same code in every
 * host; what differs is where the data comes from, what a button may do and how
 * the seller reaches the AI settings. Those differences are this one object —
 * and nothing else crosses the border, so core never has to import a router, a
 * site store or a query hook to draw a chat.
 *
 * The host builds it from whatever it has (a hook on the site, a session read in
 * the extension) and hands it to `<CopilotPanel host={…} />`. A new object
 * on every render is fine: a question uses the one the panel was last given.
 */

/** What a host returns for one run — the prompt and the lookups' shared context. */
export interface PreparedRun<C extends BaseToolContext = BaseToolContext> {
  /** The base system prompt; the engine appends the capability documents the thread holds. */
  readonly system: string;
  /** Handed to every lookup this run makes. Its `signal` should be the one `prepare` received. */
  readonly context: C;
  /** The period the answer is about, if the host has one. Printed on a pinned answer. */
  readonly window?: { readonly fromMs: number; readonly toMs: number };
}

/** What `prepare` is told about the run it is preparing. */
export interface PrepareInput {
  readonly language: Language;
  readonly now: number;
  /** Whether the active provider takes native tool declarations. */
  readonly native: boolean;
  /** Aborts when the seller cancels; a preparation still pending then must give up. */
  readonly signal: AbortSignal;
}

/** An answer the seller keeps, exactly as the host's pin list stores it. */
export interface CopilotPin {
  readonly id: string;
  /** The question that produced it. */
  readonly title: string;
  readonly blocks: readonly Block[];
  readonly createdAt: number;
  readonly window?: { readonly fromMs: number; readonly toMs: number };
}

export interface CopilotPinning {
  /** Reactive to the host's own list — the panel reads it during render. */
  isPinned(id: string): boolean;
  add(pin: CopilotPin): void;
  /**
   * The part of an answer worth keeping. The host decides: the site drops
   * traces and buttons, because a pinned card states and never acts.
   */
  pinnable(blocks: readonly Block[]): readonly Block[];
}

export interface CopilotHost<C extends BaseToolContext = BaseToolContext, A extends string = string> {
  /** The lookups and buttons the model may use on this host. */
  readonly toolkit: AgentToolkit<C, A>;

  /**
   * Called for every question and for every resume: the system prompt and the
   * lookup context for this run.
   *
   * May be async — the extension reads a fresh session first. A resume prepares
   * again but continues the same agent session, so what the model already
   * collected is kept while the context is rebuilt from the present. If
   * `signal` aborts while this is pending the panel does not start the run.
   */
  prepare(input: PrepareInput): Promise<PreparedRun<C>>;

  /**
   * Perform an action: one the model ran outright (risk `none`) or one the
   * seller pressed. A host that holds writes for confirmation does it here and
   * draws its dialog through the panel's `overlays` slot.
   */
  runAction(action: ResolvedAction<A>): void;

  /** Take the seller to the AI settings — the "not configured" banner's button. */
  openSettings(): void;

  /** Starter questions for an empty thread. */
  readonly suggestions: readonly TranslationKey[];

  /** Optional. A host without pins shows no pin button. */
  readonly pins?: CopilotPinning;
}
