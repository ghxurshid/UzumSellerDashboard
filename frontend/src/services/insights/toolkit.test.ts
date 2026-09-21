import { describe, expect, it, vi } from 'vitest';

import type {
  ExpensesSource,
  FinanceSource,
  InvoicesSource,
  OrdersSource,
} from '@/services/data/collections';
import type { ToolContext } from './toolkit';

/**
 * The decisions under test spend the seller's request budget: whether a
 * `fresh:true` argument actually reaches past a collection's freshness
 * window and asks Uzum again. `runReadTool` is the seam — the collections
 * door (`@/services/data/collections`) is mocked so every assertion reads
 * the `force` flag a read was actually called with, never the private
 * `forceOnce` helper's own bookkeeping.
 */

const { readFinance, readExpenses, readOrders, readInvoices } = vi.hoisted(() => ({
  readFinance: vi.fn(),
  readExpenses: vi.fn(),
  readOrders: vi.fn(),
  readInvoices: vi.fn(),
}));

vi.mock('@/services/data/collections', () => ({
  readFinance,
  readExpenses,
  readOrders,
  readInvoices,
}));

const { runReadTool } = await import('./toolkit');

const emptyFinance = (): FinanceSource => ({ items: [], total: 0, cancelledTotal: 0, truncated: false });
const emptyExpenses = (): ExpensesSource => ({ payments: [], total: 0, truncated: false });
const emptyOrders = (): OrdersSource => ({
  orders: [],
  counts: {} as unknown as OrdersSource['counts'],
  total: 0,
});
const emptyInvoices = (): InvoicesSource => ({ supply: [], returns: [], fbs: [], fbsUnavailable: false });

/** The window `window.totals`/`sales.timeline` fall back to when `from`/`to` are omitted. */
const SCOPE_FROM = Date.UTC(2026, 7, 1);
const SCOPE_TO = Date.UTC(2026, 7, 31, 23, 59, 59, 999);
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

let contextSeq = 0;

function makeContext(): ToolContext {
  contextSeq += 1;
  return {
    scope: { storeKey: 'all', shopIds: [1], rangeKey: 'r30', fromMs: SCOPE_FROM, toMs: SCOPE_TO },
    products: [],
    shops: [{ id: 1, name: `Shop ${contextSeq}` }],
    language: 'uz',
    now: NOW,
    signal: undefined,
  };
}

function resetMocks(): void {
  readFinance.mockReset().mockResolvedValue(emptyFinance());
  readExpenses.mockReset().mockResolvedValue(emptyExpenses());
  readOrders.mockReset().mockResolvedValue(emptyOrders());
  readInvoices.mockReset().mockResolvedValue(emptyInvoices());
}

describe('a forced refresh happens once per question, per collection, per window', () => {
  it('forces the ledger once for window.totals, then serves sales.timeline over the same window from that refresh', async () => {
    resetMocks();
    const context = makeContext();

    await runReadTool('window.totals', { fresh: true }, context);
    expect(readFinance.mock.calls[0]?.[1]).toMatchObject({ sync: true, force: true });
    expect(readExpenses.mock.calls[0]?.[1]).toMatchObject({ sync: true, force: true });

    await runReadTool('sales.timeline', { fresh: true }, context);
    // Same window as window.totals (both omit from/to, so both fall back to
    // context.scope) — the second ask must not spend a second request.
    expect(readFinance.mock.calls[1]?.[1]).toMatchObject({ sync: true, force: false });
  });

  it('forces orders again when a later fresh:true names a wider window the first force never re-read', async () => {
    // Pins the defect a review found: downgrading on the collection's name
    // alone (ignoring which days were actually forced) would leave the
    // settlement tail of the wider week unread while the model believes it
    // just asked for the very latest. If the containment check in
    // `forceOnce` is lost, the second call below regresses to `force: false`
    // and this assertion catches it.
    resetMocks();
    const context = makeContext();
    const today = { from: '2026-09-21', to: '2026-09-21' };
    const lastSevenDays = { from: '2026-09-15', to: '2026-09-21' };

    await runReadTool('orders.pipeline', { ...today, fresh: true }, context);
    expect(readOrders.mock.calls[0]?.[1]).toMatchObject({ sync: true, force: true });

    await runReadTool('data.rows', { dataset: 'orders', ...lastSevenDays, fresh: true }, context);
    expect(readOrders.mock.calls[1]?.[1]).toMatchObject({ sync: true, force: true });
  });

  it('does not force again when a later fresh:true names a window already inside one forced', async () => {
    // The other direction of the same containment check: forcing the wider
    // week first must let a later, narrower "just today" ask be served from
    // it rather than spend a second request.
    resetMocks();
    const context = makeContext();
    const lastSevenDays = { from: '2026-09-15', to: '2026-09-21' };
    const today = { from: '2026-09-21', to: '2026-09-21' };

    await runReadTool('data.rows', { dataset: 'orders', ...lastSevenDays, fresh: true }, context);
    expect(readOrders.mock.calls[0]?.[1]).toMatchObject({ force: true });

    await runReadTool('orders.pipeline', { ...today, fresh: true }, context);
    expect(readOrders.mock.calls[1]?.[1]).toMatchObject({ force: false });
  });

  it('forces again for a second question — a new ToolContext carries no memory of the first', async () => {
    resetMocks();
    const first = makeContext();
    const second = makeContext();

    await runReadTool('window.totals', { fresh: true }, first);
    await runReadTool('window.totals', { fresh: true }, second);

    expect(readFinance.mock.calls[0]?.[1]).toMatchObject({ force: true });
    expect(readFinance.mock.calls[1]?.[1]).toMatchObject({ force: true });
    expect(readExpenses.mock.calls[0]?.[1]).toMatchObject({ force: true });
    expect(readExpenses.mock.calls[1]?.[1]).toMatchObject({ force: true });
  });

  it('never forces when fresh is not asked for', async () => {
    resetMocks();
    const context = makeContext();

    await runReadTool('window.totals', {}, context);
    await runReadTool('sales.timeline', {}, context);
    await runReadTool('orders.pipeline', {}, context);
    await runReadTool('supply.invoices', {}, context);

    for (const call of readFinance.mock.calls) expect(call[1]).toMatchObject({ force: false });
    for (const call of readExpenses.mock.calls) expect(call[1]).toMatchObject({ force: false });
    for (const call of readOrders.mock.calls) expect(call[1]).toMatchObject({ force: false });
    for (const call of readInvoices.mock.calls) expect(call[1]).toMatchObject({ force: false });
  });

  it('period.compare forces the current window and never the baseline', async () => {
    resetMocks();
    const context = makeContext();

    await runReadTool('period.compare', { fresh: true }, context);

    // read(current, ...) runs before read(previous, ...) — see toolkit.ts.
    expect(readFinance.mock.calls[0]?.[1]).toMatchObject({ sync: true, force: true });
    expect(readExpenses.mock.calls[0]?.[1]).toMatchObject({ sync: true, force: true });
    expect(readFinance.mock.calls[1]?.[1]).toMatchObject({ sync: true, force: false });
    expect(readExpenses.mock.calls[1]?.[1]).toMatchObject({ sync: true, force: false });
  });
});

describe('what a header claims', () => {
  it('says a collection was refetched only when it actually went to Uzum', async () => {
    resetMocks();
    const context = makeContext();

    const { text } = await runReadTool('window.totals', { fresh: true }, context);

    expect(text).toContain('finance refetched from Uzum');
    expect(text).toContain('expenses refetched from Uzum');
  });

  it('says a downgraded read was served from this question\'s earlier refresh', async () => {
    resetMocks();
    const context = makeContext();

    await runReadTool('window.totals', { fresh: true }, context);
    const { text } = await runReadTool('sales.timeline', { fresh: true }, context);

    expect(text).toContain('finance already forced this question — served from that refresh');
    expect(text).not.toContain('finance refetched from Uzum');
  });

  it('an ordinary read mentions neither refetch nor a prior forced refresh', async () => {
    resetMocks();
    const context = makeContext();

    const { text } = await runReadTool('window.totals', {}, context);

    expect(text).not.toContain('refetched from Uzum');
    expect(text).not.toContain('already forced this question');
  });

  it('window.totals states both collections it touched in one header line', async () => {
    resetMocks();
    const context = makeContext();

    const { text } = await runReadTool('window.totals', { fresh: true }, context);
    const headerLine = text.split('\n')[0] ?? '';

    expect(headerLine.startsWith('[window.totals]')).toBe(true);
    expect(headerLine).toContain('finance refetched from Uzum');
    expect(headerLine).toContain('expenses refetched from Uzum');
  });
});
