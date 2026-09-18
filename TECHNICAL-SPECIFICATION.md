# Savdo Copilot — Texnik spetsifikatsiya

**Versiya:** 2.6.0
**Hujjat sanasi:** 2026-09-18
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
| AI | Provayder adapterlari qo'lda yozilgan: Anthropic Messages, Google `generateContent`, OpenAI-mos `/chat/completions` (OpenRouter, DeepSeek, Mistral, Ollama va boshqalar) |
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

- **Uch xil so'rov shakli:** Anthropic Messages, Google `generateContent`,
  OpenAI-mos `/chat/completions`.
- **Streaming va native tool chaqiruvlari.** Gemini 3'ning `thoughtSignature`i
  chaqiruv bilan birga qaytariladi.
- **Qayta urinish** (`RETRIES = 3`): `429`/`5xx`/tarmoq xatosida, `Retry-After`
  yoki Gemini'ning `RetryInfo.retryDelay`si hurmat qilinadi.
  - Faqat javobdan hali hech narsa ekranga chiqmagan bo'lsa takrorlanadi. Aks
    holda matn ikki marta yozilardi, shuning uchun uzilgan javob sotuvchiga
    **Davom ettirish** bilan qaytariladi.
  - Bekor qilingan so'rov va noto'g'ri kalit takrorlanmaydi.
  - **Kunlik (RPD) `429` ham takrorlanmaydi.** `ModelQuotaError.isRetryable`
    buni ataylab `false` qaytaradi
    ([`ai/usage.ts`](./frontend/src/services/ai/usage.ts#L120)) — bu chegara
    faqat Tinch okean yarim tunida ochiladi, har bir urinish esa bir xil rad
    javobini yana bir marta hisoblatib qo'yardi. Suhbat paneli bu holatda
    sababni va tiklanish vaqtini ko'rsatadi, **Davom ettirish** tugmasisiz
    ([`features/chat/useCopilotAnswers.ts`](./frontend/src/features/chat/useCopilotAnswers.ts#L36)).
- **Kvota o'lchagichi** — brauzerda, faqat Gemini uchun
  ([`ai/usage.ts`](./frontend/src/services/ai/usage.ts)):
  - `stream.ts` va `client.ts` javob **olgan** har bir so'rov uchun (qayta
    urinishlar, suhbat, rail muallifi, Sozlamalardagi ulanish testi
    qo'shilgan) bitta `ModelRequestEvent` yozadi. Javob kelmagan so'rov
    (tarmoq xatosi, timeout, bekor qilish) va kalit rad etilishi
    (`401`/`403`, `400 API_KEY_INVALID`) yozilmaydi — ular loyiha kvotasiga
    umuman tegmagan.
  - Gemini'ning `429` tanasi (`google.rpc.QuotaFailure` / `RetryInfo`) qaysi
    o'lchov (`rpm`/`tpm`/`rpd`) tugaganini va qachon qayta so'rash
    mumkinligini ajratib oladi (`readQuotaFailure`). **Dalil kuchsiz:** bu
    tana shakli loyihada yozib olingan haqiqiy namuna emas — Google'ning
    ommaviy xato formati hujjatlaridan va misollardan olingan.
  - RPM va TPM oxirgi 60 soniyalik sirpanuvchi oynada, TPM kiruvchi
    tokenlarda (`promptTokenCount`), RPD Tinch okean yarim tunidan (DST'ni
    hisobga olib) hisoblanadi; Gemini'ning o'zi `429`da aytgan limit
    katalogdagi raqamni o'zib ketadi. "Har bir natija — muvaffaqiyatli ham,
    rad etilgan ham — so'rov sifatida sanaladi" qoidasi ham **dalili
    kuchsiz**: bitta AI Studio kuzatuviga (3.5 Flash'da 23/20 RPD
    ko'rsatilgani) asoslangan.
  - Hisob [`store/modelUsage.store.ts`](./frontend/src/store/modelUsage.store.ts)da
    IndexedDB `kv`ning `model_usage` yozuvida (26 soat, 5000 tagacha,
    faqat katalogda `limits`i bor model — hozircha to'qqizta Gemini modeli)
    saqlanadi va `BroadcastChannel('savdo.model-usage')` orqali oynalar
    orasida sinxronlanadi. Ko'rsatish —
    [`features/settings/ModelPicker.tsx`](./frontend/src/features/settings/ModelPicker.tsx)
    (model tanlashda) va
    [`features/settings/ModelQuotaPanel.tsx`](./frontend/src/features/settings/ModelQuotaPanel.tsx)
    (tanlangan model uchun uchta chiziq).
- **Narx hisobi:** kesh orqali berilgan tokenlar alohida hisoblanadi.
- **Kalit:** ilova kalit olib kelmaydi — Sozlamalardagi kalit ishlatiladi, u
  bo'sh bo'lsa Copilot so'rov yubormaydi.

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

**Hozirgi holat (2026-09-14):** typecheck ✅ · lint ✅ · test ✅ (160 ta) · build ✅
(asosiy bundle 474 KB / gzip 156 KB)

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
| `ai/stream.test.ts` | Qayta urinish qarori — qaysi xato takrorlanadi, `Retry-After`, chekinish oralig'i, kunlik (RPD) `429` hech qachon takrorlanmasligi |
| `ai/usage.test.ts` | Kvota o'lchagichi — `readQuotaFailure`/`isKeyRejection`ning himoyalangan o'qishi, RPM/TPM/RPD gauge arifmetikasi, Tinch okean yarim tunining DST'dagi holati |
| `store/modelUsage.store.test.ts` | Voqealar jurnali — restore va kelayotgan hodisa orasidagi poyga, `BroadcastChannel` orqali qo'shilish |
| `insights/session.test.ts` | Javob sessiyasi — to'xtagan joydan davom ettirish, ochilgan hujjatlar nusxasi |

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
Sof funksiyalar qoplandi (160 ta test): `coverage.ts` interval algebrasi,
Copilot protokoli, toolkit arifmetikasi. Qolgani: `archivePlan.ts`,
`paginate()`, wire→row mapperlar, `missingRanges()` va v2→v3 migratsiyasi.
Oxirgi uchtasi IndexedDB talab qiladi, shuning uchun `fake-indexeddb`
qo'shilishi kerak.

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

### 6. `backend/` bo'sh shablon
Agar jamoaviy ishlash yoki serverdagi zaxira kerak bo'lsa, arxitektura qarori
qaytadan ko'rib chiqilishi kerak.
