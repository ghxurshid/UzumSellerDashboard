import { formatCompactMoney, formatNumber, formatPercent, formatStamp } from '@/lib/format';
import type {
  ExpensesSource,
  FinanceSource,
  InvoicesSource,
  OrdersSource,
  StocksSource,
} from '@/services/queries/sources';
import type {
  FbsInvoice,
  FbsOrder,
  FinanceOrderItem,
  SellerPayment,
  SellerReturn,
  SkuAmount,
  SupplyInvoice,
} from '@/services/uzum/types';
import type {
  Kpi,
  Language,
  ModuleCell,
  ModuleColumn,
  ModuleDefinition,
  ModuleKey,
  ModuleRow,
  ModuleRowAction,
  ModuleTab,
  Product,
  Tone,
} from '@/types/domain';

import { summariseFinance, LOGISTICS_SOURCE } from './finance';
import { flattenSkus, type CatalogueSku } from './products';

/**
 * The four table screens, built from live responses.
 *
 * Columns are the API's own fields, deliberately: the premise of this product
 * is that every figure can be traced to the call it came from, and inventing a
 * "cover days" or "reorder point" column the seller API cannot answer would
 * break that on the first screen a user opens.
 *
 * Each module reports `total` (what the API says exists) separately from
 * `rows.length` (what was actually read), so a truncated page walk is visible
 * rather than silently shown as the whole dataset.
 */

/* ── cell helpers ───────────────────────────────────────────────────────── */

function text(
  value: string,
  options: { align?: 'start' | 'end'; tone?: Tone; sub?: string; icon?: string } = {},
): ModuleCell {
  return {
    kind: 'plain',
    value,
    align: options.align ?? 'end',
    ...(options.tone !== undefined ? { tone: options.tone } : {}),
    ...(options.sub !== undefined ? { sub: options.sub } : {}),
    ...(options.icon !== undefined ? { icon: options.icon } : {}),
  };
}

function pill(value: string, tone: Tone): ModuleCell {
  return { kind: 'pill', value, tone, align: 'end' };
}

const DASH = '—';

function column(
  key: string,
  label: string,
  width: string,
  align: 'start' | 'end' = 'end',
): ModuleColumn {
  return { key, label, width, align, sortable: true };
}

function action(
  act: ModuleRowAction['act'],
  labelKey: string,
  icon: string,
  endpoint: string,
  primary = false,
): ModuleRowAction {
  return { act, labelKey, icon, endpoint, ...(primary ? { primary } : {}) };
}

const EXPORT_ACTION = action('export', 'bulkExport', 'file-spreadsheet', 'client-side CSV');

function kpi(
  key: string,
  label: string,
  value: string,
  unit: string,
  source: string,
  trend: Kpi['trend'] = 'flat',
): Kpi {
  return { key, labelKey: label, value, unit, delta: '', trend, spark: [], source };
}

function statusTone(value: string): Tone {
  switch (value.toUpperCase()) {
    case 'ACCEPTED':
    case 'COMPLETED':
    case 'TO_WITHDRAW':
    case 'CONFIRMED':
    case 'DELIVERED':
      return 'positive';
    case 'CANCELED':
    case 'CANCELLED':
    case 'REFUNDED':
      return 'neutral';
    case 'PARTIALLY_CANCELLED':
    case 'DEFECTED':
      return 'negative';
    case 'CREATED':
    case 'PENDING':
    case 'PACKING':
      return 'warning';
    default:
      return 'accent';
  }
}

function stamp(at: number | null | undefined): string {
  if (at === null || at === undefined || at === 0) return DASH;
  return formatStamp(at);
}

/* ── inventory: SKU stock ───────────────────────────────────────────────── */

export interface InventoryInput {
  readonly products: readonly Product[];
  readonly stocks: StocksSource | undefined;
  readonly language: Language;
}

export function buildInventoryModule(input: InventoryInput): ModuleDefinition {
  const skus = flattenSkus(input.products);
  const fbsBySku = new Map<number, SkuAmount>(
    (input.stocks?.stocks ?? []).map((entry) => [entry.skuId, entry]),
  );

  const rows = skus.map((sku) => toInventoryRow(sku, fbsBySku.get(sku.skuId)));

  const available = skus.reduce((sum, sku) => sum + sku.quantityAvailable, 0);
  const zero = skus.filter((sku) => sku.quantityAvailable === 0).length;
  const negative = skus.filter((sku) => sku.quantityAvailable < 0).length;
  const fbsEnabled = (input.stocks?.stocks ?? []).filter((entry) => entry.fbsAllowed).length;

  return {
    key: 'inventory',
    titleKey: 'nStocks',
    source: 'GET /v1/product/shop/{shopId} · GET /v3/fbs/sku/stocks',
    icon: 'layers',
    kpis: [
      kpi('skus', 'skuList', formatNumber(skus.length), 'SKU', `${input.products.length} products`),
      kpi('available', 'Σ quantityAvailable', formatNumber(available), '', 'FBO warehouse stock'),
      kpi(
        'zero',
        'amount 0',
        formatNumber(zero),
        'SKU',
        skus.length === 0 ? '' : formatPercent((zero / skus.length) * 100),
        zero > 0 ? 'down' : 'flat',
      ),
      kpi('negative', 'negative', formatNumber(negative), 'SKU', 'reservations exceed stock', negative > 0 ? 'down' : 'flat'),
      kpi('fbs', 'fbsAllowed', formatNumber(fbsEnabled), 'SKU', 'GET /v3/fbs/sku/stocks'),
    ],
    tabs: [],
    columns: [
      column('skuTitle', 'skuTitle', 'minmax(220px,2fr)', 'start'),
      column('barcode', 'barcode', 'minmax(0,1.2fr)', 'start'),
      column('characteristics', 'characteristics', 'minmax(0,1fr)', 'start'),
      column('available', 'quantityAvailable', 'minmax(0,1fr)'),
      column('sold', 'quantitySold', 'minmax(0,1fr)'),
      column('returned', 'quantityReturned', 'minmax(0,1fr)'),
      column('fbs', 'FBS', '96px'),
    ],
    rows,
    searchable: true,
    searchPlaceholder: 'skuTitle, barcode',
    bulkActions: [
      action('stock', 'updStock', 'layers', 'POST /v2/fbs/sku/stocks', true),
      action('labels', 'printLabels', 'printer', 'POST /v1/product/shop/{shopId}/barcodes/print'),
      EXPORT_ACTION,
    ],
    truncated: input.stocks?.truncated ?? false,
    total: skus.length,
  };
}

function toInventoryRow(sku: CatalogueSku, fbs: SkuAmount | undefined): ModuleRow {
  const available = sku.quantityAvailable;
  /* Returned over *shipped*, which is what the route means by
     `returnedPercentage`: `quantitySold` counts what was kept, so dividing by
     it alone reads 200% for a SKU sold twice and returned four times — a
     percentage of a smaller population than the one being described. */
  const shipped = sku.quantitySold + sku.quantityReturned;
  const returnRate = shipped === 0 ? 0 : sku.quantityReturned / shipped;

  return {
    id: String(sku.skuId),
    tab: 'all',
    search: `${sku.skuId} ${sku.skuTitle} ${sku.productTitle} ${sku.barcode} ${sku.characteristics}`.toLowerCase(),
    sortValues: [
      sku.skuTitle,
      sku.barcode,
      sku.characteristics,
      available,
      sku.quantitySold,
      sku.quantityReturned,
      fbs?.amount ?? 0,
    ],
    raw: {
      skuId: sku.skuId,
      productId: sku.productId,
      shopId: sku.shopId,
      barcode: sku.barcode,
      amount: fbs?.amount ?? 0,
      price: sku.price,
    },
    cells: [
      text(sku.skuTitle, { align: 'start', sub: sku.productTitle, icon: 'package' }),
      text(sku.barcode === '' ? DASH : sku.barcode, { align: 'start', tone: 'neutral' }),
      text(sku.characteristics === '' ? DASH : sku.characteristics, { align: 'start', tone: 'neutral' }),
      text(formatNumber(available), {
        tone: available < 0 ? 'negative' : available === 0 ? 'warning' : 'accent',
      }),
      text(formatNumber(sku.quantitySold), { tone: 'neutral' }),
      text(
        sku.quantityReturned === 0
          ? DASH
          : `${formatNumber(sku.quantityReturned)} · ${formatPercent(returnRate * 100, 0)}`,
        { tone: returnRate > 0.5 ? 'negative' : 'neutral' },
      ),
      pill(formatNumber(fbs?.amount ?? 0), fbs?.fbsAllowed === true ? 'positive' : 'neutral'),
    ],
    detail: {
      note:
        available < 0
          ? 'quantityAvailable is negative — reserved units exceed what the warehouse has registered, so nothing can be sold and the open reservations will cancel.'
          : available === 0
            ? 'Nothing available. The SKU stays visible on the market card but cannot be bought until the next supply invoice is accepted.'
            : 'quantityAvailable is the FBO stock at the Uzum warehouse. FBS stock is reported separately by GET /v3/fbs/sku/stocks.',
      facts: [
        { label: 'skuId', value: String(sku.skuId) },
        { label: 'barcode', value: sku.barcode === '' ? DASH : sku.barcode },
        { label: 'price', value: formatNumber(sku.price) },
        { label: 'status', value: sku.status },
      ],
      list: [
        {
          icon: 'package',
          text: 'quantityAvailable',
          value: formatNumber(available),
          time: '',
          tone: available > 0 ? 'positive' : 'neutral',
        },
        {
          icon: 'shopping-cart',
          text: 'quantitySold',
          value: formatNumber(sku.quantitySold),
          time: '',
          tone: 'neutral',
        },
        {
          icon: 'rotate-ccw',
          text: 'quantityReturned',
          value: formatNumber(sku.quantityReturned),
          time: '',
          tone: sku.quantityReturned > 0 ? 'warning' : 'neutral',
        },
        {
          icon: 'link',
          text: 'fbsAllowed · dbsAllowed',
          value: `${String(fbs?.fbsAllowed ?? false)} · ${String(fbs?.dbsAllowed ?? false)}`,
          time: '',
          tone: 'neutral',
        },
      ],
      actions: [
        action('stock', 'updStock', 'layers', 'POST /v2/fbs/sku/stocks', true),
        action('labels', 'printLabels', 'printer', 'POST /v1/product/shop/{shopId}/barcodes/print'),
        action('price', 'aPrice', 'tag', 'POST /v1/product/{shopId}/sendPriceData'),
      ],
    },
  };
}

/* ── ops: orders ────────────────────────────────────────────────────────── */

export interface OpsInput {
  readonly finance: FinanceSource | undefined;
  readonly orders: OrdersSource | undefined;
  readonly shopNames: ReadonlyMap<number, string>;
  readonly language: Language;
}

interface GroupedOrder {
  readonly orderId: number;
  readonly shopId: number;
  readonly status: string;
  readonly date: number;
  readonly titles: readonly string[];
  readonly units: number;
  readonly sellPrice: number;
  readonly commission: number;
  readonly logistics: number;
  readonly sellerProfit: number;
  readonly purchasePrice: number;
  readonly returns: number;
  readonly returnCause: string | null;
}

/** Order items arrive one row per SKU; the ops table works in whole orders. */
function groupByOrder(items: readonly FinanceOrderItem[]): readonly GroupedOrder[] {
  const orders = new Map<number, GroupedOrder & { titles: string[] }>();

  for (const item of items) {
    const existing = orders.get(item.orderId);
    if (existing === undefined) {
      orders.set(item.orderId, {
        orderId: item.orderId,
        shopId: item.shopId,
        status: item.status,
        date: item.date,
        titles: [item.skuTitle],
        units: item.amount ?? 0,
        sellPrice: item.sellPrice ?? 0,
        commission: item.commission ?? 0,
        logistics: item.logisticDeliveryFee ?? 0,
        sellerProfit: item.sellerProfit ?? 0,
        purchasePrice: item.purchasePrice ?? 0,
        returns: item.amountReturns ?? 0,
        returnCause: item.returnCause,
      });
      continue;
    }

    existing.titles.push(item.skuTitle);
    Object.assign(existing, {
      units: existing.units + (item.amount ?? 0),
      sellPrice: existing.sellPrice + (item.sellPrice ?? 0),
      commission: existing.commission + (item.commission ?? 0),
      logistics: existing.logistics + (item.logisticDeliveryFee ?? 0),
      sellerProfit: existing.sellerProfit + (item.sellerProfit ?? 0),
      purchasePrice: existing.purchasePrice + (item.purchasePrice ?? 0),
      returns: existing.returns + (item.amountReturns ?? 0),
      date: Math.min(existing.date, item.date),
    });
  }

  return [...orders.values()].sort((a, b) => b.date - a.date);
}

const FINANCE_STATUSES = ['PROCESSING', 'TO_WITHDRAW', 'CANCELED', 'PARTIALLY_CANCELLED'] as const;

export function buildOpsModule(input: OpsInput): ModuleDefinition {
  const items = input.finance?.items ?? [];
  const grouped = groupByOrder(items);
  const totals = summariseFinance(items, [], {
    cancelledTotal: input.finance?.cancelledTotal ?? 0,
    reportedTotal: input.finance?.total ?? 0,
  });

  const fbsRows = (input.orders?.orders ?? []).map((order) => toFbsOrderRow(order, input.shopNames));
  const financeRows = grouped.map((order) => toOrderRow(order, input.shopNames));

  const tabs: ModuleTab[] = FINANCE_STATUSES.map((status) => ({
    key: status,
    label: status,
    count: grouped.filter((order) => order.status === status).length,
  }));

  if (fbsRows.length > 0) {
    tabs.push({ key: 'FBS', label: 'FBS · DBS', count: fbsRows.length });
  }

  const fbsTotal = input.orders?.total ?? 0;

  return {
    key: 'ops',
    titleKey: 'nOrders',
    source: 'GET /v1/finance/orders · GET /v2/fbs/orders',
    icon: 'truck',
    kpis: [
      kpi('total', 'totalElements', formatNumber(input.finance?.total ?? 0), '', 'order items in the window'),
      kpi(
        'cancelled',
        'CANCELED',
        formatNumber(totals.cancelledItems),
        '',
        formatPercent(totals.cancellationRate),
        totals.cancellationRate > 0 ? 'down' : 'flat',
      ),
      kpi('orders', 'orders', formatNumber(totals.orders), '', 'distinct orderId read'),
      kpi(
        'aov',
        'AOV',
        formatNumber(totals.averageOrderValue),
        input.language === 'ru' ? 'сум' : "so'm",
        'Σ sellPrice ÷ orders',
      ),
      /* Counted from the stored rows, not from `/v2/fbs/orders/count` — so the
         source names the route those rows came from. */
      kpi('fbs', 'FBS + DBS', formatNumber(fbsTotal), '', 'GET /v2/fbs/orders', fbsTotal > 0 ? 'up' : 'flat'),
    ],
    tabs,
    columns: [
      column('orderId', 'orderId', 'minmax(110px,1fr)', 'start'),
      column('created', 'date', 'minmax(0,1fr)', 'start'),
      column('shop', 'shopId', 'minmax(0,1.1fr)', 'start'),
      column('sku', 'skuTitle', 'minmax(200px,2fr)', 'start'),
      column('items', 'amount', '72px'),
      column('price', 'sellPrice', 'minmax(0,1.1fr)'),
      column('commission', 'commission', 'minmax(0,1fr)'),
      column('net', 'net', 'minmax(0,1fr)'),
      column('status', 'status', '132px'),
    ],
    rows: [...financeRows, ...fbsRows],
    searchable: true,
    searchPlaceholder: 'orderId, skuTitle',
    bulkActions: [
      action('confirm', 'aConfirm', 'check', 'POST /v1/fbs/order/{orderId}/confirm', true),
      action('labels', 'printLabels', 'printer', 'GET /v1/fbs/order/{orderId}/labels/print'),
      action('createInvoice', 'aCreateInv', 'file-text', 'POST /v1/fbs/invoice'),
      EXPORT_ACTION,
    ],
    truncated: input.finance?.truncated ?? false,
    total: input.finance?.total ?? 0,
  };
}

function toOrderRow(order: GroupedOrder, shopNames: ReadonlyMap<number, string>): ModuleRow {
  const net = order.sellerProfit - order.purchasePrice;
  const cancelled = order.status === 'CANCELED';
  const shop = shopNames.get(order.shopId) ?? String(order.shopId);

  return {
    id: String(order.orderId),
    tab: order.status,
    search: `${order.orderId} ${order.titles.join(' ')} ${shop}`.toLowerCase(),
    sortValues: [
      order.orderId,
      order.date,
      shop,
      order.titles[0] ?? '',
      order.units,
      order.sellPrice,
      order.commission,
      net,
      order.status,
    ],
    raw: { orderId: order.orderId, shopId: order.shopId, status: order.status, scheme: 'FBO' },
    cells: [
      text(String(order.orderId), { align: 'start', tone: 'accent' }),
      text(stamp(order.date), { align: 'start', tone: 'neutral' }),
      text(shop, { align: 'start', tone: 'neutral' }),
      text(order.titles[0] ?? DASH, {
        align: 'start',
        ...(order.titles.length > 1 ? { sub: `+${order.titles.length - 1}` } : {}),
      }),
      text(formatNumber(order.units), { tone: 'neutral' }),
      text(formatNumber(order.sellPrice)),
      text(order.commission === 0 ? DASH : `−${formatNumber(order.commission)}`, {
        tone: order.commission === 0 ? 'neutral' : 'negative',
      }),
      text(cancelled ? DASH : formatNumber(net), {
        tone: cancelled ? 'neutral' : net > 0 ? 'positive' : 'negative',
      }),
      pill(order.status, statusTone(order.status)),
    ],
    detail: {
      note: cancelled
        ? 'Cancelled before handover: commission and sellerProfit come back as 0. The logisticDeliveryFee still appears in the expense ledger and is partly refunded as return-logistics-volume.'
        : 'Order items from GET /v1/finance/orders, grouped by orderId. sellerProfit = sellPrice − commission − logisticDeliveryFee; net subtracts your purchasePrice on top.',
      facts: [
        { label: 'sellPrice', value: formatNumber(order.sellPrice) },
        { label: 'commission', value: formatNumber(order.commission) },
        { label: 'logisticDeliveryFee', value: formatNumber(order.logistics) },
        { label: 'sellerProfit', value: formatNumber(order.sellerProfit) },
      ],
      list: [
        {
          icon: 'tag',
          text: 'Σ purchasePrice',
          value: formatNumber(order.purchasePrice),
          time: '',
          tone: 'neutral',
        },
        { icon: 'hash', text: 'amount', value: formatNumber(order.units), time: '', tone: 'neutral' },
        {
          icon: 'rotate-ccw',
          text: 'amountReturns',
          value: formatNumber(order.returns),
          time: '',
          tone: order.returns > 0 ? 'warning' : 'neutral',
        },
        {
          icon: 'message-square',
          text: 'returnCause',
          value: order.returnCause ?? DASH,
          time: '',
          tone: 'neutral',
        },
      ],
      actions: [EXPORT_ACTION, action('price', 'aPrice', 'tag', 'POST /v1/product/{shopId}/sendPriceData')],
    },
  };
}

function toFbsOrderRow(order: FbsOrder, shopNames: ReadonlyMap<number, string>): ModuleRow {
  const titles = (order.orderItems ?? []).map((item) => item.skuTitle ?? '').filter((title) => title !== '');
  const shop = order.shopId === null ? DASH : (shopNames.get(order.shopId) ?? String(order.shopId));
  const isDbs = (order.scheme ?? '').toUpperCase() === 'DBS';

  const actions: ModuleRowAction[] = [
    action('confirm', 'aConfirm', 'check', `POST /v1/fbs/order/${order.id}/confirm`, true),
    action('labels', 'aLabel', 'printer', `GET /v1/fbs/order/${order.id}/labels/print`),
    action('identifiers', 'aIdent', 'hash', `POST /v1/fbs/order/${order.id}/identifier`),
    action('cancelOrder', 'aCancelOrd', 'x-circle', `POST /v1/fbs/order/${order.id}/cancel`),
  ];

  if (isDbs) {
    actions.push(
      action('deliver', 'aDeliver', 'truck', `POST /v1/dbs/order/${order.id}/delivering`),
      action('complete', 'aComplete', 'check', `POST /v1/dbs/order/${order.id}/completed`),
      action('refund', 'aRefund', 'rotate-ccw', `POST /v1/dbs/order/${order.id}/refund`),
    );
  }

  return {
    id: String(order.id),
    tab: 'FBS',
    search: `${order.id} ${titles.join(' ')} ${shop}`.toLowerCase(),
    sortValues: [
      order.id,
      order.dateCreated ?? 0,
      shop,
      titles[0] ?? '',
      (order.orderItems ?? []).length,
      order.price ?? 0,
      0,
      0,
      order.status,
    ],
    raw: {
      orderId: order.id,
      shopId: order.shopId,
      status: order.status,
      scheme: order.scheme ?? 'FBS',
    },
    cells: [
      text(String(order.id), { align: 'start', tone: 'accent' }),
      text(stamp(order.dateCreated), { align: 'start', tone: 'neutral' }),
      text(shop, { align: 'start', tone: 'neutral' }),
      text(titles[0] ?? DASH, {
        align: 'start',
        ...(order.scheme !== null ? { sub: order.scheme } : {}),
      }),
      text(formatNumber((order.orderItems ?? []).length), { tone: 'neutral' }),
      text(order.price === null ? DASH : formatNumber(order.price)),
      text(DASH, { tone: 'neutral' }),
      text(DASH, { tone: 'neutral' }),
      pill(order.status, statusTone(order.status)),
    ],
    detail: {
      note: 'FBS and DBS orders from GET /v2/fbs/orders. These are the only orders the seller API lets you act on — confirm, cancel, label, and for DBS, hand over and refund.',
      facts: [
        { label: 'orderId', value: String(order.id) },
        { label: 'scheme', value: order.scheme ?? DASH },
        { label: 'dateAcceptUntil', value: stamp(order.dateAcceptUntil) },
        { label: 'dateDeliverUntil', value: stamp(order.dateDeliverUntil) },
      ],
      list: (order.orderItems ?? []).slice(0, 6).map((item) => ({
        icon: 'package',
        text: item.skuTitle ?? String(item.skuId ?? ''),
        value: formatNumber(item.amount ?? 0),
        time: '',
        tone: 'neutral' as Tone,
      })),
      actions,
    },
  };
}

/* ── invoices: supply, returns and FBS shipments ────────────────────────── */

export interface InvoicesInput {
  readonly invoices: InvoicesSource | undefined;
  readonly language: Language;
}

export function buildInvoicesModule(input: InvoicesInput): ModuleDefinition {
  const supply = input.invoices?.supply ?? [];
  const returns = input.invoices?.returns ?? [];
  const fbs = input.invoices?.fbs ?? [];

  const declared = supply.reduce((sum, invoice) => sum + invoice.totalToStock, 0);
  const accepted = supply.reduce((sum, invoice) => sum + invoice.totalAccepted, 0);
  const value = supply.reduce((sum, invoice) => sum + invoice.fullPrice, 0);

  const tabs: ModuleTab[] = [
    { key: 'fbo', label: 'FBO supply', count: supply.length },
    { key: 'ret', label: 'Returns', count: returns.length },
  ];
  if (fbs.length > 0) tabs.push({ key: 'fbs', label: 'FBS invoices', count: fbs.length });

  return {
    key: 'invoices',
    titleKey: 'nInvoices',
    source: 'GET /v1/invoice · GET /v1/return · GET /v1/fbs/invoice',
    icon: 'file-text',
    kpis: [
      kpi('invoices', 'invoices', formatNumber(supply.length), '', 'GET /v1/invoice'),
      kpi('value', 'Σ fullPrice', formatCompactMoney(value, input.language), '', 'declared value'),
      kpi('declared', 'Σ totalToStock', formatNumber(declared), 'units', 'declared to the warehouse'),
      kpi(
        'accepted',
        'Σ totalAccepted',
        formatNumber(accepted),
        'units',
        declared === 0 ? '' : `${formatNumber(accepted - declared)} vs declared`,
        accepted < declared ? 'down' : 'flat',
      ),
      kpi('returns', 'returns', formatNumber(returns.length), '', 'GET /v1/return'),
    ],
    tabs,
    columns: [
      column('id', 'id', 'minmax(110px,1fr)', 'start'),
      column('status', 'status', '150px'),
      column('created', 'dateCreated', 'minmax(0,1fr)', 'start'),
      column('value', 'fullPrice', 'minmax(0,1.2fr)'),
      column('declared', 'totalToStock', 'minmax(0,1fr)'),
      column('accepted', 'totalAccepted', 'minmax(0,1fr)'),
      column('warehouse', 'stock.title', 'minmax(0,1.4fr)', 'start'),
      column('shop', 'shopTitle', 'minmax(0,1.2fr)', 'start'),
    ],
    rows: [
      ...supply.map(toSupplyRow),
      ...returns.map(toReturnRow),
      ...fbs.map(toFbsInvoiceRow),
    ],
    searchable: true,
    searchPlaceholder: 'invoice id, warehouse',
    bulkActions: [EXPORT_ACTION],
    truncated: false,
    total: supply.length + returns.length + fbs.length,
  };
}

function toSupplyRow(invoice: SupplyInvoice): ModuleRow {
  const status = invoice.invoiceStatus?.value ?? 'UNKNOWN';
  const warehouse = invoice.stock?.title ?? DASH;
  const shop = invoice.shopTitle ?? String(invoice.shopId);
  const short = invoice.dateCreated ?? DASH;

  return {
    id: String(invoice.id),
    tab: 'fbo',
    search: `${invoice.id} ${status} ${warehouse} ${shop}`.toLowerCase(),
    sortValues: [
      invoice.id,
      status,
      short,
      invoice.fullPrice,
      invoice.totalToStock,
      invoice.totalAccepted,
      warehouse,
      shop,
    ],
    raw: { invoiceId: invoice.id, shopId: invoice.shopId },
    cells: [
      text(String(invoice.id), { align: 'start', tone: 'accent' }),
      pill(status, statusTone(status)),
      text(short, { align: 'start', tone: 'neutral' }),
      text(formatNumber(invoice.fullPrice)),
      text(formatNumber(invoice.totalToStock), { tone: 'neutral' }),
      text(formatNumber(invoice.totalAccepted), {
        tone: invoice.totalAccepted < invoice.totalToStock ? 'warning' : 'positive',
      }),
      text(warehouse, { align: 'start', tone: 'neutral' }),
      text(shop, { align: 'start', tone: 'neutral' }),
    ],
    detail: {
      note: 'Supply invoice from GET /v1/invoice. Its contents come from GET /v1/shop/{shopId}/invoice/products; a shortfall between totalToStock and totalAccepted is stock that never reached the warehouse.',
      facts: [
        { label: 'invoiceNumber', value: String(invoice.invoiceNumber ?? invoice.id) },
        { label: 'totalToStock', value: formatNumber(invoice.totalToStock) },
        { label: 'totalAccepted', value: formatNumber(invoice.totalAccepted) },
        { label: 'fullPrice', value: formatNumber(invoice.fullPrice) },
      ],
      list: (invoice.productForInvoiceDto ?? []).slice(0, 6).map((product) => ({
        icon: 'package',
        text: product.productTitle ?? product.skuTitle ?? String(product.id),
        value: `${formatNumber(product.quantityAccepted)} / ${formatNumber(product.quantityToStock)}`,
        time: '',
        tone:
          product.quantityAccepted < product.quantityToStock ? ('warning' as Tone) : ('neutral' as Tone),
      })),
      actions: [EXPORT_ACTION],
    },
  };
}

function toReturnRow(entry: SellerReturn): ModuleRow {
  const warehouse = entry.stock?.title ?? DASH;

  return {
    id: String(entry.id),
    tab: 'ret',
    search: `${entry.id} ${entry.type} ${entry.status} ${warehouse}`.toLowerCase(),
    sortValues: [
      entry.id,
      entry.status,
      entry.dateCreated ?? 0,
      entry.totalAmount,
      entry.totalAmount,
      entry.totalPackedAmount,
      warehouse,
      entry.shopTitle ?? '',
    ],
    raw: { returnId: entry.id, shopId: entry.shopId },
    cells: [
      text(String(entry.id), { align: 'start', tone: 'accent' }),
      pill(entry.status, statusTone(entry.status)),
      text(stamp(entry.dateCreated), { align: 'start', tone: 'neutral' }),
      text(entry.type, { tone: entry.type === 'DEFECTED' ? 'negative' : 'neutral' }),
      text(formatNumber(entry.totalAmount)),
      text(formatNumber(entry.totalPackedAmount), {
        tone: entry.totalPackedAmount < entry.totalAmount ? 'warning' : 'neutral',
      }),
      text(warehouse, { align: 'start', tone: 'neutral' }),
      text(entry.shopTitle ?? DASH, { align: 'start', tone: 'neutral' }),
    ],
    detail: {
      note: 'Warehouse return from GET /v1/return. Items arrive as SellerReturnItemDto with skuId, amount, packedAmount and purchasePrice.',
      facts: [
        { label: 'totalAmount', value: formatNumber(entry.totalAmount) },
        { label: 'totalPackedAmount', value: formatNumber(entry.totalPackedAmount) },
        { label: 'type', value: entry.type },
        { label: 'status', value: entry.status },
      ],
      list: (entry.returnItems ?? []).slice(0, 6).map((item) => ({
        icon: 'package',
        text: item.skuTitle ?? item.productTitle ?? String(item.skuId),
        value: `${formatNumber(item.packedAmount)} / ${formatNumber(item.amount)}`,
        time: '',
        tone: item.packedAmount < item.amount ? ('warning' as Tone) : ('neutral' as Tone),
      })),
      actions: [EXPORT_ACTION],
    },
  };
}

function toFbsInvoiceRow(invoice: FbsInvoice): ModuleRow {
  const point = invoice.dropOffPoint?.address ?? invoice.dropOffPoint?.title ?? DASH;
  const editable = invoice.status === 'CREATED';

  return {
    id: String(invoice.id),
    tab: 'fbs',
    search: `${invoice.id} ${invoice.number ?? ''} ${invoice.status} ${point}`.toLowerCase(),
    sortValues: [
      invoice.id,
      invoice.status,
      invoice.dateCreated ?? 0,
      invoice.fullPrice ?? 0,
      invoice.numberOrders ?? 0,
      invoice.numberAcceptedOrders ?? 0,
      point,
      '',
    ],
    raw: { invoiceId: invoice.id, status: invoice.status },
    cells: [
      text(String(invoice.number ?? invoice.id), { align: 'start', tone: 'accent' }),
      pill(invoice.status, statusTone(invoice.status)),
      text(stamp(invoice.dateCreated), { align: 'start', tone: 'neutral' }),
      text(invoice.fullPrice === null ? DASH : formatNumber(invoice.fullPrice)),
      text(formatNumber(invoice.numberOrders ?? 0), { tone: 'neutral' }),
      text(formatNumber(invoice.numberAcceptedOrders ?? 0), { tone: 'neutral' }),
      text(point, { align: 'start', tone: 'neutral' }),
      text(DASH, { align: 'start', tone: 'neutral' }),
    ],
    detail: {
      note: 'FBS shipment invoice. While it is CREATED its contents can be changed, its point and slot moved, and the invoice cancelled; once accepted, both acts print as Base64 PDFs.',
      facts: [
        { label: 'numberOrders', value: formatNumber(invoice.numberOrders ?? 0) },
        { label: 'numberAcceptedOrders', value: formatNumber(invoice.numberAcceptedOrders ?? 0) },
        { label: 'fullPrice', value: formatNumber(invoice.fullPrice ?? 0) },
        { label: 'status', value: invoice.status },
      ],
      list: [],
      actions: editable
        ? [
            action('timeSlot', 'aSlot', 'clock', 'POST /v1/fbs/invoice/dop/time-slot', true),
            action('updateContent', 'aUpdContent', 'pencil', `POST /v1/fbs/invoice/${invoice.id}/update-content`),
            action('cancelInvoice', 'aCancelInv', 'x-circle', `POST /v1/fbs/invoice/${invoice.id}/cancel`),
          ]
        : [
            action('printSupply', 'aPrintSupply', 'printer', `GET /v1/fbs/invoice/${invoice.id}/print`, true),
            action('printAcceptance', 'aPrintAcceptance', 'printer', `GET /v1/fbs/invoice/${invoice.id}/closing-documents`),
          ],
    },
  };
}

/* ── finance: order items, expenses and the P&L summary ─────────────────── */

export interface FinanceInput {
  readonly finance: FinanceSource | undefined;
  readonly expenses: ExpensesSource | undefined;
  readonly language: Language;
}

export function buildFinanceModule(input: FinanceInput): ModuleDefinition {
  const items = input.finance?.items ?? [];
  const payments = input.expenses?.payments ?? [];
  const totals = summariseFinance(items, payments, {
    cancelledTotal: input.finance?.cancelledTotal ?? 0,
    reportedTotal: input.finance?.total ?? 0,
  });

  const summaryRows = buildSummaryRows(totals);

  return {
    key: 'finance',
    titleKey: 'nFinance',
    source: 'GET /v1/finance/orders · GET /v1/finance/expenses',
    icon: 'pie-chart',
    kpis: [
      kpi('sell', 'Σ sellPrice', formatCompactMoney(totals.sellPrice, input.language), '', `${formatNumber(totals.liveItems)} items`),
      kpi(
        'sellerProfit',
        'Σ sellerProfit',
        formatCompactMoney(totals.sellerProfit, input.language),
        '',
        totals.sellPrice === 0 ? '' : formatPercent((totals.sellerProfit / totals.sellPrice) * 100),
      ),
      kpi(
        'net',
        'Net profit',
        formatCompactMoney(totals.netProfit, input.language),
        '',
        formatPercent(totals.netMargin),
        totals.netProfit >= 0 ? 'up' : 'down',
      ),
      kpi(
        'commission',
        'Σ commission',
        formatCompactMoney(totals.commission, input.language),
        '',
        totals.sellPrice === 0 ? '' : formatPercent((totals.commission / totals.sellPrice) * 100),
        'down',
      ),
      kpi(
        'expenses',
        'Σ paymentPrice',
        formatCompactMoney(totals.expenseLogistics + totals.expenseOther, input.language),
        '',
        'GET /v1/finance/expenses',
        'down',
      ),
    ],
    tabs: [
      { key: 'orders', label: 'Order items', count: items.length },
      { key: 'exp', label: 'Expenses', count: payments.length },
      { key: 'sum', label: 'Summary', count: summaryRows.length },
    ],
    columns: [
      column('date', 'date', 'minmax(0,1fr)', 'start'),
      column('orderId', 'orderId', 'minmax(0,1fr)', 'start'),
      column('sku', 'skuTitle', 'minmax(180px,2fr)', 'start'),
      column('amount', 'amount', '66px'),
      column('sellPrice', 'sellPrice', 'minmax(0,1.1fr)'),
      column('purchase', 'purchasePrice', 'minmax(0,1fr)'),
      column('commission', 'commission', 'minmax(0,1fr)'),
      column('logistics', 'logisticDeliveryFee', 'minmax(0,1fr)'),
      column('sellerProfit', 'sellerProfit', 'minmax(0,1fr)'),
      column('status', 'status', '132px'),
    ],
    rows: [
      ...items.map(toFinanceItemRow),
      ...payments.map(toExpenseRow),
      ...summaryRows,
    ],
    searchable: true,
    searchPlaceholder: 'orderId, skuTitle, expense',
    bulkActions: [EXPORT_ACTION],
    truncated: (input.finance?.truncated ?? false) || (input.expenses?.truncated ?? false),
    total: input.finance?.total ?? 0,
  };
}

function toFinanceItemRow(item: FinanceOrderItem): ModuleRow {
  const purchase = item.purchasePrice ?? 0;

  return {
    id: `item-${item.id}`,
    tab: 'orders',
    search: `${item.orderId} ${item.skuTitle} ${item.productTitle} ${item.status}`.toLowerCase(),
    sortValues: [
      item.date,
      item.orderId,
      item.skuTitle,
      item.amount,
      item.sellPrice,
      purchase,
      item.commission,
      item.logisticDeliveryFee,
      item.sellerProfit,
      item.status,
    ],
    raw: { orderId: item.orderId, productId: item.productId, shopId: item.shopId },
    cells: [
      text(stamp(item.date), { align: 'start', tone: 'neutral' }),
      text(String(item.orderId), { align: 'start', tone: 'accent' }),
      text(item.skuTitle, { align: 'start', sub: item.productTitle }),
      text(item.amount === 0 ? DASH : formatNumber(item.amount), { tone: 'neutral' }),
      text(item.sellPrice === 0 ? DASH : formatNumber(item.sellPrice)),
      text(purchase === 0 ? DASH : `−${formatNumber(purchase)}`, { tone: 'neutral' }),
      text(item.commission === 0 ? DASH : `−${formatNumber(item.commission)}`, {
        tone: item.commission === 0 ? 'neutral' : 'negative',
      }),
      text(
        item.logisticDeliveryFee === 0 ? DASH : `−${formatNumber(item.logisticDeliveryFee)}`,
        { tone: item.logisticDeliveryFee === 0 ? 'neutral' : 'negative' },
      ),
      text(item.sellerProfit === 0 ? DASH : formatNumber(item.sellerProfit), {
        tone: item.sellerProfit > 0 ? 'positive' : 'neutral',
      }),
      pill(item.status, statusTone(item.status)),
    ],
    detail: {
      note: 'FinanceItemEntity from GET /v1/finance/orders. sellerProfit = sellPrice − commission − logisticDeliveryFee; purchasePrice is yours and is not subtracted, so net profit is finished client-side.',
      facts: [
        { label: 'sellPrice', value: formatNumber(item.sellPrice) },
        {
          label: 'commission',
          value:
            item.sellPrice === 0
              ? formatNumber(item.commission)
              : `${formatNumber(item.commission)} · ${formatPercent((item.commission / item.sellPrice) * 100, 0)}`,
        },
        { label: 'logisticDeliveryFee', value: formatNumber(item.logisticDeliveryFee) },
        { label: 'net', value: formatNumber(item.sellerProfit - purchase) },
      ],
      list: [
        { icon: 'tag', text: 'purchasePrice', value: formatNumber(purchase), time: '', tone: 'neutral' },
        { icon: 'package', text: 'productTitle', value: item.productTitle, time: '', tone: 'neutral' },
        {
          icon: 'message-square',
          text: 'returnCause',
          value: item.returnCause ?? DASH,
          time: '',
          tone: 'neutral',
        },
        { icon: 'store', text: 'shopId', value: String(item.shopId), time: '', tone: 'neutral' },
      ],
      actions: [EXPORT_ACTION],
    },
  };
}

function toExpenseRow(payment: SellerPayment): ModuleRow {
  const income = payment.type === 'INCOME';

  return {
    id: `exp-${payment.id}`,
    tab: 'exp',
    search: `${payment.name} ${payment.source} ${payment.code}`.toLowerCase(),
    sortValues: [
      payment.dateCreated,
      payment.name,
      payment.source,
      payment.type,
      payment.amount,
      payment.paymentPrice,
      payment.status,
      '',
      '',
      '',
    ],
    raw: { paymentId: payment.id, shopId: payment.shopId },
    cells: [
      text(stamp(payment.dateCreated), { align: 'start', tone: 'neutral' }),
      text(payment.name, { align: 'start', icon: 'file-text' }),
      text(payment.source, { align: 'start', tone: 'neutral' }),
      text(payment.type, { tone: income ? 'positive' : 'negative' }),
      text(formatNumber(payment.amount), { tone: 'neutral' }),
      text(`${income ? '+' : '−'}${formatNumber(payment.paymentPrice)}`, {
        tone: income ? 'positive' : 'negative',
      }),
      pill(payment.status, statusTone(payment.status)),
      text(DASH, { tone: 'neutral' }),
      text(DASH, { tone: 'neutral' }),
      text(DASH, { tone: 'neutral' }),
    ],
    detail: {
      note:
        payment.source === LOGISTICS_SOURCE
          ? 'Logistics is already inside sellerProfit on the order item. It is listed here for traceability but excluded from the expense total, because counting it twice charges the same delivery to the same order.'
          : 'SellerPaymentDto from GET /v1/finance/expenses. Amounts are integers in so\'m; INCOME rows are refunds and net against the matching charge.',
      facts: [
        { label: 'paymentPrice', value: formatNumber(payment.paymentPrice) },
        { label: 'amount', value: formatNumber(payment.amount) },
        { label: 'type', value: payment.type },
        { label: 'code', value: payment.code },
      ],
      list: [
        { icon: 'plug', text: 'source', value: payment.source, time: '', tone: 'neutral' },
        { icon: 'calendar', text: 'dateCreated', value: '', time: stamp(payment.dateCreated), tone: 'neutral' },
        { icon: 'hash', text: 'code', value: payment.code, time: '', tone: 'neutral' },
        { icon: 'link', text: 'externalId', value: payment.externalId ?? DASH, time: '', tone: 'neutral' },
      ],
      actions: [EXPORT_ACTION],
    },
  };
}

/** The P&L, line by line, each naming the sum it comes from. */
function buildSummaryRows(totals: ReturnType<typeof summariseFinance>): readonly ModuleRow[] {
  const share = (value: number): string =>
    totals.sellPrice === 0 ? DASH : formatPercent((Math.abs(value) / totals.sellPrice) * 100);

  const lines: ReadonlyArray<{
    key: string;
    label: string;
    field: string;
    value: number;
    negative: boolean;
  }> = [
    { key: 'revenue', label: 'Seller price', field: 'Σ sellPrice', value: totals.sellPrice, negative: false },
    { key: 'purchase', label: 'Purchase price', field: 'Σ purchasePrice', value: -totals.purchasePrice, negative: true },
    { key: 'commission', label: 'Commission', field: 'Σ commission', value: -totals.commission, negative: true },
    { key: 'logistics', label: 'Logistic delivery fee', field: 'Σ logisticDeliveryFee', value: -totals.logisticDeliveryFee, negative: true },
    { key: 'sellerProfit', label: 'Seller profit', field: 'Σ sellerProfit', value: totals.sellerProfit, negative: false },
    ...[...totals.expenseBySource.entries()]
      .filter(([source]) => source !== LOGISTICS_SOURCE)
      .map(([source, value]) => ({
        key: `exp-${source}`,
        label: source,
        field: `Σ paymentPrice · ${source}`,
        value: -value,
        negative: true,
      })),
    { key: 'net', label: 'Net profit', field: 'sellerProfit − purchasePrice − expenses', value: totals.netProfit, negative: totals.netProfit < 0 },
  ];

  return lines.map((line) => ({
    id: `sum-${line.key}`,
    tab: 'sum',
    search: `${line.label} ${line.field}`.toLowerCase(),
    sortValues: [line.label, line.field, line.value, Math.abs(line.value)],
    raw: {},
    cells: [
      text(line.label, { align: 'start', icon: line.negative ? 'trending-down' : 'trending-up' }),
      text(line.field, { align: 'start', tone: 'neutral' }),
      text(formatNumber(line.value), { tone: line.negative ? 'negative' : 'accent' }),
      text(share(line.value), { tone: 'neutral' }),
      text(DASH, { tone: 'neutral' }),
      text(DASH, { tone: 'neutral' }),
      text(DASH, { tone: 'neutral' }),
      text(DASH, { tone: 'neutral' }),
      text(DASH, { tone: 'neutral' }),
      text(DASH, { tone: 'neutral' }),
    ],
    detail: {
      note: 'Client-side aggregate over the order items and expenses returned for the selected period and shops. The seller API exposes no P&L endpoint, so this is a sum, not a report.',
      facts: [
        { label: 'field', value: line.field },
        { label: 'value', value: formatNumber(line.value) },
        { label: 'share', value: share(line.value) },
      ],
      list: [],
      actions: [EXPORT_ACTION],
    },
  }));
}

/** Default tab per module — the one the design opens on. */
export const DEFAULT_TAB: Readonly<Record<ModuleKey, string>> = {
  inventory: 'all',
  ops: 'PROCESSING',
  invoices: 'fbo',
  finance: 'orders',
};
