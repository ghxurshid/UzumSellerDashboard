/**
 * Domain model — the shapes the screens render.
 *
 * Field names mirror the Uzum seller OpenAPI (`sellPrice`, `quantityActive`,
 * `logisticDeliveryFee`, …) because every figure here is summed from what that
 * API returned; keeping the names means a number on screen can always be traced
 * back to the field it came from. The wire types themselves live in
 * `services/uzum/types.ts`; these are their derived, presentational form.
 */

export type ScreenKey =
  | 'overview'
  | 'products'
  | 'inventory'
  | 'ops'
  | 'invoices'
  | 'finance'
  | 'settings';

/** Screens rendered by the generic data-module shell rather than a bespoke page. */
export type ModuleKey = Extract<ScreenKey, 'inventory' | 'ops' | 'invoices' | 'finance'>;

/**
 * Every state a screen can resolve to.
 *
 * Each one is produced by a real condition — see `hooks/useScreenStatus.ts`,
 * which owns the precedence between them. None of these can be set by hand.
 */
export type ScreenState =
  | 'loaded'
  | 'initial'
  | 'loading'
  | 'skeleton'
  | 'refreshing'
  | 'partial'
  | 'empty'
  | 'noSearch'
  | 'noFilter'
  | 'validation'
  | 'success'
  | 'warning'
  | 'readonly'
  | 'disabled'
  | 'processing'
  | 'downloading'
  | 'error'
  | 'timeout'
  | 'offline'
  | 'unauth'
  | 'forbidden';

/** How a screen state resolves visually: content, skeleton, or a full-page block. */
export type StateKind = 'ok' | 'skel' | 'block';

export type NetworkState = 'online' | 'offline';
export type SessionState = 'ok' | 'expired';
export type ThemeMode = 'dark' | 'light' | 'system';
export type Language = 'uz' | 'en' | 'ru';

export type Trend = 'up' | 'down' | 'flat';
export type Tone = 'positive' | 'negative' | 'warning' | 'neutral' | 'accent';

/* ── stores & range ─────────────────────────────────────────────────────── */

/** A shop the token can see, as `GET /v1/shops` returns it. */
export interface Store {
  readonly key: string;
  readonly id: number;
  readonly name: string;
  readonly sub: string;
}

export type RangeKey = 'r7' | 'r30' | 'r90' | 'ryear';

/* ── metrics ────────────────────────────────────────────────────────────── */

export interface Kpi {
  readonly key: string;
  /** i18n key for the tile label, or a raw API field name where none applies. */
  readonly labelKey: string;
  readonly value: string;
  readonly unit: string;
  /** Empty when no comparable previous period has been read — never invented. */
  readonly delta: string;
  readonly trend: Trend;
  /** Sparkline points in the 88×24 viewBox the design draws. */
  readonly spark: readonly number[];
  /** What the tile is summed from, shown on hover. */
  readonly source?: string;
}

export interface TickerItem {
  readonly key: string;
  readonly labelKey: string;
  readonly value: string;
  readonly delta: string;
  readonly trend: Trend;
}

export interface EconomicsRow {
  readonly key: string;
  readonly labelKey: string;
  /** The API field this line is summed from — shown in mono next to the label. */
  readonly field: string;
  readonly value: string;
  readonly pct: number;
  readonly tone: Tone;
}

export interface SeriesPoint {
  readonly label: string;
  readonly revenue: number;
  readonly profit: number;
}

/**
 * A portfolio bucket on the overview.
 *
 * `rankInfo.rank` comes back `D · Ma'lumotlar yo'q` on every SKU of a typical
 * account, so there is no ABC×XYZ class to show. What the API does carry is
 * `status.value` per product, and that is what these buckets count — the label
 * is the API's own `status.title`, not a translation key.
 */
export interface RankBucket {
  readonly key: string;
  readonly code: string;
  readonly label: string;
  readonly count: number;
}

export interface HeatCell {
  readonly weekday: number;
  readonly hour: number;
  readonly intensity: number;
}

/* ── products ───────────────────────────────────────────────────────────── */

export type ProductStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'RUN_OUT'
  | 'ARCHIVED'
  | 'DEFECTED'
  | 'WARNING';

export type ProductFilter =
  | 'ALL'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'WARNING'
  | 'WITH_SKU'
  | 'ARCHIVE'
  | 'DEFECTED'
  | 'WITHOUT_REQUIRED_FILTERS';

export type ProductSortKey =
  | 'DEFAULT'
  | 'ORDERS'
  | 'PRICE'
  | 'ID'
  | 'ROI'
  | 'CONVERSION'
  | 'LEFTOVERS'
  | 'CREATED_AND_TITLE';

export type SortDirection = 'asc' | 'desc';

export interface Sku {
  readonly skuId: number;
  readonly skuTitle: string;
  readonly barcode: string;
  readonly characteristics: string;
  readonly price: number;
  readonly purchasePrice: number;
  readonly quantityAvailable: number;
  readonly quantityActive: number;
  readonly quantityFbs: number;
  readonly quantitySold: number;
  readonly quantityReturned: number;
}

export interface Product {
  readonly productId: number;
  /** The shop the product belongs to — needed for every write against it. */
  readonly shopId: number;
  readonly sku: string;
  readonly name: string;
  readonly price: number;
  readonly purchasePrice: number;
  /** `price × quantitySold` over the catalogue's own lifetime counters. */
  readonly turnover: number;
  readonly sold: number;
  readonly returnedPct: number;
  readonly quantityAvailable: number;
  readonly quantityActive: number;
  readonly quantityFbs: number;
  /** `rankInfo.rank`, or `—` where the account has no rank data. */
  readonly rank: string;
  readonly status: ProductStatus;
  /** The API's own localised status label. */
  readonly statusTitle: string;
  readonly skus: readonly Sku[];
}

export interface ProductFact {
  readonly labelKey: string;
  readonly field: string;
  readonly value: string;
  readonly tone: Tone;
}

export interface MovementRow {
  readonly labelKey: string;
  readonly value: string;
  readonly pct: number;
  readonly tone: Tone;
}

/* ── generic data module (inventory / ops / invoices / finance) ──────────── */

export type CellKind = 'plain' | 'pill';

export interface ModuleCell {
  readonly kind: CellKind;
  readonly value: string;
  readonly sub?: string;
  readonly icon?: string;
  readonly tone?: Tone;
  readonly align: 'start' | 'end';
}

export interface ModuleRowDetailItem {
  readonly icon: string;
  readonly text: string;
  readonly value: string;
  readonly time: string;
  readonly tone: Tone;
}

/**
 * A write the row supports. Every one maps to a documented seller-OpenAPI
 * call — there is no action here the API cannot actually perform.
 */
export type RowActionKey =
  | 'stock'
  | 'price'
  | 'labels'
  | 'confirm'
  | 'cancelOrder'
  | 'identifiers'
  | 'deliver'
  | 'complete'
  | 'refund'
  | 'createInvoice'
  | 'cancelInvoice'
  | 'updateContent'
  | 'timeSlot'
  | 'printSupply'
  | 'printAcceptance'
  | 'export';

export interface ModuleRowAction {
  readonly act: RowActionKey;
  readonly labelKey: string;
  readonly icon: string;
  /** The endpoint this action calls, shown to the user before they commit. */
  readonly endpoint: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
}

export interface ModuleRowDetail {
  readonly note: string;
  readonly facts: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly list: readonly ModuleRowDetailItem[];
  readonly actions: readonly ModuleRowAction[];
}

export interface ModuleRow {
  readonly id: string;
  readonly cells: readonly ModuleCell[];
  readonly tab: string;
  /** Values the table sorts on, positionally aligned with `cells`. */
  readonly sortValues: ReadonlyArray<string | number>;
  /** Lower-cased haystack the search box matches against. */
  readonly search: string;
  /** Identifiers the row's actions need, straight from the API payload. */
  readonly raw: Readonly<Record<string, string | number | boolean | null>>;
  readonly detail: ModuleRowDetail;
}

export interface ModuleColumn {
  readonly key: string;
  /** Column heading. API field names are shown verbatim, not translated. */
  readonly label: string;
  readonly align: 'start' | 'end';
  readonly width: string;
  readonly sortable: boolean;
}

export interface ModuleTab {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface ModuleDefinition {
  readonly key: ModuleKey;
  readonly titleKey: string;
  /** The endpoints this screen is built from, shown under the title. */
  readonly source: string;
  readonly icon: string;
  readonly kpis: readonly Kpi[];
  readonly tabs: readonly ModuleTab[];
  readonly columns: readonly ModuleColumn[];
  readonly rows: readonly ModuleRow[];
  readonly searchable: boolean;
  readonly searchPlaceholder: string;
  /** Bulk writes offered for a selection on this screen. */
  readonly bulkActions: readonly ModuleRowAction[];
  /** True when a page ceiling stopped the read short of the reported total. */
  readonly truncated: boolean;
  /** Rows the API says exist, which can exceed `rows.length`. */
  readonly total: number;
}

/* ── notifications, insights, chat ──────────────────────────────────────── */

/**
 * An event that already happened.
 *
 * Notifications are appended when the application observes something — a sync
 * finishing, a write being rejected, stock going negative. Nothing is seeded at
 * startup, so an empty bell is the correct state for a quiet account.
 */
export interface Notification {
  readonly id: string;
  readonly text: string;
  /** Epoch ms of the event; the menu renders it as a relative age. */
  readonly at: number;
  readonly icon: string;
  readonly tone: Tone;
  readonly read: boolean;
}

/**
 * How much a finding costs to ignore.
 *
 * The card that carries it lives in `services/insights/blocks.ts`, because its
 * body is a composed document rather than a fixed record and belongs with the
 * language it is composed in. This stays here: the rail sorts, counts and
 * colours by severity, and those are decisions about the domain rather than
 * about how a card is drawn.
 */
export type InsightSeverity = 'critical' | 'high' | 'watch' | 'idea';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly text: string;
  readonly time: string;
  readonly pending?: boolean;
}

/* ── toasts, progress, confirmations ────────────────────────────────────── */

export type ToastKind = 'ok' | 'err' | 'warn' | 'info' | 'load';

export interface Toast {
  readonly id: string;
  readonly text: string;
  readonly kind: ToastKind;
  readonly actionLabel?: string;
  readonly sticky?: boolean;
}

/**
 * A long-running operation the user can watch.
 *
 * `pct` is null while the work has no measurable total — a single request whose
 * duration is unknown gets an indeterminate bar rather than an invented
 * percentage. Only work counted in steps (rows serialised, orders confirmed)
 * reports a number.
 */
export interface ProgressTask {
  readonly label: string;
  readonly sub: string;
  readonly kind: 'proc' | 'down';
  readonly pct: number | null;
  readonly cancellable: boolean;
}

export interface ConfirmRequest {
  readonly title: string;
  readonly body: string;
  readonly cta: string;
  readonly tone: 'warn' | 'accent';
}
