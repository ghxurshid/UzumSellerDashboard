# Savdo Copilot — Texnik spetsifikatsiya

**Versiya:** 3.2.0
**Hujjat sanasi:** 2026-11-16
**Maqsad:** [FUNCTIONAL-SPECIFICATION.md](./FUNCTIONAL-SPECIFICATION.md) dagi har bir
talab texnik jihatdan qanday amalga oshirilganini ifodalash.

Bog'liq hujjatlar:
- [ENDPOINTS.md](../frontend/src/services/uzum/ENDPOINTS.md) — Uzum API ma'lumotnomasi
- [API-REQUEST-RESPONSE.md](./API-REQUEST-RESPONSE.md) — Uzum so'rov va javoblarining
  kuzatilgan shakli, maydonma-maydon, dalil kuchi bilan
- [STORAGE.md](../frontend/src/services/storage/STORAGE.md) — IndexedDB jadvallari va sync

Loyiha uch paketdan iborat (1.4-bo'lim): `frontend/` — sayt, `extension/` —
brauzer kengaytmasi (14-bo'lim), `core/` — ikkalasiga umumiy Copilot dvigateli
(2.2-bo'lim). Quyidagi yo'llar, aks holda aytilmasa, `frontend/src/` ga nisbatan.

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
│      └── AI Copilot ── core/src/ai ──┼──────────────┐           │
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
[vite.config.ts](../frontend/vite.config.ts#L64) proxy qiladi — shu sabab saytning
asosiy URL'i konstanta emas, **sozlama**. Host ruxsatlari bilan ishlaydigan
brauzer kengaytmasi endi bor (14-bo'lim), lekin u saytning o'rnini bosmaydi: u
faqat Copilot'ning alohida mezboni va seller OpenAPI'ni emas, kabinetning ichki
API'sini o'qiydi.

### 1.2. `backend/` papkasi

Hozircha o'zgartirilmagan ASP.NET Core shabloni (`WeatherForecastController`).
Ishlatilmaydi. Kelajakda kerak bo'lsa — jamoaviy kirish, serverdagi zaxira yoki
rejalashtirilgan sinxronizatsiya uchun.

### 1.3. Texnologiyalar

Jadval saytga tegishli; kengaytma ham xuddi shu kutubxonalarni **aynan bir xil
versiyada** ishlatadi (1.4-bo'lim) va ustiga Manifest V3 qo'shadi (14.2).

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
| Kengaytma | Manifest V3, Vite (panel va kontent skript — ikkita alohida build), `chrome.storage.local`; Chrome, Edge, Firefox |

### 1.4. Uch paket

```
core/        umumiy Copilot dvigateli — manba holida, o'zining node_modules'i yo'q
frontend/    sayt        (@/     -> frontend/src)   core'ni @core/ orqali ishlatadi
extension/   kengaytma   (@ext/  -> extension/src)  core'ni @core/ orqali ishlatadi
backend/     tegilmagan ASP.NET shabloni
```

**Nega `core/` alohida paket.** Copilot — suhbat sikli, bloklar tili, LLM
transporti, sozlamalar va chat paneli — sayt ham, kengaytma ham ishlatadigan
bitta narsa. Ikki nusxa birinchi tuzatishdayoq bir-biridan uzoqlashardi, ayniqsa
model ko'radigan matnda: provayder keshi uning prefiksiga tayanadi. Shuning uchun
yagona nusxa bor, har bir mezbon uni **o'z `node_modules`**ida kompilyatsiya
qiladi — `core/`da bog'liqlik yo'q, shuning uchun react, zod va zustand har
mezbon to'plamida aniq bir marta bo'ladi.

**Qoidalar va ularni nima ushlab turadi:**

| Qoida | Qanday ta'minlanadi |
|---|---|
| `core/` hech qachon mezbondan import qilmaydi | `eslint.config.js` dagi `savdo/core-boundary` qoidasi `core/src` ichida `@/`, `@ext/` va `core/src` dan tashqariga chiquvchi nisbiy import'ni rad etadi |
| `core/`dagi `import 'zod'` mezbonning paketiga yetishi | [`core/tooling/hostResolve.ts`](../core/tooling/hostResolve.ts) — Vite plagini: `core/` ichidagi bare import'ni mezbon ildizidan hal qiladi |
| Ikki mezbon bir xil kutubxona versiyasi va bir xil qat'iylikda kompilyatsiya qilishi | [`extension/scripts/guard.mjs`](../extension/scripts/guard.mjs) (`npm run lint` va `npm run build`da): umumiy paketlar versiyasi, `strict` va unga o'xshash kompilyator opsiyalari (frontend, extension, core), va katalogdagi har bir LLM provayder origin'i manifestning host ruxsatlarida borligi |

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
services/insights/   saytning Copilot qismi: prompt, lookup'lar, amallar jadvali, kartalar
   ↑                   └── core/  Copilot dvigateli: suhbat sikli, bloklar, LLM transporti (2.2)
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

Bu diagramma `frontend/` ichidagi qatlamlar. `core/` ularning **hammasidan
pastda** turadi va istalgan qatlamdan import qilinishi mumkin (2.2); `services/api/`
dagi xato va sarlavha yordamchilari ham endi `core/`da.

**Qoida:** yuqori qatlam pastkini biladi, aksi yo'q. `derive/` sof — na tarmoq,
na saqlash, na DOM. Yagona qabul qilingan chetlanish — shartnoma modullari:
`insights/cards.ts` (insight kartasi konverti, uni `derive/insights.ts`
qoidalari ham yozadi) va `queries/sources.ts` dagi manba tiplari pastdan import
qilinishi mumkin. Bloklar tili (`@core/agent/blocks`) `core/`ning o'zi bo'lgani
uchun istalgan joydan import qilinadi.

Qaysi papka qaysi agentga tegishli ekani va chegara qoidalari ildizdagi
[CLAUDE.md](../CLAUDE.md) da; agentlar ta'rifi — [`.claude/agents/`](../.claude/agents/).

### 2.1. Kolleksiyalarga yagona eshik

[`services/data/collections.ts`](../frontend/src/services/data/collections.ts) —
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

### 2.2. `core/` — ikki mezbonga umumiy dvigatel

Nima uchun alohida paket ekani va uni nima himoya qilishi — 1.4-bo'limda. Bu
yerda — ichida nima bor. Hamma yo'l `core/src/` ga nisbatan; mezbon ularga `@core/…`
bilan murojaat qiladi.

| Papka | Nima | Oldin qayerda edi |
|---|---|---|
| `agent/` | Suhbat sikli (`agent.ts`), NDJSON oqim parseri, bloklar tili (`blocks.ts`), raqam formatlash (`figures.ts`), widget qo'llanmasi, eksport, **umumiy system prompt quruvchisi** (`systemPrompt.ts`) va **amallar registri mexanizmi** (`actionRegistry.ts`) | `services/insights/` |
| `tools/` | Mezbon va sikl orasidagi shartnoma (`contract.ts`: `AgentToolkit`, `ToolSpec`, `BaseToolContext`, `OPEN_TOOLKIT`), **toolkit mexanizmi** (`createToolkit.ts`) va tool natijasi matni (`plaintext.ts`) | `services/insights/` |
| `ai/` | LLM provayder transporti: oqim, bir martalik so'rov, ulanish testi, model qoidalari, narxlar, voqealar jurnali | `services/ai/` |
| `settings/` | Sozlamalar servisi, sxema va migratsiyalar, provayder ulanishlari | `services/storage/` |
| `storage/kv.ts` | Kalit/qiymat **porti** — mezbon backend'ini ro'yxatdan o'tkazadi (STORAGE.md, `kv`) | yangi |
| `errors/`, `net/` | `ApiError` va HTTP xatosi/sarlavha yordamchilari | `services/api/` |
| `state/` | `chat`, `settings`, `toast`, `modelUsage`, `preferences` store'lari | `store/` |
| `ui/` | `chat/` (Copilot paneli va javoblar hooki, `CopilotHost` bilan boshqariladi), `blocks/` (blok chizgich va chizmalar), `settings/` (Umumiy, Klaviatura, AI), `kit/` (UI to'plami), `shell/` (`ThemeProvider`, `ErrorBoundary`) | `features/`, `components/ui/`, `app/` |
| `i18n/`, `lib/`, `hooks/`, `constants/`, `types/` | Lug'at (uch til), `format`, umumiy hooklar, sozlama konstantalari, umumiy tiplar | `lib/i18n/`, `lib/`, `hooks/`, `constants/`, `types/` |
| `styles/theme.css` | Dizayn tokenlari; har mezbonning kirish CSS'i Tailwind'ni va shu faylni import qiladi | `styles/` |

Eski joylarda **qoldiq (shim) yo'q**: import'lar bevosita `@core/…` ga o'tkazilgan.

**Mezbon nimani beradi.** Dvigatel sayt ham, kengaytma ham bilmaydigan joyda
ishlashi uchun mezbon unga to'rt narsa uzatadi:

| Nima | Shartnoma | Sayt | Kengaytma |
|---|---|---|---|
| Nimani o'qiy oladi | `AgentToolkit` — `createToolkit()` qurgan: lookup'lar, hujjat, native tool e'lonlari | [`siteToolkit.ts`](../frontend/src/services/insights/siteToolkit.ts) | [`host/toolkit.ts`](../extension/src/host/toolkit.ts) |
| Qanday tugmalar bor | `ActionRegistry` (`createActionRegistry`) | `INSIGHT_REGISTRY` ([`actions.ts`](../frontend/src/services/insights/actions.ts)) | faqat `copilot.ask` |
| System prompt'ning mezbonga xos qismi | `PromptHost`: kimlik, mavzular, ma'lumot qayerdan, kontekst, ixtiyoriy maydon nomlari va yozish matni | [`prompt.ts`](../frontend/src/services/insights/prompt.ts) | [`host/prompt.ts`](../extension/src/host/prompt.ts) |
| Panel uchun muhit | `CopilotHost` ([`ui/chat/host.ts`](../core/src/ui/chat/host.ts)): `toolkit`, `prepare` (har savol/davom ettirishda system prompt va lookup konteksti), `runAction`, `openSettings`, takliflar, ixtiyoriy `pins` | [`useSiteCopilotHost.ts`](../frontend/src/features/chat/useSiteCopilotHost.ts) | [`panel/copilotHost.ts`](../extension/src/panel/copilotHost.ts) |

**Nega shunday.** Sayt va kengaytma farqlanadigan joy aynan shu to'rtta: ma'lumot
qayerdan keladi, tugma nima qila oladi, model nima deb tanishtiriladi va
sozlamalarga qanday o'tiladi. Qolgani — bir xil kod. Farq bitta obyektda
bo'lgani uchun `core/` router, sayt store'i yoki so'rov hook'ini import qilmasdan
chatni chizadi.

**Sayt modelga yuboradigan matn ko'chirishda o'zgarmagan.** System prompt, widget
qo'llanmasi, toolkit hujjati va native tool e'lonlari ko'chirishdan oldingi bilan
bayt-baytiga teng edi; buni [`sitePrompt.test.ts`](../frontend/src/services/insights/sitePrompt.test.ts)
snapshot'lar bilan qotirib turadi. Sabab: provayder keshi prefiksga tayanadi, va
umumiy mexanizmdagi bitta jumlaning o'zgarishi har ikki mezbonning keshini buzadi.
Bitta ataylab o'zgarish bor (2026-11-13): zod → JSON Schema konvertori
([`bound`](../core/src/ai/jsonSchema.ts#L77)) endi **butun sonning istisno
chegarasini** qo'shni butun son sifatida e'lon qiladi: `.positive()` (`> 0`) endi
`"minimum": 1` (avval noto'g'ri `"minimum": 0`). Kasr son uchun `minimum: 0`
qoladi: `exclusiveMinimum` shakli qoralamalar orasida farq qiladi va uni
har adapter qabul qilishi isbotlanmagan. Saytning qotirilgan native tool
e'lonlarida bu **17 ta `minimum` qiymatini** o'zgartirdi, boshqa hech narsa
siljimadi. Tekshiruv avval ham 0 ni rad etardi; endi e'lon buni oldindan aytadi.
Snapshot'ni `-u` bilan yangilash faqat shunday ataylab o'zgarishda va shu tarzda
izohlangan holda mumkin.

**Ko'chirish bilan o'zgargan xatti-harakat (qolgani avvalgidek):**

| O'zgarish | Nega |
|---|---|
| `ActionBlock.actionId` endi blok sxemasida enum emas, naqsh bilan tekshiriladigan satr | Qaysi id'lar bor — mezbon registrining ishi. Noma'lum id baribir chizilmaydi: uni mezbon registri rad etadi (sikldagi `checkActions`da, `serve`da, rail'ning `cards.ts` sxemasida va chizgichda) |
| `constructor` kabi obyekt prototipi a'zosi nomli lookup endi "bunday lookup yo'q" qaytaradi | Avval `Object.prototype.constructor`ni topib, siklni `TypeError` bilan yiqitardi; endi a'zolik — o'z xossasi tekshiruvi |
| Preferences store'ning saqlash joyi mezbonga almashtiriladi | Sayt avvalgidek `localStorage` (`savdo.preferences`, sinxron hydrate), kengaytma — `chrome.storage.local` (14.5) |

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

`ApiError` ([`core/src/errors/apiError.ts`](../core/src/errors/apiError.ts),
ikki mezbon uchun umumiy) turlarga bo'linadi: `network`, `timeout`, `unauthorized`,
`forbidden`, `rateLimited`, `notFound`, `server`, `client`, `cancelled`,
`unconfigured`. Har bir ekran — va Copilot — shu turga qarab nima
ko'rsatishini biladi.

---

## 4. Saqlash qatlami

To'liq tafsilot: [STORAGE.md](../frontend/src/services/storage/STORAGE.md).

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

**Yechim** ([`sync/lazySync.ts`](../frontend/src/services/sync/lazySync.ts)):
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
([`archive/coverage.ts`](../frontend/src/services/storage/archive/coverage.ts#L145))
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
[`sync/planning.test.ts`](../frontend/src/services/sync/planning.test.ts) da
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

[`sync/snapshotSync.ts`](../frontend/src/services/sync/snapshotSync.ts) — reja
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

[`sync/syncEngine.ts`](../frontend/src/services/sync/syncEngine.ts) — sync to'rt
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
| `settings.store` (`core/`) | Sozlamalar |
| `notifications.store` | Bildirishnomalar |
| `toast.store` (`core/`) | Vaqtinchalik xabarlar |
| `ui.store`, `dialog.store`, `pins.store`, `alerts.store` | UI holati, qadalgan javoblar, doimiy qoidalar |
| `chat.store`, `preferences.store`, `modelUsage.store` (`core/`) | Suhbat, tema/til/raqam formati, AI so'rovlar jurnali |

**Sync ko'rsatkichlari nega kelishadi.** Yuqori paneldagi chiziq, sozlamalar
paneli va ekran banneri — uchalasi ham `sync.store` ni o'qiydi. Ular bir-biriga
mos kelishi tuzilma bo'yicha kafolatlangan, intizom bilan emas.

---

## 9. Yozish amallari

[`queries/useUzumActions.ts`](../frontend/src/services/queries/useUzumActions.ts)
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

Kod ikki joyda. **Umumiy dvigatel** — [`core/src/agent/`](../core/src/agent/)
(suhbat sikli, bloklar, system prompt quruvchisi, amallar registri mexanizmi),
[`core/src/tools/`](../core/src/tools/) (toolkit shartnomasi va mexanizmi),
[`core/src/ai/`](../core/src/ai/) (provayder transporti), [`core/src/ui/`](../core/src/ui/)
(chat paneli, blok chizgich, AI sozlamalari) — sayt ham, kengaytma ham shuni
ishlatadi (2.2). **Saytning o'z qismi** —
[`services/insights/`](../frontend/src/services/insights/) (prompt, lookup'lar,
amallar jadvali, kartalar), [`features/chat/`](../frontend/src/features/chat/) va
[`features/insights/`](../frontend/src/features/insights/) (panel mezboni, rail,
qadalgan javoblar). Kengaytmaning qismi — 14.6-bo'lim. Quyida, aks holda
aytilmasa, tasvirlangan xatti-harakat **sayt** uchun; kengaytma bir xil siklni
boshqa toolkit bilan yuritadi.

### 10.1. Suhbat sikli

[`agent.ts`](../core/src/agent/agent.ts) — bir savol bir necha
**raund**dan iborat:

```
system prompt           kimligi, chegaralar, "kerakligini o'zing so'ra"
  + ma'lumot yangiligi  bu mashina ma'lumoti qachon o'qilgani — bir savolda bir marta
  ↳ toolkit'ni ochish   qaysi so'rovlar va amallar bor — bir thread'da bir marta
  ↳ lookup chaqirish    arxivdan ma'lumot o'qiladi (10.2)
  ↳ widget qo'llanmasi  javob qanday chiziladi — bir thread'da bir marta
  ↳ bloklar             javob, raqamlari bilan, oqimda (10.3)
```

- **Sikl toolkit'ni mezbondan oladi.** Lookup'lar, toolkit hujjati, native tool
  e'lonlari, yangilik izohi, widget maslahatlari va amallar registri —
  hammasi `options.toolkit` orqali ([`AgentToolkit`](../core/src/tools/contract.ts)),
  sikl esa ma'lumot qayerdan kelishini bilmaydi. System prompt — umumiy qurilma
  ([`systemPrompt.ts`](../core/src/agent/systemPrompt.ts)) plyus mezbon bergan qismlar
  (kimlik, mavzular, ma'lumot qayerdan, kontekst).
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
- **Tarix — savoldan oldingi suhbat.** Yangi savol bilan oxirgi 6 ta xabar
  yuboriladi: savollar o'z matni bilan, javoblar `summariseAnswer` xulosasi
  bilan; xulosasi bo'sh javob tashlab ketiladi. Tarix yangi savol thread'ga
  qo'shilishidan **oldin** o'qiladi — `startQuestion`
  ([`history.ts`](../core/src/ui/chat/history.ts)) avval tarixni oladi, keyin
  navbatni ochadi. Savolning o'zini sessiya oxiriga `createSession` qo'shadi,
  shuning uchun u tarixda bo'lmasligi kerak: avval tarix savol qo'shilgandan
  keyin o'qilar va har bir keyingi savol modelga ikki marta ketar edi.
- **Ma'lumot yangiligi — savol boshida bir marta, oxirida qo'shiladi.** Bu —
  toolkit'ning ixtiyoriy `freshness()` metodi: arxivi bor mezbon beradi
  (sayt), arxivsiz mezbon (kengaytma) bermaydi va blok umuman qo'shilmaydi.
  [`services/data/freshness.ts`](../frontend/src/services/data/freshness.ts)
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

Saytning lookup'lari — [`toolkit.ts`](../frontend/src/services/insights/toolkit.ts),
ular [`siteToolkit.ts`](../frontend/src/services/insights/siteToolkit.ts)da
hujjat bo'limlari va widget maslahatlari bilan toolkit'ga yig'iladi. Yig'ish
mexanizmining o'zi — [`createToolkit.ts`](../core/src/tools/createToolkit.ts) —
ikki mezbonga bitta: asta-sekin ochish (boshida bitta tool), provayder uchun
xavfsiz nomlar, argumentni sxema bilan tekshirish, xatoni modelga matn qilib
qaytarish, va lookup ro'yxati hamda native e'lonlar **bir registrdan** hosil
qilinishi — shuning uchun ular bir-biriga zid bo'la olmaydi. Har bir lookup
2.1-bo'limdagi yagona eshikdan `sync: true` bilan o'qiydi — ya'ni avval arxiv,
yetishmagan qism Uzum'dan. Natija **ma'lumotning o'zi**: sarlavha (tool, davr,
do'konlar, qator soni, `TRUNCATED`, qisqartirilgan davr), birliklar qatori va
birinchi qatori ustun nomlari bo'lgan `|` bilan ajratilgan jadvallar
([`plaintext.ts`](../core/src/tools/plaintext.ts)).

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
ustida kodda bajaradi ([`datasets.ts`](../frontend/src/services/insights/datasets.ts),
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
([`ndjson.ts`](../core/src/agent/ndjson.ts),
[`blocks.ts`](../core/src/agent/blocks.ts)). Faqat `text` bloki
yozilayotganda ko'rinadi — yarim jadval chizilmaydi.

| Blok | Tarkibi |
|---|---|
| `text` | Markdown, 4000 belgigacha |
| `metric` | `value`, `format`, ixtiyoriy `change` (%) |
| `metrics` | yonma-yon 2–4 ko'rsatkich; har birida `label`, `value`, `format`, ixtiyoriy `previous` |
| `kv`, `steps` | yorliq/qiymat qatorlari (≤ 12), hisob-kitob zanjiri (≤ 10) |
| `progress` | ≤ 8 qator; har birida `value` (≥ 0) va `total` (> 0), to'ldirilgan chiziq bilan |
| `table` | ≤ 6 ustun × 30 qator, katak — matn yoki son, ustun `formats` |
| `chart` | `waterfall`/`bar`/`donut` — `items` (2–12); `line` — `labels` (≤ 120) va `series` (≤ 4), har seriyada har yorliqqa bitta qiymat |
| `rank` | reyting: `items` (2–10), ixtiyoriy `order` (`desc`/`asc`) va har qatorda `note` |
| `compare` | ikki tomon (`a`, `b`) va ≤ 8 qator; har qatorda ikkala raqam, ixtiyoriy `better` (`higher`/`lower`) |
| `product` | mahsulot kartasi: `title`, ixtiyoriy `note`, `image`, `status` (≤ 24 belgi) va ≤ 6 ta `figures` |
| `choice` | sotuvchiga savol: `question`, ixtiyoriy `note`, 2–4 ta `options` (`label` ≤ 80 belgi, `description`, `recommended`) |
| `badges`, `callout`, `action` | teglar, ramkali tavsiya (bir daraja ichma-ich), registrdagi tugma |

**Ilova hisoblaydigan raqamlar.** `metrics`, `progress` va `rank` bloklarida
model faqat o'qigan raqamlarini yozadi, oxirgi raqamni esa
[`figures.ts`](../core/src/agent/figures.ts) hisoblaydi:

| Blok | Model yozadi | Ilova hisoblaydi |
|---|---|---|
| `metrics` | `value` va `previous` | o'zgarish foizi (`changeFrom`) |
| `progress` | `value` va `total` | ulush foizi va chiziq to'lishi (`shareOf`, `fillOf`) |
| `rank` | `items`, istalgan tartibda | tartib va o'rin raqami (`rankOrder`) |
| `compare` | har qatorda `a` va `b` | `a`ning `b`ga nisbatan o'zgarishi va qaysi tomon oldinda (`compareRow`) |

- O'zgarish oldingi qiymatning moduliga nisbatan olinadi; oldingi qiymat 0
  bo'lsa foiz ko'rsatilmaydi.
- `metrics` qatorida `change` maydoni rad etiladi — model `previous` bilan
  qayta yuboradi.
- Ulush 100% dan oshsa ham shundayligicha yoziladi, chiziq esa to'la holatda
  to'xtaydi.
- `rank`da teng qiymatlar bitta o'rinni oladi (1, 2, 2, 4). Chiziq ro'yxatdagi
  eng katta qiymatga nisbatan chiziladi, jamidan ulush sifatida emas.
- `compare`da tomon faqat `better` berilganda tanlanadi: usiz farq oddiy rangda
  yoziladi, `better` bilan esa oldindagi tomon qalinroq, farq yashil yoki qizil.
  Qatorda model o'zi hisoblagan farq (`diff` kabi ortiqcha maydon) rad etiladi.
- Hosila raqamlar ekranda, CSV eksportda va keyingi savolga yuboriladigan javob
  xulosasida bir xil funksiyadan olinadi.

**Mahsulot rasmi.** `product.image` — blok tilida so'rov yuboradigan yagona
maydon, shuning uchun u faqat `https://images.uzum.uz/` manzilini qabul qiladi
(query, fragment va boshqa xostsiz). Boshqa manzil wire'da sababi bilan rad
etiladi, renderer esa chizishdan oldin `isProductImage` bilan yana tekshiradi.
Rasm `referrerPolicy="no-referrer"` bilan so'raladi; yuklanmasa karta rasmsiz
chiziladi.

**Tanlov (`choice`).** Model savolni bir necha xil tushunish mumkin bo'lganda
shu blokni yuboradi; qachon so'rash va qachon so'ramaslik qoidasi widget
guide'ning ASKING BACK bo'limida.

Blok ikki joyda yashaydi:

| Qayerda | Nima | Fayl |
|---|---|---|
| Yozish maydoni o'rnida | Savol ochiq paytdagi modal forma: variantlar, o'z javobi uchun maydon, bekor qilish | [`ChoiceForm.tsx`](../core/src/ui/chat/ChoiceForm.tsx) |
| Suhbat tarixida | Savol hal bo'lgach qoladigan bir qatorli yozuv; ochiq paytda hech narsa chizilmaydi | [`ChoiceBlock.tsx`](../core/src/ui/blocks/ChoiceBlock.tsx) |

Blokning o'zi holat saqlamaydi. Holat suhbatdan o'qiladi
([`choiceState.ts`](../core/src/ui/blocks/choiceState.ts)):

| Holat | Qachon | Ekranda |
|---|---|---|
| `waiting` | javob hali kelmoqda | hech narsa; yozish maydoni joyida |
| `open` | bu oxirgi javob, hech narsa yuborilmayapti, savol yopilmagan | forma yozish maydoni o'rnida |
| `answered` | keyingi xabar variantlardan birining `label`iga teng | tarixda savol qatori |
| `passed` | keyingi xabar boshqa narsa (o'z javobi) | tarixda savol qatori |
| `dismissed` | sotuvchi savolni yopgan | tarixda savol, "Savol bekor qilindi" va "Javob berish" |

- **Javob — xabar.** Variant bosilsa uning `label`i, o'z javobida esa yozilgan
  matn oddiy savol kabi `ask` orqali yuboriladi. Shuning uchun `label`lar bir
  xil bo'lishi mumkin emas, faqat bittasi `recommended` bo'la oladi.
- **Bekor qilish — yagona saqlanadigan holat.** U ortidan xabar qoldirmaydi,
  shuning uchun so'ragan navbatga yoziladi: `ChatTurn.choiceDismissed`
  (`dismissChoice` / `reopenChoice`,
  [`chat.store.ts`](../core/src/state/chat.store.ts)).
- **Modelga nima aytiladi.** `summariseAnswer` savolni va barcha variantlarni
  javob xulosasiga yozadi; yopilgan savol uchun "bekor qilindi, qayta so'rama"
  deb qo'shadi (`SummaryOptions.choiceDismissed`).
- **Bitta savol.** Forma javobdagi birinchi `choice`ni oladi (`findChoice`,
  callout ichidan ham). Shu javobdagi boshqa `choice` bosilmaydigan yozuv
  bo'lib chiziladi.
- **Modallik.** Forma `role="dialog"` (lekin `aria-modal`siz — tarix ekran
  o'quvchisi uchun ochiq qoladi), fokusni o'zi oladi, Tab ichida aylanadi.
  Escape'ni `window`da tinglaydi; kengaytmaning o'z Escape qoidasi ochiq
  `dialog` bor paytda tugmaga tegmaydi, shuning uchun birinchi Esc savolni
  yopadi, panelni emas.
- **Tasodifdan himoya.** Forma paydo bo'lgandan keyin `CHOICE_ARM_MS` (350 ms)
  ichidagi bosish hisobga olinmaydi. Yozish maydonidagi matn formaning
  maydoniga ko'chadi va fokus o'sha yerga tushadi.
- Faqat savoldan iborat javob forma ochiq paytda bo'sh pufak chizmaydi
  (`hasVisibleBlocks`).
- Pin qilinmaydi va CSV'ga chiqmaydi. Suhbati yo'q sirtda (insight kartalari)
  blok savol va variantlar ro'yxati bo'lib, bosilmaydigan holda chiziladi.

**Raqamlar qayerdan.** Blok raqamni **qiymat** sifatida olib keladi va uning
turini aytadi: `money`, `percent`, `count`, `number`.
[`figures.ts`](../core/src/agent/figures.ts) uni ekrandagi
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
- Noma'lum blok turi, limitdan oshgan maydon, mezbon registrida yo'q amal
  id'si yoki registr rad etgan amal parametrlari chizilmaydi. Har biri sababi bilan modelga qaytariladi va bitta
  savolda **bir marta** qayta yuborish so'raladi.
- Limitlar ([`WIDGET_LIMITS`](../core/src/agent/blocks.ts))
  widget qo'llanmasiga ham shu yerdan o'qiladi
  ([`widgets.ts`](../core/src/agent/widgets.ts)), shuning uchun
  ular bir-biridan ajrab ketmaydi.

### 10.4. Amallar

Mexanizm — [`actionRegistry.ts`](../core/src/agent/actionRegistry.ts) (yozuv
shakli, darvoza, har mezbonda bor `copilot.ask`); *qaysi* amallar bor — mezbonning
jadvali. Sayt jadvali — [`actions.ts`](../frontend/src/services/insights/actions.ts)
(`INSIGHT_REGISTRY`): yopiq registr, har bir amal route'i, xavf darajasi va zod
parametrlari bilan. Kengaytmada faqat `copilot.ask` (14.6):

| Xavf | Kim bajaradi |
|---|---|
| `none` | Model darhol bajaradi (ekran ochish, davr almashtirish, qoida qo'yish). Istisno — `copilot.ask`: u doim javob ostidagi taklif chipi bo'ladi, o'zi so'ralmaydi |
| `low` | Tugma — faqat o'qiydigan so'rov (etiketka, akt PDF) |
| `mid` | Tugma — qaytarib bo'ladigan yozish (tasdiqlash, bekor qilish) |
| `high` | Tugma + tasdiq oynasi (narx, qoldiq, DBS qaytarish) |

Model hech qachon yozish amalini o'zi bajarmaydi va tugma bosilmaganini bilib
turadi: unga "sotuvchi bosmagan, bajarildi dema" deb javob qaytariladi.

### 10.5. Panelga qadalgan javob

[`pins.ts`](../frontend/src/services/insights/pins.ts) — javob **qanday yozilgan
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

- **Qoidalar** ([`derive/insights.ts`](../frontend/src/services/derive/insights.ts))
  — kalitsiz, internetsiz, har doim ishlaydi.
- **Model** ([`ai.ts`](../frontend/src/services/insights/ai.ts)) — davrning
  ma'lumot digest'ini ([`digest.ts`](../frontend/src/services/insights/digest.ts))
  bitta prompt'da oladi va qoidalar topmagan topilmalarni yozadi. Model har bir
  **ma'lumot oynasi** uchun bir marta so'raladi (so'rov kalitida digest barmoq
  izi). Qayta mount yoki fokus kredit sarflamaydi.

### 10.7. Provayder transporti

[`services/ai/`](../core/src/ai/):

- **To'rt xil so'rov shakli:** Anthropic Messages, Google `generateContent`,
  OpenAI'ning o'z Responses API'si va qolgan olti provayder (OpenRouter,
  DeepSeek, Mistral, Grok, Ollama, `custom`) uchun OpenAI-mos
  `/chat/completions`.
  - **OpenAI — Responses API**
    ([`dialectFor`](../core/src/ai/stream.ts#L920)ning `openai`
    bo'limi — oqim; [`client.ts`](../core/src/ai/client.ts#L359) —
    bir martalik so'rov): ikkalasi ham `/v1/responses`ga, `store:false` bilan
    boradi — ilovada OpenAI uchun suhbat holatini saqlaydigan server yo'q.
    Fikrlash modeliga (`gpt-5*`, `gpt-6*`, `o1`/`o3`/`o4`) shuning uchun
    `include: ["reasoning.encrypted_content"]` so'raladi
    ([`openAiResponsesFields`](../core/src/ai/modelRules.ts#L453)):
    keyingi tool raundida faqat **shu fikrlash elementi**, chaqiruvdan oldin,
    qayta yuboriladi
    ([`openAiResponsesInput`](../core/src/ai/stream.ts#L495)), va
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
  ([`openAiCompatibleHeaders`](../core/src/ai/modelRules.ts#L613),
  [`anthropicHeaders`](../core/src/ai/modelRules.ts#L581)):

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
  ([`validReasoningEffort`](../core/src/ai/modelRules.ts#L337));
  karta menyusi va transport aynan shu tekshiruvdan o'qiydi, shuning uchun
  ular bir model uchun ikki xil javob berolmaydi.
- **Sarlavha xavfsizligi.** `fetch`ning `Headers`i bosiladigan ASCII'dan
  tashqari qiymatda `TypeError` otadi. Ixtiyoriy sarlavha (tashkilot, loyiha,
  atributsiya) xavfsiz bo'lmasa jimgina tashlab ketiladi; kalitning o'zi
  xavfsiz bo'lmasa esa so'rov hech qachon `fetch`ga yetmasdan `unauthorized`
  bilan rad etiladi
  ([`isHeaderSafe`](../core/src/ai/modelRules.ts#L557)).
- **`stream_options.include_usage`** faqat OpenRouter, DeepSeek va Ollama
  uchun so'raladi — uchalasi ham buni o'z hujjatida tasdiqlagan; Mistral esa
  oqimda usage umuman qaytarmasligini aytadi, shuning uchun undan so'ralmaydi
  ([`stream.ts`](../core/src/ai/stream.ts#L1041)). OpenAI bu
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
    ([`ai/usage.ts`](../core/src/ai/usage.ts#L127)) — bu chegara
    faqat Tinch okean yarim tunida ochiladi, har bir urinish esa bir xil rad
    javobini yana bir marta hisoblatib qo'yardi. Suhbat paneli bu holatda
    sababni va tiklanish vaqtini ko'rsatadi, **Davom ettirish** tugmasisiz
    ([`ui/chat/useCopilotAnswers.ts`](../core/src/ui/chat/useCopilotAnswers.ts#L39)).
  - **OpenAI Responses'ning o'z rad javoblari kod bo'yicha ajratiladi**
    ([`classifyOpenAiFailure`](../core/src/ai/modelRules.ts#L690)):
    `insufficient_quota` — `client`, takrorlanmaydi (hisobga pul qo'shish
    kerak, kutish emas); `rate_limit`/`quota` — `rateLimited`, oddiy qoida
    bo'yicha takrorlanadi; nomsiz yoki `server` so'zli kod — `server`,
    takrorlanadi. `response.incomplete` hech narsa (matn ham, chaqiruv ham)
    yozmasdan tugasa — odatda `max_output_tokens` fikrlashga sarflanib
    bo'lgani uchun — `client`/`incomplete` bilan rad etiladi va **hech
    qachon** takrorlanmaydi: bir xil so'rov bir xil devorga urilaveradi
    ([`openAiIncompleteError`](../core/src/ai/modelRules.ts#L661)).
    Sozlamalar paneli `incomplete` va `insufficient_quota` kodlarini o'z
    tiliga tarjima qilingan gap bilan ko'rsatadi
    ([`aiErrors.ts`](../core/src/ui/settings/aiErrors.ts#L49)).
  - **Insights paneli (rail)** modelning topilmalarini bitta ma'lumot oynasiga
    bitta marta so'raydi va muvaffaqiyatsizlikni **faqat bir marta**, shu ham
    `ApiError.isRetryable` `true` bo'lgandagina, qaytadan so'raydi — kunlik
    kvota, `insufficient_quota` va `incomplete` kabi qaytarilsa ham bir xil
    javob beradigan xatolarda emas
    ([`shouldRetryAiCards`](../frontend/src/services/queries/useInsightsQuery.ts#L155)).
- **Voqealar jurnali (ledger) — har bir provayder uchun, barchasi**
  ([`ai/usage.ts`](../core/src/ai/usage.ts)):
  - `stream.ts` va `client.ts` javob **olgan** har bir so'rov uchun — qaysi
    provayder bo'lishidan qat'i nazar (qayta urinishlar, suhbat, rail
    muallifi, Sozlamalardagi ulanish testi qo'shilgan) — bitta
    `ModelRequestEvent` yozadi: provayder aytgan xom kiruvchi (kesh bilan),
    kesh, chiquvchi va fikrlash tokenlari — hech qachon taxmin emas, noma'lum
    bo'lsa `null`. Javob kelmagan so'rov (tarmoq xatosi, timeout, bekor
    qilish) va kalit rad etilishi (`401`/`403`, `400 API_KEY_INVALID`)
    yozilmaydi — ular loyiha kvotasiga umuman tegmagan. Jurnal
    [`state/modelUsage.store.ts`](../core/src/state/modelUsage.store.ts)da
    IndexedDB `kv`ning `model_usage` yozuvida saqlanadi (26 soat, 5000
    tagacha —
    [`MAX_EVENTS`](../core/src/state/modelUsage.store.ts#L55)) va
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
    [`ui/settings/ModelPicker.tsx`](../core/src/ui/settings/ModelPicker.tsx)
    (model tanlashda) va
    [`ui/settings/ModelQuotaPanel.tsx`](../core/src/ui/settings/ModelQuotaPanel.tsx)
    (faqat Gemini kartasida, tanlangan model uchun uchta chiziq).
  - **Bugungi token sarfi — har bir provayder uchun, alohida-alohida.**
    [`summarizeTokens()`](../core/src/ai/usage.ts#L862) mahalliy
    yarim tundan beri shu provayderning voqealarini yig'adi: so'rovlar soni,
    kiruvchi/keshlangan/chiquvchi/fikrlash tokenlari — har biri necha so'rov
    buni aytgani bilan birga (provayder aytmagan raqam hech qachon nolga
    aylanmaydi, "aytilmagan" deb ko'rinadi), model bo'yicha taqsimot va oxirgi
    xabar bergan so'rov.
    [`ui/settings/TokenUsagePanel.tsx`](../core/src/ui/settings/TokenUsagePanel.tsx)
    buni har bir provayder kartasida chizadi.
- **Narx hisobi.**
  [`costOfTokens()`](../core/src/ai/pricing.ts#L166) o'sha
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
  ([`AiSection`](../core/src/types/settings.ts#L143)). Yozish ikki atom
  amal orqali boradi —
  [`updateAiConnection(provider, patch)`](../core/src/settings/settings.service.ts#L307)
  faqat nomlangan provayderning yozuvini o'zgartiradi,
  [`setActiveAiProvider(provider)`](../core/src/settings/settings.service.ts#L318)
  esa faqat ko'rsatkichni suradi — shuning uchun bitta kartaning tahriri
  boshqa provayderning yozuviga hech qachon tegmaydi. v4 → v5 migratsiyasi
  ([`settingsSchema.ts`](../core/src/settings/settingsSchema.ts#L348))
  ikki xil v4 shaklidan ham o'tadi: eski, umumiy maydonli shakldan va oraliq
  `saved` yon jadvalli shakldan — ikkalasi ham `version: 4` bilan yozilgan
  edi. **Dalil kuchsiz:** provayderlar orasidagi izolyatsiya avtomatlashtirilgan
  testlarda soxta kalitlar bilan tekshirilgan
  ([`aiConnections.test.ts`](../core/src/settings/aiConnections.test.ts)),
  haqiqiy ikkita kalit bilan qo'lda emas.
- **Chiqish tokenlari byudjeti — odatiy qiymat "Avto".** `maxTokens`
  ning saqlangan **belgisi**
  ([`MAX_TOKENS_BOUNDS.max`](../core/src/constants/settings.ts), 1 048 576)
  "Avto" degani — ilovaning muvozanatli byudjeti; modelning o'z maksimumi
  **emas** va so'rovga hech qachon o'zi ketmaydi
  ([`isAutoMaxTokens()`](../core/src/ai/modelRules.ts#L134)).
  So'rovga ketadigan sonni
  [`effectiveMaxTokens()`](../core/src/ai/modelRules.ts#L155) hisoblaydi
  va u oqim yo'lida ham, bir martalik `complete()` yo'lida ham, barcha
  dialektlar uchun bitta. "Avto" —
  [`balancedMaxTokens()`](../core/src/ai/modelRules.ts#L143):

  | Holat | Yuboriladigan son |
  |---|---|
  | "Avto", OpenAI, chegara ma'lum | `min(chegara, 16 384)` ([`AUTO_MAX_TOKENS_OPENAI`](../core/src/ai/modelRules.ts#L119)) |
  | "Avto", boshqa provayder, chegara ma'lum | `min(chegara, 32 000)` ([`AUTO_MAX_TOKENS_DEFAULT`](../core/src/ai/modelRules.ts#L131)) |
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
  [`OUTPUT_CEILINGS`](../core/src/ai/modelRules.ts#L84) jadvalida
  (fikrlash tokenlari hisobga kirgan): Gemini 3.x/2.5 Flash oilasi 65 536, GPT-6
  Astra/Sol/Luna 128 000, Claude Opus 5 / Sonnet 5 128 000 va Haiku 4.5 64 000,
  DeepSeek V4 Pro/Flash 393 216, Grok 4.7 128 000 (xAI chegara e'lon qilmaydi —
  bu uning hujjatlashtirilgan odatiy qiymati). Mistral, Grok 4.3, OpenRouter,
  Ollama, `custom` va boshqa har qanday id uchun chegara **noma'lum** — taxmin
  qilinmaydi. Karta
  ([`AiProviderCard.tsx`](../core/src/ui/settings/AiProviderCard.tsx#L111))
  har doim **haqiqatan yuboriladigan** sonni ko'rsatadi: "Avto"da uning yonida
  "avto" belgisi, aniq qiymat chegaraga teng bo'lsa "modelning maksimumi"
  belgisi; qiymat aniq bo'lganda "«Avto»ga qaytarish" tugmasi chiqadi; bitta
  izoh satri holatni aytadi ("Avto" / OpenAI'dagi "Avto" / chegara e'lon
  qilinmagan / aniq qiymat — oxirgisi neytral: bu sotuvchining o'z qiymati, "Avto"ga
  qaytish muvozanatli byudjetni qaytaradi); slayder yuboriladigan son va belgini
  `aria-valuetext` bilan ham aytadi. v5 → v6 migratsiyasi
  ([`settingsSchema.ts`](../core/src/settings/settingsSchema.ts#L397))
  saqlangan 4 096'ni "Avto"ga o'tkazadi: u tegilmagan eski odatiy qiymatdan
  farq qilmaydi; boshqa har qanday qiymat ongli tanlov sifatida saqlanadi
  (v3 → v4 yangilik muddatidagi mulohazaning o'zi). **Dalil kuchsiz:**
  chegaralar vendorlarning hujjat sahifalaridan
  ([`OUTPUT_CEILINGS_AS_OF`](../core/src/ai/modelRules.ts#L59) —
  2026-11-04) olingan, 16 384 va 32 000 byudjetlari esa hech bir jonli hisob
  bilan sinab ko'rilmagan — ikkalasi ham tanlangan boshlang'ich qiymat, o'lchangan
  natija emas.

---

## 11. Qurish va tekshirish

`frontend/` dan (sayt; `core/` shu yerdan tekshiriladi va sinaladi):

```bash
npm run dev        # Vite dev server, port 5173, CORS proxy bilan
npm run build      # tsc -b && vite build
npm run typecheck  # tsc -b --noEmit
npm run lint       # eslint . va eslint core/ (core-boundary qoidasi bilan)
npm test           # vitest run — frontend/src VA core/src testlari
npm run test:watch # vitest
```

`extension/` dan (14.2):

```bash
npm run build           # tsc -b && node scripts/build.mjs — ikkala nishon: dist/chromium, dist/firefox
npm run build:chromium  # faqat Chrome/Edge
npm run build:firefox   # faqat Firefox
npm run dev             # chromium, --watch: manba o'zgarganda dist/chromium qayta yoziladi (14.2)
npm run typecheck       # tsc -b --noEmit
npm run lint            # node scripts/guard.mjs && eslint .
npm test                # vitest run — extension/src va manifests/
```

`core/` ning o'z buyruqlari yo'q: u mezbonning tsc, eslint va Vitest'i orqali
o'tadi. Uning testlari **faqat `frontend/`dan** yuradi (kengaytmaning konfiguratsiyasi
ularni ikki marta hisobotga chiqarmaslik uchun qo'shmaydi).

**Chunk bo'linishi** ([vite.config.ts](../frontend/vite.config.ts)):
`vendor-markdown`, `vendor-react`, `vendor-query`, `vendor-motion`,
`vendor-forms` — yuqori paneldagi o'zgarish grafik bundle keshini buzmasligi
uchun. Tekshiruv modul nomida qism-satr bo'yicha, shuning uchun tartib muhim:
`vendor-markdown` `vendor-react` dan oldin turadi.

**Hozirgi holat (2026-11-13):**

| Paket | typecheck | lint | test | build |
|---|---|---|---|---|
| `frontend/` (`core/` bilan) | ✅ | ✅ | ✅ 690 ta (37 fayl, shundan `core/` testlari ham) | ✅ asosiy bundle 540 KB / gzip 177 KB |
| `extension/` | ✅ | ✅ (guard ham) | ✅ 358 ta (28 fayl) | ✅ ikkala nishon; panel ~957 KB, `content.js` ~21 KB |

Bu — avtomatlashtirilgan tekshiruv. Kengaytma bundan tashqari **Chrome 157 va
Edge 157'da ishga tushirib ko'rilgan**; Firefox, haqiqiy kabinet sessiyasi va
haqiqiy LLM kaliti bilan sinov qolgan (14.8).

**Ishlab chiqish jamoasi.** Loyiha ustida ishlaydigan agentlar tuzilmasi
[CLAUDE.md](../CLAUDE.md) va [`.claude/agents/`](../.claude/agents/) da:
- har bir prompt avval `orchestrator` ga tushadi
  ([`.claude/settings.json`](../.claude/settings.json));
- u vazifani papka egasi bo'lgan mutaxassisga beradi (API, saqlash, sync,
  hisob-kitob, so'rovlar, Copilot, UI, tooling, testlar, review, hujjatlar) va
  natijani yuqoridagi buyruqlar bilan tekshiradi.

**IndexedDB testlari** (`fake-indexeddb` bilan qo'lda o'tkazilgan):
- Sxema: 15 store yaratiladi, indekslar joyida, period indeksi do'konlarni
  aralashtirmaydi
- Upgrade: v1 baza ochilganda `records` o'chadi, 15 ta yangi store quriladi

**Avtomatlashtirilgan testlar** (Vitest, `vitest.config.ts`, node muhiti). Yo'l
`core/…` bilan boshlansa — `core/src/` ichida, qolganlari `frontend/src/services/`
ichida:

| Fayl | Nima qoplangan |
|---|---|
| `archive/coverage.test.ts` | Interval algebrasi — `normalize`, `missing`, `unseal`, `clip`, `chunk`. Eng xavfli joy: noto'g'ri qoplama = hech qachon to'lmaydigan teshik |
| `idb/aggregation.test.ts` | Worker arifmetikasi — bucket'lar, mahsulot bo'yicha foyda zanjiri |
| `core/tools/plaintext.test.ts` | Tool natijasi formati — sana chegaralari, `\|` bilan ajratilgan jadval, bo'sh katak, `\|` belgisi bo'lgan nom |
| `insights/datasets.test.ts` | Toolkit arifmetikasi — sotilmagan kunda nol, buyurtma bir marta sanaladi, bekor qilingan qator, mahsulotlar yonma-yon, sahifalash |
| `core/agent/figures.test.ts` | Qiymatni formatlash — so'm, foiz, son, satr, NaN o'rniga tire; ilova hisoblaydigan raqamlar — o'zgarish, ulush, reyting o'rni, taqqoslashdagi farq va yetakchi tomon |
| `core/agent/ndjson.test.ts` | Oqim parseri — rad etish sababi to'g'ri shoxdan, line/donut tekshiruvi, yozilayotgan jumla; yangi bloklarning wire qoidalari — rasm faqat `images.uzum.uz`dan, hosila raqamni yuborgan qator rad etiladi, `choice`da takror `label` va ikkita `recommended` |
| `core/agent/agent.test.ts` | Matnli protokol — direktivani o'qish, kesh kaliti; javob xulosasi (`summariseAnswer`) — hosila raqamlar, berilgan savol va uning variantlari, bekor qilingan savol |
| `insights/agent.loop.test.ts` | Suhbat sikli — rad etilgan qatorni bir marta qayta so'rash, noto'g'ri tugma parametri, ochilgan hujjatlar keyingi savolda, `copilot.ask` chip bo'lishi |
| `insights/actions.test.ts` | Registr darvozasi — noto'g'ri yozishni rad etish, pin filtri |
| `insights/pins.test.ts` | Saqlangan kartani o'qish — eski `ref`li kartalar tashlanadi; pin filtri `choice`ni ham tashlaydi |
| `core/ui/blocks/choiceState.test.ts` | Berilgan savolning holati — ochiq, kutmoqda, javob berilgan, o'z javobi, bekor qilingan; javobdagi birinchi savolni topish; klaviatura yurishi, raqam tugmalari, yozishni boshlash, tasodifiy bosishdan himoya |
| `core/ui/chat/history.test.ts` | Keyingi savol bilan yuboriladigan tarix — savol bir marta ketadi, tarix savoldan oldingi suhbat, bo'sh javob tashlanadi, bekor qilingan savol aytiladi |
| `insights/alerts.test.ts` | Qoidalar — imzo, sovish vaqti, har bir tur |
| `core/ai/jsonSchema.test.ts` | Zod → JSON Schema konvertatsiyasi — shu jumladan butun sonning istisno chegarasi qo'shni butun son bo'lib e'lon qilinishi (`positive()` → `minimum: 1`), kasr sonda `minimum: 0` qolishi, `exclusive*` kalitlari hech qachon chiqmasligi |
| `core/ai/stream.test.ts` | Qayta urinish qarori — qaysi xato takrorlanadi, `Retry-After`, chekinish oralig'i, kunlik (RPD) `429` hech qachon takrorlanmasligi; "Avto" har bir yozuv shaklida muvozanatli byudjetni beradi, belgi qiymatni esa hech qachon |
| `core/ai/usage.test.ts` | Kvota o'lchagichi — `readQuotaFailure`/`isKeyRejection`ning himoyalangan o'qishi, RPM/TPM/RPD gauge arifmetikasi, Tinch okean yarim tunining DST'dagi holati, `summarizeTokens` |
| `core/ai/client.test.ts` | OpenAI Responses'ning bir martalik javobi — `firstOpenAiResponsesText`, `usageOf` provayder bo'yicha, `incomplete`/`failed` klassifikatsiyasi |
| `core/ai/connection.test.ts` | Ulanish testi va model ro'yxati — CORS orqasidagi 401'ni tarmoq xatosidan ajratish, OpenAI'ning chat bo'lmagan modellarini filtrlash |
| `core/ai/pricing.test.ts` | Narx jadvali — eng uzun prefiks g'olib, kesh chegirmasi, GPT-6 narxlari |
| `core/ai/modelRules.test.ts` | Chiqish tokenlari chegaralari jadvali va `effectiveMaxTokens()`ning har bir shoxi ("Avto" — OpenAI/boshqa/noma'lum chegara, aniq qiymat — chegaragacha/noma'lum chegara) |
| `core/settings/settingsSchema.test.ts` | v4 → v5 migratsiyasi — ikkala eski v4 shaklidan ham (umumiy maydon, oraliq `saved` yon jadval) to'g'ri o'tish; v5 → v6 (4 096 → "Avto", boshqa qiymat saqlanadi), v4 → v6 zanjiri, v6 tegilmasligi |
| `core/settings/aiConnections.test.ts` | Provayderlar orasidagi izolyatsiya — bitta kartaning tahriri boshqa provayderning yozuviga tegmasligi |
| `core/state/modelUsage.store.test.ts` | Voqealar jurnali — restore va kelayotgan hodisa orasidagi poyga, `BroadcastChannel` orqali qo'shilish |
| `core/agent/session.test.ts` | Javob sessiyasi — to'xtagan joydan davom ettirish, ochilgan hujjatlar nusxasi |
| `queries/useInsightsQuery.test.ts` | Rail'ning AI so'rovi — digest barmoq izi bo'yicha kesh, muvaffaqiyatsizlikni faqat bir marta qayta so'rash |
| `insights/sitePrompt.test.ts` | Saytning modelga yuboradigan matni — system prompt, widget qo'llanmasi, toolkit hujjati, native tool e'lonlari snapshot bilan qotirilgan: ko'chirish bayt-baytiga o'zgartirmaganini isbotlaydi; yagona ataylab o'zgarish — 17 ta `minimum` qiymati (2.2-bo'lim) |
| `core/agent/actionRegistry.test.ts`, `core/agent/systemPrompt.test.ts` | Registr darvozasi va prototip nomlari; umumiy prompt quruvchisi mezbon qismlari bilan |
| `core/tools/createToolkit.test.ts` | Toolkit mexanizmi — asta-sekin ochish, xavfsiz nomlar, `constructor` nomli lookup, hujjat |
| `core/state/preferences.store.test.ts` | Preferences'ning almashtiriladigan saqlash joyi |
| `core/ui/blocks/*.test.ts`, `core/ui/settings/quotaText.test.ts`, `core/lib/format.test.ts`, `core/settings/settings.service.test.ts` | Jadval bloki, chizma geometriyasi, kvota matni, formatlash, sozlamalar servisi |

Kengaytmaning testlari (`extension/`, `npm test`) — 14.8-bo'limda.

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
| Uch til | `core/src/i18n/dictionary.ts` — kalit → [en, ru, uz] |
| Copilot haqiqiy ma'lumotdan javob beradi | Lookup'lar arxivdan ma'lumotning o'zini beradi (10.2); model hisoblaydi, bloklar qiymat + `format` bilan tekshirilib chiziladi (10.3); o'qilgan lookup `trace` bo'lib ko'rinadi |
| Chuqur tahlil | `data.rows` — xom qatorlar sahifalab; hisoblovchi lookup'lar arifmetikani kodda bajaradi |
| Model Uzum'ga yozmaydi | Yopiq amallar registri, xavf darajasi, tugma + tasdiq oynasi (10.4) |
| Provayder band bo'lsa davom ettirish | `RETRIES`, `Retry-After`, sessiya `checkpoint` dan davom etadi; kunlik (RPD) limitda takrorlanmaydi (10.1, 10.7) |
| Gemini modeli tanlanganda qolgan limitni bilish | `AI_PROVIDERS[…].limits` katalogi + so'ralgan har bir javobdan hisob (`ai/usage.ts`), model tanlash va "Qolgan limit" paneli (10.7) |
| Provayder almashtirilganda kalit boshqasiga o'tib ketmasligi | Sozlamalar sxemasi v6 — `AiSection.providers`, har biri mustaqil; `updateAiConnection`/`setActiveAiProvider` atom yozuvlari (10.7) |
| Sotuvchi bugungi token sarfini ko'rishi | `summarizeTokens()` va har bir provayder kartasidagi "Token sarfi" paneli, qo'lda kiritilgan narx jadvalidan taxminiy xarajat (10.7) |
| Javobni panelga qadash | Sana va davr bilan surat, "qayta so'rash" tugmasi (10.5) |
| Copilot sayt va kengaytmada bir xil ishlashi | Umumiy `core/`: yagona sikl, bloklar, transport, sozlamalar; farq — mezbon obyekti (`CopilotHost`, toolkit, registr, prompt qismlari) (1.4, 2.2) |
| Kengaytma: saytning o'ng pastida, 80% balandlikdagi ramka | Yopiq shadow root'dagi tugma va iframe, 433 px; ochiq holat `chrome.storage.local`da (14.3) |
| Kengaytma: faqat Copilot, sozlamalardan Umumiy, AI, Klaviatura | Panelda ikki ko'rinish — chat va sozlamalar; sozlamalar `core/src/ui/settings/` dagi umumiy bo'limlardan (14.7) |
| Kengaytma: AI ko'p raundli va tool bilan, ro'yxat o'sadi | Umumiy sikl + `EXT_TOOLS` registri; keyingi lookup — uch qadam (14.6) |
| Kengaytma: Copilot mahsulot ro'yxatini FBO/FBS qoldig'i, sotilgan/qaytarilgan, narx, holat va qidiruv bilan o'qiydi | `products.list`: yopiq marshrutning `filter`/`searchQuery` parametrlari (14.4), panel tomonidagi tolerant o'quvchi `readProductsPage`, ikki jadval (`view: products \| skus`) va sahifani javobning o'z jami soniga nisbatan joylash (14.6) |
| Kengaytma: Copilot do'konlar nomini, filtr bo'yicha mahsulot sonlarini, yetkazib berish nakladnoylarini, ombordan qaytarishlarni, shartnoma tugash sanasini va o'qilmagan bildirishnomalar sonini o'qiydi | Oltita lookup — `shops.list`, `products.stats`, `invoices.list`, `returns.list`, `contract.end`, `notifications.unread`: har biri yopiq jadvaldagi bitta marshrut; do'kon nomlamaydigan ("account") marshrutda faqat kirgan sessiya tekshiriladi (14.4); tanilgan javob nomlangan ustunlar bilan, tanilmagani shakldan mustaqil renderer bilan chiqadi (14.6) |
| Kengaytma: token faqat sotuvchi brauzerida | Token kontent skriptdan chiqmaydi; marshrutlar yopiq jadval; panel bilan faqat xususiy kanal va bir martalik nonce (14.4) |

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
  [ENDPOINTS.md](../frontend/src/services/uzum/ENDPOINTS.md), 12.3-bo'lim.

### 2. Kengaytma haqiqiy brauzerda qisman tekshirilgan — Firefox, haqiqiy sessiya va haqiqiy LLM kaliti qolgan
- **Qaysi joyda:** butun [`extension/`](../extension/).
- **Nima qilingan (2026-11-13):** `dist/chromium` Chrome 157.0.8103.39 va Edge
  157.0.4341.42 ga o'rnatilib, vaqtinchalik profil bilan, oynasiz (headless)
  rejimda, `seller.uzum.uz` ning **kirilmagan** bosh sahifasida avtomatik
  boshqarildi. Ikki tashqi tomon o'rnida mahalliy almashtirgich turdi: LLM —
  `127.0.0.1` dagi ssenariyli OpenAI-mos server (`custom` provayder, matn
  protokoli); kabinet API'sining javobi — repodagi niqoblangan namuna (so'rov
  brauzerda ushlab olinib, shu bilan javob berildi; soxta token Uzum'ga
  yuborilmadi). Nima o'tgani — 14.8 jadvalida.
- **Qo'shimcha (2026-11-16):** oltita yangi lookup xuddi shu usulda Chrome
  157.0.8103.52 va Edge 157.0.4341.60 da o'tkazildi, faqat bu safar kabinet
  sahifasining o'zi ham almashtirgich edi (`seller.uzum.uz` so'rovi brauzerda
  ushlanib, bo'sh sahifa bilan javob berildi) — Uzum'ga hech narsa ketmadi.
  Natija — 14.8 jadvalining oxirgi qatorlarida.
- **Hali brauzer yoki sotuvchining o'zi kerak bo'lgan savollar:**
  1. Firefox umuman: `dist/firefox` hech qayerga o'rnatilmagan; `content.fetch`
     (va `cloneInto`) ishlaydimi, yoki doim zaxira yo'l
     ([`withFallback`](../extension/src/uzum/bridge.content.ts#L241)) ishlaydi;
  2. haqiqiy sessiya: kabinetga kirilgan varaqda `localStorage.state` shakli
     bitta namunadagidek ekani; kirilgan sahifalar ham iframe'ga yo'l qo'yishi
     (CSP faqat kirilmagan bosh sahifada ko'rilgan); haqiqiy token bilan `GET`
     javobining CORS'dan o'tishi. Preflight tekshirilgan: tokensiz `OPTIONS`
     so'roviga server kabinet origin'ini, `GET` ni va `authorization` ni ruxsat
     etdi, brauzer esa preflight'da faqat `authorization` ni so'raydi. Kabinet
     yuboradigan, kengaytma yubormaydigan `access-content-allow-origin` so'rov
     header'i serverga kerakmi — faqat haqiqiy `GET` ko'rsatadi. Yaqin dalil
     (2026-11-16): kabinetning o'zi nakladnoylar so'rovini shu header'siz
     yuborgan va `200` olgan (API-REQUEST-RESPONSE.md, 5.B.10) — demak server
     uni hamma marshrutda talab qilmaydi, lekin bu kengaytma so'rovining o'zi emas;
  3. haqiqiy LLM kaliti: Gemini, Claude va OpenAI'ning tool API'li yo'li
     (sinovda faqat matn protokoli yurgan);
  4. Ctrl+J / ⌘J oynali brauzerda brauzerning o'z qisqa yo'lini bosib o'ta
     oladimi — oynasiz rejimda brauzer qisqa yo'llari yo'q;
  5. bfcache'dan qaytganda ramka yangi nonce bilan tiklanishi (14.3);
  6. maxsus AI manzili uchun `permissions.request` oynasi (14.7) — oynasiz
     rejimda so'rov oynasi chiqmaydi.
- **Nima uchun darhol xavfli emas:** kengaytma hech narsa yozmaydi. Eng yomon
  holat — ramka ko'rinmaydi yoki "kabinet javob bermadi" deydi.
- **Keyingi qadam:** kabinetga kirilgan varaqda, haqiqiy kalit bilan va oynali
  brauzerda qo'lda o'tish, Firefox'ni qo'shish, natijani 14.8 jadvaliga yozish.

### 3. Kabinet API'sining javoblari bir-ikki namunadan ma'lum
- **Qaysi joyda:** [`extension/src/uzum/products.ts`](../extension/src/uzum/products.ts)
  (o'quvchi), [`extension/src/tools/`](../extension/src/tools/) (jadvallar,
  maydon izohi) va [`routes.ts`](../extension/src/uzum/routes.ts) (parametrlar).
  Har lookup'ning shakli bitta javobdan yozilgan (`shops.list` — ikkitadan);
  shakl tanilmasa shakldan mustaqil renderer ishlaydi.
- **Oltita kichik lookup (2026-11-16):** dalili va ochiq savollari 14.6 dagi
  jadvalda va API-REQUEST-RESPONSE.md kartalarida (5.B.3, 5.B.5, 5.B.7, 5.B.9,
  5.B.10, 5.B.11). Eng zaifi — `notifications.unread`: so'rovning o'zi yozib olinmagan,
  faqat preflight'i. To'rtta ruxsat kodi (`PRODUCT_READ`, `INVOICE_READ`,
  `SELLER_RETURN_READ`, `SHOP_READ`) — kodning o'z farazi: server qaysi kodni so'rashi hech qayerda
  yozilmagan, shuning uchun faraz noto'g'ri bo'lsa kod ruxsatli so'rovni
  yubormasdan rad etadi. Quyidagi bandlar mahsulot ro'yxati haqida.
- **Dalil:** **ikki yozib olingan so'rov, bitta yozib olingan javob**, u ham
  qisqartirilgan: 24 qatorli sahifadan 1 mahsulot, 5 SKU
  ([ENDPOINTS.md](../frontend/src/services/uzum/ENDPOINTS.md), 13-bo'lim;
  [API-REQUEST-RESPONSE.md](./API-REQUEST-RESPONSE.md), 5.B.8). Maydonlar
  ro'yxati va jami son endi ma'lum; ochiq qolgani:
  `WITHOUT_REQUIRED_FILTERS` nimani tanlashi (5.B.9 dagi 22/38 — faqat taxmin),
  `size` ning 24 dan kattasi (kodda 100 gacha) va sahifa o'rni `page × size`
  ekani, `searchQuery` qanday moslashishi va jami son unga ergashishi,
  `price`/saqlash summalarining birligi, `conversion` formulasi, `rankInfo.rank`
  shkalasi, boshqa enum qiymatlari, tezlik chegarasi, `PRODUCT_READ` aynan shu
  marshrutga kerakligi.
- **Oqibati:** model sahifani javobning o'z `totalProductsAmount`iga nisbatan
  joylay oladi ("rows 1–24 of 38"), lekin birlikni (so'm) aytmaydi, `conversion`
  va `rank` ma'nosini taxmin qilmaydi va ro'yxatni to'liq deb aytmaydi.
  Nakladnoylarda ham shunday: `fullPrice` birliksiz, jami son yo'q, hech bir
  sahifa "oxirgi" deyilmaydi. Qaytarishlarda mahsulot, dona va summa umuman yo'q;
  pullik saqlashdan faqat ikki sana bor, shuning uchun model haq haqida gapirmaydi.
- **Keyingi qadam:** qo'shimcha javoblarni yozib olish — `size=100` va `page>0`,
  to'ldirilgan `searchQuery`, `filter=WITHOUT_REQUIRED_FILTERS`, ko'p mahsulotli
  sahifa; keyin o'quvchi va legendani shularga solishtirish. Faqat `null`
  ko'rilgan maydonlarning turlari (`products.ts`da faraz qilingan) shu yerda
  tekshiriladi. Sotuvchidan qo'shimcha namuna so'rash — API-REQUEST-RESPONSE.md
  "Ochiq savollar" ro'yxati bo'yicha.

### 4. Testlar bor, lekin saqlash qatlami qoplanmagan
Sof funksiyalar qoplandi (1 164 ta test: saytda 708 — 38 fayl, shundan `core/` testlari ham, kengaytmada 456 — 32 fayl): `coverage.ts` interval algebrasi,
Copilot protokoli, toolkit arifmetikasi, AI provayder transporti va
sozlamalar sxemasi. Qolgani: `archivePlan.ts`, `paginate()`, wire→row
mapperlar, `missingRanges()` va v2→v3 migratsiyasi. Bular IndexedDB talab
qiladi, shuning uchun `fake-indexeddb` qo'shilishi kerak.

### 5. Kod va OpenAPI hujjat orasidagi 8 ta ziddiyat
Namunalarda faqat GET so'rovlar yozilgan, shuning uchun POST va print
endpointlari tekshirilmagan. Eng shubhalilari — `fetchOrderLabel`,
`fetchBarcodeTypes`, `fetchSupplyAct`, `fetchAcceptanceAct`: spec to'g'ri bo'lsa,
kod `payload` o'rniga `payload.document` ni olishi kerak.

Tafsilot: [ENDPOINTS.md](../frontend/src/services/uzum/ENDPOINTS.md), 12.3-bo'lim.

### 6. FBS nakladnoy yaratish to'liq emas
`GET /v1/fbs/invoice/dop/drop-off-points` va `GET /v1/fbs/invoice/dop/time-slot`
ulanmagan — ularsiz `createFbsInvoice` uchun kerak bo'lgan UUID'larni olib
bo'lmaydi.

### 7. Gemini kvota o'lchagichining ikkita qoidasi haqiqiy namunada tekshirilmagan
- **Qaysi joyda:** `core/src/ai/usage.ts` — `readQuotaFailure` Gemini `429`
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

### 8. OpenAI Responses integratsiyasi haqiqiy kalit bilan hali sinalmagan
- **Qaysi joyda:** `core/src/ai/stream.ts` (`reduceOpenAiResponses`,
  `dialectFor`'ning `openai` bo'limi, `openAiResponsesInput`) va
  `core/src/ai/client.ts` (bir martalik so'rov) — butun yo'l OpenAI'ning
  hujjatlaridan qurilgan, faqat mock javoblar bilan test qilingan
  (`core/src/ai/stream.test.ts`, `core/src/ai/client.test.ts`).
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

### 9. Kengaytmada kabinet so'rovlari navbati har varaqda alohida
Kontent skriptning ketma-ket navbati bitta varaqqa tegishli: ikki kabinet
varag'i ikkita mustaqil navbat, ya'ni bir vaqtda ikkita so'rov bo'lishi mumkin,
va bir varaqdagi `429` kutishi ikkinchisini sekinlatmaydi. Varaqlararo
muvofiqlashtirish ataylab qurilmagan: kabinet API'sining chegarasi noma'lum
(ENDPOINTS.md, 13.5), o'lchanmagan chegara uchun murakkab mexanizm qurish erta. `429` real
ko'rinsa qayta ko'rib chiqiladi.

### 10. `backend/` bo'sh shablon
Agar jamoaviy ishlash yoki serverdagi zaxira kerak bo'lsa, arxitektura qarori
qaytadan ko'rib chiqilishi kerak.

### 11. Sozlamalar ikki varaq orasida hamon butun yacheyka bilan qayta yoziladi
`refreshSettings()` (14.7) eskirgan snapshot ehtimolini kamaytiradi, yo'q qilmaydi.
- **Qolgan cheklovlar:**
  1. eskirgan panel o'zgarish signali yetib kelguncha yozsa, hamon ustidan yozishi
     mumkin — buni yopish uchun yozishda maydon darajasidagi birlashtirish kerak;
  2. model sarfi jurnali (`model_usage` yacheykasi) hamon butun qiymatni varaqlar
     orasida ustidan yozadi — bu yerda faqat sarf statistikasi yo'qolishi mumkin;
  3. saytda ham ikki sayt varag'i orasida xuddi shu xavf bor va signal ulanmagan.
- **Nima uchun darhol xavfli emas:** eng og'ir oqibat — boshqa varaqda kiritilgan
  kalitni qayta kiritish; Uzum'ga yozish yo'q.
- **Keyingi qadam:** `persist`da maydon darajasidagi birlashtirish; keyin
  `model_usage` uchun ham.

---

## 14. Brauzer kengaytmasi

**Funksional talab** (funksional spetsifikatsiya, 5-bo'lim, "Brauzer kengaytmasi"):
sotuvchi Uzum kabinetida ishlayotganda o'sha saytning o'zida Copilot bilan
gaplashadi va u kabinet orqali do'konining mahsulot ro'yxatini, mahsulot sonlarini,
yetkazib berish nakladnoylarini, ombordan qaytarishlarni, do'konlar nomini, shartnoma tugash sanasini va
o'qilmagan bildirishnomalar sonini o'qiydi.

Kod: [`extension/`](../extension/). Umumiy dvigatel — [`core/`](../core/) (2.2);
bu bo'lim faqat kengaytmaning o'z qismi.

> **Holat va dalil kuchi.** Kengaytma Chrome 157 va Edge 157'da ishga tushirib
> ko'rilgan (2026-11-13), lekin kabinetga kirilmagan sahifada, ssenariyli LLM va
> niqoblangan namuna bilan; Firefox'da, haqiqiy sessiya va haqiqiy LLM kaliti
> bilan — yo'q (14.8). Kabinetning ichki API'si haqida bilganimiz yozib olingan
> trafikdan: mahsulot ro'yxati uchun ikki so'rov va bitta javob, qolgan olti
> marshrut uchun bittadan (do'konlar ro'yxati — ikkitadan) namuna
> ([ENDPOINTS.md](../frontend/src/services/uzum/ENDPOINTS.md), 13-bo'lim;
> [API-REQUEST-RESPONSE.md](./API-REQUEST-RESPONSE.md), 5.B). Quyida "ishlaydi" so'zi, 14.8 da brauzerda tekshirilgan deb
> ko'rsatilmagan joyda, "kodda shunday yozilgan" ma'nosida.

### 14.1. Tuzilma

```
        seller.uzum.uz (kabinet varag'i)                    chrome-extension://…/
┌───────────────────────────────────────────┐        ┌───────────────────────────┐
│ kontent skript (content.js, ~20 KB)       │        │ panel.html  (React, core) │
│   yopiq shadow root:                      │ iframe │   chat | sozlamalar       │
│     tugma + ramka ─────────────────────────┼───────▶│   Copilot sikli           │
│   ko'prik: token, so'rov, navbat          │◀──────▶│   LLM provayderga so'rov  │
│   localStorage.state (kabinet sessiyasi)  │ xususiy│                           │
└─────────────────┬─────────────────────────┘ port   └─────────────┬─────────────┘
                  │ Bearer token                                   │ sotuvchining
                  ▼                                                ▼ o'z kaliti
      https://api-seller.uzum.uz/api/seller/…              LLM provayder
```

**Nega panel iframe'da, kontent skript esa kichik.** Kontent skript kabinetning
har bir yuklanishida ishga tushadi — unga React, zod va chat tegmasligi kerak;
og'ir qism faqat tugma bosilganda yuklanadi. Iframe kengaytmaning o'z
origin'ida: kabinet sahifasining CSS'i va skriptlari panelga yetmaydi, panel
`script-src 'self'` siyosati ostida ishlaydi. Tokenni esa panelga **bermaslik**
kerak edi — shuning uchun so'rovni kontent skript bajaradi (14.4).

| Papka | Vazifa |
|---|---|
| `src/content/` | Tugma va ramka, ochiq holat, Ctrl+J, ramka ↔ panel xabarlari |
| `src/uzum/` | Sessiya o'quvchi, yopiq marshrut jadvali, navbat, ko'prikning ikki tomoni; panel tomonida `getProducts` javobining o'quvchisi (`products.ts`) va niqoblangan namuna `getProducts.response.masked.json` |
| `src/tools/` | Kengaytmaning toolkit'i — yettita lookup: `products.list`, `products.stats`, `invoices.list`, `returns.list`, `shops.list`, `contract.end`, `notifications.unread`; ular bo'lishadigan qismlar — `cabinet.ts` (muddat, do'kon tanlash, xato matni), `lookup.ts` (bitta so'rov va tanilmagan javob), `columns.ts` (nomlangan ustunlar), `render.ts` (shakldan mustaqil renderer) |
| `src/host/` | Prompt qismlari, amallar registri, `EXTENSION_TOOLKIT` |
| `src/storage/` | `chrome.storage.local` backend'i va preferences adapteri |
| `src/panel/` | Ishga tushish tartibi, chat va sozlamalar ko'rinishlari, bildirishnomalar |
| `manifests/`, `scripts/`, `_locales/` | Manifest generatori va ikonkalar (`manifests/icons/`), build va drift-guard, nomlar (uz, ru, en) |

### 14.2. Qurish va manifest

Bitta kod bazasi, ikki chiqish — `dist/chromium` (Chrome, Edge) va
`dist/firefox`. Ular **faqat manifestda** farq qiladi
([`manifests/manifest.mjs`](../extension/manifests/manifest.mjs)): Chrome
uchun `minimum_chrome_version: 102`, Firefox uchun `browser_specific_settings.gecko`
(`strict_min_version: 128.0` — `optional_host_permissions` shuni talab qiladi).
Firefox'ning add-on id'si barqaror nom, domen va'dasi emas: AMO'ga birinchi
yuklashdan oldin tasdiqlanishi kerak.

[`scripts/build.mjs`](../extension/scripts/build.mjs) har nishon uchun uch ish qiladi:
panelni Vite bilan quradi (`vite.config.ts`, ildiz `src/panel`, nisbiy yo'llar —
sahifa `chrome-extension://<id>/` dan beriladi), kontent skriptni **alohida**
Vite build bilan (`vite.content.config.ts`: bitta klassik IIFE fayl, import'siz —
ilova build'i buni kafolatlay olmaydi) va manifestni yozib, `_locales/` bilan
ikonkalarni (`manifests/icons/*.png` → `icons/`) ko'chiradi.
Papkani build o'zi bir marta bo'shatadi, chunki ikkala Vite build bitta
papkaga yozadi.

**Sahifa nomi.** Vite sahifani manba fayli nomi bilan (`index.html`) chiqaradi,
manifest va kontent skript esa uni `panel.html` deb biladi. Nom bundle ichida
almashtiriladi ([`emitAsPanelHtml`](../extension/vite.config.ts)), diskda emas.
Build'dan keyingi alohida "qayta nomlash" qadami `--watch` rejimida birinchi
build hali hech narsa yozmasidan ishga tushib, `ENOENT` bilan to'xtardi —
`npm run dev` umuman ishlamasdi — va qayta build'larda bajarilmasdi.

**`npm run dev` (`--watch`).** Jarayon ishlab turadi va manba o'zgarganda
`dist/chromium` ni qayta yozadi (har qayta build'da bir qator chiqaradi).
Brauzerni hech narsa qayta yuklamaydi: panel o'zgarishi kabinet varag'i qayta
yuklangach ko'rinadi, kontent skript yoki manifest o'zgarishi esa kengaytmaning
o'zi brauzerning kengaytmalar sahifasida qayta yuklangach (so'ng varaq ham).

**Ikonkalar.** `manifest.icons` — 16, 32, 48 va 128 px PNG
([`manifests/icons/`](../extension/manifests/icons/); manbasi shu yerdagi
`icon.svg` — ishga tushirish tugmasining belgisi va rangi). Ular brauzerning
kengaytmalar sahifasida va asboblar paneli menyusida ko'rinadi. `action` hamon
yo'q: ikonka hech narsa ochmaydi, Copilot faqat kabinet sahifasidagi tugma
orqali ochiladi.

**O'rnatish (ishlab chiquvchi rejimi).** Kengaytma do'konga chiqarilmagan;
qo'lda yuklanadi:

| Brauzer | Qadamlar |
|---|---|
| Chrome, Edge | `npm run build` → `chrome://extensions` (Edge'da `edge://extensions`) → "Developer mode" → "Load unpacked" → `extension/dist/chromium` papkasi |
| Firefox (128+) | `npm run build` → `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → `extension/dist/firefox/manifest.json`; brauzer yopilganda o'chadi. **Sinalmagan** (14.8) |

O'rnatilgandan (yoki kengaytma qayta yuklangandan) keyin ochiq turgan kabinet
varag'ini qayta yuklash kerak: brauzer kontent skriptni faqat yangi yuklangan
sahifalarga qo'yadi.

**Ruxsatlar — har birining sababi bilan:**

| Ruxsat | Nega |
|---|---|
| `permissions: ["storage"]` | Sozlamalar, kalitlar, ramka holati va nonce yozuvlari `chrome.storage.local`da |
| `host_permissions`: `https://api-seller.uzum.uz/*` | Kontent skript kabinet API'sini chaqiradi |
| `host_permissions`: 7 ta o'rnatilgan LLM provayder origin'i (OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Mistral, xAI) | Panel provayderga to'g'ridan-to'g'ri murojaat qiladi. Katalogga yangi provayder qo'shilsa va bu ro'yxatga qo'shilmasa, `guard.mjs` build'ni to'xtatadi |
| `optional_host_permissions`: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Sotuvchi o'zi kiritgan manzil (`custom`, Ollama) uchun — so'rov **ish vaqtida**, manzil bo'yicha. Ollama'ning loopback manzili ataylab majburiy ro'yxatda yo'q: ko'pchilik sotuvchi uni ishlatmaydi, ro'yxatda bo'lsa har o'rnatishda localhost ogohlantirishi chiqardi |
| `content_scripts`: `https://seller.uzum.uz/*`, `document_idle` | Tugma va ramka faqat kabinetda |
| `web_accessible_resources`: `panel.html`, `assets/*` — faqat `https://seller.uzum.uz/*` ga | Kabinet panelni iframe'ga olishi uchun; boshqa saytga ochilmaydi |

Boshqa host ruxsati yo'q. Inter shrifti kengaytma bilan birga paketlangan
(`@fontsource/inter`): masofaviy manbadan hech narsa yuklanmaydi.

### 14.3. Kontent skript: tugma va ramka

[`src/content/`](../extension/src/content/). Kabinetning har bir sahifasida
[`mount()`](../extension/src/content/mount.ts#L142) ikkita mezbon element qo'yadi:
tugma uchun `<savdo-copilot>`, ramka uchun `<savdo-copilot-frame>` (ikkinchi marta
qo'ymaydi — hujjat ildizidagi belgi bilan).

**Ko'rinishi.**

| Nima | Qiymat |
|---|---|
| Joyi | O'ng pastki burchak, `position: fixed` — kabinetning joylashuvi siljimaydi |
| Ramka o'lchami | 433 px kenglik (saytdagi Copilot paneli kengligi), ko'rinish balandligining **80%** (`dvh` qo'llab-quvvatlansa) |
| Tor ekran | 520 px dan tor oynada ramka butun kenglikka yaqin (chetidan 8 px) |
| Ochilganda | Tugma ramka tepasiga o'tib, kichik "yopish" tugmasiga aylanadi |
| Fokus | Faqat sotuvchining o'z harakatidan keyin; saqlangan holat sahifa yuklanganda fokusni olmaydi |

**Izolyatsiya.** Ikkala mezbonning har birida o'z shadow root'i bor, ikkalasi
`closed`: sahifa skriptlari iframe'ga va uning `contentWindow`iga yeta olmaydi.
Nonce hech bir URL, atribut, `id` yoki global o'zgaruvchida yo'q — u faqat kontent
skriptning xotirasida, extension storage'da va bitta handshake xabarida bo'ladi
(14.4). Host elementning o'z xossalari CSSOM orqali `!important` bilan qo'yiladi:
sahifaning tasodifan mos kelgan qoidasi `:host` qoidasidan kuchli bo'lardi, CSSOM
esa kabinetning `style-src` siyosatiga tushmaydi.

**Nega ikkita mezbon va yopiq root ichida animatsiya yo'q.**
`document.getAnimations()` ishlayotgan har bir transition'ni, shadow daraxtlar
bo'ylab ham, sahifaga beradi va har birining `effect.target`ini ko'rsatadi; yopiq
root ichidagi elementdan `getRootNode()` rootni qaytaradi, iframe esa bir so'rov
narida. Shuning uchun root ichida hech narsa animatsiya qilinmaydi: ramkaning
so'nishi ramka **mezbonining o'ziga** CSSOM orqali qo'yiladi (sahifa uni baribir
biladi, root'ini esa o'qiy olmaydi), tugmada transition umuman yo'q
([`mount.ts`](../extension/src/content/mount.ts), [`styles.ts`](../extension/src/content/styles.ts)
sarlavhalari). `getAnimations()` mezbon orqali haqiqatan ham hech narsa
ochmasligini faqat brauzer ko'rsatadi (14.8).

**Ochiq holat va tanlov.** Ikki kalit, `chrome.storage.local`da:
`savdo.ui.open` (ramka ochiqmi) va `savdo.ui.prefs` (oxirgi tema va til — tugma
panel yuklanmasdan ham to'g'ri rangda chiqishi uchun). Saqlash — qulaylik, qaramlik
emas: o'qish yoki yozish muvaffaqiyatsiz bo'lsa, tugma baribir ishlaydi. Faqat
bitta xato e'lon qilinadi — "Extension context invalidated" (kengaytma ochiq
varaq ostida qayta yuklangan): birinchi shunday xatoda hamma narsa olib tashlanadi
va skript to'xtaydi, o'lik tugma va konsol xatolari qolmaydi.

**Iframe — kechiktirilgan va ochilgandan keyin faqat yashiriladi.** U birinchi
ochilishda yaratiladi, keyin yopilganda ham sahifada qoladi: suhbat yopishdan va
kabinetning sahifalararo o'tishlaridan omon chiqadi.

**Yuklash tartibi — nonce avval yoziladi, URL keyin beriladi.** Har bir yuklash
([`navigator.ts`](../extension/src/content/navigator.ts#L26)):

```
nonce yasaladi (16 bayt, CSPRNG, hex)
   │
   ▼
registerFrameNonce()  ── extension storage'ga yoziladi (savdo.bridge.*)
   │  (kutiladi)
   ▼
iframe.src = panel.html?r=<n>                ← to'liq navigatsiya, har safar; URL'da nonce yo'q
   │
   ▼
`load`  ── kutilgan (biz boshlagan) ─▶ attachBridge(): xususiy port beriladi (14.4)
   │
   ▼
whenReady(5 s)  ── panel `ready` yubordi ─▶ ulandi
               └─ jim ─▶ "kutilmagan yuklash" kabi: yangi nonce, to'liq navigatsiya
```

Panel nonce yozuvini topa olmasa handshake'ni rad etadi (14.4), shuning uchun URL
yozuv tugamasdan berilsa, panel o'zining tekshiruviga poyga qilardi. Yangi
`navigate()` eskisini bekor qiladi: faqat eng so'nggisi URL beradi, eskilarining
yozuvlari o'zi eskirib ketadi. **Nega `?r=<n>`.** Har chaqiruvda query boshqacha,
shuning uchun brauzer buni hujjat ichidagi o'zgarish deb olmaydi: sahifa qayta
yuklanadi va `load` keladi — bir martalik nonce esa ikki marta handshake qila
olmaydi, demak har yuklash yangi nonce talab qiladi. **Nega URL'da nonce yo'q.**
Avval u hash'da edi; URL — nonce'ning sahifa skripti yetishi mumkin bo'lgan
yagona nusxasi edi (iframe elementi yoki resource-timing yozuvi orqali), extension
storage yozuvi esa ramkani kontent skript boshlaganini allaqachon isbotlaydi. URL
nusxasi isbotni kuchaytirmay, faqat ochiqlikni oshirardi.

**Kutilmagan `load`.** Nonce bir martalik, shuning uchun biz boshlamagan har bir
yuklash (panelning o'z "Qayta yuklash" tugmasi, sahifa skripti, brauzerning
tiklashi) eskirgan yoki begona nonce bilan keladi va hech qachon ulana olmaydi.
Davosi — yangi, yozilgan nonce va to'liq navigatsiya; shuning uchun
[`loadTracker.ts`](../extension/src/content/loadTracker.ts) har `load`ni baholaydi.
**Panel tasdig'i.** Ko'prik ulangandan keyin kontent skript panelning `ready`
xabarini kutadi ([`FrameBridge.whenReady`](../extension/src/uzum/bridge.content.ts),
`ACK_TIMEOUT_MS` = 5 soniya). Tasdiq kelmasa, ramkada biz boshlagan panel emas
(sahifa uni boshqa joyga olib ketgan yoki u ko'tarilmagan), shuning uchun bu
biz boshlamagan `load` bilan bir xil davolanadi: yangi yozilgan nonce, to'liq
navigatsiya, shu chegara ostida. 5 soniya sababi: panelning o'z "ulanmadi" xabari
~2 soniyada chiqadi, sog'lom panel shu paytgacha javob bergan bo'ladi; sekin
mashinada (paket parse qilinadi, tekshiruv storage'ni o'qib qayta yozadi) esa
zaxira qoladi. Hukmlar:

| Hukm | Qachon | Nima qilinadi |
|---|---|---|
| `expected` | `src` berilishidan oldin `expectLoad()` chaqirilgan | Ko'prik ulanadi |
| `unexpected` | Boshqa har qanday `load`; yoki ko'prik ulangan, lekin 5 soniyada `ready` kelmagan | Eski ko'prik yopiladi, yangi nonce bilan qayta yuklanadi |
| `inert` | 30 soniya ichida 3 tadan ortiq `unexpected` (tasdiqsiz qolganlari ham shu hisobga kiradi) | Qayta yuklash to'xtaydi; ramkada bitta jumla va "Qayta urinish" tugmasi — tugma hisobni tozalab, qaytadan boshlaydi |

**Nega chegara.** Yuklashga qarshi kurashayotgan narsa bor (sahifa skripti,
buzilgan panel) — tsiklda nonce yasayverish uni yaxshilamaydi, faqat
ko'paytiradi. Yozuv saqlashga yozilmasa (kontekst o'lgan) ham ramka "yuklanmadi"
holatiga o'tadi, jimgina hech narsa qilmaydigan tugma qolmaydi.

**bfcache.** `pagehide`da ko'prik yopiladi. Sahifa bfcache'dan qaytsa
(`pageshow`, `persisted`), eski port allaqachon o'lik, shuning uchun yangi nonce va
to'liq navigatsiya bilan yangi panel yuklanadi. Faqat ishonchli (`isTrusted`)
hodisalar hisobga olinadi — `pageshow`, `pagehide` va qisqa yo'l uchun ham:
sahifa skripti sun'iy `pageshow` yuborib keraksiz qayta yuklashni, sun'iy `pagehide`
yuborib esa ko'prikni yopdirib, panelni u ko'rmagan holatga tushirishi mumkin edi.

**Qisqa yo'l.** Ctrl+J yoki ⌘J — aynan bittasi Ctrl/⌘, Shift va Alt yo'q
([`shortcut.ts`](../extension/src/content/shortcut.ts)): Ctrl+Shift+J brauzerning
konsoli bo'lib qoladi. Fizik `KeyJ` ham qabul qilinadi (kirill terimida `key`
"j" emas). Hodisa capture bosqichida tutiladi va faqat `isTrusted` bo'lsa.
Iframe ichida fokus bo'lganda sahifa tugmani ko'rmaydi, shuning uchun panel
xuddi shu mos kelish qoidasini o'zi ham bog'laydi.

**Ramka ↔ panel xabarlari** ([`frameMessages.ts`](../extension/src/content/frameMessages.ts)):

| Yo'nalish | Xabar | Ma'nosi |
|---|---|---|
| panel → ramka | `frame.close`, `frame.toggle` | Panelning yopish tugmasi/Escape; panel ichida Ctrl+J |
| panel → ramka | `panel.prefs` `{theme, language}` | Tugma va ramka tanlovga mos bo'lsin; saqlanadi |
| ramka → panel | `frame.visibility` `{open}` | Har o'zgarishdan keyin va panel ulanganda bir marta |

Har bir kiruvchi xabar qabul qiluvchi tomonidan shakli bo'yicha tekshiriladi
(`frameProtocol.ts`, panelda `frame.ts`); shakli mos kelmagani e'tiborsiz qoladi.

### 14.4. Ko'prik: sessiya, so'rovlar, handshake

[`src/uzum/`](../extension/src/uzum/). Kontent skriptga kiradigan fayllar
(`protocol`, `queue`, `routes`, `session`, `bridge.content`) faqat shu
ro'yxatdagi o'zaro qardosh fayllarni import qiladi — kontent skript bitta kichik fayl bo'lib qolishi kerak (zod, axios,
React yo'q). Shu papkadagi [`products.ts`](../extension/src/uzum/products.ts) esa **faqat panel
tomonida**: u zod ishlatadi, shuning uchun kontent skript to'plamiga hech qachon kirmaydi.

**Sessiya.** Kontent skript kabinet `localStorage`ining `state` kalitini o'qiydi
([`parseCabinetState`](../extension/src/uzum/session.ts#L72)); shakl — bitta namunadan
(ENDPOINTS.md, 13.4). O'qib bo'lmaydigan har narsa — kalit yo'q, buzuq JSON,
`user` yo'q, yaroqli token yo'q — "kirmagan" deb olinadi: bu xavfsiz javob, chunki
tokensiz har bir so'rov baribir rad etilardi. Token har so'rovdan **oldin**
yangidan o'qiladi: kabinet yangilagan token qayta yuklashsiz ishlatiladi.
`accessExpiration` o'qilmaydi (birligi noma'lum): eskirgan token API'dan `401`
bo'lib ko'rinadi — bu halol signal. Panelga faqat `SellerSession` beriladi
(kirgan-kirmagani, do'kon id'lari, ekrandagi do'kon, `sellerId`, `accountId`,
ruxsat kodlari); token unga umuman tushmaydi.

**So'rov.** Panel marshrut id'si va parametr yuboradi; URL'ni kontent skript
**o'zi** yasaydi:

```
panel: {route:'products.list', params:{shopId,page,size,filter?,searchQuery?}}
   │ xususiy port
   ▼
kontent skript:  marshrut id jadvalda bormi → usul GET → params qat'iy tekshiruv
   → token bormi
   → do'kon marshruti bo'lsa: do'kon sessiyada va ruxsat kodi bormi
   → URL = jadvaldan, toApiUrl(): '/api/' bilan boshlanishi va origin shu API ekani
   → navbat (ketma-ket) → fetch(Bearer token, credentials:'omit')
```

**Marshrutlar** ([`UZUM_ROUTES`](../extension/src/uzum/routes.ts#L353)). Ikki tur:
**do'kon** marshruti (`scope: 'shop'`) bitta do'kon haqida — do'kon sotuvchiniki
bo'lmasa yoki unda marshrutning ruxsat kodi bo'lmasa, so'rov yuborilmasdan rad
etiladi; **account** marshruti (`scope: 'account'`) hech bir do'konni nomlamaydi
(do'konlar ro'yxatining o'zi, bildirishnoma sanog'i), shuning uchun tekshiradigan
do'kon yo'q va faqat kirgan sessiya talab qilinadi. Token baribir faqat jadval
yasagan URL'ga ketadi — bu ikkala turda bir xil.

| Marshrut id | Yo'l | Tur · ruxsat kodi | Parametrlar | Yozib olingan so'rov |
|---|---|---|---|---|
| `products.list` | `/api/seller/shop/{shopId}/product/getProducts` | do'kon · `PRODUCT_READ` | pastdagi jadval | ikkita |
| `products.stats` | `/api/seller/shop/{shopId}/product/products-statistic` | do'kon · `PRODUCT_READ` | `shopId` | bitta, parametrsiz |
| `invoices.list` | `/api/seller/shop/{shopId}/invoice?page&size` | do'kon · `INVOICE_READ` | `shopId`, `page` `0…100 000`, `size` `1…100` | bitta, `page=0&size=20` |
| `returns.list` | `/api/seller/shop/{shopId}/return?page&size` | do'kon · `SELLER_RETURN_READ` | `shopId`, `page` `0…100 000`, `size` `1…100` | bitta, `page=0&size=20` |
| `shops.list` | `/api/seller/shop/` (oxiridagi `/` yozib olinganidek) | account | yo'q | ikkita |
| `contract.end` | `/api/seller/committent/contract/end-date?shopId` | do'kon · `SHOP_READ` | `shopId` (query'da, yo'lda emas) | bitta |
| `notifications.unread` | `/api/v1/seller/notification/unread-count` | account | yo'q | **yo'q** — faqat preflight'i |

Ruxsat kodlari — jadvalning o'z qo'riqchisi, server haqidagi gap emas: API qaysi
kodni so'rashi hech qayerda yozilmagan, kodlar o'z nomidan o'qilgan
(`PRODUCT_READ` — mahsulot marshruti uchun). Shartnoma nomli kod yo'q,
`SHOP_READ` — eng yaqini va bizning tanlov. `invoices.list` va `returns.list` da holat, sana yoki
saralash parametri **yo'q**: yozib olingan so'rovlar faqat `page` va `size`
yuborgan, uchinchisini o'ylab topish — nima qaytarishi noma'lum so'rovni yuborish
bo'lardi. Account marshruti hech qanday kalitni qabul qilmaydi — `shopId` ni ham.

**`products.list` parametrlari**
([`routes.ts`](../extension/src/uzum/routes.ts#L164)). Qat'iy tekshiruv: noma'lum
kalit rad etiladi (e'tiborsiz qoldirilgan kalit chaqiruvchiga ishlayotgan filtrdek
ko'rinardi), butun son bo'lmagan qiymat rad etiladi.

| Parametr | Qoida | Nega |
|---|---|---|
| `shopId` | musbat butun son | yo'lga kiradi; do'kon sessiyada va ruxsat kodi bor-yo'qligi alohida tekshiriladi |
| `page` / `size` | `0…100 000` / `1…100` | chegaralar — bizning shartnoma, hech bir javob ko'rsatmagan (ENDPOINTS.md, 13.3) |
| `filter` | yopiq ro'yxat `ALL`, `WITHOUT_REQUIRED_FILTERS`; berilmasa `ALL` | faqat yozib olingan ikki qiymat; uchinchisini o'ylab topish — nimani tanlashi noma'lum so'rovni yuborish bo'lardi |
| `searchQuery` | erkin matn: boshqaruv belgisi rad etiladi (kesishdan **oldin**), keyin `trim`, ko'pi bilan `PRODUCTS_SEARCH_MAX_LENGTH` = 100 belgi; berilmasa bo'sh | `trim` oxiridagi qator uzilishini jimgina yutib yuborardi — matn yozib kiritilmagani yashirinardi. 100 — bizning chegara |
| `sortBy`, `order` | parametr emas: doim `id`, `descending` | yozib olingan yagona qiymatlar; qolganini model tanlamaydi |

Erkin matn tokenni boshqa manzilga yo'naltira olmaydi: u faqat `URLSearchParams`
orqali **query qiymati** bo'lib kiradi — yo'lga va origin'ga yetmaydi, qolgan
zanjir (jadval → `toApiUrl`) o'zgarmagan. Parametr tartibi yozib olingan B
so'roviniki (`page, size, filter, sortBy, searchQuery, order`).

**Panel tomonidagi o'quvchi** ([`readProductsPage`](../extension/src/uzum/products.ts#L461)).
Yagona yozib olingan javobning shaklini o'qiydi: `productList` massivi, har
mahsulot va SKU, jami `totalProductsAmount`. Har yozuvni **ikki ko'rinishda** beradi:
`raw` — javobdagidek (lookup shuni chiqaradi) va `fields` — yozib olingan namunadagi
turga mos tiplangan ko'rinish, faqat mantiq uchun. Namunadagi turga mos kelmagan
maydon `fields`da yo'q bo'ladi va yo'li `mistyped` ro'yxatiga tushadi (ko'pi
bilan 50 yo'l), obyekt bo'lmagan mahsulot/SKU yozuvlari sanaladi (`unreadableProducts`,
`unreadableSkus`), noma'lum maydon `raw`da qoladi. Har maydon ixtiyoriy va `null`ga
ruxsat — bitta javob qaysi maydon doim borligini ko'rsata olmaydi. **Nega ikki
ko'rinish:** turi mos kelmagan qiymat `null`ga aylansa, model "API bermadi" deb
o'qirdi, API esa bergan edi. O'quvchi hech qachon xato tashlamaydi va **hech narsa
hisoblamaydi** — yig'indi ham, birlik ham yo'q: nimani ko'rsatish lookup'ning ishi.
`productList` massivi bo'lmasa `null` qaytadi (lookup shakldan mustaqil rendererga
o'tadi). Fayl sarlavhasi dalilni aytadi; sinov namunasi — shu javobning niqoblangan
nusxasi [`getProducts.response.masked.json`](../extension/src/uzum/getProducts.response.masked.json),
[`products.test.ts`](../extension/src/uzum/products.test.ts) uni o'qiydi.

**Nega yopiq jadval.** Token faqat [`routes.ts`](../extension/src/uzum/routes.ts#L353)
yasay oladigan URL'ga ketadi. Buzilgan panel yoki prompt-injection ta'sirida
model tokenni ixtiyoriy manzilga yo'naltira olmaydi: undan faqat jadvaldagi id'ni
nomlash mumkin. Yangi marshrut — `UzumRouteParamsMap`ga bitta kalit va
`UZUM_ROUTES`ga bitta yozuv; kompilyator ikkalasisiz rad etadi.

Tokenni nima ushlab turadi: u hech bir xabar shaklida yo'q (so'rov — marshrut va
parametr, natija — JSON yoki sinflangan xato, sessiya ko'rinishi tokensiz
quriladi; kontent tomoni yuboradigan har bir xabar uchun test buni qotiradi);
xato matnida va logda ham yo'q, xato tanasi iqtibos qilinmaydi.

**Navbat** ([`queue.ts`](../extension/src/uzum/queue.ts)). Saytning `api/rateLimit.ts`
i — Uzum OpenAPI'ning sarlavha asosidagi pacer'i — kabinet API'siga qarshi hech
qachon sinalmagan va uning chegarasi noma'lum (ENDPOINTS.md, 13.5). Shuning uchun
kengaytma byudjet o'ylab chiqarmaydi: so'rovlar qat'iy bittadan, 400 ms oraliq
bilan; `429` butun navbatni `Retry-After` (yoki 2 s dan 60 s gacha o'sib boruvchi
kutish — qaysi biri katta bo'lsa, ko'pi bilan 10 daqiqa) ushlab turadi. Hech narsa
o'zi qayta urinilmaydi: rad etilgan so'rov chaqiruvchiga xato bo'lib qaytadi va
sarflash-sarflamaslikni u hal qiladi. Har so'rovga 30 soniya vaqt. Navbat bitta
varaqqa tegishli (13-bo'lim, texnik qarz, 9-band).

**So'rov usuli.** So'rov sahifada, kabinetning o'z so'rovi kabi chiqadi — sahifa
origin'i va serverning mavjud CORS qoidasi bilan, cookie'siz (`credentials: 'omit'`).
Firefox'da `content.fetch` bor bo'lsa shu ishlatiladi; u Xray chegarasida
tarmoq uzilishidan farqlab bo'lmaydigan tarzda yiqilishi mumkin, shuning uchun
yiqilsa bir marta keyingi usulga o'tiladi va HTTP javob bergan birinchi usul
sahifa oxirigacha eslab qolinadi
([`withFallback`](../extension/src/uzum/bridge.content.ts#L241)). Bahosi — haqiqiy
uzilishda bitta takroriy GET. **Brauzerda tekshirilmagan** (14.8).

**Xatolar.** Faqat HTTP holati bo'yicha sinflanadi: `401` → `unauthorized`, `403` →
`forbidden`, `404` → `notFound`, `429` → `rateLimited`, `5xx` → `server`, qolgan
`4xx` → `client`; JSON bo'lmagan `200` tanasi — `server`; tarmoq —
`network`; vaqt — `timeout`. Panel ularni Copilot'ning mavjud xato qayta
ishlashi tushunadigan `ApiError`ga aylantiradi.

**Yopilgan ko'prik — alohida holat.** Kontent tomoni xayrlashgandan keyin
([`client.ts`](../extension/src/uzum/client.ts)) har bir chaqiruv `code` =
`BRIDGE_CLOSED` bilan rad etiladi, `unconfigured` bilan emas. Nega: panel bir
vaqtlar ulangan edi va ulanish yo'qolgan — "panel kabinet ichida ishlamayapti"
deyish haqiqatga to'g'ri kelmasdi, sotuvchiga esa boshqa davo (qayta yuklash)
kerak. Chaqiruvchilar buni kod bo'yicha ajratadi, `kind` bo'yicha emas
(14.7). Lookup'lar uchun yana bir qoida bor: Uzum API haqida faqat HTTP holatli
javob haqiqatan kelganda gapiriladi; kengaytmaning o'zi mahalliy rad etgan
so'rov haqida matn "so'rov yuborilmadi" va sababini aytadi (14.6;
ENDPOINTS.md, 13.6).

**Handshake — panelni kim boshqarishi mumkin.** `panel.html` kabinetga ochiq
(web-accessible), Chromium'da kengaytma id'si esa oshkora. Demak sahifada
ishlayotgan har qanday skript (XSS, buzilgan uchinchi tomon skripti) o'zining
`<iframe src=".../panel.html">`ini yasab, unga handshake yuborishi mumkin. Handshake'ning
o'zi "ramkani kontent skript boshlagan" ni isbotlamaydi. Yetishmagan dalil sahifa
skripti yoza olmaydigan kanaldan keladi — extension storage'dan. Panel o'z URL'ini
umuman o'qimaydi: nonce hech bir URL'da yo'q, u faqat kontent skriptning xotirasida,
`savdo.bridge.*` yozuvida va bitta handshake xabarida bo'ladi.

| Qadam | Kim | Nima |
|---|---|---|
| 1 | kontent skript | Nonce'ni `savdo.bridge.n.<nonce>` ga (yozilgan vaqt bilan) va `savdo.bridge.index`ga yozadi, **kutadi**, keyin ramkaga URL beradi |
| 2 | kontent skript | Ramka `load`idan keyin `MessageChannel` yasaydi; bitta `postMessage` bilan `{savdo: tag, nonce}` va `port2`ni **faqat kengaytma origin'iga** yuboradi |
| 3 | panel | Xabarni faqat **ota oynadan** (`event.source === window.parent`), tag bilan va to'g'ri shakldagi nonce bilan nomzod sifatida navbatga qo'yadi |
| 4 | panel | Nomzodlarni kelish tartibida, bir o'qishda ko'pi bilan 64 tadan to'plamlab tekshiradi: nonce extension storage'da bormi, yoshi 2 daqiqadan oshmaganmi. Tartib bo'yicha birinchi mos kelgani **bir marta** qabul qilinadi va **o'sha qabul bilan o'chiriladi** — qayta ishlatib bo'lmaydi |
| 5 | panel | Qolgan nomzodlarning portlari yopiladi. Soxta nomzod haqiqiyni kechiktirishi mumkin (uning oldidagi to'plamlar qadar), lekin to'sa olmaydi yoki almashtira olmaydi: nomzodlar soni qirqilmaydi, chunki qirqish haqiqiyni to'ldiruvchidan ajratolmaydi |
| 6 | panel | Qabuldan keyin portga `ready` yuboradi; kontent skript uni 5 soniya kutadi (14.3) |

Shundan keyin butun trafik xususiy port orqali: panel → `ready`, `request`, `abort`,
`session`, `app`; kontent → `response`, `session`, `app`, `bye` (kontent tomoni
ketmoqda — kutayotgan chaqiruvlarga javob kelmaydi, ular `BRIDGE_CLOSED` bilan rad etiladi). Panel `session` uchun 10
soniya kutadi; `request` uchun kutish yo'q — navbat `429`dan keyin daqiqalarga
ushlashi mumkin, chegara — chaqiruvchining o'z signali.

**Nima himoyalanadi, nima yo'q.** Himoya — sahifa skripti **panelni** o'zi
boshqarishidan: sotuvchining o'z kalitida ishlaydigan modelga soxta kabinet
ma'lumoti yoki prompt-injection matni yuborishdan, sotuvchi haqiqiyidan ajrata
olmaydigan ramka ichida. Himoya **tokenni** saqlamaydi: sahifaning o'zi uni
`localStorage`da ko'radi. Va to'liq isbot emas: sahifa haqiqiy handshake'dan oldin
haqiqiy nonce'ni bilib qolmasligi (u hech bir URL'da yo'q; iframe yopiq shadow
root'da) — ishonch, isbot emas; "o'qi-keyin-o'chir" kengaytma kontekstlari
orasida atomar emas. Yozuv tuzilishi: har nonce uchun bitta kalit va bitta indeks
kalit, shunda tozalash butun saqlashni (provayder kalitlari ham shu yerda)
ro'yxatlamaydi.

### 14.5. Saqlash

[`src/storage/`](../extension/src/storage/). Hammasi `chrome.storage.local`da
(Firefox'da `browser.storage` birinchi), IndexedDB va `localStorage`da emas.

**Nega.** Panel — kengaytma sahifasi, `seller.uzum.uz` ichidagi iframe'da. U
yerda IndexedDB va `localStorage` kengaytma va yuqori darajadagi sayt bo'yicha
bo'lib qo'yiladi (partitsiya) va butunlay bloklanishi mumkin.
`chrome.storage.local` esa bo'linmaydi va barcha varaqlar uchun umumiy: tema,
sozlamalar va provayder kalitlari varaqlar va qayta ishga tushirishdan omon
chiqadi.

| Kalit | Nima | Kim |
|---|---|---|
| `savdo.kv.settings`, `savdo.kv.model_usage` | Umumiy `kv` portining ikki yacheykasi (STORAGE.md, `kv`). `core/` kalit satrlari o'zgarmagan, faqat prefiks qo'shilgan | [`chromeStorageKvBackend`](../extension/src/storage/chromeStorageKv.ts#L78) |
| `savdo.preferences` | Tema, til, raqam formati — zustand store'ning o'z JSON satri, prefikssiz | [`createChromePreferencesStorage`](../extension/src/storage/chromePreferences.ts#L43) |
| `savdo.ui.open`, `savdo.ui.prefs` | Ramka holati (14.3) | kontent skript |
| `savdo.bridge.n.<nonce>`, `savdo.bridge.index` | Handshake yozuvlari, 2 daqiqa (14.4) | kontent skript yozadi, panel o'chiradi |

Hech narsa IndexedDB'ga yozilmaydi: kengaytmada arxiv, qamrov va sync **yo'q**.

Backend har chaqiruvda hal qilinadi, import paytida emas (test va Firefox uchun).
API yo'q bo'lsa (panel HTML'i dev serverdan ochilgan) chaqiruvlar rad etiladi va
sozlamalar servisi buni "xotiradagi sessiya" deb oladi. Preferences adapteri
**boshqa varaq** o'zgartirganini eshitadi (`watch`) va qayta o'qiydi; o'zining
yozuvi hodisasini qiymati bo'yicha tanib o'tkazib yuboradi, shunda o'zgarish
varaq va uning saqlashi orasida aylanib yurmaydi. Sozlamalar
(`savdo.kv.settings`) uchun xuddi shunday kuzatuv alohida: har kabinet varag'ida o'z
paneli va o'z snapshot'i bor, saqlash esa butun yacheykani qayta yozadi — eskirgan
panel istalgan maydonni saqlasa, boshqa varaqda kiritilgan API kalitini o'chirib
yuborardi. Shu sabab panel `refreshSettings()` ni chaqiradi (14.7); qolgan
cheklovlar — 13-bo'lim, 11-band. Dev uchun
`localStorage` backend'i bor, lekin u faqat aniq tanlanadi — o'rnatilgan
kengaytma jimgina boshqa panellar ko'rmaydigan saqlashga tushib qolmasligi uchun.

### 14.6. Toolkit va mezbon

**Toolkit** ([`src/tools/`](../extension/src/tools/)) — kengaytma nimani o'qiy
oladi. Yettita lookup, har biri yopiq jadvaldagi bitta marshrut (14.4):
**`products.list`** — eng kattasi, pastda batafsil — va oltita kichigi. Ular umumiy
[`createToolkit`](../core/src/tools/createToolkit.ts) orqali yig'iladi, shuning
uchun toolkit hujjati va native tool e'lonlari bir registrdan keladi
([`EXT_TOOLS`](../extension/src/tools/index.ts#L44)).

**Oltita kichik lookup.** Har biri — bitta jonli so'rov; do'konni tanlash, muddat va
xato matni `products.list` niki bilan bir xil (pastdagi jadval), faqat `shops.list`
va `notifications.unread` do'kon so'ramaydi: ular butun akkaunt haqida, shuning uchun
bir nechta do'konli sotuvchida ham "qaysi do'kon?" deb to'xtamaydi va natijada
`askedShopId` ustuni yo'q.

| Lookup | Argumentlar | Tanilgan javob | Natija | Dalil |
|---|---|---|---|---|
| `products.stats` | `{shopId?}` | `statisticResultList` massivli obyekt | `askedShopId\|type\|count\|shopId` jadvali; birliklar satri har safar "turlar kesishadi, qo'shma" deydi | 1 javob: sakkiz hisoblagich, `IN_STOCK + OUT_OF_STOCK + ARCHIVED = 36`, `ALL = 38` |
| `invoices.list` | `{shopId?, page? (0 dan), size? (1–100, standart 20)}` | massiv | Nakladnoy qatori — pastda | 1 javob: 20 qatorli to'liq sahifa, bitta do'kon, bitta ombor, ikki holat |
| `returns.list` | `{shopId?, page? (0 dan), size? (1–100, standart 20)}` | `payload` massivli obyekt | Qaytarish qatori — pastda | 1 javob: 20 qatorli to'liq sahifa, bitta do'kon, bitta ombor, bitta holat, ikki tur |
| `shops.list` | `{}` | massiv | `id`, `shopTitle`, `shortTitle`, `urlTitle`, `skuTitle`, `transferred`, `shopDescription`, `description.uz`, `description.ru` (matnlar 80 belgigacha). Sarlavha ro'yxat bilan sessiya do'konlari farq qilsa aytadi | 2 javob, 3 kun oralig'ida, o'sha ikki do'kon |
| `contract.end` | `{shopId?}` | `payload` kalitli obyekt | `askedShopId=… payload=… timestamp=…`; `payload: null` bo'lsa sarlavha "sana aytilmagan" deydi | 1 javob; bu shartnomaning **tugash** sanasi ekani yo'l nomidan o'qilgan |
| `notifications.unread` | `{}` | `unreadCount` kalitli obyekt | `unreadCount=…`; `null` — "son aytilmagan", nol emas | so'rovning o'zi yozib olinmagan, faqat unga javob deb berilgan tana |

`invoices.list` ustunlari ([`invoicesList.ts`](../extension/src/tools/invoicesList.ts)):
`askedShopId`, `id`, `invoiceNumber`, `dateCreated`, `invoiceStatus.value`, `status`,
`fullPrice`, `totalToStock`, `totalAccepted`, `hasIssue`, `dateAccepted`,
`expressAcceptanceDate`, `timeSlotReservation.timeFrom` / `.timeTo` (to'rttasining
har biri yonida `.utc` ustuni), `timeSlotReservation.status`,
`timeSlotReservation.timeSlots.length`, `stock.id`, `stock.title`,
`remainingAmountOfUpdates`, `invoiceEttn.warningFlag`, `invoiceEttn.ettn`,
`externalNumber`, `deliveryCertificate`, `fines.length`, `createdInvoiceCount`.
**Nega nomlangan ustunlar:** holat kodi, band qilingan vaqt va ombor ichma-ich
obyektlarda turadi, shakldan mustaqil renderer esa ularni `{text,color,value}`
shaklida qisqartirardi — savol aynan shu maydon haqida bo'ladi. Ombor obyekti 20
qatorning hammasida bir xil edi, shuning uchun qatorda faqat `id` va nomi chiqadi
(manzil va ish vaqti yigirma marta takrorlanardi). Javobda jami son yo'q:
sarlavha sahifani faqat bir sahifadan so'zlaydi va hech birini "oxirgi" demaydi
(`products.list` ning jami sonsiz holatidagi so'zlar bilan).

`returns.list` ustunlari ([`returnsList.ts`](../extension/src/tools/returnsList.ts)):
`askedShopId`, `id`, `type`, `status`, `dateCreated`, `assembledDate`, `executionDate`,
`completedDate`, `canceledDate`, `paidStorage.status`, `paidStorage.startDate` / `.endDate`,
`timeSlotReservation.timeFrom` / `.timeTo` (to'qqizta vaqt maydonining har biri yonida `.utc`
ustuni), `timeSlotReservation.status`, `stock.id`, `stock.title`, `externalNumber`,
`ettnInfo`, `returnDropInfo`. Sarlavhada javobning o'z `timestamp` i ham chiqadi; jami son
yo'q, sahifa nakladnoylardagi so'zlar bilan joylanadi. Bu — Uzum omboridan sotuvchiga
qaytarilayotgan tovar, xaridor qaytargan buyurtma emas; javobda mahsulot, dona va summa
**yo'q**, birliklar satri buni har natijada aytadi. Pullik saqlash sanalari o'zi kelgandek
chiqadi — tugash boshlanishdan oldin bo'lsa ham (yozib olingan 20 qatorning 14 tasida
shunday): kod ularni "tuzatmaydi", ulardan hech narsa hisoblamaydi va haq olinganini aytmaydi.

`shops.list` `chatAvatarUrl` ni ataylab chiqarmaydi: bu `images.uzum.uz` dagi rasm
manzili, ya'ni `product` blokining `image` i qabul qiladigan narsaning o'zi —
mahsulot qatorlari yonida turgan do'kon avatari mahsulot rasmi bo'lib chizilishi
bir nusxalashga yaqin.

Olti lookup uchun ham: javob tanilgan shaklda bo'lmasa — "shape not recognised
(expected …): printed generically" sarlavhasi bilan shakldan mustaqil renderer;
obyekt bo'lmagan yozuvlar tashlab o'tiladi va soni aytiladi; ko'prik mahalliy rad
etgan so'rov matnida qaysi ruxsat kodi yetishmagani ham bor ("The seller lacks
INVOICE_READ on shop …").

| `products.list` | |
|---|---|
| Argumentlar | `{shopId?, page? (0 dan), size? (1–100, standart 24), filter? (ALL \| WITHOUT_REQUIRED_FILTERS, standart ALL), search? (matn, ≤ 100 belgi), view? (products \| skus, standart products)}`. Standart `size` — kabinetning o'z jadvali sahifa hajmi (yozib olingan saqlangan sozlamada 24 edi). Model ba'zan sonni qo'shtirnoqda yozgani uchun son qabul qilinadi (`coerce`), chegaralar ma'noni baribir hal qiladi. `search` route'da `searchQuery` bo'ladi; boshqaruv belgili matn so'rov **yuborilmasdan** model amal qila oladigan jumla bilan rad etiladi — qoida route'niki (`hasControlCharacter`, chegaralar ham route'dan eksport qilinadi), lookup uni model yozgan matnga `trim`dan oldin qo'llaydi |
| Do'kon qanday tanlanadi | Aniq `shopId` (sotuvchining o'ziniki bo'lishi shart) → kabinet ekranidagi do'kon → yagona do'kon → aks holda so'rov **yuborilmaydi**: "do'konni tanlang" matni modelga qaytadi. Do'konni taxmin qilish noto'g'ri do'kon haqida to'liq ishonch bilan javob berish bo'lardi |
| Rad etish | Kirmagan, do'kon yo'q, do'kon sotuvchiniki emas — bularning har biri model amal qila oladigan matn, yiqilgan so'rov emas |
| Xato matni | Uzum API nomidan faqat HTTP holatli javob haqiqatan kelganda gapiriladi. Kengaytmaning o'zi mahalliy rad etgan so'rov (do'kon sessiyada yo'q, ruxsat kodi yo'q, token yo'q) holatsiz xato bilan keladi va matn "so'rov yuborilmadi"ni sababi bilan aytadi; yopilgan ko'prik (`BRIDGE_CLOSED`) ham shunday — model "API xato berdi" deb ishonmasligi uchun ([`cabinet.ts`](../extension/src/tools/cabinet.ts), `explainFailure`) |
| Muddat | 30 soniya; chaqiruv muddat bilan **poyga** qilinadi (mijoz signalga e'tibor bermasa ham javob ushlanib qolmaydi), muddat o'tsa far tomoniga to'xtatish aytiladi |
| Natija | Ikki shakldan biri: javob `readProductsPage` tanigan bo'lsa — **ikki jadvaldan biri** (pastda); tanimasa — shakldan mustaqil renderer (zaxira yo'l). Sarlavha ikkalasida: do'kon (va nega aynan shu), `page`, `size`, `filter` (`WITHOUT_REQUIRED_FILTERS` — "meaning undocumented" belgisi bilan), qidiruv va ko'rinish, sahifa o'rni, `live from …`, HTTP holati `200` bo'lmasa, `TRUNCATED` |

**Ikki jadval** ([`productsView.ts`](../extension/src/tools/productsView.ts); katakni
o'qish va jadvalni kesish qoidasi — [`columns.ts`](../extension/src/tools/columns.ts),
oltita kichik lookup bilan umumiy). Ustunlar —
API'ning o'z maydon nomlari (ichma-ich bo'lsa nuqtali yo'l), birinchi ustun
`askedShopId` — so'ralgan do'kon, payload'dan emas. Katak qiymati **javobdagi yozuvdan**
(`raw`) olinadi, o'quvchining tiplangan ko'rinishidan emas: yozib olingan namunaga mos
kelmagan tur (masalan satr bo'lib kelgan narx) o'zi kelgandek chiqadi, aks holda model
"API narx bermadi" deb o'qirdi. Qiymatlar JSON'dagidek, yaxlitlanmasdan
(`plaintext.table` foizni ikki o'nlikka yaxlitlardi); bo'sh katak — faqat `null` yoki
kalit yo'qligi, **hech qachon nol emas**: qoldiqsiz SKU ning pullik saqlash maydonlari
`null`, model ularni `0` deb o'qisa, saqlash bepul deb xabar qilardi. Hech bir ustun
qo'shilmaydi.

| Ko'rinish | Qachon | Nima chiqadi |
|---|---|---|
| `products` (standart) | mahsulotlar haqida savol | Mahsulot qatori: `productId`, `title`, `status.value`, `moderationStatus.value`, `quantityAvailable`, `quantityAvailableByStockType.fbo` / `.fbs`, `quantitySold`, `quantityReturned`, `returnedPercentage`, `price`, `rating`, `feedbackQuantity`, `viewers`, `clicks`, `conversion`, `rankInfo.rank`, `pstorage`, `promotionStatus`, `previewImg` (to'liq manzil — `product` blokining `image`i uchun), `skuList.length`, `skuList.RUN_OUT` |
| `skus` | o'lcham, qoldiq, saqlash haqida savol: qiymatning ko'pi SKU da | Avval qisqa kalit jadval (`productId`, `title`, `skuList.length`), keyin SKU qatori: `productId`, `skuId`, `skuTitle`, `characteristics`, `barcode`, `status.value`, `forecastOutOfStock`, `quantityAvailable`, `…ByStockType.fbo` / `.fbs`, `quantitySold`, `quantityReturned`, `returnedPercentage`, `price`, `commission`, `pstorage`, `paidStoragePriceItem`, `paidStorageAmount`, `avgdsales`, `avgdquantity`, `turnover`, `rankInfo.rank`, `hasActiveDiscount`, `specialOffer.inOffer`, `specialOffer.endDate` va uning yonida `specialOffer.endDate.utc`, `blocked`, `archived` |

Ikkala ko'rinish — **bitta so'rov**; `view` faqat chizish usuli. Kod hisoblaydigan
yagona ikki ustun (sahifa o'rni va SKU sonlaridan tashqari) — mahsulotning o'z
`skuList` idagi obyektlarga tegishli `skuList.length` va `skuList.RUN_OUT`
(SKU `status.value` = `RUN_OUT` soni); ular o'z nomlari bilan atalgan, ustunlar
satrida esa "kodda hisoblangan: o'rin, 'more remain', SKU sonlari" deb ajratilgan. Vaqt
tamg'asi epoch millisekund bo'lib qoladi, `.utc` ustuni faqat shu qiymatning UTC
matni.

**Sahifa o'rni javobning o'z jami sonidan** ([`pagingText`](../extension/src/tools/productsView.ts#L198)).
Sarlavhada `rows 1–24 of 38 (totalProductsAmount, position from page × size)`:
`38` — javobning `totalProductsAmount`i, o'rin esa so'rov qurilishidan (`page ×
size`) chiqarilgan faraz, javob uni tasdiqlamaydi. Faraz mos kelmasa, matn buni
**yashirmay** aytadi:

| Holat | Sarlavha nima deydi |
|---|---|
| Qidiruv berilgan yoki `filter` ≠ `ALL` ("narrowed") | Jami son aytiladi, lekin "yozib olinmagan: u shu filtr/qidiruvga ergashadimi" izohi bilan va **undan xulosa chiqarilmaydi**: na "chegaralangan sahifa", na "qancha qoldi", na `size`ni kichraytirish maslahati; to'la sahifadan keyin yana sahifa bo'lishi mumkin |
| Jami son yo'q | Faqat bir sahifadan: bo'sh / so'ralgandan ko'p (API `size`ni hurmat qilmasligi mumkin) / aynan so'ralgancha (keyingi sahifa raqami) / so'ralgandan kam (API sahifani cheklashi mumkin) — har birida "javobda jami son yo'q"; **hech qachon "oxirgi"** |
| Qator yo'q, jami `0` | "no products in this read — total 0" |
| Qator yo'q, `page × size ≥ jami` | sahifa oxiridan keyin boshlanadi |
| Qator yo'q, lekin jami > o'rin | sahifa va jami bir-biriga zid |
| Sahifa jamidan o'tib ketadi / so'ralgandan ko'p qator | jami va sahifa zid; API `size`ni hurmat qilmasligi mumkin |
| Oxirgi qator = jami | "nothing further per the total" |
| So'ralgandan kam, ortig'i bor | API sahifani cheklagan ko'rinadi: keyingi sahifa qatorlarni **tashlab o'tadi**; bo'shliqsiz sahifalash uchun `size` ≤ shu soni |
| Aks holda | "N more remain: next page" |

Nega shunday: bitta javobda sahifani oxirgi deb ataydigan hech narsa yo'q —
`size` chegarasi bizniki, API pastroq cheklashi mumkin, jami son esa `filter`
va qidiruvga ergashishi hali yozilmagan. Shuning uchun matn har holda javobning
o'zi aytganiga tayanadi va tayanchi bo'lmaganini aytadi. Namunaga mos kelmagan narsa
sarlavhaning **"unexpected:"** qismida aytiladi: obyekt bo'lmagan `productList` yozuvlari
(tashlab o'tilgan), SKU sanalmagan `skuList` yozuvlari, oddiy son bo'lmagan va shu sabab
ishlatilmagan `totalProductsAmount` — jimgina yo'qotish o'qilganini butun sahifa deb
ko'rsatardi. Javob `productList` yonida bo'sh bo'lmagan `errors`/`messages` kabi ro'yxat
olib kelsa, sarlavha buni aytadi va ro'yxat pastda chiqariladi (bo'sh `productList` va
`errors` birga "mahsulot yo'q" deb o'qilmasligi uchun). Javobning
`totalProductsAmountWithoutWeightDimensional`i ham sarlavhaga chiqadi.

**Maydon izohi.** Toolkit hujjatining **PRODUCT LIST FIELDS** bo'limi
([`EXTENSION_SECTIONS`](../extension/src/tools/index.ts#L55)) har noaniq maydon haqida
yagona javob nimani ko'rsatganini aytadi — kuzatuv sifatida, dalil kuchi bilan ("1 ta
mahsulot", "6 ta nusxadan 6 tasi"), hech qachon tasdiqlangan deb emas: miqdorlar
SKU yig'indisiga tengligi, `returnedPercentage` formulasi, `paidStorageAmount`
(`pstorage` shartida; bo'sh katak "aytilmagan", nol emas), `turnover`, `status`
kodlari va `forecastOutOfStock` API'ning o'z bayrog'i ekani, `price` birligi yo'qligi
(yozilgan kattalik so'm narxiniki — "buni valyuta deb aytma"), `conversion` formulasi
noma'lumligi, `rating` va `roi` satr ekani, `rankInfo.rank` shkalasi noma'lumligi,
sana millisekund ekani va `.utc` ustuni UTC (Toshkent vaqti emas) ekani. Legenda dalildan
oshmaslikka urinadi: `commission` — "birligi payload'da yo'q, ehtimol foiz"; saralash
so'ralgan, lekin bitta mahsulot buni ko'rsata olmaydi; `search` faqat bo'sh yozilgan,
qo'llanishi va moslashishi noma'lum; matnlar tili faqat `ru-RU` bilan yozilgan (lookup
shu header'ni qo'ymaydi, shuning uchun til yozilmagan).

**Zaxira yo'l.** Javob `productList` massivini olib kelmasa (shakl o'zgargan,
`errors` obyekti bilan `200`), lookup oldingi shakldan mustaqil rendererga tushadi:
sarlavha "shape not recognised: printed generically" deydi, eng katta ro'yxatni
"mahsulotlar" deb atamaydi (nomi `errors`, `messages` kabi bo'lsa buni aytadi), sahifa
o'rni esa faqat bir sahifadan so'zlanadi — jami son da'vo qilinmaydi.

| Jadval o'lchovi | Chegara |
|---|---|
| Butun matn | ≈ 12 000 belgi; birinchi qator har doim chiqadi, kesilgan joy `TRUNCATED` bilan aytiladi ("kichikroq `size` so'ra yoki `search` ishlat") |
| `skus` ko'rinishida kalit jadval | shu byudjetning to'rtdan biri, qolgani SKU jadvaliga |
| `title` / boshqa matn katagi | 50 / 30 belgi (`skuTitle` va `characteristics` — 40); katakka sig'maydigan obyekt/massiv `{a,b,+3}` / `[N items]` shaklida |
| Sarlavhadagi qidiruv matni | 40 belgi |

**Shakldan mustaqil renderer** — endi faqat zaxira yo'l ([`render.ts`](../extension/src/tools/render.ts#L338)):
nom va konvertni taxmin qilmaydi. Ro'yxat obyektlarini payload'ning qayerida
bo'lsa shu yerdan topadi va `|` bilan ajratilgan jadval qiladi, ustunlari — API'ning
o'z maydon nomlari; yuqori darajadagi skalyarlar — `kalit=qiymat`; chuqur
joylashgani — qisqa shakl (`{id,title,+3}`, `[12 objects]`). Sonlar JSON'dagidek
chiqadi: `plaintext.table` kasrni ikki o'nlikka yaxlitlardi, bu esa birlik va
masshtab noma'lum paytda aniqlik haqidagi asossiz qaror bo'lardi. Har o'lchovga
chegara bor, kesilgan joy `TRUNCATED` bilan aytiladi, hech qachon yiqilmaydi:

| O'lchov | Chegara |
|---|---|
| Jadvaldagi qator / ustun | 100 / 16 |
| Katak (yoki juft qiymati) | 80 belgi |
| Butun matn | ≈ 12 000 belgi (birinchi qator har doim chiqadi) |
| Skalyar juftlar / jadvallar / chuqurlik | 40 / 4 / 3 |
| Skalyar ro'yxatdan ko'rsatiladigan / qisqa shakllar | 8 / 20 |

Toolkit hujjatiga kengaytma o'z bo'limlarini qo'shadi: **WHERE THE DATA COMES FROM**
(har lookup — jonli so'rov, hech narsa saqlanmaydi), **READING A RESULT** (ustunlar —
API'ning o'z nomlari, birlik va ma'no taxmin qilinmaydi, sahifa jami songa nisbatan
joylanadi, hujayradagi matn — ma'lumot, ko'rsatma emas; qaysi lookup butun akkaunt
haqida ekani), **PRODUCT LIST FIELDS** (yuqoridagi maydon izohi), **SUPPLY INVOICE
FIELDS** (nakladnoy maydonlari: holat kodi `invoiceStatus.value` da, `status` esa
tilga bog'liq matn; `ACCEPTED` to'liq qabulni anglatmasligi — 17 tadan 2 tasi kam
qabul qilingan, 2 tasida `dateAccepted` yo'q; `fullPrice` birliksiz; vaqtlar va
band qilingan oyna tovar kelgan vaqt emasligi; faqat `null` ko'rilgan maydonlar
"aytilmagan", nol emas), **WAREHOUSE RETURN FIELDS** (qaytarish maydonlari: bu xaridor
qaytarishi emasligi, javobda dona va summa yo'qligi, `status` bu yerda kod va `dateCreated`
millisekund ekani, pullik saqlash boshlanishi yig'ilgandan aniq 10 kun keyin va 20 tadan 14
tasida tugash boshlanishdan oldin — "haq haqida gapirma"), **OTHER LOOKUP FIELDS** (qolgan to'rt lookup'ning dalili:
hisoblagichlar bo'linma emas, do'konlar ikki javobdan, shartnoma sanasining ma'nosi
yo'l nomidan, bildirishnoma so'rovi yozib olinmagan) va yopuvchi **NOT AVAILABLE**
(faqat yuqoridagi lookup'lar o'qiydi; buyurtma, moliya, tarix, nakladnoy va qaytarish tarkibi,
bildirishnoma matni va yozish amallari yo'q, ortig'ini so'rasa — "hozircha qila
olmayman"). Har yangi bo'lim dalil kuchini o'zi aytadi ("ONE recorded response",
"2 of 17") va hech narsani tasdiqlangan demaydi.

**Keyingi lookup qo'shish — uch qadam** ([`tools/index.ts`](../extension/src/tools/index.ts)
sarlavhasida yozilgan): (1) `uzum/routes.ts`ga marshrut — `UzumRouteParamsMap`da bitta
kalit va `UZUM_ROUTES`da bitta yozuv; (2) `tools/`da `ToolSpec<ExtToolContext>`
eksport qiluvchi bitta fayl: zod sxema, `args`, `summary` va `run` — do'konni
`resolveShop` bilan hal qiladi (account marshrutida faqat kirganlikni tekshiradi),
bitta so'rovni [`readCabinet`](../extension/src/tools/lookup.ts#L47) bilan yuboradi
(muddat va xato matni shu yerda), tanigan javobni nomlangan ustunlar bilan, qolganini
[`unrecognised`](../extension/src/tools/lookup.ts#L88) bilan chiqaradi. Qisqa namuna
— `invoicesList.ts`, uzuni (tiplangan o'quvchi bilan) — `productsList.ts`;
(3) `EXT_TOOLS`ga bitta qator va `EXTENSION_SECTIONS`ga maydonlar haqida namuna nimani
ko'rsatgani, dalil kuchi bilan. Boshqa hech narsa o'zgarmaydi: hujjat va native
e'lonlar registrdan o'zi hosil bo'ladi, prompt esa katalogni emas, vaziyatni
tasvirlaydi.

**Mezbon** ([`src/host/`](../extension/src/host/)):

| Qism | Nima |
|---|---|
| Prompt ([`prompt.ts`](../extension/src/host/prompt.ts#L305)) | Umumiy quruvchiga mezbon qismlari: kimlik, mavzular, ma'lumot qayerdan, kontekst, va **yozish matni** ("bu versiyada hech narsa yozilmaydi"). `fieldNames` ataylab **berilmagan**: kod izohi sababini aytadi — bitta javobdan olingan nom misol bo'lib promptga tushsa, model "har natijada shular bor" deb eshitadi, keyingi lookup'ning nomlari esa boshqa; qoida misolsiz aytiladi, ustun nomlarini esa har natija o'zi chop etadi. Nomlar toolkit legendasida, dalili bilan |
| Nima haqida gapiradi | Model **nimani da'vo qila olishi**: so'm degan birlik, ro'yxatning to'liqligi, "o'tgan haftadan beri" o'zgarish, kabinet ekrani — har biri dalil yetarli bo'lmagan ishonchli gap. Aniqroq: sanasiz hisoblagich (sotilgan, qaytarilgan) natija nomlamagan davrni qamraydi, uni "shu hafta/oy" deb aytib bo'lmaydi; `format` — birlik haqidagi da'vo (`money` faqat so'm aytilgan joyda, `percent` faqat foiz aytilgan joyda); butun ro'yxat uchun aytilgan son — nechta ekanini bildiradi, yig'indisini emas (yig'indi faqat o'qilgan qatorlarni qamraydi); API o'zi qaytargan belgi yoki daraja API'niki deb, maydon nomi bilan keltiriladi, ustiga bashorat qurilmaydi |
| Sana va vaqt | CONTEXT bo'limidagi bir qator: bugungi sana va vaqtlarni qaysi zonada aytish — sotuvchining Umumiy sozlamasidagi `general.timezone` zonasida (offset hisoblab qo'shiladi). Natijadagi vaqt UTC'da keladi; panel esa har vaqtni shu zonada ko'rsatadi, shuning uchun model ham xuddi shu soatni aytadi. Zona nomini `Intl` qabul qilmasa — UTC, va qator UTC deydi (sotuvchi tanlamagan zonani emas). Saqlangan matn promptga o'zicha emas, `Intl` hal qilgan nom bilan tushadi. Zonani panel o'qiydi ([`prepareRun`](../extension/src/panel/copilotHost.ts#L68)), `prompt.ts` toza qoladi |
| Sessiyadan nima kiradi | Faqat kirgan-kirmagani, do'kon id'lari va ekrandagi do'kon. `sellerId`, `accountId` va ruxsat kodlari promptga **tushmaydi**: modelning hech bir ishi ularni talab qilmaydi, sababsiz LLM provayderga ketgan identifikator — ortiqcha |
| Kirmagan varaq | CONTEXT bo'limida aytiladi, qolgan prompt bayt-baytiga bir xil — provayder keshi prefiksni qayta ishlatishda davom etadi |
| Amallar ([`actions.ts`](../extension/src/host/actions.ts#L25)) | Faqat `copilot.ask`. Sayt amallari (narx, qoldiq, navigatsiya) ataylab yo'q — kengaytmada ularni bajaradigan na API mijozi, na ekran bor. Registrda yo'q id modelga mavjud id'lar ro'yxati bilan rad etiladi |
| `EXTENSION_TOOLKIT` | Toolkit va registr bir qiymatda — ularni noto'g'ri juftlash mumkin emas |

Yozish amali kelganda o'zgaradigan joylar: registrga yozuv, `uzum/routes.ts`ga
marshrut, panelda tasdiq oynasi va prompt'dagi "bu versiya faqat o'qiydi" abzatsi.

### 14.7. Panel

[`src/panel/`](../extension/src/panel/).

**Ishga tushish tartibi** ([`bootstrap.ts`](../extension/src/panel/bootstrap.ts#L73)).
Saqlash asinxron (`chrome.storage`), lekin sozlamalar sinxron o'qiladi (AI mijoz so'rovni
snapshot'dan quradi, store React'ga va'da emas, snapshot beradi, tema va til
bo'yoqdan oldin qo'llanadi). Shuning uchun avval **yuklash** kutiladi, keyin
hammasi sinxron:

| # | Qadam | Nega aynan shu joyda |
|---|---|---|
| 0 | `connectBridge()` va `startFrameLink()` — **ishga tushishning birinchi ikki ifodasi, birorta `await`dan oldin** | Handshake iframe `load`ida yuboriladi; u modul hisoblanib bo'lmaguncha kela olmaydi. Tinglovchi saqlash o'qilguncha o'rnatilmasa, kelgan handshake abadiy yo'qolardi. `frame.visibility` ham, ya'ni ramkaning ulanish xabari ham shu tinglovchi orqali keladi |
| 1 | `registerKvBackend(chromeStorageKvBackend)`, `initModelUsageSync()` | Birinchi so'rovdan oldin: kvota o'lchagichi uni eshitgan bo'lsin |
| 2 | Preferences saqlashini o'rnatish va qayta hydrate; boshqa varaq o'zgartirishini kuzatish | Aks holda standart tema va til miltillab, keyin almashtirilardi |
| 3 | `hydrateSettings()`, so'ng `wireSettingsRefresh` (faqat o'rnatilgan kengaytmada) | Provayder va kalit. Kuzatuv hydrate'dan keyin: yuklanmagan snapshot'ni yangilash ma'nosiz |
| 4 | `restoreModelUsage()` | 1-qadamdagi backend kerak |
| 5 | Tema va hujjat tilini qo'llash | Bo'yoqdan oldin |

**Sozlamalar boshqa varaqni kuzatadi** ([`settingsSync.ts`](../extension/src/panel/settingsSync.ts)).
`core/` dagi [`refreshSettings()`](../core/src/settings/settings.service.ts#L414) saqlangan
sozlamalarni qayta o'qiydi va boshqa kontekst o'zgartirgan bo'lsa, o'shani qabul
qiladi; **hech qachon yozmaydi**, mahalliy yozuv yo'lda bo'lsa — mahalliy yutadi, o'z
yozuvining aks-sadosida esa hech narsa qilmaydi. Panel uni uch holatda chaqiradi:
extension storage'da sozlamalar yacheykasi o'zgarganda (faqat **signal** sifatida,
kelgan qiymatga ishonilmaydi), panel oynasi fokus olganda va hujjati ko'rinadigan
bo'lganda. Nega: ikki kabinet varag'ida ikkita panel bor, har biri o'z snapshot'ini
ushlaydi va saqlashda butun yacheykani qayta yozadi; eskirgani istalgan maydonni
saqlasa, masalan boshqa varaqda kiritilgan API kalitini o'chirardi. Sayt uni
chaqirmaydi va avvalgidek ishlaydi. Qolgan cheklovlar halol yozilgan: 13-bo'lim, 11-band;
brauzerda tekshirilmagan — 14.8.

Hech narsa yiqilmaydi: saqlash xatosi xotiradagi sessiyaga tushadi va natijada
(`failures`) xabar qilinadi. O'rnatilgan kengaytma **har doim** `chrome.storage`
oladi; u yo'q bo'lsa jimgina boshqasiga o'tilmaydi — chaqiruvlar rad etilib,
sessiya xotirada ko'rinib ishlaydi. `localStorage` backend'i faqat kengaytmadan
tashqarida dev serverdan ochilgan build uchun.

**`BridgeGate` — tasdiqlangan handshake'gacha panel inert.** `panel.html` kabinetga
ochiq, shuning uchun sahifa skripti uni o'z iframe'iga olishi mumkin; bunday ramka
tasdiqlangan handshake'ni hech qachon olmaydi (nonce yozuvi yo'q) va sotuvchining AI
sozlamalari ustida sirt bo'lib qolmasligi kerak. Shuning uchun o'rnatilgan
kengaytmada interaktiv ilova **faqat** tasdiqlangan handshake'dan keyin chiziladi:

```
waiting (mavzuli fon, hech qanday boshqaruv yo'q)
   ├── handshake tasdiqlandi ──────────────────────────────▶ connected (ilova)  ← yakuniy
   └── 2 soniya o'tdi, kelmadi ──▶ failed: bitta jumla + "Qayta yuklash"
                                      └── keyin kelsa ──────▶ connected
```

"Qayta yuklash" faqat shu hujjatni qayta yuklaydi: dushman ramkada zararsiz, haqiqiy
ramkada esa kontent skript kutilmagan `load`ni ko'rib, yangi yozilgan nonce bilan
boshidan boshlaydi (14.3). Kech kelgan handshake ham ko'rinishni ilovaga aylantiradi,
`connected` esa kech kelgan "muddat o'tdi" hukmi bilan qaytarilmaydi. Gate'ni faqat
**kengaytmadan tashqarida** (extension storage umuman yo'q, dev build) o'tkazib
yuboriladi — panelni dev serverdan ishlab chiqish uchun. Ishga tushish yiqilib,
`startup` bo'lmagan bo'lsa ham gate qo'yiladi: dev build ekani hech nimadan ma'lum emas.

**Ko'rinishlar.** Ikki ko'rinish: chat va sozlamalar. Chat **doim ulangan** turadi
(sozlamalar ochiq bo'lsa `open={false}`: chizilmaydi, lekin komponent qoladi),
shuning uchun oqayotgan javob oqishda davom etadi va suhbat qaytganda joyida. Sozlamalarda
aynan uchta bo'lim — **Umumiy**, **AI**, **Klaviatura** (`core/src/ui/settings/`dagi
saytnikining o'zi). Umumiyda ikkita bildirishnoma tumblerchasi yashiriladi: ular
saytning bildirishnoma jurnalini boshqaradi, kengaytmada u yo'q, hech narsani
o'zgartirmaydigan tumbler esa yolg'on. Escape: sozlamalardan — bir qadam orqaga, chatdan —
ramkani yopish; ochiq select, menyu yoki dialog o'zinikini birinchi oladi.
[`shortcuts.ts`](../extension/src/panel/shortcuts.ts) Klaviatura ro'yxatini va
ishlov beruvchilarni bitta joydan oladi: ro'yxatda bor, lekin hech narsa javob
bermaydigan tugma bo'lmaydi.

**Mezbon obyekti** ([`copilotHost.ts`](../extension/src/panel/copilotHost.ts#L68)). Har savolda
sessiya kabinet varag'idan **bir marta** o'qiladi va undan ikki narsa quriladi: modelga
aytiladigan prompt va lookup'lar tekshiriladigan kontekst. Ikki marta o'qisak, model
bitta do'konlar to'plamini eshitib, lookup boshqasiga qarshi tekshirilishi mumkin edi.
Kirmagan varaq xato **emas**: prompt buni aytadi va ma'lumot talab qilmaydigan savolga
javob berish mumkin. Ko'prik yopilgan bo'lsa (`BRIDGE_CLOSED`) savol "kabinet sahifasi
bilan aloqa uzildi" jumlasi bilan to'xtaydi — "kabinet ichida emas" deb emas. Panel
kabinet ramkasidan tashqarida ochilgan bo'lsa (faqat dev build) o'qiydigan varaq yo'q
va savol jumla bilan to'xtaydi. Xato matni sotuvchining tilida, ko'prikning o'z
inglizcha xabarlari emas. Boshlang'ich takliflar — `products.list` javob bera
oladiganlar ("mahsulotlarimni ko'rsat"...): taklif — va'da; kichik lookup'lar
(mahsulot sonlari, nakladnoylar, do'konlar) uchun taklif hali yo'q. Pin (qadash) yo'q, shuning
uchun pin tugmasi chiqmaydi; insights paneli, sinxronlash tugmasi, tanlangan davr — hech biri yo'q.

**Panelda sotuvchi ko'radigan holatlar** ([`cabinetStatus.ts`](../extension/src/panel/cabinetStatus.ts)):

| Holat | Qachon | Nima ko'rinadi |
|---|---|---|
| `checking`, `ready` | Hali so'ralmagan / kirgan va do'konlari bor | Hech narsa |
| `signedOut` | Kabinetda kirmagan | "Bu varaqda kabinetga kirmagansiz…" + qayta tekshirish |
| `noShops` | Akkauntda do'kon ko'rinmaydi | "…kabinetda do'konlar ko'rinmayapti" + qayta tekshirish |
| `unreachable` | Kabinet varag'i javob bermadi | "Kabinet varag'i javob bermadi…" + qayta tekshirish |
| `closed` | Ulanish bor edi, kabinet sahifasi xayrlashdi (qayta yuklandi, boshqa sahifaga o'tdi) | "Kabinet sahifasi bilan aloqa uzildi…" (`extBridgeLost`) + **Qayta yuklash**; suhbat ekranda qoladi. Qayta tekshirishning foydasi yo'q: davosi — yangi hujjat va yangi handshake |
| `outside` | Panel kabinet ramkasidan tashqarida — **faqat dev build**: ishlab chiqarish paneli ilovani tasdiqlangan ulanishdan keyingina chizadi (`BridgeGate`) | Tushuntirish; qayta tekshirishning foydasi yo'q |

Holat panel ochilganda, har ramka ko'rsatilganda (sotuvchi shu orada kirgan yoki
do'kon almashtirgan bo'lishi mumkin) va talab bilan qayta o'qiladi; yangisi bilan
almashtirilgan o'qish bekor qilinadi va jim turadi, shuning uchun sekin javob yangisini
bosib ketmaydi. **AI sozlanmagan** holat — umumiy panelning o'z bannerida (saytdagi
kabi), uning tugmasi AI bo'limini ochadi. **Maxsus AI manzili** uchun AI bo'limida
[`HostAccessNotice`](../extension/src/panel/HostAccessNotice.tsx): faol provayderning
origin'iga ruxsat so'raladi, faqat u hali berilmagan bo'lsa. Ruxsat — ixtiyoriy
(server kengaytmalardan so'rovni qabul qilsa, ruxsatsiz ham ishlaydi), rad javobi
hech narsani o'zgartirmaydi; `permissions.request` foydalanuvchi harakatini talab
qilgani uchun bosish ishlov beruvchisidan to'g'ridan-to'g'ri, `await`siz chaqiriladi.

**Zichlik.** Umumiy komponentlar o'lchamni ko'rinish kengligi breakpoint'i bilan tanlaydi,
sakrash nuqtasi esa `md` (768 px): undan pastda telefon maketi chiziladi. Panelning
ko'rinish kengligi iframe'niki — kompyuterda 433 px, ya'ni o'zgartirilmasa doim
"telefon" bo'lib chiqardi. Shuning uchun [`panel.css`](../extension/src/panel/panel.css)
`--breakpoint-md` ni 360 px ga tushiradi: ramka — mashina yuzasi (sichqoncha, zich
panel), 433 px dan tor bo'lsa ham hamon ixcham turishi kerak; 360 dan pastda esa
telefon zichligi. Barmoq nishonlarini kengaytirish kenglikka emas,
`pointer: coarse`ga bog'liq, shuning uchun sensorli ekran buni yo'qotmaydi.

### 14.8. Tekshirilgan va tekshirilmagan

**Avtomatlashtirilgan** (`extension/`, `npm test`, 456 ta test, 32 fayl):

| Fayl | Nima qoplangan |
|---|---|
| `uzum/routes.test.ts`, `uzum/session.test.ts` | Yopiq jadval va qat'iy parametr tekshiruvi: yettita marshrutning har biri yozib olingan URL'ni harfma-harf yasashi, account marshruti hech qanday kalitni (jumladan `shopId` ni) qabul qilmasligi, jadvalda faqat `GET` va faqat `/api/…` borligi; buzuq/yetishmagan `state` — "kirmagan" |
| `uzum/queue.test.ts`, `uzum/bridge.test.ts` | Ketma-ket navbat, `429` kutishi, bekor qilish; kontent tomoni: ruxsat (har do'kon marshruti o'z kodi bilan va qaysi kod yetishmagani), URL, xato sinfi, tokenning hech bir xabarda yo'qligi; account marshruti do'konsiz sessiyada ham ishlashi, kirilmagan varaqda esa yuborilmasligi; xayrlashgandan keyin `BRIDGE_CLOSED` |
| `uzum/handshake.test.ts` | Handshake — ota oyna, bir marta, nonce faqat xabarda, yozuv yoshi, bir martalik iste'mol, soxta nomzoddan keyin haqiqiyi (to'plamlab tekshirish), `ready` tasdig'i, panel URL'ni o'qimasligi |
| `content/content.test.ts`, `content/navigation.test.ts` | Frame holati reduceri, shortcut, nonce va URL shakli (URL'da nonce yo'q); yuklash tartibi, kutilmagan `load`, tasdiqsiz qolish va `inert` chegarasi |
| `uzum/products.test.ts` | Niqoblangan namunani o'qish; `raw` va `fields`, `mistyped`, o'qib bo'lmaydigan yozuvlar, hech qachon xato tashlamaslik |
| `tools/productsList.test.ts`, `tools/productsView.test.ts`, `tools/render.test.ts`, `tools/index.test.ts` | Lookup argumentlari va sarlavhasi, ikki jadval (ustunlar, `null` — bo'sh katak, turi mos kelmagan qiymat), sahifa o'rni holatlari (jumladan qidiruv/filtrli), zaxira yo'l, renderer chegaralari, toolkit hujjati (aynan yettita lookup, har biri o'z marshrutining nomi bilan; yangi legendalar dalil kuchini aytishi) |
| `tools/invoicesList.test.ts`, `tools/returnsList.test.ts`, `tools/shopsList.test.ts`, `tools/smallLookups.test.ts` | Oltita kichik lookup, hujjatdagi niqoblangan namunalar bilan: so'rov parametrlari, do'kon hal bo'lmaguncha so'rov yo'qligi (account lookup'da esa do'kon so'ralmasligi), ichma-ich maydonlardan ustunlar, `null` va nol farqi, `.utc` ustunlari, jami sonsiz sahifalash, kesilgan jadval, tanilmagan shakl, xato matni va bekor qilingan savol |
| `host/prompt.test.ts` + snapshot, `host/actions.test.ts`, `host/loop.test.ts` | Prompt (kirmagan varaq, identifikatorlar, sana va vaqt zonasi — noma'lum zona UTC'ga tushadi), registr darvozasi, umumiy sikl kengaytma toolkit'i bilan |
| `panel/*.test.ts` | Ishga tushish tartibi (tinglovchi birinchi), gate, ko'rinishlar, shortcut'lar, kabinet holatlari (jumladan `closed`), mezbon, host ruxsati, sozlamalarni boshqa varaqdan yangilash signallari |
| `storage/*.test.ts`, `manifests/manifest.test.ts` | Backend va preferences adapteri; ikki manifest va u nomlagan ikonka fayllarining mavjudligi |

**Haqiqiy brauzerda tekshirilgan** (2026-11-13; `dist/chromium`, Chrome
157.0.8103.39 va Edge 157.0.4341.42, ikkalasida bir xil natija). Sharoit:
vaqtinchalik profil, oynasiz (headless) rejim, brauzer avtomatik boshqarilgan;
sahifa — `seller.uzum.uz` ning **kirilmagan** bosh sahifasi; LLM — `127.0.0.1`
dagi ssenariyli OpenAI-mos server (`custom` provayder, matn protokoli); kabinet
sessiyasi — sahifa yuklangandan keyin `localStorage.state` ga yozilgan soxta
yozuv; kabinet API'sining javobi — niqoblangan namuna (so'rov brauzerda ushlab
olingan, Uzum'ga yuborilmagan). Sinov skriptlari repoda yo'q. Bu — bir kun, bir
mashina, ikki brauzer versiyasi: kafolat emas, kuzatuv.

| Nima | Natija |
|---|---|
| O'rnatish va kontent skript | Manifest xatosiz qabul qilindi; kabinet sahifasida tugma chiqdi |
| Kabinetning CSP'si va iframe | Kirilmagan bosh sahifada CSP sarlavhasi ham, `<meta>` ham yo'q; `panel.html` ramkada yuklandi. Kirilgan sahifalar ko'rilmagan |
| Handshake va panel tasdig'ining vaqti | Tugma bosilgandan ilova chizilguncha ~120 ms (chegara 5 s). To'g'ridan-to'g'ri varaqda ochilgan `panel.html` "ulana olmadi" ko'rinishida qoldi (14.7 dagi gate) |
| Kabinet so'rovining shakli | Kontent skript `GET …/product/getProducts?page=0&size=24&filter=ALL&sortBy=id&searchQuery=&order=descending` ni `Authorization: Bearer …`, `Accept: application/json`, origin `https://seller.uzum.uz` bilan, cookie'siz yubordi; brauzerning preflight'i faqat `authorization` ni so'radi |
| Preflight (haqiqiy server) | Alohida, tokensiz `OPTIONS` so'roviga `api-seller.uzum.uz` 200 qaytardi: origin `https://seller.uzum.uz`, `GET` va `authorization` ruxsat etilgan. Haqiqiy token bilan `GET` javobining o'zi sinalmagan |
| To'liq suhbat | Savol → `{"need":"tools"}` → `products.list` → ko'prik → namuna jadval bo'lib modelga qaytdi → javob manba chipi bilan chizildi |
| Panelning LLM'ga yetishi | Ramkadan OpenAI, Anthropic, Gemini va OpenRouter'ga kalitsiz so'rov o'qiladigan HTTP javob oldi (401/403/200) — CORS to'sig'i yo'q. Loopback manzilga so'rov ruxsat berilmasdan ham o'tdi (server CORS sarlavhalarini bergani uchun) |
| Sozlamalar | Formaga kiritilgan kalit `chrome.storage.local` ga yozildi (`savdo.kv.settings`, sxema v6) va sahifa qayta yuklangach saqlangan edi |
| Sozlamalar ikkinchi varaqni kuzatishi | Bir varaqda tanlangan til ikkinchi varaqning paneliga darhol (u yashirin turganida ham) yetdi; saqlangan kalit ikkinchi varaqda u ko'rsatilgach ko'rindi |
| Ctrl+J va Esc | Sahifadan Ctrl+J ochdi, iframe ichidan Ctrl+J va Esc yopdi (avtomatlashtirilgan, lekin `isTrusted` klaviatura hodisalari). Brauzerning o'z Ctrl+J'i bilan to'qnashuv — quyida |
| Sahifa ↔ iframe fokus uzatish | Ochilganda yozuv maydoniga, yopilganda tugmaga o'tdi |
| Qayta tiklanish | Sahifa qayta yuklanganda ochiq holat tiklandi va yangi panel ulandi; panel o'zini qayta yuklaganda kontent skript uni yangi nonce bilan qayta yukladi (`?r=1`) |
| `document.getAnimations()` (14.3) | Ochilish va yopilish paytida faqat ramka mezbonining o'zini (`savdo-copilot-frame`) ko'rsatdi; shadow root ichidagi hech narsa yo'q |

**Oltita yangi lookup haqiqiy brauzerda** (2026-11-16; `dist/chromium`, Chrome
157.0.8103.52 va Edge 157.0.4341.60, ikkalasida bir xil natija; `returns.list` — o'sha kuni
ikkinchi yurgizishda). Sharoit yuqoridagidek,
bitta farq bilan: kabinet sahifasining o'zi ham almashtirgich — `seller.uzum.uz`
so'rovi brauzerda ushlanib, bo'sh sahifa bilan javob berildi, kabinet API'sining
javoblari esa hujjatdagi niqoblangan namunalar edi. Uzum'ga hech bir so'rov ketmadi
(boshqa `uzum.uz` manziliga urinish — 0 ta). Bu serverning xatti-harakati haqida
hech narsa demaydi: javoblarni sinovning o'zi bergan.

| Nima | Natija |
|---|---|
| Model olgan toolkit hujjati | Yettita lookup va `copilot.ask` sanalgan; **SUPPLY INVOICE FIELDS**, **WAREHOUSE RETURN FIELDS** va **OTHER LOOKUP FIELDS** bo'limlari bor |
| Oltita so'rovning shakli | Har biri 14.4 jadvalidagi yo'lga (`…/shop/`, `…/product/products-statistic`, `…/invoice?page=0&size=20`, `…/return?page=0&size=20`, `…/contract/end-date?shopId=…`, `/api/v1/…/unread-count`) `Authorization: Bearer …`, `Accept: application/json`, origin `https://seller.uzum.uz` bilan, cookie'siz va boshqa hech qanday qo'shimcha header'siz ketdi; brauzerning preflight'i har birida faqat `authorization` ni so'radi |
| Account marshrutlari | `shops.list` va `notifications.unread` do'kon so'ramasdan ishladi; model `shops.list` ga `shopId` qo'shganda u e'tiborsiz qoldi, so'rov o'sha parametrsiz yo'lga ketdi |
| Ruxsat kodi yo'q do'kon | `INVOICE_READ` va `SELLER_RETURN_READ` berilmagan do'kon uchun `invoices.list` va `returns.list` — brauzer **hech qanday so'rov yubormadi**; modelga "so'rov yuborilmadi … The seller lacks INVOICE_READ on shop …" matni qaytdi |
| Natijalar va panel | Oltita natija kutilgan jadval/juftliklar bo'lib modelga qaytdi; panelda har chaqiruvga bitta iz qatori va manba chipi chizildi |
| Token | Modelga yuborilgan uchta so'rovning hech birida soxta token yo'q |

**Hali tekshirilmagan** (13-bo'lim, texnik qarz, 2-band):

| Nima | Nega ishonch yo'q |
|---|---|
| Firefox umuman; `content.fetch` (va `cloneInto`) | `dist/firefox` hech qayerga o'rnatilmagan; Xray chegarasidagi xatti-harakatni faqat brauzer ko'rsatadi |
| Haqiqiy kabinet sessiyasi | `localStorage.state` shakli bitta namunadan ma'lum; kirilgan sahifalarning CSP'si va haqiqiy token bilan `GET` javobining CORS'i ko'rilmagan; kabinetning `access-content-allow-origin` so'rov header'i bizda yuborilmaydi (kabinetning o'zi uni nakladnoy so'roviga qo'shmagan va `200` olgan — 5.B.10; kengaytma so'rovi uchun bu hali dalil emas) |
| Oltita yangi lookup haqiqiy server bilan | Yettita marshrutning hech biri kengaytmadan haqiqiy token bilan yuborilmagan. `PRODUCT_READ`, `INVOICE_READ`, `SELLER_RETURN_READ`, `SHOP_READ` — kodning farazi: server boshqa kod so'rasa yoki umuman so'ramasa, kod ruxsatli so'rovni rad etadi yoki server `403` qaytaradi. `notifications.unread` ning `GET` i hech qachon yozib olinmagan |
| Haqiqiy LLM kaliti; tool API'li yo'l | Sinovda faqat matn protokoli (`custom`) yurgan; Gemini, Claude va OpenAI'ning tool API'li yo'li brauzerda yurmagan |
| Ctrl+J qisqa yo'li brauzerning o'z qisqa yo'lini bosib o'tadimi | Oynasiz rejimda brauzer qisqa yo'llari yo'q; brauzerlar o'zlari zaxiralagan tugmalar to'plami har xil |
| bfcache'dan qaytganda ramka tiklanishi | Hodisalar tartibi brauzerga bog'liq; sinovda faqat oddiy qayta yuklash va panelning o'z qayta yuklashi o'tgan |
| Optional host ruxsatining so'rovi va rad etilishi | `permissions.request` oynasi oynasiz rejimda chiqmaydi |
| Oynali brauzer | Barcha kuzatuvlar oynasiz rejimda; dvigatel bir xil, lekin fokus va qisqa yo'llar oynali rejimda farq qilishi mumkin |
