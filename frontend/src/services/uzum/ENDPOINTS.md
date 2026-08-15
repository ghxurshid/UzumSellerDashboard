# Uzum Seller OpenAPI — endpointlar ma'lumotnomasi

Bu hujjat loyihada ishlatiladigan **barcha Uzum seller API endpointlarini** tushuntiradi:
har biri nima vazifa bajaradi, qanday parametr qabul qiladi va **nima qaytaradi**.

Manbalar:
- Kod: [`endpoints.ts`](./endpoints.ts), [`types.ts`](./types.ts), [`http.ts`](./http.ts)
- Rasmiy spetsifikatsiya: `frontend/_design/v1/uploads/api-docs.json` (OpenAPI 3, 35 ta path)

---

## 1. Umumiy qoidalar (avval shuni o'qing)

| Nima | Qiymat |
|---|---|
| Base URL | `https://api-seller.uzum.uz/api/seller-openapi/` |
| Avtorizatsiya | `TokenAuth` — har bir so'rovda token header'i |
| Rate limit | Soatiga cheklangan. Shu sabab sahifalar **ketma-ket** o'qiladi, parallel emas |

### Javob "konvert"lari (envelope) — 3 xil shakl bor

Uzum API bir xil emas. Uch xil javob shakli mavjud va `http.ts` uchalasini ham biladi:

| Shakl | Misol endpointlar | Kodda o'qigich |
|---|---|---|
| **Yalang'och massiv** — javobning o'zi ro'yxat | `/v1/shops`, `/v1/invoice`, `/v1/return` | `getRaw()` |
| **`{ payload: … }`** — asosiy ma'lumot `payload` ichida | `/v3/fbs/sku/stocks`, `/v2/fbs/orders`, `/v1/finance/expenses` | `getPayload()` |
| **O'ziga xos obyekt** — nomlangan maydon ichida | `/v1/finance/orders` → `orderItems`, `/v1/product/shop/{id}` → `productList` | `getRaw()` |

### Vaqt formati — eng ko'p xato qilinadigan joy

> **`dateFrom` / `dateTo` so'rov parametrlari — SEKUNDLARDA.**
> **Javob ichidagi barcha timestamp'lar — MILLISEKUNDLARDA.**

Ikkisini aralashtirsangiz API xato bermaydi — shunchaki **bo'sh ro'yxat** qaytaradi.
Shuning uchun konvertatsiya alohida nom olgan: `toApiSeconds()` ([http.ts:150](./http.ts#L150)).

### Sahifalash (pagination)

`paginate()` funksiyasi kolleksiyani oxirigacha o'qib beradi — chaqiruvchi kursor bilan
ovora bo'lmaydi. Lekin **40 sahifalik shift** bor (`MAX_PAGES`): rate limit budjetini
bitta ekran yangilanishiga sarflab yubormaslik uchun.

Natija `PageResult<T>` ko'rinishida qaytadi:

```ts
{
  items: T[],        // o'qilgan yozuvlar
  total: number,     // API aytgan umumiy son (aytmasa — o'qilganlar soni)
  truncated: boolean // true bo'lsa: shift tufayli to'liq o'qilmadi
}
```

Har bir endpointning o'z sahifa hajmi bor (`PAGE_SIZE`, [endpoints.ts:34](./endpoints.ts#L34)):
finance 50, expenses 50, products 100, fbsOrders 50, stocks 100, supplyInvoices 50,
returns 50, fbsInvoices 20.

---

## 2. Akkaunt

### `GET /v1/shops` — do'konlar ro'yxati

**Funksiya:** `fetchShops()`

**Nima qiladi:** Ushbu token ko'ra oladigan barcha do'konlarni qaytaradi.
Bundan tashqari **ulanishni tekshirish** uchun ham ishlatiladi — bu API'dagi eng "arzon"
avtorizatsiyalangan so'rov, ya'ni muvaffaqiyatli javob bir yo'la base URL, token va
tarmoq mavjudligini isbotlaydi.

**Parametrlar:** yo'q

**Qaytaradi:** `UzumShop[]` (yalang'och massiv)

| Maydon | Tur | Ma'nosi |
|---|---|---|
| `id` | number | Do'kon ID — qolgan deyarli barcha endpointlarda `shopId` sifatida kerak |
| `name` | string | Do'kon nomi |

---

## 3. Moliya (Finance)

### `GET /v1/finance/orders` — sotuvlar ro'yxati

**Funksiya:** `fetchFinanceOrderItems(shopIds, window)`

**Nima qiladi:** Berilgan davrdagi **har bir sotilgan pozitsiya** (order item) bo'yicha
moliyaviy tafsilotni qaytaradi. Bu dashboard'dagi daromad, komissiya, sof foyda va
birlik iqtisodiyoti (unit economics) hisob-kitoblarining asosiy manbasi.

**Parametrlar:** `shopIds[]` (majburiy), `dateFrom`/`dateTo` (sekund), `group=false`,
`page`, `size` (50), `statuses[]` (ixtiyoriy)

**Qaytaradi:** `{ orderItems: FinanceOrderItem[], totalElements: number }`

| Maydon | Tur | Ma'nosi |
|---|---|---|
| `id` | number | Pozitsiya ID |
| `orderId` | number | Buyurtma ID |
| `status` | string | `TO_WITHDRAW` \| `PROCESSING` \| `CANCELED` \| `PARTIALLY_CANCELLED` |
| `date` | number (ms) | Sotuv sanasi |
| `dateIssued` | number \| null | Xaridorga topshirilgan sana |
| `productId` / `productTitle` | number / string | Mahsulot |
| `skuTitle` | string | SKU nomi (variant: rang, o'lcham…) |
| `shopId` | number | Qaysi do'kon |
| `sellPrice` | number | Sotuv narxi |
| `amount` | number | Soni |
| `amountReturns` | number | Qaytarilgan soni |
| `commission` | number | Uzum komissiyasi |
| `logisticDeliveryFee` | number | Logistika xarajati |
| `purchasePrice` | number \| null | Tannarx (kiritilgan bo'lsa) |
| `sellerProfit` | number | Sotuvchi foydasi |
| `withdrawnProfit` | number | Yechib olingan foyda |
| `cancelled` | boolean \| null | Bekor qilinganmi |
| `returnCause` / `comment` | string \| null | Qaytarish sababi / izoh |

---

### `GET /v1/finance/orders` (`statuses=CANCELED`, `size=1`) — bekor qilinganlar soni

**Funksiya:** `fetchCancelledCount(shopIds, window)`

**Nima qiladi:** Faqat **sonini** oladi — ro'yxatni emas. Bitta yozuv so'raladi va
javobdagi `totalElements` o'qiladi.

**Nega alohida so'rov?** Yuqoridagi ro'yxat 40 sahifalik shift bilan cheklangan.
Agar bekor qilish foizini o'sha kesilgan ro'yxatdan hisoblasangiz, u "tasodifan
sig'ganlar" foizi bo'lib qoladi. `totalElements` esa haqiqiy maxraj.

**Qaytaradi:** `number` — bekor qilingan pozitsiyalarning umumiy soni.

---

### `GET /v1/finance/expenses` — sotuvchi xarajatlari

**Funksiya:** `fetchExpenses(shopIds, window)`

**Nima qiladi:** Davr ichidagi barcha to'lov/xarajat operatsiyalarini qaytaradi —
reklama, logistika, jarimalar, hisob-kitoblar va h.k.

**Parametrlar:** `shopIds[]`, `dateFrom`/`dateTo` (sekund), `page`, `size` (50)

**Qaytaradi:** `payload: { payments: SellerPayment[], totalElements }`

> ⚠️ **Real serverda `totalElements` HAR DOIM `0` qaytadi** — yozuvlar bor bo'lsa ham
> (real namunada: `payments` to'la, `totalElements: 0`). Batafsil: 12-bo'lim, №1.

| Maydon | Tur | Ma'nosi |
|---|---|---|
| `id` | number | Operatsiya ID |
| `dateCreated` / `dateUpdated` | number (ms) | Yaratilgan / yangilangan |
| `dateService` | number \| null | Xizmat ko'rsatilgan sana |
| `name` | string | Operatsiya nomi |
| `source` | string | Kategoriya — masalan `Logistika`, `Marketing` (erkin matn) |
| `type` | string | `INCOME` (kirim) yoki `OUTCOME` (chiqim) |
| `paymentPrice` / `amount` | number | Summa / miqdor |
| `status` | string | Holati |
| `shopId` / `sellerId` | number | Do'kon / sotuvchi |
| `code`, `externalId` | string | Tashqi identifikatorlar |

---

## 4. Katalog (Mahsulotlar)

### `GET /v1/product/shop/{shopId}` — do'kon mahsulotlari

**Funksiya:** `fetchShopProducts(shopId)`

**Nima qiladi:** Do'kondagi barcha mahsulotlarni SKU'lari, qoldiqlari va
analitik ko'rsatkichlari bilan qaytaradi. Products sahifasi va portfel reytingi
shu ma'lumotdan quriladi.

**Parametrlar:** `shopId`, `page`, `size` (100), `sortBy=ORDERS`, `order=DESC`,
`filter=ALL` (spec'da yana `searchQuery`, `productRank` ham bor — kodda ishlatilmaydi)

**Qaytaradi:** `{ productList: ShopProduct[], totalProductsAmount, totalProductsAmountWithoutWeightDimensional }`

> ⚠️ Bu route'da **`totalElements` ham, `totalPages` ham YO'Q**. Umumiy son
> `totalProductsAmount` deb ataladi. Kod `totalElements` ni o'qiydi → `undefined`.
> Batafsil: 12-bo'lim, №2.

**Mahsulot darajasi (`ShopProduct`):**

| Maydon | Ma'nosi |
|---|---|
| `productId`, `title`, `category` | Asosiy ma'lumot |
| `status` | `{ id, value, title, description, color }` — real qiymatlar quyida |
| `rating`, `feedbackQuantity` | Reyting va sharhlar soni |
| `image`, `previewImg` | Rasmlar |
| `price` | Narx |
| `quantityCreated` | Jami yaratilgan |
| `quantityAvailable` | Sotuvga tayyor qoldiq |
| `quantityActive` | Faol qoldiq |
| `quantityFbs` | FBS omborida |
| `quantitySold` | Sotilgan |
| `quantityReturned` | Qaytarilgan |
| `returnedPercentage` | Qaytarish foizi |
| `roi`, `conversion`, `clicks`, `viewers` | Marketing ko'rsatkichlari |
| `rankInfo` | `{ rank, rankValue, dateUpdated }` — katalogdagi o'rin |
| `skuList` | Variantlar ro'yxati (quyida) |

**SKU darajasi (`ProductSku`) — mahsulot varianti:**

| Maydon | Ma'nosi |
|---|---|
| `skuId`, `skuTitle`, `skuFullTitle` | SKU identifikatori va nomi |
| `barcode` | Shtrix-kod |
| `characteristics` | Xususiyatlari (rang, o'lcham…) |
| `price`, `purchasePrice` | Sotuv narxi / tannarx |
| `quantity*` | Yuqoridagi kabi, lekin SKU kesimida |
| `quantityMissing`, `quantityDefected` | Yo'qolgan / brak |
| `commission`, `turnover` | Komissiya, aylanma |
| `sellerItemCode` | Sotuvchining ichki artikuli |
| `archived`, `blocked` | Arxivlangan / bloklangan |

**`status.value` ning real qiymatlari** (52 ta mahsulot namunasidan):

| Qiymat | `title` | Nechta |
|---|---|---|
| `IN_STOCK` | Sotuvda | 23 |
| `RUN_OUT` | Tugadi | 21 |
| `ARCHIVED` | Arxiv | 5 |
| `BLOCKED` | Bloklangan | 1 |
| — | `status` maydoni umuman yo'q | 2 |

> ⚠️ **`ACTIVE` degan qiymat yo'q** — sotuvdagi mahsulot `IN_STOCK` deb ataladi.
> Kod esa `ACTIVE` ni kutadi. Batafsil: 12-bo'lim, №4.

---

### `POST /v1/product/{shopId}/sendPriceData` — narxlarni o'zgartirish

**Funksiya:** `sendPriceData(shopId, entries)`

**Nima qiladi:** Bir yoki bir nechta SKU narxini yangilaydi. **Yozuv operatsiyasi** —
haqiqiy narxlar o'zgaradi.

**Body:** `{ skuList: [{ skuId, fullPrice, sellPrice }] }`

- `fullPrice` — chizilgan (eski) narx
- `sellPrice` — haqiqiy sotuv narxi
- Har ikkisi uchun spec cheklovi: **1 … 999 999 000**

**Qaytaradi:** aniq foydali tarkib yo'q — muvaffaqiyat/xato sifatida qaraladi.

---

## 5. FBS qoldiqlari (Stocks)

### `GET /v3/fbs/sku/stocks` — SKU qoldiqlari

**Funksiya:** `fetchSkuStocks()`

**Nima qiladi:** FBS/DBS sxemasi bo'yicha **yangilash mumkin bo'lgan** qoldiqlarni
qaytaradi (`sku_id` bo'yicha tartiblangan).

**Parametrlar:** `page`, `size` (100)

**Qaytaradi:** `payload: { skuAmountList: SkuAmount[] }` — **`totalElements` yo'q**
(real javobda `payload` ichida faqat `skuAmountList` bor)

| Maydon | Ma'nosi |
|---|---|
| `skuId`, `skuTitle`, `productTitle` | SKU va mahsulot |
| `barcode` | Shtrix-kod — **yangilashda majburiy**, unikal bo'lishi kerak |
| `amount` | Joriy qoldiq |
| `fbsAllowed` / `dbsAllowed` | Ushbu sxema bo'yicha ishlashga ruxsat bormi |
| `fbsLinked` / `dbsLinked` | Ushbu sxemaga ulanganmi |
| `sellerSkuCode` | Sotuvchining ichki kodi |

> `GET /v2/fbs/sku/stocks` — **eskirgan** (deprecated), sahifalashsiz. Loyihada ishlatilmaydi.

---

### `POST /v2/fbs/sku/stocks` — qoldiqlarni yangilash

**Funksiya:** `updateSkuStocks(entries)`

**Nima qiladi:** FBS va DBS qoldiqlarini o'zgartiradi. **Yozuv operatsiyasi.**

**Body:** `{ skuAmountList: [{ skuId, barcode, amount }] }`

`barcode` va `amount` majburiy; `skuId` ixtiyoriy (identifikatsiya `barcode` orqali).

---

## 6. FBS / DBS buyurtmalari

### Buyurtma statuslari — ish oqimi tartibida

`CREATED` → `PACKING` → `PENDING_DELIVERY` → `DELIVERING` → `DELIVERED` → `COMPLETED`

Yon holatlar: `CANCELED`, `RETURNED`

### `GET /v2/fbs/orders` — buyurtmalar ro'yxati

**Funksiya:** `fetchFbsOrders(shopIds, window, status)`

**Nima qiladi:** Berilgan statusdagi buyurtmalarni qaytaradi. **Status majburiy** —
ya'ni "barcha buyurtmalar"ni bitta so'rovda olib bo'lmaydi, har bir status uchun
alohida so'rov kerak.

**Parametrlar:** `shopIds[]`, `dateFrom`/`dateTo` (sekund), `status`, `page`, `size` (50)

**Qaytaradi:** `payload: { orders: FbsOrder[] }` — **`totalElements` yo'q**
(shu sabab `orders/count` alohida chaqiriladi)

| Maydon | Ma'nosi |
|---|---|
| `id` | Buyurtma ID |
| `status` | Joriy status |
| `scheme` | Sxema — FBS yoki DBS |
| `shopId` | Do'kon |
| `dateCreated` | Yaratilgan (ms) |
| `dateAcceptUntil` | **Qabul qilish muddati** — o'tkazib yuborilsa buyurtma bekor bo'ladi |
| `dateDeliverUntil` | **Yetkazish muddati** |
| `price` | Summa |
| `dropOffPoint` | `{ title, address }` — topshirish punkti |
| `orderItems[]` | `{ id, skuId, skuTitle, productTitle, amount, price }` |

> `orderItems[].id` — bu **pozitsiya ID** (`orderItemId`), identifikator biriktirishda kerak bo'ladi.

---

### `GET /v2/fbs/orders/count` — buyurtmalar soni

**Funksiya:** `fetchFbsOrderCount(shopIds, window, status)`

**Nima qiladi:** Ro'yxatni yuklamasdan faqat **sonini** qaytaradi. KPI va status
badge'lari uchun arzon so'rov — 8 ta status uchun 8 ta yengil so'rov, ro'yxatlarni
yuklashdan ancha tejamli.

**Qaytaradi:** `payload: number`

---

### `POST /v1/fbs/order/{orderId}/confirm` — buyurtmani tasdiqlash

**Funksiya:** `confirmFbsOrder(orderId)`

**Nima qiladi:** Buyurtmani qabul qiladi — ya'ni "yig'ishga olaman" deb tasdiqlaydi.
Odatda `CREATED` → `PACKING` o'tishi.

**Body:** yo'q. **Qaytaradi:** yangilangan buyurtma obyekti.

---

### `POST /v1/fbs/order/{orderId}/cancel` — buyurtmani bekor qilish

**Funksiya:** `cancelFbsOrder(orderId, { reason, comment? })`

**Nima qiladi:** Buyurtmani bekor qiladi. `reason` **majburiy** va faqat quyidagi
qiymatlardan biri bo'lishi mumkin:

| Kod | Ma'nosi |
|---|---|
| `OUT_OF_STOCK` | Tovar qolmagan |
| `OUT_OF_PACKAGE` | Qadoq yo'q |
| `OUT_OF_TIME` | Ulgurmadi |
| `ACCEPTANCE_TIME_EXPIRED` | Qabul muddati o'tdi |
| `DELIVERY_TIME_EXPIRED` | Yetkazish muddati o'tdi |
| `RETURNED_BY_CUSTOMER` | Xaridor qaytardi |
| `CANCELED_BY_CUSTOMER` | Xaridor bekor qildi |
| `MARKET_REASON` | Marketplace sababi |
| `OTHER` | Boshqa |

---

### `POST /v1/fbs/order/{orderId}/identifier` — identifikator biriktirish

**Funksiya:** `bindOrderIdentifiers(orderId, body)`

**Nima qiladi:** Buyurtma pozitsiyalariga identifikatorlarni (IMEI, seriya raqami,
marking kodi kabi) paketli biriktiradi — nazorat qilinadigan tovarlar uchun.

**Spec bo'yicha body:** `{ items: [{ orderItemId, values: string[] }] }`
Qiymatlar takrorlanmasligi kerak.

---

### `GET /v1/fbs/order/return-reasons` — qaytarish sabablari ma'lumotnomasi

**Funksiya:** `fetchReturnReasons()`

**Nima qiladi:** Bekor qilish/qaytarish sabablari ro'yxatini qaytaradi — UI'dagi
dropdown shundan to'ldiriladi, ro'yxat kodga qotirilmaydi.

**Qaytaradi:** `payload.reasons: [{ reason, title }]`

Real serverdan kelgan ro'yxat — **spec'dagi 9 ta enumdan faqat 4 tasi**, `title` esa
o'zbek tilida tayyor holda keladi:

| `reason` | `title` |
|---|---|
| `OUT_OF_STOCK` | Tovar yoʻq |
| `OUT_OF_PACKAGE` | Qadoq yoʻq |
| `OUT_OF_TIME` | Yigʻishga ulgurmayapman |
| `OTHER` | Boshqa sabab |

Qolgan enum qiymatlari (`ACCEPTANCE_TIME_EXPIRED`, `CANCELED_BY_CUSTOMER` va h.k.) —
tizim o'zi qo'yadigan sabablar, sotuvchi tanlay olmaydi.

---

## 7. DBS — sotuvchi o'zi yetkazadi

DBS (Delivery by Seller) — yetkazishni sotuvchining o'zi bajaradi, shuning uchun
statuslarni ham qo'lda o'tkazadi.

### `POST /v1/dbs/order/{orderId}/delivering` — yetkazishga uzatish

**Funksiya:** `deliverDbsOrder(orderId)` → status `DELIVERING` bo'ladi.

### `POST /v1/dbs/order/{orderId}/completed` — topshirilganini tasdiqlash

**Funksiya:** `completeDbsOrder(orderId, { issueCode })`

Xaridor tasdig'i talab qilinsa, `issueCode` — xaridor aytadigan topshirish kodi.
Status `COMPLETED` bo'ladi.

### `POST /v1/dbs/order/{orderId}/refund` — qaytarish rasmiylashtirish

**Funksiya:** `refundDbsOrder(orderId)` — allaqachon topshirilgan DBS buyurtma bo'yicha
qaytarish yaratadi.

---

## 8. FBO — yetkazib berish va qaytarish nakladnoylari

FBO (Fulfilment by Operator) — tovar Uzum omboriga topshiriladi.

### `GET /v1/invoice` — yetkazib berish nakladnoylari

**Funksiya:** `fetchSupplyInvoices()`

**Nima qiladi:** Uzum omboriga qilingan yetkazib berishlar ro'yxatini qaytaradi.

**Parametrlar:** `page`, `size` (50). **Diqqat:** javob yalang'och massiv —
umumiy son (`totalElements`) yo'q, shuning uchun progress foizini ko'rsatib bo'lmaydi.

**Qaytaradi:** `SupplyInvoice[]`

| Maydon | Ma'nosi |
|---|---|
| `id`, `invoiceNumber` | Nakladnoy ID va raqami |
| `shopId`, `shopTitle` | Do'kon |
| `dateCreated` | Yaratilgan (bu yerda **string**) |
| `dateAccepted` | Qabul qilingan (ms) |
| `invoiceStatus` | `{ value, text, color }` |
| `fullPrice` | Umumiy summa |
| `totalToStock` | Topshirish rejalashtirilgan soni |
| `totalAccepted` | Ombor **haqiqatda qabul qilgan** soni |
| `stock` | `{ id, title, address, externalId }` — ombor |
| `timeSlotReservation` | `{ id, status, timeFrom, timeTo }` — band qilingan vaqt |
| `productForInvoiceDto[]` | Tarkibi (ba'zan bo'sh — quyidagi endpoint kerak bo'ladi) |

> `totalToStock` va `totalAccepted` farqi — nesortitsa (yo'qotish) ko'rsatkichi.

---

### `GET /v1/shop/{shopId}/invoice/products` — nakladnoy tarkibi

**Funksiya:** `fetchSupplyInvoiceProducts(shopId, invoiceId)`

**Nima qiladi:** Bitta nakladnoyga kirgan tovarlar ro'yxatini qaytaradi.

**Qaytaradi:** `InvoiceProduct[]`

| Maydon | Ma'nosi |
|---|---|
| `id`, `productTitle`, `skuTitle` | Tovar |
| `quantityToStock` | Topshirilgan soni |
| `quantityAccepted` | Qabul qilingan soni |
| `purchasePrice` | Tannarx |
| `skuForInvoiceDtoList[]` | SKU kesimida yana o'sha maydonlar + `issue` (muammo izohi) |

---

### `GET /v1/return` — ombordan qaytarishlar

**Funksiya:** `fetchReturns()`

**Nima qiladi:** Uzum omboridan sotuvchiga qaytarilayotgan tovarlar ro'yxati
(brak, muddati o'tgan, arxivlangan tovarlar va h.k.).

**Parametrlar:** `page`, `size` (50). Javob — yalang'och massiv, umumiy sonsiz.

**Qaytaradi:** `SellerReturn[]`

| Maydon | Ma'nosi |
|---|---|
| `id`, `externalNumber` | Qaytarish ID va tashqi raqam |
| `dateCreated` | Sana (ms) |
| `status`, `type` | Holati va turi |
| `shopId`, `shopTitle` | Do'kon |
| `stock` | Qaysi ombordan |
| `totalAmount` | Qaytarilishi kerak bo'lgan jami |
| `totalPackedAmount` | Qadoqlangan jami |
| `returnItems[]` | `{ id, skuId, skuTitle, productTitle, amount, packedAmount, purchasePrice }` |

---

## 9. FBS jo'natma nakladnoylari

FBS'da sotuvchi buyurtmalarni yig'ib, ularni **bitta nakladnoyga** birlashtiradi va
belgilangan vaqtda qabul punktiga (drop-off point) topshiradi.

### `GET /v1/fbs/invoice` — nakladnoylar ro'yxati

**Funksiya:** `fetchFbsInvoices()`

**Parametrlar:** `statuses[]` (majburiy) — `CREATED`, `ACCEPTANCE_IN_PROGRESS`,
`ACCEPTED`, `CANCELLED`; `page`, `size` (20)

> ⚠️ **`statuses` bo'lmasa `400 Bad request`** (`bad-request-001`) qaytadi — real
> namunada shu tasdiqlangan. Kod `statuses` ni yuboradi, ya'ni to'g'ri ishlaydi.
>
> Bu route ba'zi serverlarda yalang'och massiv, ba'zilarida `{ invoices: [...] }`
> qaytaradi — kod ikkalasini ham qabul qiladi ([endpoints.ts:325](./endpoints.ts#L325)).
> Namunadagi yagona chaqiruv 400 bilan tugagani uchun **javob shakli tasdiqlanmagan**.

**Qaytaradi:** `FbsInvoice[]`

| Maydon | Ma'nosi |
|---|---|
| `id`, `number` | Nakladnoy ID va raqami |
| `status` | Holati |
| `dateCreated` | Sana (ms) |
| `numberOrders` | Nakladnoydagi buyurtmalar soni |
| `numberAcceptedOrders` | Qabul qilinganlari soni |
| `fullPrice` / `acceptedPrice` | Umumiy / qabul qilingan summa |
| `dropOffPoint` | `{ title, address }` |
| `timeSlot` | `{ timeFrom, timeTo }` |

---

### `POST /v1/fbs/invoice` — nakladnoy yaratish

**Funksiya:** `createFbsInvoice({ orderIds, dropOffPointUuid, timeSlotUuid, idempotencyKey })`

**Nima qiladi:** Tanlangan buyurtmalarni bitta jo'natmaga birlashtiradi va
qabul punkti + vaqt oynasini band qiladi.

- `dropOffPointUuid` — `GET /v1/fbs/invoice/dop/drop-off-points` dan olinadi
- `timeSlotUuid` — `GET /v1/fbs/invoice/dop/time-slot` dan olinadi
- `idempotencyKey` — takroriy so'rov ikkinchi nakladnoy yaratmasligi uchun
- Spec `sellerId` ni ham majburiy deb belgilagan

---

### `POST /v1/fbs/invoice/{invoiceId}/cancel` — nakladnoyni bekor qilish

**Funksiya:** `cancelFbsInvoice(invoiceId)`

### `POST /v1/fbs/invoice/{invoiceId}/update-content` — tarkibini o'zgartirish

**Funksiya:** `updateFbsInvoiceContent(invoiceId, { customerOrderId, idempotencyKey })`

Mavjud nakladnoyga buyurtma qo'shadi/olib tashlaydi.

### `POST /v1/fbs/invoice/dop/time-slot` — punkt va vaqtni o'zgartirish

**Funksiya:** `updateFbsInvoiceTimeSlot({ invoiceId, dropOffPointUuid, timeSlotUuid, idempotencyKey })`

Yaratilgan nakladnoyning topshirish punkti va vaqt oynasini yangilaydi.

---

## 10. Chop etiladigan hujjatlar

> **Muhim:** bu endpointlarning barchasi PDF'ni **binary oqim emas, Base64 satr**
> sifatida qaytaradi. Chaqiruvchi uni o'zi `Blob` ga aylantiradi.

| Endpoint | Funksiya | Nima chiqadi |
|---|---|---|
| `GET /v1/fbs/order/{orderId}/labels/print` | `fetchOrderLabel(orderId, size)` | Buyurtma yorlig'i (etiketka) |
| `GET /v1/product/barcodes/types` | `fetchBarcodeTypes()` | Etiketka **o'lchamlari ma'lumotnomasi** |
| `POST /v1/product/shop/{shopId}/barcodes/print` | `printSkuBarcodes(shopId, body)` | SKU shtrix-kod etiketkalari |
| `GET /v1/fbs/invoice/{invoiceId}/print` | `fetchSupplyAct(invoiceId)` | **Yetkazib berish akti** |
| `GET /v1/fbs/invoice/{invoiceId}/closing-documents` | `fetchAcceptanceAct(invoiceId)` | **Qabul qilish akti** |

**Etiketka chop etish tartibi:**
1. `fetchBarcodeTypes()` → o'lchamlar ro'yxati `{ id, title, printType }`
2. Foydalanuvchi o'lcham tanlaydi → uning `id` si `barcodeTypeId` bo'ladi
3. `printSkuBarcodes()` chaqiriladi

**Cheklovlar:** bir so'rovda **100 tadan ko'p SKU emas** va har bir SKU uchun
**100 tadan ko'p etiketka emas**.

---

## 11. Loyihada hali ishlatilmayotgan endpointlar

Bular OpenAPI hujjatda bor, lekin `endpoints.ts` da yo'q:

| Endpoint | Nima qilardi | Izoh |
|---|---|---|
| `GET /v1/fbs/invoice/dop/drop-off-points` | Mos qabul punktlari ro'yxati | **Kerak bo'ladi** — `createFbsInvoice` uchun `dropOffPointUuid` shu yerdan |
| `GET /v1/fbs/invoice/dop/time-slot` | Bo'sh vaqt oynalari | **Kerak bo'ladi** — `timeSlotUuid` shu yerdan |
| `GET /v1/fbs/order/{orderId}` | Bitta buyurtma tafsiloti | Ro'yxatdan olinayotgani uchun hozircha shart emas |
| `GET /v1/fbs/invoice/{invoiceId}` | Bitta nakladnoy tafsiloti | — |
| `GET /v1/fbs/invoice/{invoiceId}/orders` | Nakladnoydagi buyurtmalar | Nakladnoy tafsiloti ekrani uchun foydali |
| `GET /v1/shop/{shopId}/invoice` | Do'kon kesimidagi yetkazib berish nakladnoylari | `/v1/invoice` ning do'konga cheklangan varianti |
| `GET /v1/shop/{shopId}/return` | Do'kon kesimidagi qaytarishlar | `/v1/return` ning do'konga cheklangan varianti |
| `GET /v1/shop/{shopId}/return/{returnId}` | Bitta qaytarish tarkibi | — |
| `GET /v2/fbs/sku/stocks` | Qoldiqlar (sahifalashsiz) | **Eskirgan** — `/v3` ishlatiladi |

> `drop-off-points` va `time-slot` GET'lari qo'shilmaguncha, FBS nakladnoy yaratish
> oqimi to'liq ishlamaydi — UUID'larni boshqa yo'l bilan olib bo'lmaydi.

---

## 12. Real javoblar bilan tekshiruv natijalari

**Dalil manbasi:** `frontend/_design/v1/uploads/uzum-samples.json` — 2026-08-10 da
real serverga qilingan **30 ta so'rov** yozuvi (28 tasi muvaffaqiyatli), do'konlar
54951 va 115015, 60 kunlik oyna.

> ⚠️ **Namunani o'qiyotganda:** dump vositasi `sampleLimit: 25` bilan ishlagan, ya'ni
> uzun massivlar ~26 tagacha qirqilgan. Shuning uchun massiv **uzunligidan** xulosa
> chiqarib bo'lmaydi; maydonlarning **bor/yo'qligi** va skalyar qiymatlar esa ishonchli.

### 12.1. Tasdiqlangan — kod to'g'ri ishlayapti

| Nima | Dalil |
|---|---|
| `dateFrom`/`dateTo` **sekundlarda** | Maxsus ikkita probe qilingan: `ms` bilan → `totalElements: 0`, `sec` bilan → `totalElements: 3353`. Xato bermaydi, jimgina bo'sh qaytaradi |
| Uch xil konvert shakli | `/v1/shops`, `/v1/invoice`, `/v1/return` → yalang'och massiv. `/v3/fbs/sku/stocks`, `/v2/fbs/orders`, `/v1/finance/expenses`, `return-reasons` → `{payload, timestamp}`. `/v1/finance/orders`, `/v1/product/shop/{id}` → o'ziga xos obyekt |
| `return-reasons` → `payload.reasons` | Tasdiqlandi |
| `/v1/fbs/invoice` uchun `statuses` majburiy | `statuses`siz chaqiruv `400 bad-request-001` bergan |
| `/v1/finance/orders` da `totalElements` haqiqiy | 3353 — `fetchCancelledCount` mantiqi to'g'ri |
| `orders/count` → `payload` — oddiy son | `{"payload": 0, "timestamp": …}` |
| `SellerPayment` maydonlari | To'liq mos: `source`, `code`, `type`, `dateService` va h.k. |

### 12.2. Tasdiqlangan xatolar

№1, №2, №3 — **tuzatildi**. №4 — API cheklovi, tuzatib bo'lmaydi.

**№1 — `/v1/finance/expenses` `totalElements: 0` qaytaradi, natijada sahifalash to'xtaydi** ✅ tuzatildi

Real namunada `page=0` va `page=1` — ikkalasida ham yozuvlar to'la, lekin
`totalElements: 0`.

`paginate()` mantiqi ([http.ts:136](./http.ts#L136)):

```ts
if (reported !== undefined && collected.length >= reported) break;  // 50 >= 0 → chiqib ketadi
```

Natija: **xarajatlar faqat 1-sahifa (50 ta yozuv) o'qilardi**, qolgani yo'qolardi.
Qaytgan `total` ham `0` bo'lardi, `truncated` esa `false` — ya'ni UI "hammasi shu"
deb o'ylardi. Xarajatlar bo'yicha barcha hisob-kitoblar kam chiqardi.

**Tuzatish:** `paginate()` endi `0` ni "noma'lum" deb qabul qiladi, "hech narsa" deb
emas — faqat musbat `total` hisobga olinadi. Sahifalash oddiy tartibda davom etadi:
qisqa sahifa kelguncha yoki `MAX_PAGES` gacha.

**№2 — `/v1/product/shop/{shopId}` da `totalElements` degan maydon yo'q** ✅ tuzatildi

Real javob: `{ productList, totalProductsAmount, totalProductsAmountWithoutWeightDimensional }`.
Namunada `totalProductsAmount: 55` (54951-do'kon), `38` (115015-do'kon).

Kod `body.totalElements` ni o'qirdi → `undefined` → `total` sifatida o'qilgan yozuvlar
soni qaytardi. Sahifalash o'zi ishlardi (sahifa hajmi evristikasi bilan), lekin
umumiy son va progress foizi noto'g'ri edi.

**Tuzatish:** `ShopProductsResponse` da maydon `totalProductsAmount` deb qayta
nomlandi va `fetchShopProducts` o'shani o'qiydi.

**№3 — Mahsulot statusi `ACTIVE` emas, `IN_STOCK`** ✅ tuzatildi

52 ta real mahsulotda uchraganlari: `IN_STOCK` (23), `RUN_OUT` (21), `ARCHIVED` (5),
`BLOCKED` (1), statussiz (2). **`ACTIVE` umuman yo'q.**

`narrowStatus()` ([derive/products.ts:23](../derive/products.ts#L23)) esa
`KNOWN_STATUSES` ichida `ACTIVE`, `INACTIVE`, `RUN_OUT`, `ARCHIVED`, `DEFECTED`,
`WARNING` ni izlaydi va topilmasa `INACTIVE` qaytaradi.

Oqibati:
- Sotuvdagi 23 ta mahsulot ham **`INACTIVE`** bo'lib ko'rinardi
- `BLOCKED` ham `INACTIVE` ga tushardi
- Products sahifasidagi **`ACTIVE` filtri hech qachon hech narsa topmasdi**
  ([useProductTable.ts:27](../../features/products/useProductTable.ts#L27))

**Tuzatish:** `narrowStatus` ga `STATUS_ALIASES` jadvali qo'shildi —
`IN_STOCK → ACTIVE`, `BLOCKED → WARNING`. Domen so'z boyligi (`ProductStatus`)
o'zgarmadi; tarjima aynan chegara nuqtasida bajariladi. `BLOCKED` uchun rang
`warning` bo'ladi — `STATUS_TONE` da bu allaqachon bor.

**№4 — `/v2/fbs/orders` va `/v3/fbs/sku/stocks` da `totalElements` yo'q** ℹ️ API cheklovi

Real `payload` ichida faqat `orders` / `skuAmountList` bor. Kod buni ixtiyoriy deb
belgilagani uchun ishlaydi, lekin progress foizini ko'rsatib bo'lmaydi va `total`
o'qilgan yozuvlar soniga teng bo'ladi.

### 12.3. Hal qilinmagan — namunada dalil yo'q

Dump vositasi faqat **GET** so'rovlarini yozgan. Quyidagi endpointlar umuman
chaqirilmagan, shuning uchun kod va OpenAPI orasidagi ziddiyat **ochiq qolmoqda**.
Bularni real token bilan sinab ko'rish kerak:

| Funksiya | Kod nima yuboradi/kutadi | OpenAPI nima deydi |
|---|---|---|
| `bindOrderIdentifiers` | `{ orderItemId, type, values }` | `{ items: [{ orderItemId, values }] }` — massiv, `type` yo'q |
| `printSkuBarcodes` | `{ barcodeTypeId, skus: [{ skuId, labelCount }] }` | `{ data: [{ skuId, amount, barcodeTypeId }] }` |
| `fetchBarcodeTypes` | `payload` — massiv | `payload.barcodeLabelTypes` — massiv |
| `fetchOrderLabel` | `payload` — satr | `payload.document` — satrlar **massivi** |
| `fetchSupplyAct` / `fetchAcceptanceAct` | `payload` — satr | `payload.document` — satr |
| `completeDbsOrder` | `issueCode` body'da, satr | `issueCode` **query param**, butun son |
| `createFbsInvoice` | `sellerId` yo'q | `sellerId` majburiy |
| `updateFbsInvoiceContent` | `sellerId` yo'q | `sellerId` majburiy |

Bulardan **`fetchBarcodeTypes`, `fetchOrderLabel`, `fetchSupplyAct`,
`fetchAcceptanceAct`** eng shubhalilari: agar spec to'g'ri bo'lsa, kod `payload`
o'rniga `payload.document` ni olishi kerak — hozircha PDF o'rniga obyekt qaytadi
va Base64 dekodlash buziladi.

### 12.4. Kichik kuzatuvlar

- `fetchSupplyInvoiceProducts` da `page`/`size` yuboriladi, spec'da bunday parametr
  yo'q — lekin real so'rov `200` bergan, ya'ni server e'tiborsiz qoldiradi. Zararsiz.
- `FinanceOrderItem` da real javobda `productImage` maydoni ham bor —
  `types.ts` da yo'q. Kerak bo'lsa qo'shsa bo'ladi.
- `SellerReturn` da real javobda ko'proq maydon bor: `paidStorage`, `executionDate`,
  `assembledDate`, `completedDate`, `canceledDate`, `ettnInfo`, `returnDropInfo`,
  `countAllowedChange`.
- `SupplyInvoice` da qo'shimcha: `deliveryCertificate`, `remainingAmountOfUpdates`,
  `expressAcceptanceDate`, `ettnDto`.
- `/v1/shop/{shopId}/invoice` `/v1/invoice` dan **farq qiladi**: `shopId`/`shopTitle`
  va `productForInvoiceDto` yo'q, o'rniga `status`, `hasIssue`, `externalNumber`,
  `invoiceEttn`, `createdInvoiceCount` bor.
- `/v1/finance/orders` da `group=true` **butunlay boshqa shakl** qaytaradi:
  mahsulot bo'yicha guruhlangan, ichida `items[]` va `image` obyektlari. Kod
  `group=false` ishlatadi — to'g'ri.
- Real xarajat kategoriyalari (`source`): `Logistika`, `Marketing`, va bo'sh satr.
  `code` qiymatlari: `logistics-volume`, `return-logistics-volume`, `У000120`.
- Real qaytarish turlari (`type`): `RETURN`, `DEFECTED`.
- Real FBO nakladnoy statuslari: `ACCEPTANCE_IN_PROGRESS`, `ACCEPTED`.
- Rate limit haqiqiy: namunadagi bitta so'rov (`fbs_orders_RETURNED`) **429** bilan
  qaytgan — ketma-ket o'qish qarori asosli.
