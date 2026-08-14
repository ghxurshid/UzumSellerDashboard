import { useEffect, useState } from 'react';

import { derivePriceImpact, type PriceMove } from '@/services/derive/priceImpact';
import {
  ENTITY_TYPES,
  readJournal,
  readLedger,
  readMeta,
} from '@/services/storage/archive/archive.service';
import type { ChangeEvent } from '@/services/storage/archive/codec';
import { bounds } from '@/services/storage/archive/coverage';
import { toCoverage } from '@/services/storage/idb/metadata.repo';
import { useArchiveStore } from '@/store/archive.store';

/**
 * Reading the archive for analysis.
 *
 * The ledger can be a six-figure row count, and reading it is a real cost — not
 * one to pay during a render, and not one to pay at all until someone opens a
 * screen that needs it. So this hook loads on mount and after a sync, off the
 * render path, and reports `loading` while it does.
 *
 * It is not a React Query: there is no request here and nothing to retry or
 * revalidate. The source of truth is IndexedDB, and the only thing that changes
 * it is a sync — which is exactly what the archive store publishes.
 *
 * ## Why this one reads rows rather than using the analytics worker
 *
 * The price-impact derivation is not an aggregation. It walks the change
 * journal, and for each price move it needs the individual order rows either
 * side of it to measure what demand did — a shape the bucketed summaries in
 * `idb/aggregation.ts` cannot express. Charts and AI window summaries go through
 * the worker; this one genuinely needs the rows, and pays for them off the
 * render path instead.
 */

export interface ArchiveAnalysis {
  /** Price moves with the demand either side, newest first. */
  readonly moves: readonly PriceMove[];
  /** The raw change journal, newest first. */
  readonly changes: readonly ChangeEvent[];
  /** Settled order rows held for this shop. */
  readonly ledgerRows: number;
  readonly loading: boolean;
}

const EMPTY: ArchiveAnalysis = { moves: [], changes: [], ledgerRows: 0, loading: false };

async function analyse(shopId: number): Promise<ArchiveAnalysis> {
  const [journal, ledger, meta] = await Promise.all([
    readJournal(shopId),
    readLedger(shopId),
    readMeta(shopId, ENTITY_TYPES.orderItem),
  ]);

  const covered = bounds(toCoverage(meta.synced_ranges));

  /* Product titles come from the ledger rather than the catalogue capture: the
     capture stores SKU titles, and a move is reported per product. */
  const titles = new Map<number, string>();
  for (const row of ledger) {
    if (!titles.has(row.productId) && row.productTitle !== '') {
      titles.set(row.productId, row.productTitle);
    }
  }

  return {
    moves: derivePriceImpact({
      journal,
      ledger,
      coveredFrom: covered?.fromMs ?? null,
      coveredTo: covered?.toMs ?? null,
      titleOf: (productId) => titles.get(productId) ?? `product ${productId}`,
    }),
    changes: [...journal].sort((a, b) => b.at - a.at),
    ledgerRows: ledger.length,
    loading: false,
  };
}

export function useArchiveAnalysis(shopId: number | null): ArchiveAnalysis {
  const refreshedAt = useArchiveStore((state) => state.refreshedAt);
  const [state, setState] = useState<ArchiveAnalysis>(EMPTY);

  useEffect(() => {
    if (shopId === null) {
      setState(EMPTY);
      return;
    }

    setState((previous) => ({ ...previous, loading: true }));

    /* `live` guards against a shop switch resolving out of order: the read is
       asynchronous, so a slow first request could otherwise land after a fast
       second one and show the wrong shop's analysis. */
    let live = true;

    void analyse(shopId)
      .then((result) => {
        if (live) setState(result);
      })
      .catch(() => {
        if (live) setState(EMPTY);
      });

    return () => {
      live = false;
    };
  }, [refreshedAt, shopId]);

  return state;
}
