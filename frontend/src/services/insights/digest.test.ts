import { describe, expect, it, vi } from 'vitest';

import type { Scope } from '@/services/api/queryKeys';
import type { DataFreshness, TableFreshness } from '@/services/data/freshness';

const { readDataFreshness } = vi.hoisted(() => ({ readDataFreshness: vi.fn() }));
vi.mock('@/services/data/freshness', () => ({ readDataFreshness }));

const { freshnessNote, tableStamp } = await import('./digest');

const SCOPE: Scope = { storeKey: 'all', shopIds: [1], rangeKey: 'r30', fromMs: 0, toMs: 1 };

describe('tableStamp', () => {
  const NOW = Date.UTC(2026, 8, 21, 14, 12);

  it('prints the clock for a table read today', () => {
    const entry: TableFreshness = { table: 'sales', syncedAt: Date.UTC(2026, 8, 21, 14, 8), held: true };
    expect(tableStamp(entry, NOW)).toBe('sales 14:08');
  });

  it('prints the date for a table read an earlier day', () => {
    const entry: TableFreshness = { table: 'sales', syncedAt: Date.UTC(2026, 8, 20, 9, 0), held: true };
    expect(tableStamp(entry, NOW)).toBe('sales 2026-09-20');
  });

  it('prints never for a table that has not been read', () => {
    const entry: TableFreshness = { table: 'returns', syncedAt: null, held: false };
    expect(tableStamp(entry, NOW)).toBe('returns never');
  });

  it('marks a table that was read but holds nothing — the FBO-only account whose FBS invoice route refuses, stamped as read', () => {
    const entry: TableFreshness = { table: 'fbsInvoices', syncedAt: Date.UTC(2026, 8, 21, 10, 0), held: false };
    expect(tableStamp(entry, NOW)).toBe('fbsInvoices 10:00 empty');
  });
});

describe('freshnessNote', () => {
  it('is empty for a scope with no shops, without reading freshness', async () => {
    readDataFreshness.mockReset();

    const note = await freshnessNote({ ...SCOPE, shopIds: [] }, Date.now());

    expect(note).toBe('');
    expect(readDataFreshness).not.toHaveBeenCalled();
  });

  it('carries the clock, the refresh window and one stamp per table', async () => {
    readDataFreshness.mockReset();
    const now = Date.UTC(2026, 8, 21, 14, 12);
    const freshness: DataFreshness = {
      now,
      refreshMinutes: 60,
      tables: [
        { table: 'sales', syncedAt: Date.UTC(2026, 8, 21, 14, 8), held: true },
        { table: 'returns', syncedAt: null, held: false },
        { table: 'fbsInvoices', syncedAt: Date.UTC(2026, 8, 21, 10, 0), held: false },
      ],
    };
    readDataFreshness.mockResolvedValue(freshness);

    const note = await freshnessNote(SCOPE, now);

    expect(readDataFreshness).toHaveBeenCalledWith(SCOPE.shopIds, now);
    expect(note).toBe(
      [
        "[freshness] now 14:12 UTC · stored here, auto-refreshes past 60min · fresh:true only if the seller explicitly wants Uzum's latest — costs budget, slower",
        'sales 14:08 · returns never · fbsInvoices 10:00 empty',
      ].join('\n'),
    );
  });
});
