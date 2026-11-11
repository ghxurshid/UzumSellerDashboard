# Savdo Copilot — Texnik spetsifikatsiya

**Versiya:** 2.9.0
**Hujjat sanasi:** 2026-11-11
**Maqsad:** [FUNCTIONAL-SPECIFICATION.md](./FUNCTIONAL-SPECIFICATION.md) dagi har bir
talab texnik jihatdan qanday amalga oshirilganini ifodalash.

Bog'liq hujjatlar:
- [ENDPOINTS.md](./frontend/src/services/uzum/ENDPOINTS.md) — Uzum API ma'lumotnomasi
- [STORAGE.md](./frontend/src/services/storage/STORAGE.md) — IndexedDB jadvallari va sync

---

## 1. Arxitektura

### 1.1. Serversiz model

**Ilova serveri yo'q.** Brauzer to'g'ridan-to'g'ri `api-seller.uzum.uz` bilan
gaplashadi, foydalanuvchining o'z tokeni bilan. AI Copilot ham xuddi shunday:
sotuvchi tanlagan LLM provayderiga uning o'z kaliti bilan brauzerdan murojaat
qiladi (10-bo'lim).

```
┌──────────────────────────── Brauzer ────────────────────────────┐
│                                                                 │
│   React SPA                                                     │
│      │                                                          │
│      ├── TanStack Query ──── axios ──┐                          │
│      │                               │                          │
│      ├── IndexedDB ('savdo', v3)     │                          │
│      │     15 object store           │                          │
│      │                               │                          │
│      └── AI Copilot ── services/ai ──┼──────────────┐           │
│                                      │              │           │
└──────────────────────────────────────┼──────────────┼───────────┘
                                       │              │
                          ┌────────────┴────────────┐ │
                          │  dev: Vite proxy (CORS) │ │
                          └────────────┬────────────┘ │
                                       ▼              ▼
                        https://api-seller.uzum.uz   LLM provayder
                            /api/seller-openapi      (Claude, OpenAI, Gemini, …)
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
| AI | Provayder adapterlari qo'lda yozilgan: Anthropic Messages, Google `generateContent`, OpenAI'ning o'z Responses API'si (`/v1/responses`), OpenAI-mos `/chat/completions` (OpenRouter, DeepSeek, Mistral, Grok, Ollama, boshqa gateway) |
| Matn | react-markdown + remark-gfm (Copilot javobidagi prose, xom HTML'siz) |
| Testlar | Vitest (node muhiti) |

---

## 2. Qatlamlar

Bog'liqlik yo'nalishi qat'iy — pastdan yuqoriga:

```
pages/          ekranlar
   ↑
features/       ekran bloklari
   ↑
services/queries/    TanStack Query hooklari (kalit, enabled, dedup)
   ↑
services/insights/   AI Copilot: suhbat sikli, toolkit, bloklar, amallar
   ↑                   └── services/ai/  LLM provayder transporti
services/data/       kolleksiyalarga yagona eshik — `sync` bayrog'i
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
na saqlash, na DOM. Yagona qabul qilingan chetlanish — shartnoma modullari:
`insights/blocks.ts` (karta tanasi tili, uni `derive/insights.ts` qoidalari ham
yozadi) va `queries/sources.ts` dagi manba tiplari pastdan import qilinishi
mumkin.

Qaysi papka qaysi agentga tegishli ekani va chegara qoidalari ildizdagi
[CLAUDE.md](./CLAUDE.md) da; agentlar ta'rifi — [`.claude/agents/`](./.claude/agents/).

### 2.1. Kolleksiyalarga yagona eshik

[`services/data/collections.ts`](./frontend/src/services/data/collections.ts) —
har bir kolleksiya shu yerdan o'qiladi, har doim normalizatsiyalangan
jadvallardan. Har bir o'qishda `sync` bayrog'i bor:

| `sync` | Windowed kolleksiya | Snapshot kolleksiya |
|---|---|---|
| `false` (standart) | IndexedDB'dan o'qiydi, tarmoqqa chiqmaydi | xuddi shunday |
| `true` | so'ralgan davrning yetishmagan qismini oladi | kolleksiyani butunlay qayta oladi |

Farq tanlov emas: `dateFrom`/`dateTo` ni faqat uchta route qabul qiladi
(4.3-bo'lim), qolganida so'raladigan davr yo'q. Shuning uchun snapshot uchun
`sync: true` "hozirgi holatni qayta ol" degani, davr esa faqat **o'qishga**
qo'llanadi.

Standart qiymat `false` — tarmoqqa chiqish har doim ochiq-oydin so'raladi.
"Bu boshqaruv elementini o'zgartirish so'rovga tushadimi?" degan savolga
chaqiruvning o'zini o'qib javob berish mumkin.

`sync` **so'rov kalitiga kirmaydi**: bir xil manba va qamrov uchun bitta so'rov
yaratiladi, birinchi bo'lib mount bo'lgan chaqiruvchi tarmoqqa chiqish-chiqmaslikni
hal qiladi. Ekran o'z qamrovi uchun qaror qiladi, yordamchi o'quvchi (masalan
insights paneli) esa o'sha natijani oladi.

Tarmoqqa hech narsa bu yerdan chiqmaydi — ikkala sync yo'li ham `sync/` orqali,
u esa `api/rateLimit.ts` orqali boradi. Ya'ni `sync: true` o'qish navbatga
turadi, poyga qilmaydi.

Ikkita chetlanish ochiq aytiladi: `collections.ts` sinxronizatsiya jurnaliga
yozish uchun `store/sync.store.ts` ga murojaat qiladi (`sync/` ham shunday
qiladi), va `queries/` dan ikkita bargli tipni oladi (`SourceId`,
`SourceProgressReporter`). Ikkalasi ham qiymat sikli hosil qilmaydi, lekin
diagrammadagi sof yo'nalishdan chetlanish — shuning uchun bu yerda qayd
etilgan.

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

`ApiError` turlarga bo'linadi: `network`, `timeout`, `unauthorized`,
`forbidden`, `rateLimited`, `notFound`, `server`, `client`, `cancelled`,
`unconfigured`. Har bir ekran — va Copilot — shu turga qarab nima
ko'rsatishini biladi.

---

## 4. Saqlash qatlami

To'liq tafsilot: [STORAGE.md](./frontend/src/services/storage/STORAGE.md).

### 4.1. IndexedDB sxemasi

`DB_NAME = 'savdo'`, `DB_VERSION = 3`, **15 object store**.

Har bir yozuvda: `id` (deterministik), `store_id`, `account`, `timestamp`, `day`.
Har bir jadvalda 4 ta umumiy indeks: `store_date` (`['store_id','timestamp']`),
`timestamp`, `store_id`, `account`.

**Windowed** (sync oynasi bor): `order_items`, `expenses`, `fbs_orders`,
`fbs_order_items`

**Snapshot** (oyna yo'q): `products`, `product_skus`, `fbs_stocks`,
`supply_invoices`, `supply_invoice_items`, `seller_returns`, `return_items`,
`fbs_invoices`

**Journal**: `change_events`

**Xizmat**: `sync_metadata`, `kv`

`sync_metadata`da ikkita vaqt bor, va ular boshqa savolga javob beradi:
`last_synced_at` — **Uzum'dan oxirgi marta qachon so'ralgan** (bo'sh javob va
qat'iy rad ham shu yerga yoziladi — 5.4), `captured_at` — **hozir capture
saqlanadimi**. Yangilik darvozasi (5.1, 5.4) birinchisiga qarab "qayta so'rash
kerakmi" deb hal qiladi; ekran nimani ko'rsata olishi — ikkinchisi.

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

**Live edge.** Qoplama "hozir"gacha emas, oxirgi o'qish onigacha yetadi —
shuning uchun "hozir" bilan tugaydigan har bir savol (Copilot'ning har savoli
shunday) shu tirqishni doim teshik deb topib, uni **har safar** qayta so'rardi,
hatto yangilik oynasi ichida bo'lsa ham. `sealLiveEdge()`
([`archive/coverage.ts`](./frontend/src/services/storage/archive/coverage.ts#L145))
shu tirqishni, qoplangan oxirgi on sozlamalardagi **yangilik oynasi**dan
(standart — 1 soat, sotuvchi 1 daqiqadan 12 soatgacha tanlaydi) yosh bo'lgan
davrida, "qoplangan" deb hisoblaydi — faqat rejalashtirishda, `synced_ranges`ga
hech qachon yozilmasdan. Natijada `sync: true` o'qish jadval-do'kon juftiga
**yangilik oynasida bir marta** tarmoqqa chiqadi, orasida — hech qachon.
`force` (sinxronlash tugmasi) buni nolga tushiradi. Bu faqat yangilik oynasi
settlement lag'dan qat'iy kichik bo'lganda xavfsiz — pastga qarang.

So'ralgan oyna solishtirishdan oldin **hozirgi lahzaga qisqartiriladi**:
kelajakka cho'zilgan oyna na so'rov yaratadi, na "qoplangan" deb yozib
qo'yiladi.

### 5.2. Settlement lag

**Funksional talab:** "oxirgi 14 kun qayta o'qiladi".

**Yechim:** `SETTLEMENT_LAG_MS = 14 kun`. Taqqoslashdan oldin qoplamaning oxirgi
14 kuni "ochib" qo'yiladi. Undan eskisi — barqaror tarix.

Lekin bu har savolda qayta o'qishga olib kelmasligi kerak. Shuning uchun tail
faqat **yozuv yangilik oynasidan eski bo'lsa** ochiladi. Sync tugmasi `force`
uzatadi va har doim ochadi.

**Yangilik oynasi settlement lag'dan qat'iy kichik bo'lishi shart.** 5.1-dagi
live edge tailni ochilgan tomondan yopadi; ikkovi bir chetda uchrashsa
(yangilik oynasi ≥ `SETTLEMENT_LAG_MS`), live edge settlement lag ochgan
tirqishni zudlik bilan qayta yopib qo'yardi va band fortnight abadiy qayta
o'qilmas edi. Sotuvchi tanlay oladigan har bir yangilik oynasi (1 daqiqadan
12 soatgacha) bundan ancha kichik — tengsizlik
[`sync/planning.test.ts`](./frontend/src/services/sync/planning.test.ts) da
tasdiqlanadi, shuning uchun kelgusida kengroq variant qo'shilsa test o'zi
buziladi, ko'rib chiqish esiga tushmasa ham.

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
   deyarli har doim rate limit, "sotuvchi hamma tovarini o'chirdi" emas. Shunga
   qaramay bo'sh javob odatda **o'qilgan deb belgilanadi** (`last_synced_at`):
   qaytarish, nakladnoy yoki FBS jo'natma yo'qligi barqaror haqiqiy holat,
   shtampsiz bo'lsa har savolda qayta so'ralardi. Katalog va SKU bundan
   mustasno — ularning bo'sh javobi faqat **avval capture bo'lgan bo'lsa**
   ishoniladi (`trustsEmptyAnswer`), aks holda bitta blinkgan route butun
   oynaga qoldiq va mahsulot ekranini bo'shatib qo'yardi

**Yangilik endi capture emas, o'qishga qarab o'lchanadi.** `isFresh()`
`captured_at`ni emas, oxirgi o'qish onini tekshiradi (`lastReadAt` =
`last_synced_at ?? captured_at`). Qat'iy rad ham — 401/429 bo'lmagan 4xx —
shu tarzda o'qilgan deb belgilanadi: FBS-only hisobning `/v1/fbs/invoice`si
har safar 400 qaytarsa, shtampsiz bu har savolda uchta befoyda so'rov degani
edi.

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
| `insights.ts` | Qoida asosidagi kuzatuv kartalari — chegarani kesib o'tgan ko'rsatkichni topadi va raqamlarni blokka `format` bilan qiymat sifatida yozadi |
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

## 10. AI Copilot

**Funksional talab** (funksional spetsifikatsiya, 5-bo'lim): sotuvchi o'z
ma'lumoti haqida oddiy tilda so'raydi va javob haqiqiy ma'lumotdan tuziladi;
model Uzum'ga o'zi hech narsa yozmaydi.

Kod: [`services/insights/`](./frontend/src/services/insights/) (suhbat, toolkit,
bloklar, amallar), [`services/ai/`](./frontend/src/services/ai/) (provayder
transporti), [`features/chat/`](./frontend/src/features/chat/) va
[`features/insights/`](./frontend/src/features/insights/) (panel, rail, chizish).

### 10.1. Suhbat sikli

[`agent.ts`](./frontend/src/services/insights/agent.ts) — bir savol bir necha
**raund**dan iborat:

```
system prompt           kimligi, chegaralar, "kerakligini o'zing so'ra"
  + ma'lumot yangiligi  bu mashina ma'lumoti qachon o'qilgani — bir savolda bir marta
  ↳ toolkit'ni ochish   qaysi so'rovlar va amallar bor — bir thread'da bir marta
  ↳ lookup chaqirish    arxivdan ma'lumot o'qiladi (10.2)
  ↳ widget qo'llanmasi  javob qanday chiziladi — bir thread'da bir marta
  ↳ bloklar             javob, raqamlari bilan, oqimda (10.3)
```

- **Ikki protokol, bitta sikl.** Claude, OpenAI va Gemini'da chaqiruvlar
  provayderning o'z tool API'si orqali keladi; boshlanishda faqat bitta tool —
  `open_toolkit` — e'lon qilinadi, qolganlari toolkit ochilgandan keyin.
  Boshqa provayderlarda xuddi shu suhbat JSON qatorlari orqali boradi
  (`{"need":"tools"}`, `{"call":"window.totals","args":{}}`).
- **Byudjet.** Chuqur rejimda 5 raund va 12 lookup, oddiy rejimda 2 va 4. Oxirgi
  raundga "bu oxirgisi, bor narsang bilan javob ber" deb oldindan aytiladi.
  Bitta savol ichida takrorlangan lookup keshdan beriladi.
- **Ochilgan hujjatlar keyingi savolga o'tadi.** Keyingi savolning tarixi oldingi
  javoblarning qisqa mazmuni, hujjatlarning o'zi emas. Shuning uchun thread'da
  ochilgan toolkit va widget qo'llanmasi yangi savolning system prompt'iga
  qo'shiladi (`withOpenedDocuments`). Aks holda model "sizda bor" deb aytilgan,
  lekin ko'rmayotgan qo'llanma bo'yicha shakllarni taxmin qilardi.
- **Ma'lumot yangiligi — savol boshida bir marta, oxirida qo'shiladi.**
  [`services/data/freshness.ts`](./frontend/src/services/data/freshness.ts)
  tarmoqqa chiqmasdan har bir jadval oxirgi marta qachon o'qilganini
  `sync_metadata`dan o'qiydi. Blok savolning birinchi raundida bir marta
  hisoblanadi va sessiyada muzlatiladi (`session.freshness`) — **Davom
  ettirish** bosilsa ham xuddi shu shtamplar bilan davom etadi, aks holda
  modelga o'zi allaqachon yozgan gapidan keyin sodir bo'lgan sinxronlash haqida
  ma'lumot berilardi. System prompt'ning **oxiriga**, ochilgan hujjatlardan
  keyin qo'shiladi (`withDataFreshness`): identitet, chegaralar va hujjatlar
  savoldan savolga o'zgarmay qoladi va provayder keshi ularni prefiks sifatida
  qayta ishlata oladi — o'zgaradigan yagona qism eng oxirda turadi.
- **Davom ettirish.** Raund o'rtasida uzilsa (`503`, tarmoq), sessiya saqlanadi:
  **Davom ettirish** o'sha raunddan boshlaydi, o'qilgan lookup'lar keshdan
  keladi va ekranga chiqqan matn takrorlanmaydi (`checkpoint`).

### 10.2. Toolkit — model nimani o'qiy oladi

[`toolkit.ts`](./frontend/src/services/insights/toolkit.ts). Har bir lookup
2.1-bo'limdagi yagona eshikdan `sync: true` bilan o'qiydi — ya'ni avval arxiv,
yetishmagan qism Uzum'dan. Natija **ma'lumotning o'zi**: sarlavha (tool, davr,
do'konlar, qator soni, `TRUNCATED`, qisqartirilgan davr), birliklar qatori va
birinchi qatori ustun nomlari bo'lgan `|` bilan ajratilgan jadvallar
([`plaintext.ts`](./frontend/src/services/insights/plaintext.ts)).

| Lookup | Nima beradi |
|---|---|
| `window.totals` | Davrning butun pul modeli: sellPrice, komissiya, logistika, sellerProfit, tannarx, xarajatlar manba bo'yicha, sof foyda, marja, buyurtma, birlik, bekor qilish, qaytarish |
| `period.compare` | Ikki davr yonma-yon, farq va farq % bilan |
| `sales.timeline` | Soat/kun/hafta/oy kesimida sotuv — butun do'kon yoki 8 tagacha mahsulot yonma-yon, sotilmagan kunda nol |
| `sales.pattern` | Soat yoki hafta kuni bo'yicha buyurtma, birlik, tushum — sotuvchi vaqt zonasida |
| `products.rank` | Davrda sotilgan barcha mahsulotlar reytingi, foyda zanjiri, ulush va marjalar; `order:"asc"` — eng zaiflari |
| `product.find` | Bitta mahsulot: SKU'lar (skuId, shtrix-kod), qoldiq, davrdagi natijasi |
| `expenses.breakdown`, `stock.health`, `orders.pipeline`, `supply.invoices`, `price.impact` | Xarajatlar, qoldiq muammolari, buyurtmalar muddati, nakladnoy kamomadi, narx o'zgarishi ta'siri |
| `data.rows` | **Xom qatorlar**, sahifalab (`limit` ≤ 1000, `offset`): `sales`, `expenses`, `orders`, `catalogue` — hisoblovchi lookup javob bermaydigan chuqur tahlil uchun |
| `archive.coverage`, `alerts.list`, `shops.list` | Arxiv qamrovi, doimiy qoidalar, do'konlar |

**Nega ikki chuqurlik.** Hisoblovchi lookup'lar arifmetikani har bir qator
ustida kodda bajaradi ([`datasets.ts`](./frontend/src/services/insights/datasets.ts),
testlangan) — model uch yuz qatorni boshida qo'shganidan aniqroq. `data.rows`
esa oldindan ko'zda tutilmagan savol uchun: savatcha tahlili, SKU kesimi,
qaytarish sabablari.

**Token tejash.** Mahsulot nomi sahifada bir marta lug'at sifatida, yil
sarlavhada bir marta, ajratgich atrofida bo'shliq yo'q, 400 dan ortiq bucket
so'ralsa granularlik yiriklashtiriladi.

**`fresh:true` — savolda bir marta, kolleksiya va oyna bo'yicha.** Model
`fresh:true` bersa, lookup yangilik oynasini chetlab o'tib Uzum'ga chiqadi —
lekin faqat shu savolda o'sha kolleksiya (`finance`, `expenses`, `orders`,
`invoices`) uchun **shu oynani qamrab olgan** birinchi so'rovda. Keyingi
`fresh:true` so'ralgan oyna allaqachon majburlangan oyna ichiga to'liq
sig'sa — o'sha yangi o'qishdan xizmat qiladi, qayta so'ramaydi; kengroq,
oldinroq yoki kesishmaydigan oyna esa yana majburlaydi. Har bir natijaning
sarlavhasida ikkisidan qaysi biri bo'lgani aytiladi: "Uzum'dan qayta olindi"
yoki "bu savolda allaqachon majburlangan — o'sha yangilanishdan xizmat
qildi". `period.compare` bundan bitta istisno bilan foydalanadi: `fresh:true`
faqat **joriy** oynani majburlaydi, oldingi oynani hech qachon — oldingi oyna
barqaror tarix, uni yangilash hech narsani o'zgartirmaydi.

### 10.3. Javob — bloklar

Model javobni **NDJSON** qilib yozadi: har qatorda bitta blok. Qator tugashi
bilan zod sxemasi bo'yicha tekshiriladi va chiziladi
([`ndjson.ts`](./frontend/src/services/insights/ndjson.ts),
[`blocks.ts`](./frontend/src/services/insights/blocks.ts)). Faqat `text` bloki
yozilayotganda ko'rinadi — yarim jadval chizilmaydi.

| Blok | Tarkibi |
|---|---|
| `text` | Markdown, 4000 belgigacha |
| `metric` | `value`, `format`, ixtiyoriy `change` (%) |
| `kv`, `steps` | yorliq/qiymat qatorlari (≤ 12), hisob-kitob zanjiri (≤ 10) |
| `table` | ≤ 6 ustun × 30 qator, katak — matn yoki son, ustun `formats` |
| `chart` | `waterfall`/`bar`/`donut` — `items` (2–12); `line` — `labels` (≤ 120) va `series` (≤ 4), har seriyada har yorliqqa bitta qiymat |
| `badges`, `callout`, `action` | teglar, ramkali tavsiya (bir daraja ichma-ich), registrdagi tugma |

**Raqamlar qayerdan.** Blok raqamni **qiymat** sifatida olib keladi va uning
turini aytadi: `money`, `percent`, `count`, `number`.
[`figures.ts`](./frontend/src/services/insights/figures.ts) uni ekrandagi
boshqa raqamlar bilan bir xil formatlaydi: guruhlash, so'm, o'nlik ajratgich.
Model raqamni lookup natijasidan oladi yoki undan hisoblaydi va o'zi hisoblagan
raqamni qanday olganini ko'rsatadi. Qaysi lookup o'qilgani suhbatda `trace`
qatori bo'lib ko'rinadi.

**Nega shunday.** Avval bloklar raqam o'rniga fakt jadvaliga `ref` ko'rsatardi,
qiymatni esa ilova topardi. Model raqam yoza olmasdi, lekin buning narxi baland
edi:
- jadvalda `ref` bo'lmagan savol — ulush, farq, 7 kunlik dinamika — umuman
  javobsiz qolardi;
- ekran davri uchun oldindan to'ldirilgan `ref`lar boshqa davr haqidagi
  javobga jimgina tushib qolardi.

Endi model ma'lumotni oladi va hisoblaydi. Ilovaga shakl, tekshiruv va
formatlash qoladi.

**Darvoza.**
- Noma'lum blok turi, limitdan oshgan maydon yoki registr rad etgan amal
  parametrlari chizilmaydi. Har biri sababi bilan modelga qaytariladi va bitta
  savolda **bir marta** qayta yuborish so'raladi.
- Limitlar ([`WIDGET_LIMITS`](./frontend/src/services/insights/blocks.ts))
  widget qo'llanmasiga ham shu yerdan o'qiladi
  ([`widgets.ts`](./frontend/src/services/insights/widgets.ts)), shuning uchun
  ular bir-biridan ajrab ketmaydi.

### 10.4. Amallar

[`actions.ts`](./frontend/src/services/insights/actions.ts) — yopiq registr,
har bir amal route'i, xavf darajasi va zod parametrlari bilan:

| Xavf | Kim bajaradi |
|---|---|
| `none` | Model darhol bajaradi (ekran ochish, davr almashtirish, qoida qo'yish). Istisno — `copilot.ask`: u doim javob ostidagi taklif chipi bo'ladi, o'zi so'ralmaydi |
| `low` | Tugma — faqat o'qiydigan so'rov (etiketka, akt PDF) |
| `mid` | Tugma — qaytarib bo'ladigan yozish (tasdiqlash, bekor qilish) |
| `high` | Tugma + tasdiq oynasi (narx, qoldiq, DBS qaytarish) |

Model hech qachon yozish amalini o'zi bajarmaydi va tugma bosilmaganini bilib
turadi: unga "sotuvchi bosmagan, bajarildi dema" deb javob qaytariladi.

### 10.5. Panelga qadalgan javob

[`pins.ts`](./frontend/src/services/insights/pins.ts) — javob **qanday yozilgan
bo'lsa shunday** saqlanadi: bloklar, saqlangan vaqt va o'sha paytdagi davr.
Tugma va `trace` bloklari olib tashlanadi.

**Nega surat.** Raqamlar model yozgan jumlalar ichida. Lookup'larni qayta
o'qib raqamlarni yangilash eski jumla ostiga yangi raqam qo'yardi — o'zi bilan
o'zi zid, lekin eskirgani ko'rinmaydigan karta. Buning o'rniga kartada
"yangi ma'lumot bilan qayta so'rash" tugmasi bor: savol Copilot'ga qayta
beriladi va tahlil ham qaytadan yoziladi. Eski formatdagi (`ref`li) saqlangan
kartalar o'qilayotganda sxemadan o'tmaydi va tashlab yuboriladi.

### 10.6. Insights paneli (rail)

Ikki muallif, bitta karta tili:

- **Qoidalar** ([`derive/insights.ts`](./frontend/src/services/derive/insights.ts))
  — kalitsiz, internetsiz, har doim ishlaydi.
- **Model** ([`ai.ts`](./frontend/src/services/insights/ai.ts)) — davrning
  ma'lumot digest'ini ([`digest.ts`](./frontend/src/services/insights/digest.ts))
  bitta prompt'da oladi va qoidalar topmagan topilmalarni yozadi. Model har bir
  **ma'lumot oynasi** uchun bir marta so'raladi (so'rov kalitida digest barmoq
  izi). Qayta mount yoki fokus kredit sarflamaydi.

### 10.7. Provayder transporti

[`services/ai/`](./frontend/src/services/ai/):

- **To'rt xil so'rov shakli:** Anthropic Messages, Google `generateContent`,
  OpenAI'ning o'z Responses API'si va qolgan olti provayder (OpenRouter,
  DeepSeek, Mistral, Grok, Ollama, `custom`) uchun OpenAI-mos
  `/chat/completions`.
  - **OpenAI — Responses API**
    ([`dialectFor`](./frontend/src/services/ai/stream.ts#L1005)ning `openai`
    bo'limi — oqim; [`client.ts`](./frontend/src/services/ai/client.ts#L355) —
    bir martalik so'rov): ikkalasi ham `/v1/responses`ga, `store:false` bilan
    boradi — ilovada OpenAI uchun suhbat holatini saqlaydigan server yo'q.
    Fikrlash modeliga (`gpt-5*`, `gpt-6*`, `o1`/`o3`/`o4`) shuning uchun
    `include: ["reasoning.encrypted_content"]` so'raladi
    ([`openAiResponsesFields`](./frontend/src/services/ai/modelRules.ts#L453)):
    keyingi tool raundida faqat **shu fikrlash elementi**, chaqiruvdan oldin,
    qayta yuboriladi
    ([`openAiResponsesInput`](./frontend/src/services/ai/stream.ts#L495)), va
    shifrlanmagan (`encrypted_content`siz) element tashlab yuboriladi — uni
    `store:false`da qayta tiklab bo'lmaydi. Tool'lar `strict:false` bilan
    e'lon qilinadi: zod'dan chiqqan sxemalarda ixtiyoriy maydonlar bor, ular
    strict rejimda rad etiladi. **Dalil kuchsiz:** bu yo'l haqiqiy OpenAI
    kaliti bilan hali sinalmagan — OpenAI'ning hujjatlaridan qurilgan va
    faqat mock javoblar bilan test qilingan; "chaqiruvni qayta yuborishda
    `fc_` id emas, faqat `call_id` yetarli" qoidasi 2025 yilgi hamjamiyat
    xabarlariga asoslangan, hujjatlashtirilgan talab emas.
  - Qolgan olti provayder xuddi avvalgidek `/chat/completions`ga boradi.
- **Streaming va native tool chaqiruvlari** — Claude, Gemini **va endi
  OpenAI**da (10.1-bo'lim); Gemini 3'ning `thoughtSignature`i chaqiruv bilan
  birga qaytariladi.
- **Provayderga xos parametrlar** — har biri o'z kartasida ko'rinadi va
  simning aynan qayeriga tushishi karta ostida yoziladi
  ([`openAiCompatibleHeaders`](./frontend/src/services/ai/modelRules.ts#L613),
  [`anthropicHeaders`](./frontend/src/services/ai/modelRules.ts#L581)):

  | Provayder | Parametr | Simda |
  |---|---|---|
  | OpenAI | `orgId`, `projectId` | `OpenAI-Organization`, `OpenAI-Project` sarlavhalari |
  | OpenAI, OpenRouter | `reasoningEffort` | `reasoning.effort` (so'rov tanasida) |
  | Claude | `reasoningEffort` | `output_config.effort` |
  | Grok | `reasoningEffort` | `reasoning_effort` |
  | Claude | `anthropicVersion` | `anthropic-version` sarlavhasi (bo'sh yoki xavfsiz bo'lmasa — `2023-06-01`) |
  | Gemini 3+ | `thinkingLevel` | `generationConfig.thinkingConfig.thinkingLevel` |
  | DeepSeek | `thinking` | `thinking.type` (`enabled`/`disabled`) |
  | OpenRouter | `appUrl`, `appTitle` | `HTTP-Referer`, `X-OpenRouter-Title` sarlavhalari |

  Model qabul qilmaydigan qiymat — yoki `''` — hech qachon yuborilmaydi, jimgina
  tashlab ketiladi
  ([`validReasoningEffort`](./frontend/src/services/ai/modelRules.ts#L337));
  karta menyusi va transport aynan shu tekshiruvdan o'qiydi, shuning uchun
  ular bir model uchun ikki xil javob berolmaydi.
- **Sarlavha xavfsizligi.** `fetch`ning `Headers`i bosiladigan ASCII'dan
  tashqari qiymatda `TypeError` otadi. Ixtiyoriy sarlavha (tashkilot, loyiha,
  atributsiya) xavfsiz bo'lmasa jimgina tashlab ketiladi; kalitning o'zi
  xavfsiz bo'lmasa esa so'rov hech qachon `fetch`ga yetmasdan `unauthorized`
  bilan rad etiladi
  ([`isHeaderSafe`](./frontend/src/services/ai/modelRules.ts#L557)).
- **`stream_options.include_usage`** faqat OpenRouter, DeepSeek va Ollama
  uchun so'raladi — uchalasi ham buni o'z hujjatida tasdiqlagan; Mistral esa
  oqimda usage umuman qaytarmasligini aytadi, shuning uchun undan so'ralmaydi
  ([`stream.ts`](./frontend/src/services/ai/stream.ts#L1057)). OpenAI bu
  ro'yxatdan chiqib ketgan — uning usage'si Responses'ning
  `response.completed` hodisasidan keladi.
- **Qayta urinish** (`RETRIES = 3`): `429`/`5xx`/tarmoq xatosida, `Retry-After`
  yoki Gemini'ning `RetryInfo.retryDelay`si hurmat qilinadi.
  - Faqat javobdan hali hech narsa ekranga chiqmagan bo'lsa takrorlanadi. Aks
    holda matn ikki marta yozilardi, shuning uchun uzilgan javob sotuvchiga
    **Davom ettirish** bilan qaytariladi.
  - Bekor qilingan so'rov va noto'g'ri kalit takrorlanmaydi.
  - **Kunlik (RPD) `429` ham takrorlanmaydi.** `ModelQuotaError.isRetryable`
    buni ataylab `false` qaytaradi
    ([`ai/usage.ts`](./frontend/src/services/ai/usage.ts#L127)) — bu chegara
    faqat Tinch okean yarim tunida ochiladi, har bir urinish esa bir xil rad
    javobini yana bir marta hisoblatib qo'yardi. Suhbat paneli bu holatda
    sababni va tiklanish vaqtini ko'rsatadi, **Davom ettirish** tugmasisiz
    ([`features/chat/useCopilotAnswers.ts`](./frontend/src/features/chat/useCopilotAnswers.ts#L36)).
  - **OpenAI Responses'ning o'z rad javoblari kod bo'yicha ajratiladi**
    ([`classifyOpenAiFailure`](./frontend/src/services/ai/modelRules.ts#L690)):
    `insufficient_quota` — `client`, takrorlanmaydi (hisobga pul qo'shish
    kerak, kutish emas); `rate_limit`/`quota` — `rateLimited`, oddiy qoida
    bo'yicha takrorlanadi; nomsiz yoki `server` so'zli kod — `server`,
    takrorlanadi. `response.incomplete` hech narsa (matn ham, chaqiruv ham)
    yozmasdan tugasa — odatda `max_output_tokens` fikrlashga sarflanib
    bo'lgani uchun — `client`/`incomplete` bilan rad etiladi va **hech
    qachon** takrorlanmaydi: bir xil so'rov bir xil devorga urilaveradi
    ([`openAiIncompleteError`](./frontend/src/services/ai/modelRules.ts#L661)).
    Sozlamalar paneli `incomplete` va `insufficient_quota` kodlarini o'z
    tiliga tarjima qilingan gap bilan ko'rsatadi
    ([`aiErrors.ts`](./frontend/src/features/settings/aiErrors.ts#L49)).
  - **Insights paneli (rail)** modelning topilmalarini bitta ma'lumot oynasiga
    bitta marta so'raydi va muvaffaqiyatsizlikni **faqat bir marta**, shu ham
    `ApiError.isRetryable` `true` bo'lgandagina, qaytadan so'raydi — kunlik
    kvota, `insufficient_quota` va `incomplete` kabi qaytarilsa ham bir xil
    javob beradigan xatolarda emas
    ([`shouldRetryAiCards`](./frontend/src/services/queries/useInsightsQuery.ts#L155)).
- **Voqealar jurnali (ledger) — har bir provayder uchun, barchasi**
  ([`ai/usage.ts`](./frontend/src/services/ai/usage.ts)):
  - `stream.ts` va `client.ts` javob **olgan** har bir so'rov uchun — qaysi
    provayder bo'lishidan qat'i nazar (qayta urinishlar, suhbat, rail
    muallifi, Sozlamalardagi ulanish testi qo'shilgan) — bitta
    `ModelRequestEvent` yozadi: provayder aytgan xom kiruvchi (kesh bilan),
    kesh, chiquvchi va fikrlash tokenlari — hech qachon taxmin emas, noma'lum
    bo'lsa `null`. Javob kelmagan so'rov (tarmoq xatosi, timeout, bekor
    qilish) va kalit rad etilishi (`401`/`403`, `400 API_KEY_INVALID`)
    yozilmaydi — ular loyiha kvotasiga umuman tegmagan. Jurnal
    [`store/modelUsage.store.ts`](./frontend/src/store/modelUsage.store.ts)da
    IndexedDB `kv`ning `model_usage` yozuvida saqlanadi (26 soat, 5000
    tagacha —
    [`MAX_EVENTS`](./frontend/src/store/modelUsage.store.ts#L56)) va
    `BroadcastChannel('savdo.model-usage')` orqali oynalar orasida
    sinxronlanadi.
  - **Limit chizig'i (rpm/tpm/rpd) hamon faqat Gemini uchun** — katalogda
    faqat Gemini modellarining nashr qilingan limiti bor
    (`AI_PROVIDERS[…].limits`), boshqa sakkiz provayder uchun taqqoslanadigan
    tavan yo'q. Gemini'ning `429` tanasi (`google.rpc.QuotaFailure` /
    `RetryInfo`) qaysi o'lchov (`rpm`/`tpm`/`rpd`) tugaganini ajratib oladi
    (`readQuotaFailure`). **Dalil kuchsiz:** bu tana shakli loyihada yozib
    olingan haqiqiy namuna emas — Google'ning ommaviy xato formati
    hujjatlaridan olingan. RPM va TPM oxirgi 60 soniyalik sirpanuvchi oynada,
    TPM kiruvchi tokenlarda, RPD Tinch okean yarim tunidan (DST'ni hisobga
    olib) hisoblanadi; Gemini'ning o'zi `429`da aytgan limit katalogdagi
    raqamni o'zib ketadi. "Har bir natija — muvaffaqiyatli ham, rad etilgan
    ham — so'rov sifatida sanaladi" qoidasi ham **dalili kuchsiz**: bitta AI
    Studio kuzatuviga (3.5 Flash'da 23/20 RPD ko'rsatilgani) asoslangan.
    Ko'rsatish —
    [`features/settings/ModelPicker.tsx`](./frontend/src/features/settings/ModelPicker.tsx)
    (model tanlashda) va
    [`features/settings/ModelQuotaPanel.tsx`](./frontend/src/features/settings/ModelQuotaPanel.tsx)
    (faqat Gemini kartasida, tanlangan model uchun uchta chiziq).
  - **Bugungi token sarfi — har bir provayder uchun, alohida-alohida.**
    [`summarizeTokens()`](./frontend/src/services/ai/usage.ts#L862) mahalliy
    yarim tundan beri shu provayderning voqealarini yig'adi: so'rovlar soni,
    kiruvchi/keshlangan/chiquvchi/fikrlash tokenlari — har biri necha so'rov
    buni aytgani bilan birga (provayder aytmagan raqam hech qachon nolga
    aylanmaydi, "aytilmagan" deb ko'rinadi), model bo'yicha taqsimot va oxirgi
    xabar bergan so'rov.
    [`features/settings/TokenUsagePanel.tsx`](./frontend/src/features/settings/TokenUsagePanel.tsx)
    buni har bir provayder kartasida chizadi.
- **Narx hisobi.**
  [`costOfTokens()`](./frontend/src/services/ai/pricing.ts#L166) o'sha
  voqealardan qo'lda kiritilgan narx jadvali bilan dollar hisoblaydi — GPT-6
  narxlari OpenAI'ning o'z model sahifalaridan, 2026-09-28 tekshirilgan. Kesh
  har bir so'rovda aytilmagan bo'lsa, narx "≈" o'rniga "≤" bilan ko'rsatiladi —
  haqiqiy sarf hech qachon undan yuqori bo'lmasligini bildiradi.
- **Kalit va konfiguratsiya — har bir provayder alohida.** Ilova kalit olib
  kelmaydi — Sozlamalardagi kalit ishlatiladi, u bo'sh bo'lsa (Ollama va
  `custom`dan tashqari, ularga kalit shart emas) Copilot o'sha provayderga
  so'rov yubormaydi. Sozlamalar sxemasi **v6**da `ai = { provider, providers }`
  — `providers` to'qqizta provayderning **har biri** uchun to'liq, mustaqil
  konfiguratsiya saqlaydi (kalit, endpoint, model, timeout, harorat,
  maksimal token, yuqoridagi jadvaldagi o'ziga xos parametrlar), `provider`
  esa ulardan qaysi biri ishlatilayotganini ko'rsatadi
  ([`AiSection`](./frontend/src/types/settings.ts#L143)). Yozish ikki atom
  amal orqali boradi —
  [`updateAiConnection(provider, patch)`](./frontend/src/services/storage/settings.service.ts#L290)
  faqat nomlangan provayderning yozuvini o'zgartiradi,
  [`setActiveAiProvider(provider)`](./frontend/src/services/storage/settings.service.ts#L301)
  esa faqat ko'rsatkichni suradi — shuning uchun bitta kartaning tahriri
  boshqa provayderning yozuviga hech qachon tegmaydi. v4 → v5 migratsiyasi
  ([`settingsSchema.ts`](./frontend/src/services/storage/settingsSchema.ts#L348))
  ikki xil v4 shaklidan ham o'tadi: eski, umumiy maydonli shakldan va oraliq
  `saved` yon jadvalli shakldan — ikkalasi ham `version: 4` bilan yozilgan
  edi. **Dalil kuchsiz:** provayderlar orasidagi izolyatsiya avtomatlashtirilgan
  testlarda soxta kalitlar bilan tekshirilgan
  ([`aiConnections.test.ts`](./frontend/src/services/storage/aiConnections.test.ts)),
  haqiqiy ikkita kalit bilan qo'lda emas.
- **Chiqish tokenlari byudjeti — odatiy qiymat "Avto".** `maxTokens`
  ning saqlangan **belgisi**
  ([`MAX_TOKENS_BOUNDS.max`](./frontend/src/constants/settings.ts), 1 048 576)
  "Avto" degani — ilovaning muvozanatli byudjeti; modelning o'z maksimumi
  **emas** va so'rovga hech qachon o'zi ketmaydi
  ([`isAutoMaxTokens()`](./frontend/src/services/ai/modelRules.ts#L134)).
  So'rovga ketadigan sonni
  [`effectiveMaxTokens()`](./frontend/src/services/ai/modelRules.ts#L155) hisoblaydi
  va u oqim yo'lida ham, bir martalik `complete()` yo'lida ham, barcha
  dialektlar uchun bitta. "Avto" —
  [`balancedMaxTokens()`](./frontend/src/services/ai/modelRules.ts#L143):

  | Holat | Yuboriladigan son |
  |---|---|
  | "Avto", OpenAI, chegara ma'lum | `min(chegara, 16 384)` ([`AUTO_MAX_TOKENS_OPENAI`](./frontend/src/services/ai/modelRules.ts#L119)) |
  | "Avto", boshqa provayder, chegara ma'lum | `min(chegara, 32 000)` ([`AUTO_MAX_TOKENS_DEFAULT`](./frontend/src/services/ai/modelRules.ts#L131)) |
  | "Avto", chegara noma'lum | 4 096 (avvalgi odatiy qiymat) |
  | Aniq qiymat, chegara ma'lum | `min(qiymat, chegara)` |
  | Aniq qiymat, chegara noma'lum | `min(qiymat, 32 000)` (eski slayder cheti) |

  Modelning o'z maksimumi endi alohida belgi bilan emas, **chegaraning o'ziga
  teng aniq qiymat** bilan so'raladi: slayderning yuqori qadami — chegaraning
  o'zi. Nega shunday: avvalgi "modelning maksimumi" odatiy qiymati har bir
  so'rovda eng katta byudjetni zaxiralar edi, balans esa ikkalasini ham
  istaydi — yaxshi javob va limitni bekorga sarflamaslik. OpenAI byudjeti
  pastroq, chunki OpenAI'ning limitlar qo'llanmasi (2026-11-11 o'qilgan)
  limit `max_tokens` va so'rovning taxminiy token soni **kattasi** bo'yicha
  hisoblanishini aytadi — ya'ni so'ralgan maksimum model yozmasa ham
  daqiqalik (TPM) limitdan zaxiralanadi. Claude uchun
  Anthropic'ning limitlar sahifasi (platform.claude.com/docs/en/api/rate-limits,
  2026-11-11 o'qilgan) OTPM faqat haqiqatan yaratilgan tokenlarni sanashini va
  `max_tokens` OTPM hisobiga kirmasligini aytadi. Gemini va DeepSeek uchun
  bu avvalroq hujjatlarini **o'qishdan** kelgan xulosa — bugun qayta
  o'qilmagan, loyiha buni o'lchamagan. Shuning uchun boshqa provayderlarda
  32 000 limitni emas, to'xtamay ketgan generatsiya va uning narxini cheklaydi. Chegaralar
  [`OUTPUT_CEILINGS`](./frontend/src/services/ai/modelRules.ts#L84) jadvalida
  (fikrlash tokenlari hisobga kirgan): Gemini 3.x/2.5 Flash oilasi 65 536, GPT-6
  Astra/Sol/Luna 128 000, Claude Opus 5 / Sonnet 5 128 000 va Haiku 4.5 64 000,
  DeepSeek V4 Pro/Flash 393 216, Grok 4.7 128 000 (xAI chegara e'lon qilmaydi —
  bu uning hujjatlashtirilgan odatiy qiymati). Mistral, Grok 4.3, OpenRouter,
  Ollama, `custom` va boshqa har qanday id uchun chegara **noma'lum** — taxmin
  qilinmaydi. Karta
  ([`AiProviderCard.tsx`](./frontend/src/features/settings/AiProviderCard.tsx#L111))
  har doim **haqiqatan yuboriladigan** sonni ko'rsatadi: "Avto"da uning yonida
  "avto" belgisi, aniq qiymat chegaraga teng bo'lsa "modelning maksimumi"
  belgisi; qiymat aniq bo'lganda "«Avto»ga qaytarish" tugmasi chiqadi; bitta
  izoh satri holatni aytadi ("Avto" / OpenAI'dagi "Avto" / chegara e'lon
  qilinmagan / aniq qiymat — oxirgisi neytral: bu sotuvchining o'z qiymati, "Avto"ga
  qaytish muvozanatli byudjetni qaytaradi); slayder yuboriladigan son va belgini
  `aria-valuetext` bilan ham aytadi. v5 → v6 migratsiyasi
  ([`settingsSchema.ts`](./frontend/src/services/storage/settingsSchema.ts#L397))
  saqlangan 4 096'ni "Avto"ga o'tkazadi: u tegilmagan eski odatiy qiymatdan
  farq qilmaydi; boshqa har qanday qiymat ongli tanlov sifatida saqlanadi
  (v3 → v4 yangilik muddatidagi mulohazaning o'zi). **Dalil kuchsiz:**
  chegaralar vendorlarning hujjat sahifalaridan
  ([`OUTPUT_CEILINGS_AS_OF`](./frontend/src/services/ai/modelRules.ts#L59) —
  2026-11-04) olingan, 16 384 va 32 000 byudjetlari esa hech bir jonli hisob
  bilan sinab ko'rilmagan — ikkalasi ham tanlangan boshlang'ich qiymat, o'lchangan
  natija emas.

---

## 11. Qurish va tekshirish

```bash
npm run dev        # Vite dev server, port 5173, CORS proxy bilan
npm run build      # tsc -b && vite build
npm run typecheck  # tsc -b --noEmit
npm run lint       # eslint
npm test           # vitest run
npm run test:watch # vitest
```

**Chunk bo'linishi** ([vite.config.ts](./frontend/vite.config.ts)):
`vendor-markdown`, `vendor-react`, `vendor-query`, `vendor-motion`,
`vendor-forms` — yuqori paneldagi o'zgarish grafik bundle keshini buzmasligi
uchun. Tekshiruv modul nomida qism-satr bo'yicha, shuning uchun tartib muhim:
`vendor-markdown` `vendor-react` dan oldin turadi.

**Hozirgi holat (2026-11-11):** typecheck ✅ · lint ✅ · test ✅ (639 ta) · build ✅
(asosiy bundle 528 KB / gzip 173 KB)

**Ishlab chiqish jamoasi.** Loyiha ustida ishlaydigan agentlar tuzilmasi
[CLAUDE.md](./CLAUDE.md) va [`.claude/agents/`](./.claude/agents/) da:
- har bir prompt avval `orchestrator` ga tushadi
  ([`.claude/settings.json`](./.claude/settings.json));
- u vazifani papka egasi bo'lgan mutaxassisga beradi (API, saqlash, sync,
  hisob-kitob, so'rovlar, Copilot, UI, tooling, testlar, review, hujjatlar) va
  natijani yuqoridagi buyruqlar bilan tekshiradi.

**IndexedDB testlari** (`fake-indexeddb` bilan qo'lda o'tkazilgan):
- Sxema: 15 store yaratiladi, indekslar joyida, period indeksi do'konlarni
  aralashtirmaydi
- Upgrade: v1 baza ochilganda `records` o'chadi, 15 ta yangi store quriladi

**Avtomatlashtirilgan testlar** (Vitest, `vitest.config.ts`, node muhiti):

| Fayl | Nima qoplangan |
|---|---|
| `archive/coverage.test.ts` | Interval algebrasi — `normalize`, `missing`, `unseal`, `clip`, `chunk`. Eng xavfli joy: noto'g'ri qoplama = hech qachon to'lmaydigan teshik |
| `idb/aggregation.test.ts` | Worker arifmetikasi — bucket'lar, mahsulot bo'yicha foyda zanjiri |
| `insights/plaintext.test.ts` | Tool natijasi formati — sana chegaralari, `\|` bilan ajratilgan jadval, bo'sh katak, `\|` belgisi bo'lgan nom |
| `insights/datasets.test.ts` | Toolkit arifmetikasi — sotilmagan kunda nol, buyurtma bir marta sanaladi, bekor qilingan qator, mahsulotlar yonma-yon, sahifalash |
| `insights/figures.test.ts` | Qiymatni formatlash — so'm, foiz, son, satr, NaN o'rniga tire |
| `insights/ndjson.test.ts` | Oqim parseri — rad etish sababi to'g'ri shoxdan, line/donut tekshiruvi, yozilayotgan jumla |
| `insights/agent.test.ts` | Matnli protokol — direktivani o'qish, kesh kaliti |
| `insights/agent.loop.test.ts` | Suhbat sikli — rad etilgan qatorni bir marta qayta so'rash, noto'g'ri tugma parametri, ochilgan hujjatlar keyingi savolda, `copilot.ask` chip bo'lishi |
| `insights/actions.test.ts` | Registr darvozasi — noto'g'ri yozishni rad etish, pin filtri |
| `insights/pins.test.ts` | Saqlangan kartani o'qish — eski `ref`li kartalar tashlanadi |
| `insights/alerts.test.ts` | Qoidalar — imzo, sovish vaqti, har bir tur |
| `ai/jsonSchema.test.ts` | Zod → JSON Schema konvertatsiyasi |
| `ai/stream.test.ts` | Qayta urinish qarori — qaysi xato takrorlanadi, `Retry-After`, chekinish oralig'i, kunlik (RPD) `429` hech qachon takrorlanmasligi; "Avto" har bir yozuv shaklida muvozanatli byudjetni beradi, belgi qiymatni esa hech qachon |
| `ai/usage.test.ts` | Kvota o'lchagichi — `readQuotaFailure`/`isKeyRejection`ning himoyalangan o'qishi, RPM/TPM/RPD gauge arifmetikasi, Tinch okean yarim tunining DST'dagi holati, `summarizeTokens` |
| `ai/client.test.ts` | OpenAI Responses'ning bir martalik javobi — `firstOpenAiResponsesText`, `usageOf` provayder bo'yicha, `incomplete`/`failed` klassifikatsiyasi |
| `ai/connection.test.ts` | Ulanish testi va model ro'yxati — CORS orqasidagi 401'ni tarmoq xatosidan ajratish, OpenAI'ning chat bo'lmagan modellarini filtrlash |
| `ai/pricing.test.ts` | Narx jadvali — eng uzun prefiks g'olib, kesh chegirmasi, GPT-6 narxlari |
| `ai/modelRules.test.ts` | Chiqish tokenlari chegaralari jadvali va `effectiveMaxTokens()`ning har bir shoxi ("Avto" — OpenAI/boshqa/noma'lum chegara, aniq qiymat — chegaragacha/noma'lum chegara) |
| `storage/settingsSchema.test.ts` | v4 → v5 migratsiyasi — ikkala eski v4 shaklidan ham (umumiy maydon, oraliq `saved` yon jadval) to'g'ri o'tish; v5 → v6 (4 096 → "Avto", boshqa qiymat saqlanadi), v4 → v6 zanjiri, v6 tegilmasligi |
| `storage/aiConnections.test.ts` | Provayderlar orasidagi izolyatsiya — bitta kartaning tahriri boshqa provayderning yozuviga tegmasligi |
| `store/modelUsage.store.test.ts` | Voqealar jurnali — restore va kelayotgan hodisa orasidagi poyga, `BroadcastChannel` orqali qo'shilish |
| `insights/session.test.ts` | Javob sessiyasi — to'xtagan joydan davom ettirish, ochilgan hujjatlar nusxasi |
| `queries/useInsightsQuery.test.ts` | Rail'ning AI so'rovi — digest barmoq izi bo'yicha kesh, muvaffaqiyatsizlikni faqat bir marta qayta so'rash |

> ⚠️ IndexedDB va worker qatlamlari hali qoplanmagan — ular uchun
> `fake-indexeddb` kerak bo'ladi.

---

## 12. Funksional talab → texnik yechim

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
| Copilot haqiqiy ma'lumotdan javob beradi | Lookup'lar arxivdan ma'lumotning o'zini beradi (10.2); model hisoblaydi, bloklar qiymat + `format` bilan tekshirilib chiziladi (10.3); o'qilgan lookup `trace` bo'lib ko'rinadi |
| Chuqur tahlil | `data.rows` — xom qatorlar sahifalab; hisoblovchi lookup'lar arifmetikani kodda bajaradi |
| Model Uzum'ga yozmaydi | Yopiq amallar registri, xavf darajasi, tugma + tasdiq oynasi (10.4) |
| Provayder band bo'lsa davom ettirish | `RETRIES`, `Retry-After`, sessiya `checkpoint` dan davom etadi; kunlik (RPD) limitda takrorlanmaydi (10.1, 10.7) |
| Gemini modeli tanlanganda qolgan limitni bilish | `AI_PROVIDERS[…].limits` katalogi + so'ralgan har bir javobdan hisob (`ai/usage.ts`), model tanlash va "Qolgan limit" paneli (10.7) |
| Provayder almashtirilganda kalit boshqasiga o'tib ketmasligi | Sozlamalar sxemasi v6 — `AiSection.providers`, har biri mustaqil; `updateAiConnection`/`setActiveAiProvider` atom yozuvlari (10.7) |
| Sotuvchi bugungi token sarfini ko'rishi | `summarizeTokens()` va har bir provayder kartasidagi "Token sarfi" paneli, qo'lda kiritilgan narx jadvalidan taxminiy xarajat (10.7) |
| Javobni panelga qadash | Sana va davr bilan surat, "qayta so'rash" tugmasi (10.5) |

---

## 13. Texnik qarz va keyingi qadamlar

Ustuvorlik tartibida:

### 1. `sellPrice` birligi hal qilinmagan, ikki formula bir-biridan farq qiladi
- **Qaysi joyda:** `derive/finance.ts` (`summariseFinance`) va
  `derive/series.ts` (`buildSeries`) tushumni `Σ sellPrice` deb hisoblaydi.
  Arxivning `revenue` ustuni, worker va Copilot lookup'lari esa
  `sellPrice × amount` ishlatadi.
- **Qachon farq chiqadi:** faqat `amount > 1` bo'lgan qatorda. Namunada bunday
  qatorlar kam — `group=false` rejimidagi 50 qatordan 1 tasi.
- **Dalil:** o'sha yagona qator `sellPrice` bir dona narxi ekanini ko'rsatadi,
  ya'ni ekrandagi tushum va sof foyda bunday qatorlarda kam chiqadi. Lekin bitta
  qator yetarli dalil emas. `purchasePrice` birligi ham isbotlanmagan.
- **Keyingi qadam:** `amount > 1` bo'lgan yana bir real namuna olish, keyin
  formulani bitta qilish. Tafsilot:
  [ENDPOINTS.md](./frontend/src/services/uzum/ENDPOINTS.md), 12.3-bo'lim.

### 2. Testlar bor, lekin saqlash qatlami qoplanmagan
Sof funksiyalar qoplandi (639 ta test): `coverage.ts` interval algebrasi,
Copilot protokoli, toolkit arifmetikasi, AI provayder transporti va
sozlamalar sxemasi. Qolgani: `archivePlan.ts`, `paginate()`, wire→row
mapperlar, `missingRanges()` va v2→v3 migratsiyasi. Bular IndexedDB talab
qiladi, shuning uchun `fake-indexeddb` qo'shilishi kerak.

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

### 5. Gemini kvota o'lchagichining ikkita qoidasi haqiqiy namunada tekshirilmagan
- **Qaysi joyda:** `services/ai/usage.ts` — `readQuotaFailure` Gemini `429`
  javobini `google.rpc.QuotaFailure` / `RetryInfo` shakli deb o'qiydi, va
  "har bir natija — muvaffaqiyatli ham, rad etilgan ham — loyiha kvotasiga
  so'rov sifatida sanaladi" qoidasi shu o'qishga tayanadi.
- **Dalil qanchalik kuchli:** javob tanasi loyihada yozib olingan haqiqiy
  Gemini `429` namunasi emas — Google'ning ommaviy xato-format hujjatlari va
  masalalar (issue)lardagi misollardan olingan. "Har bir natija sanaladi"
  qoidasi esa bitta AI Studio kuzatuviga (3.5 Flash modelida 23/20 RPD
  ko'rsatilgani) asoslangan.
- **Nima uchun darhol xavfli emas:** noto'g'ri chiqsa ham natija faqat
  ko'rsatkich chizig'ini suradi — Copilot javobiga yoki Uzum'ga yozish
  amaliga ta'sir qilmaydi, va Gemini'ning real `429`dagi limiti baribir
  katalog raqamini o'zib ketadi.
- **Keyingi qadam:** hech bo'lmasa bitta haqiqiy Gemini `429` javobini (xususan
  bir nechta `violations`li holatni) yozib olib, `pickViolation` va
  `axisFromQuotaId` ustidan tekshirish.

### 6. OpenAI Responses integratsiyasi haqiqiy kalit bilan hali sinalmagan
- **Qaysi joyda:** `services/ai/stream.ts` (`reduceOpenAiResponses`,
  `dialectFor`'ning `openai` bo'limi, `openAiResponsesInput`) va
  `services/ai/client.ts` (bir martalik so'rov) — butun yo'l OpenAI'ning
  hujjatlaridan qurilgan, faqat mock javoblar bilan test qilingan
  (`ai/stream.test.ts`, `ai/client.test.ts`).
- **Dalil qanchalik kuchli:** fikrlash elementini `store:false` bilan
  chaqiruvdan oldin qayta yuborish OpenAI'ning o'z reasoning qo'llanmasiga
  asoslangan — hujjatlashtirilgan. Ammo "chaqiruvni qayta yuborishda `fc_`
  id emas, faqat `call_id` yetarli" qoidasi 2025 yilgi hamjamiyat
  xabarlariga asoslangan, OpenAI'ning o'z hujjatida yozilmagan va qayta
  tekshirilmagan.
- **Nima uchun darhol xavfli emas:** noto'g'ri bo'lsa eng yomon holatda
  OpenAI 400 qaytaradi (`classifyOpenAiFailure` buni `client` deb
  belgilaydi) va sotuvchi tushunarli xato ko'radi — jimgina noto'g'ri javob
  yozilmaydi.
- **Keyingi qadam:** haqiqiy OpenAI kaliti va fikrlash modeli
  (`gpt-6-astra`) bilan ikki+ raundli, tool chaqiruvli suhbatni sinab
  ko'rish — xususan ikkinchi raundda `reasoning` elementi qabul qilinishini
  va `fc_` id yubormaslikning haqiqatan zarur yoki zararsiz ekanini
  tasdiqlash.

### 7. `backend/` bo'sh shablon
Agar jamoaviy ishlash yoki serverdagi zaxira kerak bo'lsa, arxitektura qarori
qaytadan ko'rib chiqilishi kerak.
