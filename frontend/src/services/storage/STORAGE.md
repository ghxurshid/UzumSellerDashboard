# Storage qatlami — IndexedDB jadvallari va sync

Bu hujjat Uzum'dan keladigan har bir ro'yxatning IndexedDB'da qayerda saqlanishini
va qanday yangilanishini tushuntiradi.

Bog'liq: [ENDPOINTS.md](../uzum/ENDPOINTS.md) — endpointlarning o'zi.

---

## 1. Asosiy qoida: har bir ro'yxat — alohida jadval

`DB_NAME = 'savdo'`, `DB_VERSION = 3`. Jami **15 ta object store**:
13 ta entity jadvali + `sync_metadata`, `kv`.

> **v3 da `buffer` jadvali olib tashlandi.** U packed payload'larni manba va
> tanlov bo'yicha saqlardi — ya'ni entity jadvallaridagi ma'lumotning ikkinchi
> nusxasi. Ikki nusxa "bu SKU narxi qancha" degan savolga ikki xil javob
> berardi va qaysi biri ko'rinishi ekran qaysi yo'ldan borganiga bog'liq edi.
> Endi ekranlar faqat normalizatsiyalangan jadvallardan o'qiydi.

Har bir entity yozuvida — **istisnosiz** — quyidagilar bor:

| Ustun | Nima uchun |
|---|---|
| `store_id` | **Qaysi do'kon.** Uzum buni izchil bermaydi: `/v1/finance/orders` har qatorda `shopId` yozadi, `/v3/fbs/sku/stocks` esa do'kon haqida umuman gapirmaydi. Shuning uchun u so'rov qilingan do'kondan olinib qo'yiladi, payload'ga ishonilmaydi |
| `account` | Token barmoq izi — boshqa sotuvchi tokeni qo'yilsa, oldingisining raqamlari ko'rinmaydi |
| `timestamp` | Fakt qachon sodir bo'lgan (ms). Seriya o'qi |
| `day` | `timestamp` ning UTC yarim tuni — kunlik grafiklar shu bo'yicha guruhlaydi |
| `id` | `<account>:<store_id>:<entity>:<native id>` — deterministik, ya'ni qayta o'qish `put` bilan ustiga yozadi |

Har bir jadvalda 4 ta umumiy indeks: `store_date` (`['store_id','timestamp']`),
`timestamp`, `store_id`, `account` — ustiga entity'ga xos indekslar.

---

## 2. Jadvallar

### Windowed — sotuv amaliyotlari (sync window bor)

Bular **o'zgarmas tarix**: tovar sotildi, narxi shu edi, komissiya olindi — tamom.
Va — tasodif emas — **API faqat shu uchtasini sana bo'yicha filtrlaydi.**

| Jadval | Manba | Qo'shimcha indeks |
|---|---|---|
| `order_items` | `GET /v1/finance/orders` | `order_id`, `product_id` |
| `expenses` | `GET /v1/finance/expenses` | `source_bucket` |
| `fbs_orders` | `GET /v2/fbs/orders` | `status` |
| `fbs_order_items` | ↳ `order.orderItems[]` | `order_id`, `sku_id` |

Bularda `sync_metadata.synced_ranges` yuritiladi — qaysi oraliqlar to'liq olingani.
Keyingi so'rovda **o'sha oraliqlar ayirib tashlanadi** va faqat qolgani so'raladi.

### Snapshot — hozirgi holat (sync window YO'Q)

Bular **hozir shunday** degan da'vo: narx o'zgaradi, qoldiq sotiladi, tavsif
tahrirlanadi, nakladnoy statusi `CREATED` dan `ACCEPTED` ga o'tadi.

| Jadval | Manba | Qo'shimcha indeks |
|---|---|---|
| `products` | `GET /v1/product/shop/{shopId}` | `product_id` |
| `product_skus` | ↳ `product.skuList[]` | `sku_id`, `product_id` |
| `fbs_stocks` | `GET /v3/fbs/sku/stocks` | `sku_id` |
| `supply_invoices` | `GET /v1/invoice` | `invoice_id` |
| `supply_invoice_items` | `GET /v1/shop/{id}/invoice/products` | `invoice_id` |
| `seller_returns` | `GET /v1/return` | `return_id` |
| `return_items` | ↳ `return.returnItems[]` | `return_id`, `sku_id` |
| `fbs_invoices` | `GET /v1/fbs/invoice` | `invoice_id` |

Bularda `synced_ranges` **har doim bo'sh**, o'rniga `captured_at` yoziladi.

### Journal — lokal kuzatuv

| Jadval | Manba | Qo'shimcha indeks |
|---|---|---|
| `change_events` | `product_skus` snapshot'lari farqidan | `sku_id` |

---

## 3. Nega ayrimlarida window bor, ayrimlarida yo'q

Bu **tanlov emas, API cheklovi**. Butun seller OpenAPI'da `dateFrom`/`dateTo`
parametrini qabul qiladigan **atigi uchta** route bor:

```
GET /v1/finance/orders     ✓ dateFrom, dateTo
GET /v1/finance/expenses   ✓ dateFrom, dateTo
GET /v2/fbs/orders         ✓ dateFrom, dateTo
────────────────────────────────────────────
qolgan hammasi             ✗ faqat page, size
```

Ya'ni mahsulotlar, qoldiqlar, nakladnoylar va qaytarishlar uchun "menga mart oyini
ber" deb so'rashning **iloji yo'q**. Ular uchun yagona to'g'ri o'qish — hammasini
o'qish, yagona to'g'ri yozish — butunlay almashtirish.

Bu sizning mantiqingizga aynan mos tushadi: sotuv amaliyoti — o'zgarmas fakt,
demak window mumkin va foydali; narx va qoldiq — hozirgi holat, demak window
ma'nosiz.

---

## 4. Sync qanday ishlaydi

### Windowed: lazy sync ([`sync/lazySync.ts`](../sync/lazySync.ts))

Bir jumlaga sig'adi: **davr haqida savol berilganda avval `sync_metadata` ga
qaralади, faqat u da'vo qilmagan qismlar so'raladi, keyin javob IndexedDB'dan
o'qiladi.**

```
So'ralgan oyna:  [────────── yanvar ── fevral ── mart ──────────]
Metadata:        [────────── yanvar ─────────]
Natija:                                [fevral ── mart] ← faqat shu so'raladi
```

- Reja **barcha 4 ta windowed entity**ning yetishmagan qismlari **birlashmasi**
  bo'yicha tuziladi. Sababi: bitta so'rovda `order_item` yozuvi tushib, `expense`
  yozuvi tushmasligi mumkin — faqat ledger bo'yicha rejalashtirsa, o'sha teshik
  abadiy qolib ketardi
- Oyna to'liq bo'lsa — **tarmoqqa umuman chiqilmaydi**
- Bitta gap tushmasa, u shunchaki qoplanmagan bo'lib qoladi va keyingi safar
  qayta rejalashtiriladi

**Settlement lag (14 kun).** Yaqin o'tmish qoplamasi ataylab "ochib" qo'yiladi:
buyurtma `PROCESSING` bo'lib yoziladi, kunlar o'tib `TO_WITHDRAW` yoki `CANCELED`
bo'ladi. FBS buyurtma statusi ham shunday harakatlanadi. Undan eskisi — qayta
so'ralmaydigan barqaror tarix.

### Snapshot: capture ([`sync/snapshotSync.ts`](../sync/snapshotSync.ts))

Reja yo'q, ayirish yo'q. Bor-yo'g'i ikkita qoida:

1. **Avval o'chirish, keyin yozish.** Katalogdan chiqib ketgan mahsulotning
   ustiga yoziladigan yangi qatori yo'q — o'chirilmasa, u oxirgi ma'lum narxi
   bilan abadiy turib qolardi
2. **Bo'sh javob — o'chirish emas, xato.** Route hech narsa qaytarsa, bu deyarli
   har doim rate limit yoki vaqtinchalik nosozlik, "sotuvchi hamma tovarini
   o'chirdi" emas. Shuning uchun bo'sh natija oldingi capture'ga tegmaydi

Tejash faqat bitta: capture yetarlicha yangi bo'lsa, o'tkazib yuboriladi
(`maxAgeMs`). Sana filtri bo'lmagach, boshqa tejash imkoni yo'q.

---

## 5. Ikkita nozik joy

**`/v3/fbs/sku/stocks` do'konni aytmaydi.** Javob account bo'yicha, `shopId`
yo'q. Shuning uchun avval katalog o'qiladi, so'ng har bir qoldiq **o'z do'koni
SKU'lariga tegishliligi bo'yicha** ajratiladi. Shu tufayli `store_id` yolg'on
bo'lmaydi va bir account'ning bir necha do'koni bir-birining qatorini da'vo
qilmaydi.

Bog'liqlik `requested()` da yozilgan: `fbsStock` so'ralsa `product` ham
so'raladi. Katalog na shu yugurishda, na saqlangan holda topilmasa, qoldiq
**umuman yozilmaydi** va capture shtampi qo'yilmaydi — keyingi o'qish qayta
urinadi. Hammasini bitta do'kon ostiga yozish muqobili emas edi: u ikki do'konli
account'da har bir SKU'ni ikki marta sanardi.

**`/v1/invoice` ham account bo'yicha**, lekin u har qatorda `shopId` yozadi —
shuning uchun bu yerda ajratish oddiy filtr.

---

## 6. Retention

| Entity | Chegara | Qoplamani qirqadimi |
|---|---|---|
| `order_item` | 200 000 qator | ha |
| `expense` | 50 000 | ha |
| `fbs_order` | 100 000 | ha |
| `fbs_order_item` | 300 000 | ha |
| `change_event` | 20 000 | yo'q |
| snapshot'lar | cheklanmagan | — |

Snapshot cheklanmaydi, chunki u do'konning o'z hajmi bilan chegaralangan va uni
qirqish to'liq bo'lishi kerak bo'lgan capture'ning bir qismini o'chirish degani.

Qirqish yoshi bo'yicha, eng eskisidan. Windowed entity qirqilsa, `synced_ranges`
ham qirqiladi — aks holda arxiv o'zi o'chirib yuborgan davrni "menda bor" deb
da'vo qilardi.

---

## 7. Nima o'chirildi

- **`storage/migration/`** (734 qator) — localStorage'dan bir martalik import.
  v2 bazani toza boshlagani uchun ma'nosiz qoldi
- **`records` object store** — 4 xil entity bitta jadvalda, `entity_type`
  diskriminatori bilan. Endi har biri o'z jadvalida
- **`catalog_sku` entity** — `product` va `product_sku` ga bo'lindi, `fbs_stock`
  esa alohida jadvalga chiqdi (u boshqa route'dan, boshqa tezlikda keladi)
- **`INDEXES.storeEntityDate`** (`['store_id','entity_type','timestamp']`) →
  **`INDEXES.storeDate`** (`['store_id','timestamp']`) — entity endi jadvalning
  o'zidan ma'lum, shuning uchun indeks bitta komponentga qisqardi

---

## 8. Yangi entity qo'shish

To'rt joyga tegiladi, `db.ts` ga emas:

1. [`idb/schema.ts`](./idb/schema.ts) — `ENTITY_TYPES` ga nom, `ENTITIES` ga
   ta'rif (store nomi, `mode`, indekslar), record interfeysi
2. [`idb/mappers.ts`](./idb/mappers.ts) — wire → record
3. [`retention.ts`](./retention.ts) — chegara kerak bo'lsa (kerak bo'lmasa
   avtomatik cheklanmagan bo'ladi)
4. [`archive/archive.service.ts`](./archive/archive.service.ts) — read va
   commit funksiyalari

`db.ts` store'ni registry'dan o'zi yaratadi.
