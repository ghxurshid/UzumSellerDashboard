import {
  aggregateByProduct,
  aggregateExpenses,
  aggregateOrders,
  chooseGranularity,
  type AnalyticsJob,
  type AnalyticsResult,
  type ExpenseRowLike,
  type ProductRowLike,
} from './aggregation';
import { withStore, walk } from './db';
import { ENTITY_TYPES, INDEXES, STORES } from './schema';
import { periodRange } from './records.repo';
import type { ExpenseRecord, OrderItemRecord } from './schema';

/**
 * Running one analytics job against IndexedDB.
 *
 * This module is the half of the analytics path that both the worker and the
 * main thread execute. It exists separately from the worker because the worker
 * is an *optimisation*, not a requirement: a browser without module workers, or
 * a build where the worker fails to start, must still be able to answer the
 * same questions. Keeping the job runner here means the fallback is the same
 * code rather than a second implementation that will quietly drift.
 *
 * The property that makes running it off-thread worthwhile: **rows are folded
 * as the cursor passes them and never collected.** A year of a busy shop's
 * order items is hundreds of thousands of records; materialising them into an
 * array to sum afterwards would allocate more than the summary is worth and
 * would hold the main thread for the whole of it. Every job below streams.
 */

/** Fold one shop's rows for a period, without building an array. */
async function streamPeriod<T>(
  storeIds: readonly number[],
  entity: (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES],
  fromMs: number,
  toMs: number,
  visit: (row: T) => void,
): Promise<void> {
  if (storeIds.length === 0) return;

  await withStore(STORES.records, 'readonly', async (store) => {
    const index = store.index(INDEXES.storeEntityDate);
    for (const storeId of storeIds) {
      await walk<T>(index, periodRange(storeId, entity, fromMs, toMs), 'next', visit);
    }
  });
}

/**
 * Collect rows for a period into an array.
 *
 * Used only where the aggregation genuinely needs a second pass or a sort that
 * cannot be done incrementally. Everything else streams.
 */
async function collectPeriod<T>(
  storeIds: readonly number[],
  entity: (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES],
  fromMs: number,
  toMs: number,
): Promise<T[]> {
  const rows: T[] = [];
  await streamPeriod<T>(storeIds, entity, fromMs, toMs, (row) => {
    rows.push(row);
  });
  return rows;
}

export async function runAnalytics(job: AnalyticsJob): Promise<AnalyticsResult> {
  switch (job.kind) {
    case 'series': {
      const granularity = job.granularity ?? chooseGranularity(job.fromMs, job.toMs);

      /**
       * Sorting matters here even though each shop's rows arrive in order: a
       * consolidated view reads several shops one after another, so the
       * concatenation is not globally ascending. The bucketed aggregation does
       * not require order — every row is placed arithmetically — but `firstAt`
       * and `lastAt` in the totals do, and a chart's tooltip reads them.
       */
      const rows = await collectPeriod<OrderItemRecord>(
        job.storeIds,
        ENTITY_TYPES.orderItem,
        job.fromMs,
        job.toMs,
      );
      if (job.storeIds.length > 1) rows.sort((a, b) => a.timestamp - b.timestamp);

      return {
        kind: 'series',
        value: aggregateOrders(rows, { fromMs: job.fromMs, toMs: job.toMs }, granularity),
      };
    }

    case 'products': {
      const rows = await collectPeriod<ProductRowLike>(
        job.storeIds,
        ENTITY_TYPES.orderItem,
        job.fromMs,
        job.toMs,
      );
      return { kind: 'products', value: aggregateByProduct(rows, job.limit ?? 0) };
    }

    case 'expenses': {
      const rows = await collectPeriod<ExpenseRecord>(
        job.storeIds,
        ENTITY_TYPES.expense,
        job.fromMs,
        job.toMs,
      );
      return { kind: 'expenses', value: aggregateExpenses(rows as readonly ExpenseRowLike[]) };
    }

    case 'count': {
      /* Counted by the index rather than read — no row is deserialised at all. */
      let total = 0;
      await withStore(STORES.records, 'readonly', async (store) => {
        const index = store.index(INDEXES.storeEntityDate);
        for (const storeId of job.storeIds) {
          total += await new Promise<number>((resolve, reject) => {
            const counter = index.count(periodRange(storeId, job.entity, job.fromMs, job.toMs));
            counter.onsuccess = () => {
              resolve(counter.result);
            };
            counter.onerror = () => {
              reject(counter.error ?? new Error('count failed'));
            };
          });
        }
      });
      return { kind: 'count', value: total };
    }
  }
}
