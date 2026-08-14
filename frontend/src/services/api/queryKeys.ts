import type { RangeKey } from '@/types/domain';

/**
 * Query key factory.
 *
 * A scope is the exact question every data query answers: *these* shops, over
 * *this* window. The window is resolved once (when the range changes, or when
 * a sync starts) rather than from `Date.now()` at render time — a key that
 * moved every render would refetch on every render.
 */
export interface Scope {
  /** `all`, or the shop id as a string. Drives the store chip. */
  readonly storeKey: string;
  /** Shop ids the request is actually made for. */
  readonly shopIds: readonly number[];
  readonly rangeKey: RangeKey;
  readonly fromMs: number;
  readonly toMs: number;
}

/** The part of a scope a server request depends on, as a stable key segment. */
export const scopeSegment = (scope: Scope) =>
  ({
    shopIds: [...scope.shopIds].sort((a, b) => a - b).join(','),
    from: scope.fromMs,
    to: scope.toMs,
  }) as const;

export const queryKeys = {
  /** Account-level, scope-independent: the connection probe. */
  shops: ['uzum', 'shops'] as const,

  source: {
    all: ['uzum', 'source'] as const,
    products: (scope: Scope) => ['uzum', 'source', 'products', scopeSegment(scope).shopIds] as const,
    stocks: () => ['uzum', 'source', 'stocks'] as const,
    finance: (scope: Scope) => ['uzum', 'source', 'finance', scopeSegment(scope)] as const,
    /** The same window one period earlier — what "vs previous period" compares to. */
    comparison: (scope: Scope) => ['uzum', 'source', 'comparison', scopeSegment(scope)] as const,
    expenses: (scope: Scope) => ['uzum', 'source', 'expenses', scopeSegment(scope)] as const,
    orders: (scope: Scope) => ['uzum', 'source', 'orders', scopeSegment(scope)] as const,
    invoices: () => ['uzum', 'source', 'invoices'] as const,
  },

  reference: {
    returnReasons: ['uzum', 'reference', 'return-reasons'] as const,
    barcodeTypes: ['uzum', 'reference', 'barcode-types'] as const,
  },
} as const;
