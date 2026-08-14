#!/usr/bin/env node
// Uzum Seller OpenAPI -> bitta namuna fayli (uzum-samples.json)
// Ishga tushirish:  UZUM_TOKEN="<token>" node uzum-dump.mjs
// Node 18+ kerak (fetch built-in). Hech qanday npm paket kerak emas.
//
// Faqat GET so'rovlar. Hech narsa o'zgartirmaydi.
// Mijoz ismi/telefoni/manzili avtomatik maskalanadi.

const BASE = 'https://api-seller.uzum.uz/api/seller-openapi';
const TOKEN = process.env.UZUM_TOKEN || process.argv[2];
const DAYS = Number(process.env.DAYS || 60);      // qancha kunlik tarix
const SAMPLE = Number(process.env.SAMPLE || 25);  // massivdan nechta element saqlanadi
const OUT = process.env.OUT || 'uzum-samples.json';

if (!TOKEN) {
  console.error('UZUM_TOKEN yo\'q.  Misol:  UZUM_TOKEN="abc..." node uzum-dump.mjs');
  process.exit(1);
}

const now = Date.now();
const fromMs = now - DAYS * 864e5;
const result = { meta: { base: BASE, generatedAt: new Date().toISOString(), days: DAYS, sampleLimit: SAMPLE }, calls: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PII = new Set(['customerfullname', 'customerphone', 'deliveryaddress', 'deliverycomment', 'customername', 'phone', 'phonenumber', 'recipientname']);

// massivlarni qisqartirish + PII maskalash; strukturani buzmaydi
function trim(v, path = '') {
  if (Array.isArray(v)) {
    const kept = v.slice(0, SAMPLE).map(x => trim(x, path + '[]'));
    if (v.length > SAMPLE) kept.push(`…__${v.length - SAMPLE}_more_items_omitted__`);
    return kept;
  }
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      o[k] = PII.has(k.toLowerCase()) && typeof val === 'string' ? '__masked__' : trim(val, path + '.' + k);
    }
    return o;
  }
  return v;
}

async function get(label, path, params = {}) {
  const u = new URL(BASE + path);
  for (const [k, val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) val.forEach(x => u.searchParams.append(k, x));
    else u.searchParams.set(k, val);
  }
  const url = u.toString();
  let res, body, text;
  try {
    res = await fetch(url, { headers: { Authorization: TOKEN, Accept: 'application/json' } });
    text = await res.text();
    try { body = JSON.parse(text); } catch { body = { __nonJson: text.slice(0, 400) }; }
  } catch (e) {
    result.calls[label] = { request: url, error: String(e) };
    console.log(`✗ ${label} — ${e}`);
    return null;
  }
  result.calls[label] = { request: url, status: res.status, response: trim(body) };
  const n = countItems(body);
  console.log(`${res.ok ? '✓' : '✗'} ${label} — ${res.status}${n != null ? ` · ${n} element` : ''}`);
  await sleep(350); // rate limit (soatlik cheklov bor)
  return res.ok ? body : null;
}

function countItems(b) {
  if (Array.isArray(b)) return b.length;
  const p = b?.payload ?? b;
  for (const k of ['orderItems', 'productList', 'payments', 'orders', 'skuAmountList'])
    if (Array.isArray(p?.[k])) return p[k].length;
  if (Array.isArray(p?.orders)) return p.orders.length;
  return null;
}

// dateFrom/dateTo — spec int64, ms yoki sekund ekani hujjatda aniq emas.
// Ikkalasini sinab, ishlaganini meta'ga yozamiz.
async function detectTimeUnit(shopIds) {
  for (const [unit, f, t] of [['ms', fromMs, now], ['sec', Math.floor(fromMs / 1e3), Math.floor(now / 1e3)]]) {
    const b = await get(`probe_timeUnit_${unit}`, '/v1/finance/orders', { shopIds, dateFrom: f, dateTo: t, size: 1, page: 0 });
    const n = countItems(b);
    if (n) { result.meta.timeUnit = unit; return [f, t]; }
  }
  result.meta.timeUnit = 'unknown (ikkalasi ham bo\'sh qaytdi — DAYS ni oshirib ko\'ring)';
  return [fromMs, now];
}

const run = async () => {
  const shops = await get('shops', '/v1/shops');
  const shopIds = (Array.isArray(shops) ? shops : []).map(s => s.id);
  if (!shopIds.length) { console.error('Do\'kon topilmadi — token to\'g\'rimi?'); }
  result.meta.shopIds = shopIds;
  const shopId = shopIds[0];

  const [dateFrom, dateTo] = await detectTimeUnit(shopIds);
  const range = { dateFrom, dateTo };

  // --- 1-daraja: pul ---
  await get('finance_orders_flat_p0', '/v1/finance/orders', { shopIds, ...range, group: false, size: 50, page: 0 });
  await get('finance_orders_flat_p1', '/v1/finance/orders', { shopIds, ...range, group: false, size: 50, page: 1 });
  await get('finance_orders_grouped', '/v1/finance/orders', { shopIds, ...range, group: true, size: 50, page: 0 });
  await get('finance_orders_canceled', '/v1/finance/orders', { shopIds, ...range, group: false, size: 25, page: 0, statuses: ['CANCELED'] });
  await get('finance_expenses_p0', '/v1/finance/expenses', { shopIds, ...range, size: 50, page: 0 });
  await get('finance_expenses_p1', '/v1/finance/expenses', { shopIds, ...range, size: 50, page: 1 });

  // --- 2-daraja: katalog + buyurtmalar ---
  for (const sid of shopIds.slice(0, 3))
    await get(`products_shop_${sid}`, `/v1/product/shop/${sid}`, { shopId: sid, size: 100, page: 0, sortBy: 'ORDERS', order: 'DESC', filter: 'ALL' });

  const ord = await get('fbs_orders_all', '/v2/fbs/orders', { shopIds, ...range, size: 50, page: 0 });
  await get('fbs_orders_p1', '/v2/fbs/orders', { shopIds, ...range, size: 50, page: 1 });
  for (const st of ['CANCELED', 'RETURNED', 'COMPLETED'])
    await get(`fbs_orders_${st}`, '/v2/fbs/orders', { shopIds, ...range, status: st, size: 25, page: 0 });
  for (const st of ['CREATED', 'PACKING', 'DELIVERING', 'COMPLETED', 'CANCELED', 'RETURNED'])
    await get(`fbs_orders_count_${st}`, '/v2/fbs/orders/count', { shopIds, ...range, status: st });

  const oneOrderId = ord?.payload?.orders?.[0]?.id;
  if (oneOrderId) await get('fbs_order_single', `/v1/fbs/order/${oneOrderId}`);

  // --- 3-daraja: qaytarish, qoldiq, ta'minot ---
  const rets = await get('returns_list', '/v1/return', { size: 30, page: 0 });
  const retId = Array.isArray(rets) ? rets[0]?.id : undefined;
  if (retId && shopId) await get('return_single', `/v1/shop/${shopId}/return/${retId}`);
  await get('return_reasons', '/v1/fbs/order/return-reasons');
  await get('stocks_v3', '/v3/fbs/sku/stocks', { size: 100, page: 0 });

  const inv = await get('fbo_invoices', '/v1/invoice', { size: 20, page: 0 });
  const invId = Array.isArray(inv) ? inv[0]?.id : undefined;
  if (shopId) await get('fbo_invoices_shop', `/v1/shop/${shopId}/invoice`, { size: 20, page: 0 });
  if (shopId && invId) await get('fbo_invoice_products', `/v1/shop/${shopId}/invoice/products`, { invoiceId: invId, size: 20, page: 0 });
  await get('fbs_invoices', '/v1/fbs/invoice', { size: 20, page: 0 });

  const ok = Object.values(result.calls).filter(c => c.status >= 200 && c.status < 300).length;
  result.meta.summary = { calls: Object.keys(result.calls).length, ok };
  const fs = await import('node:fs/promises');
  await fs.writeFile(OUT, JSON.stringify(result, null, 1));
  console.log(`\n→ ${OUT} yozildi · ${ok}/${Object.keys(result.calls).length} so'rov muvaffaqiyatli`);
  console.log('Faylni ochib bir ko\'z tashlang, keyin chatga tashlang.');
};

run().catch(e => { console.error(e); process.exit(1); });
