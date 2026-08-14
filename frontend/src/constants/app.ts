import type { ModuleKey, ScreenKey, ScreenState, StateKind } from '@/types/domain';

/** Screens that use the generic data-module shell. */
export const MODULE_KEYS = ['inventory', 'ops', 'invoices', 'finance'] as const satisfies readonly ModuleKey[];

export const SCREEN_KEYS = [
  'overview',
  'products',
  'inventory',
  'ops',
  'invoices',
  'finance',
  'settings',
] as const satisfies readonly ScreenKey[];

/**
 * How each screen state resolves: render content, render a skeleton, or take
 * over the pane with a full-page block. Exhaustive over `ScreenState`, so a
 * state added there cannot silently fall through to "content".
 */
export const STATE_KIND: Readonly<Record<ScreenState, StateKind>> = {
  loaded: 'ok',
  refreshing: 'ok',
  partial: 'ok',
  success: 'ok',
  warning: 'ok',
  validation: 'ok',
  readonly: 'ok',
  disabled: 'ok',
  processing: 'ok',
  downloading: 'ok',
  loading: 'skel',
  skeleton: 'skel',
  initial: 'block',
  empty: 'block',
  noSearch: 'block',
  noFilter: 'block',
  error: 'block',
  offline: 'block',
  timeout: 'block',
  unauth: 'block',
  forbidden: 'block',
};

/** Layout widths the window chrome switches between, in px. */
export const WINDOW = {
  dockedWidth: 470,
  maxWidth: 1420,
  railWidth: 52,
  chatWidth: 433,
  titlebarHeight: 38,
  topbarHeight: 46,
  /** Below this the insights rail is hidden rather than squeezed. */
  insightsMinAvailable: 900,
} as const;

export const TOAST_TIMEOUT_MS = 3600;

export const PRODUCT_PAGE_SIZES = [10, 25, 50, 100] as const;
export const MODULE_PAGE_SIZES = [10, 25, 50] as const;

export const DEFAULT_PRODUCT_PAGE_SIZE = 10;
export const DEFAULT_MODULE_PAGE_SIZE = 10;

/** Cancellation reasons the Uzum FBS API accepts. */
export const CANCEL_REASONS = [
  'OUT_OF_STOCK',
  'OUT_OF_PACKAGE',
  'OUT_OF_TIME',
  'OTHER',
  'ACCEPTANCE_TIME_EXPIRED',
  'DELIVERY_TIME_EXPIRED',
  'RETURNED_BY_CUSTOMER',
  'CANCELED_BY_CUSTOMER',
  'MARKET_REASON',
] as const;

/** Injected from package.json at build time — see `vite.config.ts`. */
declare const __APP_VERSION__: string;

export const APP_VERSION_LABEL = `v${__APP_VERSION__}`;
