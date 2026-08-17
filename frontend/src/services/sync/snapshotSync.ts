import { ApiError } from '@/services/api/client';
import {
  commitCatalog,
  commitFbsInvoices,
  commitReturns,
  commitStocks,
  commitSupplyInvoiceItems,
  commitSupplyInvoices,
  readMeta,
} from '@/services/storage/archive/archive.service';
import type { ChangeEvent } from '@/services/storage/archive/codec';
import { ENTITY_TYPES, type EntityType } from '@/services/storage/idb/schema';
import {
  fetchFbsInvoices,
  fetchReturns,
  fetchShopProducts,
  fetchSkuStocks,
  fetchSupplyInvoiceProducts,
  fetchSupplyInvoices,
} from '@/services/uzum/endpoints';
import type { InvoiceProduct, SkuAmount, SupplyInvoice } from '@/services/uzum/types';

/**
 * Capturing the entities that have no window.
 *
 * Six routes answer here — the catalogue, FBS stock, supply invoices and their
 * lines, warehouse returns and their lines, and FBS shipment invoices — and not
 * one of them accepts a date filter. `page` and `size` are the whole of their
 * query vocabulary. So there is no period to plan, nothing to subtract, and no
 * coverage record to consult: the only correct read is the whole set, and the
 * only correct write is a replacement.
 *
 * That is the difference from `lazySync.ts`, and it is a difference in the API
 * rather than a choice made here. A sale is a fact with a date on it and Uzum
 * will filter by that date; a price, a stock level and an invoice status are
 * claims about right now, and Uzum will only ever tell you what they are at the
 * moment you ask.
 *
 * ## Freshness instead of coverage
 *
 * A snapshot is skipped when the last capture is younger than the caller's
 * freshness window. That is the only economy available: without a date filter
 * the alternative to re-reading everything is re-reading nothing. `force`
 * bypasses it, because that is what pressing sync means.
 */

export interface SnapshotOptions {
  readonly shopId: number;
  readonly now?: number;
  readonly signal?: AbortSignal | undefined;
  /** Re-capture whatever the age of what is held. */
  readonly force?: boolean | undefined;
  /** Skip a capture younger than this. Zero always re-captures. */
  readonly maxAgeMs?: number | undefined;
  /**
   * Account-wide FBS amounts, read once per run and shared across shops.
   *
   * `/v3/fbs/sku/stocks` names no shop, so reading it per shop would fetch the
   * same rows once for each.
   */
  readonly stocks?: readonly SkuAmount[] | undefined;
  readonly onEntity?: (entity: EntityType, rows: number) => void;
}

export interface SnapshotReport {
  readonly shopId: number;
  /** Rows captured, per entity. Absent entities were skipped or failed. */
  readonly captured: Readonly<Partial<Record<EntityType, number>>>;
  /** Changes the catalogue capture revealed against the previous one. */
  readonly changes: readonly ChangeEvent[];
  readonly skipped: readonly EntityType[];
  readonly failures: readonly string[];
}

/**
 * How many supply invoices get their lines expanded.
 *
 * The line route takes one invoice at a time, so expanding a hundred invoices
 * is a hundred requests against an hourly budget. The recent ones are the ones
 * a shortfall would still be worth acting on, so the walk stops after this many.
 */
const INVOICE_DETAIL_LIMIT = 20;

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function describe(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Unexpected failure';
}

/** Whether a capture is recent enough to leave alone. */
async function isFresh(
  shopId: number,
  entity: EntityType,
  now: number,
  maxAgeMs: number,
): Promise<boolean> {
  if (maxAgeMs <= 0) return false;

  const meta = await readMeta(shopId, entity);
  if (meta.captured_at === null) return false;

  return now - meta.captured_at < maxAgeMs;
}

/**
 * Capture every snapshot entity for one shop.
 *
 * Each entity is independent: a failure captures nothing for that one and
 * leaves the previous capture in place, while the others carry on. Nothing here
 * is transactional across entities on purpose — a stale invoice table next to a
 * fresh catalogue is a far better outcome than neither being written because one
 * route was rate-limited.
 */
export async function captureSnapshots(options: SnapshotOptions): Promise<SnapshotReport> {
  const { shopId, signal } = options;
  const now = options.now ?? Date.now();
  const force = options.force === true;
  const maxAge = force ? 0 : (options.maxAgeMs ?? 0);

  const captured: Partial<Record<EntityType, number>> = {};
  const skipped: EntityType[] = [];
  const failures: string[] = [];
  let changes: readonly ChangeEvent[] = [];

  /** Run one capture, unless it is fresh enough to skip. */
  const step = async (
    entity: EntityType,
    run: () => Promise<number>,
  ): Promise<void> => {
    if (aborted(signal)) return;

    if (await isFresh(shopId, entity, now, maxAge)) {
      skipped.push(entity);
      return;
    }

    try {
      const rows = await run();
      captured[entity] = rows;
      options.onEntity?.(entity, rows);
    } catch (error) {
      failures.push(`${entity}: ${describe(error)}`);
    }
  };

  /* The catalogue first: the stock capture below is partitioned by which of
     this shop's SKUs each amount belongs to, which needs the catalogue read. */
  const products = await captureCatalogue(options, now, step, (events) => {
    changes = events;
  });

  await step(ENTITY_TYPES.fbsStock, async () => {
    const stocks = options.stocks ?? (await fetchSkuStocks({ signal })).items;

    /* `/v3/fbs/sku/stocks` is account-wide and names no shop. Only the amounts
       whose SKU is in this shop's catalogue are stored under it, so the same
       account-wide read can serve several shops without any of them claiming
       another's rows. */
    const owned = products === null
      ? stocks
      : stocks.filter((stock) => products.has(stock.skuId));

    const outcome = await commitStocks(shopId, owned, now);
    return outcome.rows;
  });

  const invoices = await captureSupplyInvoices(options, now, step);

  await step(ENTITY_TYPES.supplyInvoiceItem, async () => {
    if (invoices.length === 0) return 0;

    /* Newest first, and only the first few: one request per invoice against an
       hourly budget is the constraint that decides this. */
    const recent = [...invoices]
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
      .slice(0, INVOICE_DETAIL_LIMIT);

    const lines: { invoiceId: number; products: readonly InvoiceProduct[] }[] = [];
    for (const invoice of recent) {
      if (aborted(signal)) break;
      const products_ = await fetchSupplyInvoiceProducts(shopId, invoice.id, { signal });
      lines.push({ invoiceId: invoice.id, products: products_ });
    }

    const outcome = await commitSupplyInvoiceItems(shopId, lines, now);
    return outcome.rows;
  });

  await step(ENTITY_TYPES.sellerReturn, async () => {
    const page = await fetchReturns({ signal });
    const outcome = await commitReturns(shopId, page.items, now);
    captured[ENTITY_TYPES.returnItem] = outcome.items.rows;
    return outcome.entries.rows;
  });

  await step(ENTITY_TYPES.fbsInvoice, async () => {
    const page = await fetchFbsInvoices({ signal });
    const outcome = await commitFbsInvoices(shopId, page.items, now);
    return outcome.rows;
  });

  return { shopId, captured, changes, skipped, failures };
}

/**
 * Capture products and SKUs, and return the SKU ids the shop owns.
 *
 * The id set is what lets the account-wide stock read be split across shops. A
 * `null` return means the catalogue was not read this run — skipped or failed —
 * in which case the stock capture cannot be partitioned and stores what it got.
 */
async function captureCatalogue(
  options: SnapshotOptions,
  now: number,
  step: (entity: EntityType, run: () => Promise<number>) => Promise<void>,
  onChanges: (events: readonly ChangeEvent[]) => void,
): Promise<ReadonlySet<number> | null> {
  let owned: ReadonlySet<number> | null = null;

  await step(ENTITY_TYPES.product, async () => {
    const page = await fetchShopProducts(options.shopId, { signal: options.signal });
    const stocks = options.stocks ?? [];

    const outcome = await commitCatalog(options.shopId, page.items, stocks, now);
    onChanges(outcome.events);

    owned = new Set(
      page.items.flatMap((product) => (product.skuList ?? []).map((sku) => sku.skuId)),
    );

    return outcome.products;
  });

  return owned;
}

/** Capture supply invoices, and hand back what was captured for line expansion. */
async function captureSupplyInvoices(
  options: SnapshotOptions,
  now: number,
  step: (entity: EntityType, run: () => Promise<number>) => Promise<void>,
): Promise<readonly SupplyInvoice[]> {
  let captured: readonly SupplyInvoice[] = [];

  await step(ENTITY_TYPES.supplyInvoice, async () => {
    const page = await fetchSupplyInvoices({ signal: options.signal });

    /* `/v1/invoice` is account-wide too, and unlike the stock route it does
       state a shop per row — so the split is a filter rather than a join. */
    captured = page.items.filter((invoice) => invoice.shopId === options.shopId);

    const outcome = await commitSupplyInvoices(options.shopId, captured, now);
    return outcome.rows;
  });

  return captured;
}
