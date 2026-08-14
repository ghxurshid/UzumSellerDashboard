import { queryOptions } from '@tanstack/react-query';

import { queryKeys, type Scope } from '@/services/api/queryKeys';
import { SourceProgressTracker, type SourceProgressReporter } from '@/services/queries/progress';
import { PERIODIC_SOURCES as PERIODIC } from '@/services/queries/sourceIds';
import { readThrough, readThroughPerShop } from '@/services/queries/readThrough';
import {
  ENTITY_TYPES,
  readExpenses,
  readLedger,
  readMeta,
} from '@/services/storage/archive/archive.service';
import { toCoverage } from '@/services/storage/idb/metadata.repo';
import { bounds } from '@/services/storage/archive/coverage';
import {
  invoicesCodec,
  ordersCodec,
  productsCodec,
  stocksCodec,
} from '@/services/storage/buffer/sourceCodecs';
import { ensureWindowAcross, type LazySyncResult } from '@/services/sync/lazySync';
import {
  FBS_ORDER_STATUSES,
  fetchFbsInvoices,
  fetchFbsOrderCount,
  fetchFbsOrders,
  fetchReturns,
  fetchShopProducts,
  fetchShops,
  fetchSkuStocks,
  fetchSupplyInvoices,
  type FbsCountedStatus,
} from '@/services/uzum/endpoints';
import { useSyncStore } from '@/store/sync.store';
import type {
  FbsInvoice,
  FbsOrder,
  FinanceOrderItem,
  SellerPayment,
  SellerReturn,
  ShopProduct,
  SkuAmount,
  SupplyInvoice,
  UzumShop,
} from '@/services/uzum/types';

/**
 * The six data sources, each read through IndexedDB.
 *
 * The data path is `Uzum API → IndexedDB → UI`, and these query functions
 * are where that is enforced. **No screen ever reaches the API.** A screen asks
 * for a scope; the buffer answers it if it can, and goes to Uzum only for what
 * it cannot. Changing the range on the overview therefore does one of two
 * things and nothing else: it serves a period already held, instantly, or it
 * lazily syncs the part that is missing and then serves that.
 *
 * Which question is asked depends on what kind of data it is:
 *
 *   **Settled history** — `finance` and `expenses`. These belong to a period,
 *   so the question is *coverage*: `sync_metadata` says which windows have been
 *   pulled, and only the gaps are requested. A period fetched last week is free
 *   forever. This is the migration model: metadata first, fetch the complement,
 *   then read the rows back out of storage — and the reading is a bounded index
 *   range rather than a scan, so it stays cheap as the archive grows.
 *
 *   **Re-readable state** — `products`, `stocks`, `orders`, `invoices`. These
 *   have no period to complete, so the question is *age*: the buffer serves the
 *   stored copy until the freshness window from Settings has passed. That is
 *   what stops every screen change from spending requests on a catalogue that
 *   has not moved.
 *
 * Both kinds are stored **per shop**, never per selection — `finance` through
 * the archive's `(store_id, entity_type)` partition, `products` and `orders`
 * through one buffer slot each. That is what makes the store chip free: picking
 * one shop out of five that were just synced asks a question every one of those
 * slots can already answer. `stocks` and `invoices` are the exception, because
 * their routes take no shop id at all and return the same rows whichever chip
 * is selected; they are keyed per account.
 *
 * Each is one React Query over that, which is what makes every state in the
 * design a real one: a source is either untouched, in flight, resolved with
 * rows, resolved with none, or failed — and the failure carries *why*.
 */

/**
 * The ids live in their own leaf module — see `sourceIds.ts` — because the sync
 * store needs them too, and this file needs the sync store. Re-exported here so
 * every existing import keeps working.
 */
export { PERIODIC_SOURCES, SOURCE_IDS, type SourceId } from './sourceIds';

/**
 * React Query is a *view* of the buffer, not a second cache of the API.
 *
 * `staleTime: Infinity` says so literally: the query layer never decides on its
 * own that data needs refetching, because that decision belongs to the buffer,
 * which owns the freshness window the user configured. What React Query still
 * gives us is deduplication of concurrent readers, suspense/loading states and
 * per-scope keying — none of which is about freshness.
 */
const base = {
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: 30 * 60 * 1_000,
  retry: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
} as const;

/* ── shops ──────────────────────────────────────────────────────────────── */

export const shopsQuery = () =>
  queryOptions({
    queryKey: queryKeys.shops,
    queryFn: ({ signal }) => fetchShops({ signal }),
    ...base,
    staleTime: 60 * 60 * 1_000,
    /* The one query that still goes straight to the API on mount: it is the
       connection probe, and a buffered answer would let a revoked token look
       connected. One cheap call an hour buys that. */
    refetchOnMount: true,
  });

/* ── products ───────────────────────────────────────────────────────────── */

/** A catalogue product with the shop it belongs to — the API omits that. */
export interface OwnedProduct extends ShopProduct {
  readonly shopId: number;
}

export interface ProductsSource {
  readonly products: readonly OwnedProduct[];
  readonly total: number;
  readonly truncated: boolean;
}

/**
 * The catalogue, one shop at a time.
 *
 * `/v1/product/shop/{id}` is already a per-shop route, so the walk over the
 * selection is the read-through layer's rather than this function's: it stores
 * a slot per shop and calls back only for the shops it does not hold. A
 * selection of one shop out of five costs nothing after a sync, where the
 * previous set-keyed slot made it a full catalogue refetch.
 */
export const productsQuery = (
  scope: Scope,
  enabled: boolean,
  onProgress?: SourceProgressReporter,
  force?: boolean,
) =>
  queryOptions({
    queryKey: queryKeys.source.products(scope),
    enabled,
    queryFn: ({ signal }): Promise<ProductsSource> =>
      readThroughPerShop<ProductsSource>({
        id: 'products',
        scope,
        periodic: PERIODIC.products,
        codec: productsCodec,
        signal,
        onProgress,
        force,
        fetch: async (shopId, context) => {
          const page = await fetchShopProducts(shopId, {
            signal: context.signal,
            onProgress: context.onProgress,
          });

          /* The shop id is not on the wire — it is added here, and it is the
             only way a stored row knows which shop it came from. */
          return {
            products: page.items.map((product): OwnedProduct => ({ ...product, shopId })),
            total: page.total,
            truncated: page.truncated,
          };
        },
        merge: (parts) => ({
          products: parts.flatMap((part) => part.products),
          total: parts.reduce((sum, part) => sum + part.total, 0),
          truncated: parts.some((part) => part.truncated),
        }),
      }),
    ...base,
  });

/* ── stocks ─────────────────────────────────────────────────────────────── */

export interface StocksSource {
  readonly stocks: readonly SkuAmount[];
  readonly total: number;
  readonly truncated: boolean;
}

/**
 * FBS amounts, which belong to the account rather than to a shop.
 *
 * `/v3/fbs/sku/stocks` takes no shop id and answers the same rows whichever
 * chip is selected, so it gets one slot per account. Keying it by the selection
 * only ever meant fetching identical rows into a second slot.
 */
export const stocksQuery = (
  enabled: boolean,
  scope: Scope,
  onProgress?: SourceProgressReporter,
  force?: boolean,
) =>
  queryOptions({
    queryKey: queryKeys.source.stocks(),
    enabled,
    queryFn: ({ signal }): Promise<StocksSource> =>
      readThrough<StocksSource>({
        id: 'stocks',
        scope,
        periodic: PERIODIC.stocks,
        codec: stocksCodec,
        signal,
        onProgress,
        force,
        fetch: async (context) => {
          const page = await fetchSkuStocks({
            signal: context.signal,
            onProgress: context.onProgress,
          });
          return { stocks: page.items, total: page.total, truncated: page.truncated };
        },
      }),
    ...base,
  });

/* ── finance: settled history, served from the archive ──────────────────── */

export interface FinanceSource {
  readonly items: readonly FinanceOrderItem[];
  /** Rows the archive holds for this window — the real denominator. */
  readonly total: number;
  readonly cancelledTotal: number;
  /** True when eviction has clipped the archive inside the requested window. */
  readonly truncated: boolean;
}

/**
 * Fill any gaps in the requested window, then read the rows back out.
 *
 * This is the lazy sync, called from a query function. Nothing is returned from
 * the network directly: the fetch writes into IndexedDB and the answer is read
 * from IndexedDB afterwards, so a period that was already held and one that was
 * just fetched produce identical results.
 *
 * `sync_metadata` is consulted first and, on the common path, is the *only*
 * thing consulted — a window already covered costs one keyed read and no
 * request at all.
 */
async function fillLedger(
  scope: Scope,
  signal: AbortSignal | undefined,
  onProgress: ((loaded: number, total: number) => void) | undefined,
  options: { readonly onBegin?: () => void; readonly force?: boolean | undefined } = {},
): Promise<LazySyncResult> {
  return ensureWindowAcross({
    shopIds: scope.shopIds,
    window: { fromMs: scope.fromMs, toMs: scope.toMs },
    signal,
    onProgress,
    /* `force` re-opens the provisional tail whatever its age. A screen never
       sets it — that is the whole point of the archive — and the sync button
       always does, because "sync" means "go and look now". */
    force: options.force,
    ...(options.onBegin !== undefined ? { onBegin: options.onBegin } : {}),
  });
}

/** Whether retention has cut into the window being asked about. */
async function clippedInside(scope: Scope): Promise<boolean> {
  const metas = await Promise.all(
    scope.shopIds.map((shopId) => readMeta(shopId, ENTITY_TYPES.orderItem)),
  );

  return metas.some((meta) => meta.evicted_before !== null && meta.evicted_before > scope.fromMs);
}

/**
 * Read one window across every shop in scope.
 *
 * The window is the key range the cursor opens on rather than a filter applied
 * afterwards, which is the change that makes this cheap: a shop holding two
 * years of history answers a question about last week by touching last week's
 * rows. The old implementation read every row the shop held and then filtered.
 */
async function readLedgerWindow(scope: Scope): Promise<readonly FinanceOrderItem[]> {
  const window = { fromMs: scope.fromMs, toMs: scope.toMs };
  const perShop = await Promise.all(
    scope.shopIds.map((shopId) => readLedger(shopId, window)),
  );

  return perShop.flat().sort((a, b) => a.date - b.date);
}

async function readExpenseWindow(scope: Scope): Promise<readonly SellerPayment[]> {
  const window = { fromMs: scope.fromMs, toMs: scope.toMs };
  const perShop = await Promise.all(
    scope.shopIds.map((shopId) => readExpenses(shopId, window)),
  );

  return perShop.flat().sort((a, b) => a.dateCreated - b.dateCreated);
}

export const financeQuery = (
  scope: Scope,
  enabled: boolean,
  onProgress?: SourceProgressReporter,
  force?: boolean,
) =>
  queryOptions({
    queryKey: queryKeys.source.finance(scope),
    enabled,
    queryFn: async ({ signal }): Promise<FinanceSource> => {
      /* Announced only if the window turns out to need requests. A period the
         archive already holds is served without touching the sync log — a row
         that flips to `running` on every store change is how a source that
         fetched nothing comes to look like it is being fetched all over
         again. */
      let announced = false;
      const begin = (): void => {
        announced = true;
        useSyncStore.getState().beginLazySource('finance');
      };

      try {
        const result = await fillLedger(
          scope,
          signal,
          (loaded, total) => {
            if (onProgress !== undefined) {
              onProgress({ loaded, total, fraction: total > 0 ? loaded / total : null });
            } else {
              useSyncStore.getState().reportSource('finance', { loaded, total });
            }
          },
          { onBegin: begin, force },
        );

        const items = await readLedgerWindow(scope);
        const cancelledTotal = items.filter((row) => row.status === 'CANCELED').length;

        const source: FinanceSource = {
          items,
          total: items.length,
          cancelledTotal,
          truncated: await clippedInside(scope),
        };

        const failure = result.failures[0];
        if (failure !== undefined && items.length === 0) throw new Error(failure);

        if (announced) {
          useSyncStore.getState().settleLazySource('finance', {
            rows: items.length,
            truncated: source.truncated,
          });
        }
        return source;
      } catch (error) {
        if (announced) {
          useSyncStore.getState().settleLazySource('finance', {
            error: error instanceof Error ? error.message : 'Unexpected failure',
          });
        }
        throw error;
      }
    },
    ...base,
  });

/**
 * The window immediately before the selected one.
 *
 * Read from the archive on the same terms as the main window, which is why the
 * comparison is now nearly free: the previous period has almost always been
 * fetched already, either by an earlier sync or by the user looking at it.
 */
export const comparisonQuery = (scope: Scope, enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.source.comparison(scope),
    enabled,
    queryFn: async ({ signal }): Promise<FinanceSource & { payments: readonly SellerPayment[] }> => {
      const span = scope.toMs - scope.fromMs;
      const previous: Scope = { ...scope, fromMs: scope.fromMs - span, toMs: scope.fromMs };

      await fillLedger(previous, signal, undefined, {});

      const [items, payments, truncated] = await Promise.all([
        readLedgerWindow(previous),
        readExpenseWindow(previous),
        clippedInside(previous),
      ]);

      return {
        items,
        total: items.length,
        cancelledTotal: 0,
        truncated,
        payments,
      };
    },
    ...base,
  });

/* ── expenses: settled history, served from the archive ─────────────────── */

export interface ExpensesSource {
  readonly payments: readonly SellerPayment[];
  readonly total: number;
  readonly truncated: boolean;
}

export const expensesQuery = (
  scope: Scope,
  enabled: boolean,
  onProgress?: SourceProgressReporter,
  force?: boolean,
) =>
  queryOptions({
    queryKey: queryKeys.source.expenses(scope),
    enabled,
    queryFn: async ({ signal }): Promise<ExpensesSource> => {
      let announced = false;
      const begin = (): void => {
        announced = true;
        useSyncStore.getState().beginLazySource('expenses');
      };

      try {
        /* The same call the finance source makes: order items and expense rows
           are fetched together per window, so whichever source asks first pays
           for both and the second finds its window already covered. */
        await fillLedger(
          scope,
          signal,
          (loaded, total) => {
            if (onProgress !== undefined) {
              onProgress({ loaded, total, fraction: total > 0 ? loaded / total : null });
            } else {
              useSyncStore.getState().reportSource('expenses', { loaded, total });
            }
          },
          { onBegin: begin, force },
        );

        const payments = await readExpenseWindow(scope);

        if (announced) {
          useSyncStore.getState().settleLazySource('expenses', { rows: payments.length });
        }
        return { payments, total: payments.length, truncated: await clippedInside(scope) };
      } catch (error) {
        if (announced) {
          useSyncStore.getState().settleLazySource('expenses', {
            error: error instanceof Error ? error.message : 'Unexpected failure',
          });
        }
        throw error;
      }
    },
    ...base,
  });

/* ── FBS / DBS orders ───────────────────────────────────────────────────── */

export interface OrdersSource {
  readonly orders: readonly FbsOrder[];
  readonly counts: Readonly<Record<FbsCountedStatus, number>>;
  readonly total: number;
}

export const ordersQuery = (
  scope: Scope,
  enabled: boolean,
  onProgress?: SourceProgressReporter,
  force?: boolean,
) =>
  queryOptions({
    queryKey: queryKeys.source.orders(scope),
    enabled,
    queryFn: ({ signal }): Promise<OrdersSource> =>
      readThroughPerShop<OrdersSource>({
        id: 'orders',
        scope,
        periodic: PERIODIC.orders,
        codec: ordersCodec,
        signal,
        onProgress,
        force,
        /**
         * Read one shop's open orders.
         *
         * The route accepts a list of shops, so asking for the whole selection
         * in one go would be fewer requests — but the answer could then only be
         * stored against that exact selection, which is the thing that made
         * every change of the store chip a full refetch. One shop per slot
         * costs one extra count call per shop and buys a buffer that answers
         * any selection.
         */
        fetch: async (shopId, context) => {
          const window = { fromMs: scope.fromMs, toMs: scope.toMs };
          const counts = {} as Record<FbsCountedStatus, number>;
          const orders: FbsOrder[] = [];
          /* One part per status. The count call that opens each one is what
             makes that part's size knowable, so the bar is honest from the
             first status instead of guessing at eight unknown lists. */
          const progress = new SourceProgressTracker(FBS_ORDER_STATUSES.length, (report) =>
            context.onProgress({ loaded: report.loaded, total: report.total }),
          );

          for (const status of FBS_ORDER_STATUSES) {
            const count = await fetchFbsOrderCount([shopId], window, status, {
              signal: context.signal,
            });
            counts[status] = count;

            /* Only walk the list where the count says there is something to
               walk. On an FBO-only account every status is 0 and this costs
               eight cheap calls instead of eight paginated reads. */
            if (count > 0) {
              const page = await fetchFbsOrders([shopId], window, status, {
                signal: context.signal,
                onProgress: progress.page,
              });
              orders.push(...page.items);
              progress.finishPart(page.items.length, count);
            } else {
              progress.finishPart(0, 0);
            }
          }

          const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
          return { orders, counts, total };
        },
        merge: (parts) => ({
          orders: parts.flatMap((part) => part.orders),
          /* Summed per status rather than replaced: the status tiles count the
             whole selection, and a shop with no `PACKING` orders must not erase
             another shop's. */
          counts: FBS_ORDER_STATUSES.reduce(
            (totals, status) => ({
              ...totals,
              [status]: parts.reduce((sum, part) => sum + (part.counts[status] ?? 0), 0),
            }),
            {} as Record<FbsCountedStatus, number>,
          ),
          total: parts.reduce((sum, part) => sum + part.total, 0),
        }),
      }),
    ...base,
  });

/* ── invoices, supply and returns ───────────────────────────────────────── */

export interface InvoicesSource {
  readonly supply: readonly SupplyInvoice[];
  readonly returns: readonly SellerReturn[];
  readonly fbs: readonly FbsInvoice[];
  /** FBS invoices are optional on FBO-only accounts; a 4xx there is not fatal. */
  readonly fbsUnavailable: boolean;
}

/** Supply, returns and FBS invoices — account-wide routes, one slot per account. */
export const invoicesQuery = (
  enabled: boolean,
  scope: Scope,
  onProgress?: SourceProgressReporter,
  force?: boolean,
) =>
  queryOptions({
    queryKey: queryKeys.source.invoices(),
    enabled,
    queryFn: ({ signal }): Promise<InvoicesSource> =>
      readThrough<InvoicesSource>({
        id: 'invoices',
        scope,
        periodic: PERIODIC.invoices,
        codec: invoicesCodec,
        signal,
        onProgress,
        force,
        fetch: async (context) => {
          /* Three collections, none of which publishes a row total — they
             answer with a bare array. Parts are therefore the only thing this
             source can measure honestly. */
          const progress = new SourceProgressTracker(3, (report) =>
            context.onProgress({ loaded: report.loaded, total: report.total }),
          );

          const supply = await fetchSupplyInvoices({
            signal: context.signal,
            onProgress: progress.page,
          });
          progress.finishPart(supply.items.length);

          const returns = await fetchReturns({
            signal: context.signal,
            onProgress: progress.page,
          });
          progress.finishPart(returns.items.length);

          /* An account with no FBS shipments answers this route with 400. That
             is a fact about the account, not a failure of the screen, so it
             degrades to "no FBS invoices" instead of failing the whole source. */
          try {
            const fbs = await fetchFbsInvoices({
              signal: context.signal,
              onProgress: progress.page,
            });
            progress.finishPart(fbs.items.length);
            return {
              supply: supply.items,
              returns: returns.items,
              fbs: fbs.items,
              fbsUnavailable: false,
            };
          } catch {
            progress.finishPart(0);
            return {
              supply: supply.items,
              returns: returns.items,
              fbs: [],
              fbsUnavailable: true,
            };
          }
        },
      }),
    ...base,
  });

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

export type { UzumShop };
