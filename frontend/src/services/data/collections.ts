import type { Scope } from '@/services/api/queryKeys';
import type { SourceProgressReporter } from '@/services/queries/progress';
import type { SourceId } from '@/services/queries/sourceIds';
import {
  ENTITY_TYPES,
  archivedShops,
  readExpenses as readExpenseRows,
  readFbsInvoices,
  readFbsOrderItemsIn,
  readFbsOrders,
  readFbsStocks,
  readLedger,
  readMeta,
  readProducts as readProductRows,
  readProductSkus,
  readReturnLines,
  readSellerReturns,
  readSupplyInvoiceLines,
  readSupplyInvoices,
  type EntityType,
} from '@/services/storage/archive/archive.service';
import { bounds } from '@/services/storage/archive/coverage';
import {
  recordToFbsInvoice,
  recordToFbsOrder,
  recordToProduct,
  recordToReturn,
  recordToStock,
  recordToSupplyInvoice,
} from '@/services/storage/idb/mappers';
import { toCoverage } from '@/services/storage/idb/metadata.repo';
import type {
  FbsOrderItemRecord,
  ProductSkuRecord,
  ReturnItemRecord,
  SupplyInvoiceItemRecord,
} from '@/services/storage/idb/schema';
import { readDataSettings } from '@/services/storage/settings.service';
import { ensureWindowAcross } from '@/services/sync/lazySync';
import { captureSnapshotsAcross } from '@/services/sync/snapshotSync';
import { FBS_ORDER_STATUSES, type FbsCountedStatus } from '@/services/uzum/endpoints';
import type {
  FbsInvoice,
  FbsOrder,
  FinanceOrderItem,
  SellerPayment,
  SellerReturn,
  ShopProduct,
  SkuAmount,
  SupplyInvoice,
} from '@/services/uzum/types';
import { useSyncStore } from '@/store/sync.store';

/**
 * The one door to every collection Uzum publishes.
 *
 * There used to be two. Settled history went through the archive — plan the
 * window, fetch the gaps, read the rows back — while the catalogue, stock and
 * invoices went through a separate buffer that stored a packed payload per
 * source and selection. The same catalogue therefore existed twice, in two
 * shapes, refreshed on two different rules, and which copy a screen saw
 * depended on which path it happened to take.
 *
 * Now every collection is read here, out of the normalised tables, and the
 * difference between the two kinds survives only where the API forces it:
 *
 *   **`sync: true` on a windowed collection** plans the requested period and
 *   fetches only the stretches coverage does not already claim. `finance`,
 *   `expenses` and `orders` are windowed because `/v1/finance/orders`,
 *   `/v1/finance/expenses` and `/v2/fbs/orders` are the only three routes that
 *   accept `dateFrom`/`dateTo`.
 *
 *   **`sync: true` on a snapshot collection** re-captures the collection whole,
 *   because the other thirty-two routes take nothing but `page` and `size`.
 *   There is no period to ask for. The requested window still applies — but to
 *   the *read*, as a bound on the stored rows, not to the request.
 *
 * That asymmetry is stated rather than hidden: a caller asking to sync March of
 * the catalogue is asking for something the API cannot do, and it should be
 * visible here that what it gets instead is the catalogue as of now.
 *
 * ## The flag defaults to off
 *
 * `sync` is `false` unless asked for. Reading is then a bounded index range and
 * nothing else — no request, no rate-limit budget spent, no dependency on being
 * online. Going to the network is a decision a caller makes deliberately, which
 * is what makes "does changing this control cost a request?" answerable by
 * reading the call rather than by tracing what it reaches.
 *
 * ## Rate limits
 *
 * Nothing here talks to the API. Both sync paths go through `sync/`, which
 * reaches Uzum through `api/rateLimit.ts` — one sequential channel for the whole
 * application, honouring `Retry-After`. A `sync: true` read therefore queues
 * behind whatever else is in flight rather than racing it, and resolves when
 * its own rows have landed.
 */

export interface ReadOptions {
  /** Go and fetch what is missing before answering. Defaults to `false`. */
  readonly sync?: boolean | undefined;
  /**
   * Re-read even what looks current.
   *
   * On a windowed collection this re-opens the provisional tail whatever its
   * age; on a snapshot one it ignores the freshness window. It is what the sync
   * button means and what a screen never asks for.
   */
  readonly force?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: SourceProgressReporter | undefined;
  /**
   * Fetch without appearing in the sync log.
   *
   * For reads the user did not ask for — the comparison window behind a
   * percentage change, say. Logging those would put a row in Settings for work
   * nobody initiated, next to the rows for work they did.
   */
  readonly silent?: boolean | undefined;
}

/* ── source shapes ──────────────────────────────────────────────────────── */

/** A catalogue product with the shop it belongs to — the API omits that. */
export interface OwnedProduct extends ShopProduct {
  readonly shopId: number;
}

export interface ProductsSource {
  readonly products: readonly OwnedProduct[];
  readonly total: number;
  readonly truncated: boolean;
}

export interface StocksSource {
  readonly stocks: readonly SkuAmount[];
  readonly total: number;
  readonly truncated: boolean;
}

export interface FinanceSource {
  readonly items: readonly FinanceOrderItem[];
  /** Rows the archive holds for this window — the real denominator. */
  readonly total: number;
  readonly cancelledTotal: number;
  /** True when eviction has clipped the archive inside the requested window. */
  readonly truncated: boolean;
}

export interface ExpensesSource {
  readonly payments: readonly SellerPayment[];
  readonly total: number;
  readonly truncated: boolean;
}

export interface OrdersSource {
  readonly orders: readonly FbsOrder[];
  readonly counts: Readonly<Record<FbsCountedStatus, number>>;
  readonly total: number;
}

export interface InvoicesSource {
  readonly supply: readonly SupplyInvoice[];
  readonly returns: readonly SellerReturn[];
  readonly fbs: readonly FbsInvoice[];
  /** FBS invoices are optional on FBO-only accounts; a 4xx there is not fatal. */
  readonly fbsUnavailable: boolean;
}

/* ── sync ───────────────────────────────────────────────────────────────── */

const windowOf = (scope: Scope) => ({ fromMs: scope.fromMs, toMs: scope.toMs });

/**
 * Announce a source to the sync log, but only if it turns out to need requests.
 *
 * A row that flips to `running` every time a screen re-reads a period it
 * already holds is how a source that fetched nothing comes to look like it is
 * being fetched all over again.
 */
function announcer(id: SourceId, silent = false) {
  let announced = false;

  return {
    begin: (): void => {
      if (announced || silent) return;
      announced = true;
      useSyncStore.getState().beginLazySource(id);
    },
    settled: (rows: number, truncated?: boolean): void => {
      if (!announced) return;
      useSyncStore.getState().settleLazySource(id, {
        rows,
        ...(truncated === undefined ? {} : { truncated }),
      });
    },
    failed: (error: unknown): void => {
      if (!announced) return;
      useSyncStore.getState().settleLazySource(id, {
        error: error instanceof Error ? error.message : 'Unexpected failure',
      });
    },
  };
}

function reporter(id: SourceId, options: ReadOptions) {
  return (loaded: number, total: number): void => {
    if (options.onProgress !== undefined) {
      options.onProgress({ loaded, total, fraction: total > 0 ? loaded / total : null });
      return;
    }
    if (options.silent === true) return;
    useSyncStore.getState().reportSource(id, { loaded, total });
  };
}

/**
 * Fill the gaps in a window across every shop in scope.
 *
 * All four windowed entities are planned together, so whichever collection asks
 * first pays for the rest and the second finds its window already covered.
 */
function fillWindow(
  scope: Scope,
  id: SourceId,
  options: ReadOptions,
  begin: () => void,
): Promise<{ readonly failures: readonly string[] }> {
  return ensureWindowAcross({
    shopIds: scope.shopIds,
    window: windowOf(scope),
    signal: options.signal,
    onProgress: reporter(id, options),
    force: options.force,
    silent: options.silent,
    onBegin: begin,
  });
}

/** How old a capture may be before `sync: true` re-takes it. */
const freshnessMs = (): number => readDataSettings().freshnessMinutes * 60_000;

/** What a snapshot capture leaves the caller to act on. */
interface CaptureResult {
  readonly failures: readonly string[];
  /** Entities whose page walk was clipped, so the replacement is partial. */
  readonly truncated: ReadonlySet<EntityType>;
}

const EMPTY_CAPTURE: CaptureResult = { failures: [], truncated: new Set() };

/**
 * Re-capture some snapshot entities across the shops in scope.
 *
 * Failures are collected rather than thrown *here*: an account with no FBS
 * shipments answers that route with 400 while every other capture in the same
 * run succeeds, and losing the catalogue because of it would be the wrong
 * trade. The caller decides which failures are fatal — see `fatal()`.
 */
async function capture(
  scope: Scope,
  only: readonly EntityType[],
  options: ReadOptions,
  begin: () => void,
): Promise<CaptureResult> {
  const reports = await captureSnapshotsAcross(scope.shopIds, {
    only,
    force: options.force,
    maxAgeMs: freshnessMs(),
    signal: options.signal,
    /* Announced from inside the run, past the freshness check, so a screen that
       re-reads what it already holds does not appear in the sync log. */
    onBegin: begin,
  });

  const truncated = new Set<EntityType>();
  for (const report of reports) {
    for (const [entity, wasTruncated] of Object.entries(report.truncated)) {
      if (wasTruncated === true) truncated.add(entity as EntityType);
    }
  }

  return { failures: reports.flatMap((report) => report.failures), truncated };
}

/**
 * The failure worth refusing to answer over, if any.
 *
 * FBS shipment invoices are optional: an FBO-only account answers `/v1/fbs/invoice`
 * with 4xx on every single run, and treating that as a failed read would make
 * the invoices screen permanently unopenable for those sellers. Every other
 * route failing is a real failure.
 */
function fatal(failures: readonly string[]): string | undefined {
  return failures.find((entry) => !entry.startsWith(`${ENTITY_TYPES.fbsInvoice}:`));
}

/**
 * Refuse to answer when the fetch failed and left nothing behind.
 *
 * A failed capture over a previous one is a partial answer worth showing — the
 * rows are old but real. A failed capture over an empty table is just a
 * failure, and returning `[]` for it is how a rate-limited sync comes to look
 * like a seller with no products.
 */
function refuseIfEmpty(failures: readonly string[], rows: number): void {
  const failure = fatal(failures);
  if (failure !== undefined && rows === 0) throw new Error(failure);
}

/* ── windowed collections ───────────────────────────────────────────────── */

/** Whether retention has cut into the window being asked about. */
async function clippedInside(scope: Scope): Promise<boolean> {
  const metas = await Promise.all(
    scope.shopIds.map((shopId) => readMeta(shopId, ENTITY_TYPES.orderItem)),
  );

  return metas.some((meta) => meta.evicted_before !== null && meta.evicted_before > scope.fromMs);
}

export async function readFinance(
  scope: Scope,
  options: ReadOptions = {},
): Promise<FinanceSource> {
  const log = announcer('finance', options.silent === true);

  try {
    let failure: string | undefined;
    if (options.sync === true) {
      const result = await fillWindow(scope, 'finance', options, log.begin);
      failure = result.failures[0];
    }

    const window = windowOf(scope);
    const perShop = await Promise.all(
      scope.shopIds.map((shopId) => readLedger(shopId, window)),
    );
    const items = perShop.flat().sort((a, b) => a.date - b.date);

    const source: FinanceSource = {
      items,
      total: items.length,
      cancelledTotal: items.filter((row) => row.status === 'CANCELED').length,
      truncated: await clippedInside(scope),
    };

    /* A failed fetch that still produced rows is a partial answer worth
       showing; one that produced none is just a failure. */
    if (failure !== undefined && items.length === 0) throw new Error(failure);

    log.settled(items.length, source.truncated);
    return source;
  } catch (error) {
    log.failed(error);
    throw error;
  }
}

export async function readExpenses(
  scope: Scope,
  options: ReadOptions = {},
): Promise<ExpensesSource> {
  const log = announcer('expenses', options.silent === true);

  try {
    if (options.sync === true) await fillWindow(scope, 'expenses', options, log.begin);

    const window = windowOf(scope);
    const perShop = await Promise.all(
      scope.shopIds.map((shopId) => readExpenseRows(shopId, window)),
    );
    const payments = perShop.flat().sort((a, b) => a.dateCreated - b.dateCreated);

    log.settled(payments.length);
    return { payments, total: payments.length, truncated: await clippedInside(scope) };
  } catch (error) {
    log.failed(error);
    throw error;
  }
}

/**
 * FBS and DBS orders, rebuilt from the two tables they are stored across.
 *
 * The status tiles used to come from `/v2/fbs/orders/count`, which meant eight
 * extra requests per shop on every read. They are counted from the stored rows
 * instead — which also makes them agree with the list underneath them, where
 * the count call could disagree with a list the page shift had truncated.
 */
export async function readOrders(
  scope: Scope,
  options: ReadOptions = {},
): Promise<OrdersSource> {
  const log = announcer('orders', options.silent === true);

  try {
    if (options.sync === true) await fillWindow(scope, 'orders', options, log.begin);

    const window = windowOf(scope);
    const perShop = await Promise.all(
      scope.shopIds.map(async (shopId) => {
        const [records, lines] = await Promise.all([
          readFbsOrders(shopId, window),
          readFbsOrderItemsIn(shopId, window),
        ]);

        const byOrder = groupBy(lines, (line) => line.order_id);
        return records.map((record) =>
          recordToFbsOrder(record, byOrder.get(record.order_id) ?? []),
        );
      }),
    );

    const orders = perShop.flat().sort((a, b) => (b.dateCreated ?? 0) - (a.dateCreated ?? 0));

    const counts = {} as Record<FbsCountedStatus, number>;
    for (const status of FBS_ORDER_STATUSES) counts[status] = 0;
    for (const order of orders) {
      if (isCountedStatus(order.status)) counts[order.status] += 1;
    }

    log.settled(orders.length);
    return { orders, counts, total: orders.length };
  } catch (error) {
    log.failed(error);
    throw error;
  }
}

function isCountedStatus(status: string): status is FbsCountedStatus {
  return (FBS_ORDER_STATUSES as readonly string[]).includes(status);
}

/* ── snapshot collections ───────────────────────────────────────────────── */

export async function readProducts(
  scope: Scope,
  options: ReadOptions = {},
): Promise<ProductsSource> {
  const log = announcer('products', options.silent === true);

  try {
    let result: CaptureResult = EMPTY_CAPTURE;
    if (options.sync === true) {
      result = await capture(
        scope,
        [ENTITY_TYPES.product, ENTITY_TYPES.productSku],
        options,
        log.begin,
      );
    }

    const perShop = await Promise.all(
      scope.shopIds.map(async (shopId) => {
        const [products, skus] = await Promise.all([
          readProductRows(shopId),
          readProductSkus(shopId),
        ]);

        const byProduct = groupBy(skus.rows, (row) => row.product_id);

        return products.rows.map(
          (record): OwnedProduct => ({
            ...recordToProduct(record, byProduct.get(record.product_id) ?? []),
            shopId,
          }),
        );
      }),
    );

    const products = perShop.flat();
    refuseIfEmpty(result.failures, products.length);

    /* Truncation here is the route's page walk hitting its limit, not eviction:
       a snapshot is written by replacement, so a clipped read swaps the whole
       catalogue for part of one and the screen must say so. */
    const truncated = result.truncated.has(ENTITY_TYPES.product);

    log.settled(products.length, truncated);
    return { products, total: products.length, truncated };
  } catch (error) {
    log.failed(error);
    throw error;
  }
}

/**
 * FBS amounts — captured for the selected shops, read for the whole account.
 *
 * The asymmetry is deliberate and matches what the route is. `/v3/fbs/sku/stocks`
 * names no shop and answers the same rows whichever chip is selected, so its
 * query is keyed per account; narrowing the *read* to the selection would leave
 * that key promising an answer it no longer gives. Consumers join these amounts
 * to the catalogue by `skuId`, and the catalogue is scoped — so rows from an
 * unselected shop are matched by nothing and cost nothing.
 *
 * A SKU no catalogue claims is not stored at all — see `captureSnapshots`,
 * which refuses to file account-wide amounts under a shop that cannot be shown
 * to own them. Shop `0` is read here anyway because older databases may hold
 * rows under it, and a row that exists should be readable.
 */
export async function readStocks(
  scope: Scope,
  options: ReadOptions = {},
): Promise<StocksSource> {
  const log = announcer('stocks', options.silent === true);

  try {
    let result: CaptureResult = EMPTY_CAPTURE;
    if (options.sync === true) {
      result = await capture(scope, [ENTITY_TYPES.fbsStock], options, log.begin);
    }

    const perShop = await Promise.all(
      (await accountShops()).map((shopId) => readFbsStocks(shopId)),
    );

    /* One SKU belongs to one shop, so the per-shop tables should partition the
       account. Keyed rather than concatenated anyway: a table written before
       the capture could attribute its rows may still hold another shop's, and
       counting those twice would inflate every stock KPI on the screen. */
    const bySku = new Map<number, SkuAmount>();
    for (const held of perShop) {
      for (const row of held.rows) bySku.set(row.sku_id, recordToStock(row));
    }

    const stocks = [...bySku.values()];
    refuseIfEmpty(result.failures, stocks.length);

    const truncated = result.truncated.has(ENTITY_TYPES.fbsStock);
    log.settled(stocks.length, truncated);
    return { stocks, total: stocks.length, truncated };
  } catch (error) {
    log.failed(error);
    throw error;
  }
}

/** The bucket older builds used for stock rows no catalogue claimed. */
const UNATTRIBUTED = 0;

/**
 * Every shop this machine holds rows for, plus the unattributed bucket.
 *
 * Used by the two collections whose routes are account-wide — stock and
 * invoices — because their query keys carry no scope. Reading per selection
 * under a key that ignores the selection would serve one chip's answer to
 * another chip.
 */
async function accountShops(): Promise<readonly number[]> {
  const shops = await archivedShops();
  return [...new Set([...shops, UNATTRIBUTED])];
}

export async function readInvoices(
  scope: Scope,
  options: ReadOptions = {},
): Promise<InvoicesSource> {
  const log = announcer('invoices', options.silent === true);

  try {
    let result: CaptureResult = EMPTY_CAPTURE;
    if (options.sync === true) {
      result = await capture(
        scope,
        [
          ENTITY_TYPES.supplyInvoice,
          ENTITY_TYPES.supplyInvoiceItem,
          ENTITY_TYPES.sellerReturn,
          ENTITY_TYPES.returnItem,
          ENTITY_TYPES.fbsInvoice,
        ],
        options,
        log.begin,
      );
    }

    /* Account-wide, for the same reason as stock: `/v1/invoice`, `/v1/return`
       and `/v1/fbs/invoice` take no shop id, and this query's key carries no
       scope. The rows state their own shop, so a screen can still narrow. */
    const perShop = await Promise.all(
      (await accountShops()).map(async (shopId) => {
        const [supply, supplyLines, returns, returnLines, fbs, fbsMeta] = await Promise.all([
          readSupplyInvoices(shopId),
          readSupplyInvoiceLines(shopId),
          readSellerReturns(shopId),
          readReturnLines(shopId),
          readFbsInvoices(shopId),
          readMeta(shopId, ENTITY_TYPES.fbsInvoice),
        ]);

        const linesByInvoice = groupBy(supplyLines.rows, (row) => row.invoice_id);
        const linesByReturn = groupBy(returnLines.rows, (row) => row.return_id);

        return {
          supply: supply.rows.map((record) =>
            recordToSupplyInvoice(record, linesByInvoice.get(record.invoice_id) ?? []),
          ),
          returns: returns.rows.map((record) =>
            recordToReturn(record, linesByReturn.get(record.return_id) ?? []),
          ),
          fbs: fbs.rows.map(recordToFbsInvoice),
          /* Never captured, on an account that has been synced, is what an
             FBO-only seller looks like: the route answered 400 every time. */
          fbsCaptured: fbsMeta.captured_at !== null,
          /* Whether this shop has been captured at all — the other two invoice
             routes are the evidence that a sync has happened here. */
          anyCaptured:
            fbsMeta.captured_at !== null ||
            supply.at !== null ||
            returns.at !== null,
        };
      }),
    );

    const supply = perShop.flatMap((part) => part.supply);
    const returns = perShop.flatMap((part) => part.returns);
    const fbs = perShop.flatMap((part) => part.fbs);

    /* Unavailable means the route was asked and refused, which is only knowable
       once something else on this account has been captured. On a machine that
       has synced nothing, "never captured" says nothing about the account. */
    const anyCaptured = perShop.some((part) => part.anyCaptured);

    const source: InvoicesSource = {
      supply,
      returns,
      fbs,
      fbsUnavailable: anyCaptured && perShop.every((part) => !part.fbsCaptured),
    };

    refuseIfEmpty(result.failures, supply.length + returns.length + fbs.length);

    log.settled(supply.length + returns.length + fbs.length);
    return source;
  } catch (error) {
    log.failed(error);
    throw error;
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

type Child = FbsOrderItemRecord | ProductSkuRecord | SupplyInvoiceItemRecord | ReturnItemRecord;

/** Index child rows by their parent key, so reassembly is one pass. */
function groupBy<T extends Child>(
  rows: readonly T[],
  key: (row: T) => number,
): Map<number, T[]> {
  const grouped = new Map<number, T[]>();

  for (const row of rows) {
    const id = key(row);
    const bucket = grouped.get(id);
    if (bucket === undefined) grouped.set(id, [row]);
    else bucket.push(row);
  }

  return grouped;
}

/** How far back the archive can answer for these shops, or null. */
export async function archivedFrom(scope: Scope): Promise<number | null> {
  const metas = await Promise.all(
    scope.shopIds.map((shopId) => readMeta(shopId, ENTITY_TYPES.orderItem)),
  );

  const starts = metas
    .map((meta) => bounds(toCoverage(meta.synced_ranges))?.fromMs)
    .filter((value): value is number => value !== undefined);

  return starts.length === 0 ? null : Math.min(...starts);
}
