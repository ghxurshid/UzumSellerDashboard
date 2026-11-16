/**
 * Types shared by the engine and both hosts.
 *
 * Only vocabulary that references no site type belongs here; the screen-level
 * domain model stays in `frontend/src/types/domain.ts`, which re-exports these.
 */

export type ThemeMode = 'dark' | 'light' | 'system';
export type Language = 'uz' | 'en' | 'ru';

export type Trend = 'up' | 'down' | 'flat';
export type Tone = 'positive' | 'negative' | 'warning' | 'neutral' | 'accent';

export type ChatRole = 'user' | 'assistant';

export type ToastKind = 'ok' | 'err' | 'warn' | 'info' | 'load';

export interface Toast {
  readonly id: string;
  readonly text: string;
  readonly kind: ToastKind;
  readonly actionLabel?: string;
  /** Sticky toasts stay until dismissed — used for in-flight work. */
  readonly sticky?: boolean;
}
