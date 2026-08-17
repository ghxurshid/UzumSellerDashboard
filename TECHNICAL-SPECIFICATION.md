# Savdo Copilot — Texnik spetsifikatsiya

**Versiya:** 2.4.0
**Hujjat sanasi:** 2026-08-16
**Maqsad:** [FUNCTIONAL-SPECIFICATION.md](./FUNCTIONAL-SPECIFICATION.md) dagi har bir
talab texnik jihatdan qanday amalga oshirilganini ifodalash.

Bog'liq hujjatlar:
- [ENDPOINTS.md](./frontend/src/services/uzum/ENDPOINTS.md) — Uzum API ma'lumotnomasi
- [STORAGE.md](./frontend/src/services/storage/STORAGE.md) — IndexedDB jadvallari va sync

---

## 1. Arxitektura

### 1.1. Serversiz model

**Ilova serveri yo'q.** Brauzer to'g'ridan-to'g'ri `api-seller.uzum.uz` bilan
gaplashadi, foydalanuvchining o'z tokeni bilan.

```
┌──────────────────────────── Brauzer ────────────────────────────┐
│                                                                 │
│   React SPA                                                     │
│      │                                                          │
│      ├── TanStack Query ──── axios ──┐                          │
│      │                               │                          │
│      └── IndexedDB ('savdo', v2)     │                          │
│            16 object store           │                          │
│                                      │                          │
└──────────────────────────────────────┼──────────────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          │  dev: Vite proxy (CORS) │
                          └────────────┬────────────┘
                                       ▼
                        https://api-seller.uzum.uz
                            /api/seller-openapi
```

**Nega shunday.** Uzum tokeni sotuvchining o'ziniki. Uni serverga saqlash
qo'shimcha ishonch talab qiladi va hech qanday funksional foyda bermaydi —
barcha hisob-kitob mijoz tomonida bajarilishi mumkin.

**Natijasi (funksional spetsifikatsiyaning 7-bo'limi).** Ma'lumot faqat
foydalanuvchi brauzerida; jamoaviy ishlash, serverdagi zaxira va boshqa
qurilmadan kirish yo'q.

**CORS.** Uzum API CORS sarlavhalarini yubormaydi, shuning uchun `localhost` dan
to'g'ridan-to'g'ri chaqirib bo'lmaydi. Ishlab chiqishda
[vite.config.ts](./frontend/vite.config.ts#L38) proxy qiladi. Ishlab chiqarishda
ilova brauzer kengaytmasi sifatida host ruxsatlari bilan ishlashi ko'zda
tutilgan — shu sabab asosiy URL konstanta emas, **sozlama**.

### 1.2. `backend/` papkasi

Hozircha o'zgartirilmagan ASP.NET Core shabloni (`WeatherForecastController`).
Ishlatilmaydi. Kelajakda kerak bo'lsa — jamoaviy kirish, serverdagi zaxira yoki
rejalashtirilgan sinxronizatsiya uchun.

### 1.3. Texnologiyalar

| Qatlam | Tanlov |
|---|---|
| Til | TypeScript 5.7 (`strict`) |
| UI | React 19, Vite 6 |
| Uslub | Tailwind CSS 4 |
| Komponentlar | Radix UI primitivlari |
| Server holati | TanStack Query 5 |
| Mijoz holati | Zustand 5 |
| Formalar | react-hook-form + zod |
| HTTP | axios |
| Animatsiya | framer-motion |
| Saqlash | IndexedDB (to'g'ridan-to'g'ri, ORM'siz) |

---

## 2. Qatlamlar

Bog'liqlik yo'nalishi qat'iy — pastdan yuqoriga:

```
pages/          ekranlar
   ↑
features/       ekran bloklari
   ↑
services/queries/    TanStack Query hooklari, read-through
   ↑
services/derive/     hisob-kitob (sof funksiyalar)
   ↑
services/storage/    IndexedDB, sync metadata
services/sync/       lazy sync, snapshot capture
   ↑
services/uzum/       endpointlar, wire tiplar, envelope
   ↑
services/api/        axios, xatolar, rate limit
```

**Qoida:** yuqori qatlam pastkini biladi, aksi yo'q. `derive/` sof — na tarmoq,
na saqlash, na DOM.

---

## 3. API qatlami

### 3.1. Envelope

Uzum uch xil javob shakli qaytaradi. `uzum/http.ts` uchalasini biladi:

| Shakl | Endpointlar | O'qigich |
|---|---|---|
| Yalang'och massiv | `/v1/shops`, `/v1/invoice`, `/v1/return` | `getRaw()` |
| `{ payload }` | `/v3/fbs/sku/stocks`, `/v2/fbs/orders`, `/v1/finance/expenses` | `getPayload()` |
| O'ziga xos obyekt | `/v1/finance/orders`, `/v1/product/shop/{id}` | `getRaw()` |

### 3.2. Vaqt birligi

`dateFrom`/`dateTo` — **sekund**, javob ichidagi timestamp'lar — **millisekund**.
Aralashtirilsa API xato bermaydi, bo'sh ro'yxat qaytaradi. Konvertatsiya bitta
nomlangan funksiyada: `toApiSeconds()`.

### 3.3. Sahifalash

`paginate()` kolleksiyani oxirigacha o'qiydi, **40 sahifalik shift** bilan.
Natija `{ items, total, truncated }`. `truncated: true` — UI "to'liq emas" deb
ko'rsatadi.

> Bitta muhim tuzatish: `/v1/finance/expenses` real serverda `totalElements: 0`
> qaytaradi, qatorlar bo'lsa ham. `paginate()` `0` ni "noma'lum" deb qabul
> qiladi, "hech narsa" deb emas — aks holda sahifalash birinchi sahifadan keyin
> to'xtardi.

### 3.4. Rate limit

`api/rateLimit.ts` — barcha so'rovlar bitta kanaldan o'tadi, ketma-ket, o'lchangan
tezlikda. `429` kelsa `Retry-After` hurmat qilinadi va pauza uzayadi.

**Nega ketma-ket.** Uzum soatiga cheklaydi. Parallel so'rovlar tezlik bermaydi,
faqat `429` keltiradi.

### 3.5. Xatolar

`ApiError` turlarga bo'linadi: `unauthorized`, `forbidden`, `notFound`,
`rateLimited`, `timeout`, `cancelled`, `server`, `client`. Har bir ekran shu
turga qarab nima ko'rsatishini biladi.

---

## 4. Saqlash qatlami

To'liq tafsilot: [STORAGE.md](./frontend/src/services/storage/STORAGE.md).

### 4.1. IndexedDB sxemasi

`DB_NAME = 'savdo'`, `DB_VERSION = 2`, **16 object store**.

Har bir yozuvda: `id` (deterministik), `store_id`, `account`, `timestamp`, `day`.
Har bir jadvalda 4 ta umumiy indeks: `store_date` (`['store_id','timestamp']`),
`timestamp`, `store_id`, `account`.

**Windowed** (sync oynasi bor): `order_items`, `expenses`, `fbs_orders`,
`fbs_order_items`

**Snapshot** (oyna yo'q): `products`, `product_skus`, `fbs_stocks`,
`supply_invoices`, `supply_invoice_items`, `seller_returns`, `return_items`,
`fbs_invoices`

**Journal**: `change_events`

**Xizmat**: `sync_metadata`, `buffer`, `kv`

### 4.2. `store_id` qayerdan keladi

Uzum buni izchil bermaydi: `/v1/finance/orders` har qatorda `shopId` yozadi,
`/v3/fbs/sku/stocks` esa do'kon haqida umuman gapirmaydi.

Shuning uchun `store_id` **so'rov qilingan do'kondan** qo'yiladi, payload'ga
ishonilmaydi. FBS qoldiqlari uchun esa avval katalog o'qiladi va har bir qoldiq
o'z do'konining SKU'lariga tegishliligi bo'yicha ajratiladi.

### 4.3. Nega ayrimlarida oyna bor

**Bu tanlov emas, API cheklovi.** `dateFrom`/`dateTo` ni faqat 3 ta route qabul
qiladi:

```
GET /v1/finance/orders     ✓
GET /v1/finance/expenses   ✓
GET /v2/fbs/orders         ✓
──────────────────────────────
qolgan 32 ta route         ✗   faqat page, size
```

Ya'ni mahsulot yoki nakladnoy uchun "mart oyini ber" deb so'rashning iloji yo'q.
Bu funksional spetsifikatsiyaning 6-bo'limidagi "ikki turdagi ma'lumot"
bo'linishiga aynan mos keladi.

### 4.4. Retention

| Entity | Chegara | Qoplamani qirqadimi |
|---|---|---|
| `order_item` | 200 000 | ha |
| `expense` | 50 000 | ha |
| `fbs_order` | 100 000 | ha |
| `fbs_order_item` | 300 000 | ha |
| `change_event` | 20 000 | yo'q |
| snapshot'lar | cheklanmagan | — |

Windowed entity qirqilsa `synced_ranges` ham qirqiladi — aks holda arxiv o'zi
o'chirgan davrni "menda bor" deb da'vo qilardi.

---

## 5. Sinxronizatsiya

### 5.1. Lazy sync — asosiy mexanizm

**Funksional talab:** "yuklangan davr tanlansa tarmoqqa chiqilmaydi".

**Yechim** ([`sync/lazySync.ts`](./frontend/src/services/sync/lazySync.ts)):
davr haqida savol berilganda avval `sync_metadata` o'qiladi, faqat u da'vo
qilmagan qismlar so'raladi, javob esa **har doim IndexedDB'dan** qaytariladi.

```
So'ralgan:   [───────── yanvar ── fevral ── mart ─────────]
Metadata:    [───────── yanvar ────────]
So'raladi:                        [fevral ── mart]
```

Uchta xossa bundan kelib chiqadi:

1. Grafik, AI tahlil, davr chipi va sync tugmasi — **bitta yo'ldan** boradi
2. Bir marta olingan davr abadiy tekin
3. Javob har doim saqlashdan o'qilgani uchun, "yangi olingan" va "eskidan bor"
   davrlar bir xil natija beradi

**Reja barcha 4 windowed entity'ning yetishmagan qismlari birlashmasi bo'yicha
tuziladi.** Sababi: bitta so'rovda `order_item` yozuvi tushib, `expense` yozuvi
tushmasligi mumkin — faqat ledger bo'yicha rejalashtirsa, o'sha teshik abadiy
qolardi.

**In-flight registri.** Bir necha ekran bir vaqtda bir xil davrni so'rashi mumkin
— ikkinchisi birinchisini kutadi, takroriy so'rov yuborilmaydi.

### 5.2. Settlement lag

**Funksional talab:** "oxirgi 14 kun qayta o'qiladi".

**Yechim:** `SETTLEMENT_LAG_MS = 14 kun`. Taqqoslashdan oldin qoplamaning oxirgi
14 kuni "ochib" qo'yiladi. Undan eskisi — barqaror tarix.

Lekin bu har savolda qayta o'qishga olib kelmasligi kerak. Shuning uchun tail
faqat **yozuv yangilik oynasidan eski bo'lsa** ochiladi. Sync tugmasi `force`
uzatadi va har doim ochadi.

### 5.3. Backfill

**Funksional talab:** "eski tarix asta-sekin qo'shiladi".

| Parametr | Qiymat |
|---|---|
| Birinchi sync chuqurligi | 90 kun |
| Bo'lak hajmi | 30 kun |
| Oddiy sync qo'shadigan bo'lak | 2 ta |
| "Davom ettirish" qo'shadigan | 12 ta |
| Eng chuqur chegara | 730 kun |

Bo'laklar **yangisidan eskisiga** o'qiladi — yarim yo'lda to'xtatilsa, yaqin
tarix to'liq qoladi.

Tarix boshi topilishi: **ketma-ket ikkita bo'sh oy**. API'da "do'kon qachon
ochilgan" degan maydon yo'q, shuning uchun xulosa chiqariladi. Bitta bo'sh oy
yetarli emas — bir oy tanaffus qilgan do'konning undan oldingi tarixi
yo'qolardi.

### 5.4. Snapshot capture

[`sync/snapshotSync.ts`](./frontend/src/services/sync/snapshotSync.ts) — reja
yo'q, ayirish yo'q. Ikki qoida:

1. **Avval o'chirish, keyin yozish** — katalogdan chiqib ketgan mahsulotning
   ustiga yoziladigan qatori yo'q; o'chirilmasa u oxirgi ma'lum narxi bilan
   abadiy turardi
2. **Bo'sh javob — xato, o'chirish emas** — route hech narsa qaytarsa, bu
   deyarli har doim rate limit, "sotuvchi hamma tovarini o'chirdi" emas

### 5.5. Truncation

Sahifa shifti bitta oynani kesib qo'ysa, o'sha oynani "qoplangan" deb belgilash
arxivni buzadi. Shuning uchun kesilgan oyna **ikkiga bo'linadi** va har yarmi
alohida o'qiladi, `MAX_SPLIT_DEPTH = 3` gacha.

### 5.6. Bitta jarayon qoidasi

[`sync/syncEngine.ts`](./frontend/src/services/sync/syncEngine.ts) — sync to'rt
joydan boshlanishi mumkin (yuqori panel, palitra, sozlamalar, banner), lekin
**bitta** `AbortController` va **bitta** in-flight promise bor.

Ikkinchi bosish yangi jarayon boshlamaydi — birinchisiga qo'shiladi. Natija bir
marta e'lon qilinadi, ya'ni bitta toast chiqadi.

### 5.7. Invariant

> **Oraliq faqat u qamragan qatorlar yozilgandan KEYIN qayd etiladi.**

Teskari tartib — bu loyihadagi yagona tuzatib bo'lmaydigan xato. Qoplangan deb
belgilangan, lekin saqlanmagan oyna — hech qachon qayta so'ralmaydigan teshik,
chunki rejalashtiruvchi qoplama yozuviga so'zsiz ishonadi.

---

## 6. Hisob-kitob qatlami

`services/derive/` — sof funksiyalar, tarmoq va saqlashsiz.

| Modul | Nima hisoblaydi |
|---|---|
| `overview.ts` | KPI'lar, jonli lenta, umumiy xulosa |
| `finance.ts` | Aylanma, komissiya, logistika, sof foyda |
| `series.ts` | Vaqt seriyalari, bucket'lash |
| `products.ts` | Katalog qatorlari, holat normalizatsiyasi |
| `modules.ts` | To'rt jadval ekranining ta'rifi (ustunlar, KPI, amallar) |
| `insights.ts` | Avtomatik kuzatuvlar |
| `priceImpact.ts` | Narx o'zgarishining sotuvga ta'siri |

### Wire → domen tarjimasi

Uzum so'z boyligi ilova so'z boyligiga aynan mos kelmaydi. Tarjima **chegarada**
bajariladi (`derive/products.ts`):

```
IN_STOCK  →  ACTIVE
BLOCKED   →  WARNING
```

Saqlashda esa **API qanday aytsa shunday** yoziladi. Shu tufayli Uzum
so'zlashuvi o'zgarsa, bitta joyda tuzatiladi — saqlangan qatorlarni qayta yozish
kerak bo'lmaydi.

---

## 7. Analitika worker'i

Katta davrlarni yig'ish asosiy oqimni bloklamasligi kerak.

- `analytics.worker.ts` — Web Worker
- `analytics.runner.ts` — ish mantiqi (worker ham, asosiy oqim ham shuni ishlatadi)
- `aggregation.ts` — sof arifmetika

**Muhim xossa:** qatorlar kursor o'tayotganda **yig'iladi va massivga
to'planmaydi**. Bir yillik tarix yuz minglab qator bo'lishi mumkin; ularni
massivga yig'ish xulosa qiymatidan ko'proq xotira talab qilardi.

Worker ishlamaydigan brauzerda **xuddi shu kod** asosiy oqimda ishlaydi —
ikkinchi implementatsiya yo'q, ya'ni ular bir-biridan uzoqlashmaydi.

Natija ustunlar ko'rinishida qaytadi (`at[]`, `revenue[]`, `units[]`) — worker
chegarasidan o'tkazish arzonroq.

---

## 8. Mijoz holati

Zustand store'lari, har biri bitta mas'uliyat bilan:

| Store | Nima saqlaydi |
|---|---|
| `session.store` | Ulanish holati, tanlangan do'konlar |
| `filters.store` | Davr oynasi, filtrlar |
| `sync.store` | Sync jarayoni, log — **butun UI shundan o'qiydi** |
| `archive.store` | Qoplama ko'rinishi, saqlash hajmi |
| `settings.store` | Sozlamalar |
| `notifications.store` | Bildirishnomalar |
| `toast.store` | Vaqtinchalik xabarlar |
| `ui.store`, `dialog.store`, `chat.store`, `preferences.store` | UI holati |

**Sync ko'rsatkichlari nega kelishadi.** Yuqori paneldagi chiziq, sozlamalar
paneli va ekran banneri — uchalasi ham `sync.store` ni o'qiydi. Ular bir-biriga
mos kelishi tuzilma bo'yicha kafolatlangan, intizom bilan emas.

---

## 9. Yozish amallari

[`queries/useUzumActions.ts`](./frontend/src/services/queries/useUzumActions.ts)
— har bir yozish to'rt ish qiladi:

1. So'rovni jarayon oynasi ostida bajaradi
2. API'ning o'z javobini ko'rsatadi
3. Bildirishnomaga yozadi
4. **Aynan o'zgargan** so'rovlarni invalidatsiya qiladi

Rad etilgan yozish keshga tegmaydi va sababini aytadi.

**Ommaviy amallar sikl bilan bajariladi, batch bilan emas** — Uzum'da
buyurtmalar uchun batch endpoint yo'q. Shu sababli jarayon ko'rsatkichi
haqiqiy bajarilgan so'rovlarni sanaydi.

Chop etish: barcha PDF route'lari Base64 satr qaytaradi, `Blob` ga aylantirish
mijozda.

---

## 10. Qurish va tekshirish

```bash
npm run dev        # Vite dev server, port 5173, CORS proxy bilan
npm run build      # tsc -b && vite build
npm run typecheck  # tsc -b --noEmit
npm run lint       # eslint
```

**Chunk bo'linishi** ([vite.config.ts](./frontend/vite.config.ts#L9)):
`vendor-react`, `vendor-query`, `vendor-motion`, `vendor-forms` — yuqori
paneldagi o'zgarish grafik bundle keshini buzmasligi uchun.

**Hozirgi holat:** typecheck ✅ · lint ✅ · build ✅ (~6s, asosiy bundle 338 KB /
gzip 111 KB)

**IndexedDB testlari** (`fake-indexeddb` bilan qo'lda o'tkazilgan):
- Sxema: 16 store yaratiladi, indekslar joyida, period indeksi do'konlarni
  aralashtirmaydi
- Upgrade: v1 baza ochilganda `records` o'chadi, 16 ta yangi store quriladi

> ⚠️ **Avtomatlashtirilgan test to'plami yo'q.** Loyihada test runner o'rnatilmagan.
> Bu eng katta texnik qarz — pastdagi 12-bo'limga qarang.

---

## 11. Funksional talab → texnik yechim

| Funksional talab | Yechim |
|---|---|
| Token kiritilib 1 daqiqada raqamlar | 90 kunlik genesis reja, oyma-oy, yangisidan; qismi kelishi bilan ekranga chiqadi |
| Yuklangan davr — tarmoqsiz | `missingRanges()` bo'sh qaytarsa tarmoqqa umuman chiqilmaydi |
| Har bir raqamning manbasi | `ModuleDefinition.source` va `Kpi.source` — endpoint nomi ta'rifning bir qismi |
| Yozish natijasi darhol | `useUzumActions` API javobini o'zi ko'rsatadi, nuqtali invalidatsiya |
| Yarim yo'lda to'xtatish | Har bir oyna tushishi bilan commit qilinadi; hammasi-yoki-hech narsa tranzaksiyasi yo'q |
| Internetsiz ishlash | Javob har doim IndexedDB'dan o'qiladi, tarmoqdan emas |
| 14 kunlik qayta o'qish | `SETTLEMENT_LAG_MS`, qoplamaning tail'ini ochish |
| Bir nechta do'kon | `store_id` har bir yozuvda; konsolidatsiya do'kon bo'yicha alohida o'qib, keyin birlashtirish |
| Rate limitga moslashish | `rateLimit.ts` — bitta kanal, ketma-ket, `Retry-After` |
| Uch til | `lib/i18n/dictionary.ts` — kalit → [en, ru, uz] |

---

## 12. Texnik qarz va keyingi qadamlar

Ustuvorlik tartibida:

### 1. Test to'plami yo'q — **eng yuqori ustuvorlik**
Runner o'rnatilmagan. Eng avval qamrab olinishi kerak: `coverage.ts` interval
algebrasi, `paginate()`, mapperlar, `missingRanges()`. Bular sof funksiyalar,
ya'ni test yozish arzon, xato narxi esa qimmat — arxivda teshik.

### 2. `buffer` va snapshot jadvallari ustma-ust
Ekranlar mahsulot va qoldiqni **read-through buffer** dan o'qiydi
(`queries/sources.ts`), yangi `products` / `product_skus` / `fbs_stocks`
jadvallaridan emas. Ya'ni bir xil ma'lumot ikki joyda.

Birlashtirilsa `buffer/` (~750 qator) butunlay olib tashlanadi. Lekin bu
`sources.ts` (647 qator) va `readThrough.ts` (361 qator) ni qayta yozishni talab
qiladi.

### 3. Kod va OpenAPI hujjat orasidagi 8 ta ziddiyat
Namunalarda faqat GET so'rovlar yozilgan, shuning uchun POST va print
endpointlari tekshirilmagan. Eng shubhalilari — `fetchOrderLabel`,
`fetchBarcodeTypes`, `fetchSupplyAct`, `fetchAcceptanceAct`: spec to'g'ri bo'lsa,
kod `payload` o'rniga `payload.document` ni olishi kerak.

Tafsilot: [ENDPOINTS.md](./frontend/src/services/uzum/ENDPOINTS.md), 12.3-bo'lim.

### 4. FBS nakladnoy yaratish to'liq emas
`GET /v1/fbs/invoice/dop/drop-off-points` va `GET /v1/fbs/invoice/dop/time-slot`
ulanmagan — ularsiz `createFbsInvoice` uchun kerak bo'lgan UUID'larni olib
bo'lmaydi.

### 5. `backend/` bo'sh shablon
Agar jamoaviy ishlash yoki serverdagi zaxira kerak bo'lsa, arxitektura qarori
qaytadan ko'rib chiqilishi kerak.
