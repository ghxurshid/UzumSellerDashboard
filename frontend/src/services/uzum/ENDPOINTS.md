# Uzum Seller OpenAPI — endpointlar ma'lumotnomasi

Bu hujjat loyihada ishlatiladigan **barcha Uzum seller API endpointlarini** tushuntiradi:
har biri nima vazifa bajaradi, qanday parametr qabul qiladi va **nima qaytaradi**.

Manbalar:
- Kod: [`endpoints.ts`](./endpoints.ts), [`types.ts`](./types.ts), [`http.ts`](./http.ts)
- Rasmiy spetsifikatsiya: `frontend/_design/v1/uploads/api-docs.json` (OpenAPI 3, 35 ta path)

> 1–12-bo'limlar — **seller OpenAPI** (`/api/seller-openapi/`). Brauzer kengaytmasi
> ishlatadigan **kabinetning ichki API'si** (`/api/seller/`) bu API emas: u alohida,
> dalili ancha kuchsiz va [13-bo'limda](#13-kabinetning-ichki-apisi-openapi-emas)
> ajratib yozilgan.

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
Shuning uchun konvertatsiya alohida nom olgan: `toApiSeconds()` ([http.ts:171](./http.ts#L171)).

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
| `sellPrice` | number | Sotuv narxi — **bir dona uchun** bo'lishi ehtimoli katta, lekin to'liq isbotlanmagan (12.3) |
| `amount` | number | Soni |
| `amountReturns` | number | Qaytarilgan soni |
| `commission` | number | Uzum komissiyasi — butun pozitsiya uchun |
| `logisticDeliveryFee` | number | Logistika xarajati — butun pozitsiya uchun |
| `purchasePrice` | number \| null | Tannarx (kiritilgan bo'lsa) — dona yoki pozitsiya uchun ekani isbotlanmagan |
| `sellerProfit` | number | Sotuvchi foydasi — butun pozitsiya uchun: `sellPrice × amount − commission − logisticDeliveryFee` |
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
> qaytaradi — kod ikkalasini ham qabul qiladi ([endpoints.ts:338](./endpoints.ts#L338)).
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

`paginate()` mantiqi ([http.ts:118](./http.ts#L118)):

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

`narrowStatus()` ([derive/products.ts:36](../derive/products.ts#L36)) esa
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

**`/v1/finance/orders` — `sellPrice` bir donaniki mi, pozitsiyaniki mi** ⚠️ dalil kam

Bu GET so'rov namunada bor, lekin savolni hal qiladigan qatorlar juda kam.

| Rejim | Namunadagi dalil | Nimani ko'rsatadi |
|---|---|---|
| `group=false` (kod shuni ishlatadi) | 50 qator, ulardan **faqat 1 tasida** `amount > 1`: `sellPrice 48 900`, `amount 2`, `commission 24 450`, `logisticDeliveryFee 11 000`, `sellerProfit 62 350` | `48 900 × 2 − 24 450 − 11 000 = 62 350` — ya'ni `sellPrice` **bir dona** narxi, pul maydonlari esa butun pozitsiya uchun. `amount = 1` bo'lgan qolgan qatorlarda ikkala o'qish ham bir xil natija beradi |
| `group=true` | Guruh ichidagi `items[]` da `sellPrice` guruh bo'yicha jami (`54 800 − 11 757 − 11 000 = 32 043`, `amount 2`) | Guruh summasi — yuqoridagiga zid emas |

Kodga ta'siri:
- `derive/finance.ts` (`summariseFinance`) va `derive/series.ts` (`buildSeries`)
  tushumni `Σ sellPrice` deb oladi.
- `storage/idb/mappers.ts` (`revenue`), analitika worker'i va Copilot lookup'lari
  (`insights/datasets.ts`) esa `sellPrice × amount` ishlatadi.
- Ikkalasi faqat `amount > 1` bo'lgan qatorlarda farq qiladi. Agar `sellPrice`
  bir donaniki bo'lsa, ekrandagi tushum va sof foyda bunday qatorlarda kam
  chiqadi.
- `purchasePrice` ning birligi ham shu sabab bilan ochiq.

**Hal qilish uchun:** `amount > 1` bo'lgan bir necha real `group=false` qatorini
yozib olish va `sellerProfit` ayniyatini tekshirish. Keyin ikkala formula bitta
qilinadi.

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

---

## 13. Kabinetning ichki API'si (OpenAPI emas)

Bu bo'limdagi hech narsa yuqoridagi 1–12-bo'limlarga tegishli emas. Uni
saytning o'zi chaqirmaydi: faqat brauzer kengaytmasi
([`extension/`](../../../../extension/src/uzum/routes.ts)), sotuvchining ochiq
kabinet varag'i orqali (kabinetning o'zi ham shu yo'llarni chaqiradi — yozib
olingan so'rovlar uniki). Hujjatlashtirilmagan API: u haqida bilganimiz faqat yozib
olingan trafik. Kod **o'nta** marshrutni chaqiradi: mahsulot ro'yxati (13.3 — ikkita
yozib olingan so'rov, bitta javob) va to'qqizta kichigi (13.6 — bittadan namuna,
do'konlar ro'yxatida ikkitadan), bunga bitta sessiya namunasi qo'shiladi (13.4).
To'qqiztasi `GET`; sharhlar ro'yxati — yagona `POST`, u ham o'qish (13.6).
Javoblarning maydonma-maydon shakli bu yerda **takrorlanmaydi**:
[API-REQUEST-RESPONSE.md, 5.B](../../../../docs/API-REQUEST-RESPONSE.md#5b-kabinet-api).

### 13.1. Dalil qanchalik kuchli

Jadval mahsulot ro'yxati (13.3) va sessiya haqida; qolgan to'qqiz marshrutning dalili — 13.6.

| Nima | Dalil |
|---|---|
| So'rov | **Ikkita** yozib olingan so'rov (kabinetning o'zi yuborgan): A — `size=5`, B — `size=24` |
| Javob | **Bitta** yozib olingan javob (B so'rovniki), yozib olgan kishi qisqartirgan: 24 qatorli sahifadan 1 mahsulot, 5 SKU. A so'rovining tanasi yozilmagan |
| Javob header'lari | Bitta javobniki (B) |
| Sessiya shakli | **Bitta** `localStorage.state` namunasi (sirlar almashtirilgan) |
| Tezlik chegarasi | Noma'lum: bitta javobda `X-RateLimit-*` va `Retry-After` yo'q |

Bu bo'limdagi "bitta namuna" so'zi aniq shuni anglatadi: bir marta ko'rilgan.
Hech qaysi qator "tasdiqlangan" deb yozilmagan — 12.1-bo'limdagi kabi bir
nechta real javob bilan solishtirish bu yerda hali bo'lmagan. Kengaytma hech
qachon haqiqiy brauzerda ishga tushirilmagan (texnik spetsifikatsiya, 14.8).

### 13.2. OpenAPI'dan farqi

| | Seller OpenAPI (1–12) | Kabinetning ichki API'si |
|---|---|---|
| Host | `api-seller.uzum.uz` | `api-seller.uzum.uz` (o'sha host) |
| Yo'l | `/api/seller-openapi/…` | `/api/seller/…` |
| `Authorization` | xom token, `Bearer`siz | `Bearer <token>` |
| Token qayerdan | sotuvchi Sozlamalarga o'zi qo'yadi | kabinetning o'z sessiyasi (13.4) |
| Kim chaqiradi | sayt | bizning kodimizdan faqat kengaytmaning kontent skripti (kabinetning o'zi ham chaqiradi) |

Kabinet tokeni OpenAPI tokeni bilan bir xilmi, bittasi ikkinchisida ishlaydimi —
**noma'lum**; ikkisi bir-biriga almashtirilmaydi.

### 13.3. `GET /api/seller/shop/{shopId}/product/getProducts` — mahsulotlar sahifasi

**Yozib olingan so'rovlar (ikkita, ikkalasi `200`):**

```
A  GET https://api-seller.uzum.uz/api/seller/shop/{shopId}/product/getProducts
         ?page=0&size=5&filter=WITHOUT_REQUIRED_FILTERS
   Authorization: Bearer <token>
   → 200   (tanasi yozib olinmagan)

B  GET https://api-seller.uzum.uz/api/seller/shop/{shopId}/product/getProducts
         ?page=0&size=24&filter=ALL&sortBy=id&searchQuery=&order=descending
   Authorization: Bearer <token>
   → 200   (tanasi — yagona yozib olingan javob)
```

B kabinetning o'z mahsulotlar jadvali so'roviga o'xshaydi: `size=24` kabinet saqlagan
sahifa hajmiga teng; A — kichik vidjetga o'xshaydi. Bu o'qish taxmin, ikkala so'rovda
ham `sentry` tranzaksiya nomlari bir xil edi. `searchQuery` B da **bo'sh satr** bilan
yuborilgan; `sortBy` va `order` uchun yozilgan yagona qiymatlar `id` va
`descending`. A da bu uchtasi yo'q va `200` qaytgan.

Kod B ning parametr tartibi bilan chaqiradi
([`routes.ts`](../../../../extension/src/uzum/routes.ts#L241); marshrut — yopiq jadval
`UZUM_ROUTES`, token faqat shu jadval yasagan URL'ga yuboriladi:
[`toApiUrl`](../../../../extension/src/uzum/routes.ts#L572)). A shaklini (`sortBy`/
`order`/`searchQuery`siz) kod yubormaydi.

| Parametr | Kod nimani qabul qiladi | Dalil |
|---|---|---|
| `shopId` | musbat butun son | yo'lda — ikkala namunada |
| `page` | butun, 0…100 000 | ikkalasida `0`; yuqori chegara — o'zimizniki |
| `size` | butun, 1…100 (lookup'ning standarti — 24) | `5` (A) va `24` (B); **24 dan kattasi qabul qilinishi dalilsiz** |
| `filter` | yopiq ro'yxat `ALL`, `WITHOUT_REQUIRED_FILTERS`; berilmasa `ALL` | `ALL` — B, `WITHOUT_REQUIRED_FILTERS` — A; boshqa qiymat yozilmagan va o'ylab topilmagan |
| `searchQuery` | erkin matn, kesilgan (`trim`), ko'pi bilan 100 belgi, boshqaruv belgilarisiz; berilmasa bo'sh | B da bo'sh; to'ldirilgan qiymat bilan so'rov yozilmagan, **qanday moslashishi noma'lum**; 100 belgi — o'zimizniki |
| `sortBy` | parametr emas, doim `id` | B da shu bitta qiymat |
| `order` | parametr emas, doim `descending` | B da shu bitta qiymat |

Qidiruv matni nega tokenni boshqa joyga yo'naltira olmaydi: u faqat `URLSearchParams`
orqali **query qiymati** bo'lib kiradi — yo'lga ham, origin'ga ham yetmaydi, URL esa
baribir `toApiUrl`dan o'tadi.

**Javob header'lari (B, bitta namuna):** `content-type: application/json`;
`access-control-allow-origin: https://seller.uzum.uz` (kabinet origin'i),
`access-control-allow-credentials: true`, `access-control-allow-methods: POST, GET,
OPTIONS, PUT, DELETE`, `access-control-allow-headers` ro'yxatida `authorization`
bor; `access-control-max-age: 3600`; `cache-control: no-cache, no-store, …`;
`server: istio-envoy`. `X-RateLimit-*` va `Retry-After` **yo'q**. Bu — CORS
kabinet origin'idan chiqqan so'rovga ruxsat berganining bitta namunasi; kengaytma
so'rovi shu origin'dan, sahifada chiqadi. Preflight alohida yozib olingan
(2026-11-13, bitta namuna, tokensiz `OPTIONS`): faqat `authorization` so'ralganda
server kabinet origin'iga, `GET` ga va shu header'ga ruxsat berdi
([API-REQUEST-RESPONSE.md, 5.B.8](../../../../docs/API-REQUEST-RESPONSE.md#5b8-get-apisellershopshopidproductgetproducts)).
Haqiqiy token bilan `GET` ning o'zi kengaytmadan hali yuborilmagan (13.5).

**Javob shakli — bitta javobdan ma'lum.** Yuqori daraja: `productList` (massiv) va
ikkita jami son — `totalProductsAmount` (yozuvda `38`) va
`totalProductsAmountWithoutWeightDimensional` (`0`). Har mahsulot ichida `skuList`.
Maydonlar, turlar, `null`lar va dalil kuchi — [API-REQUEST-RESPONSE.md, 5.B.8](../../../../docs/API-REQUEST-RESPONSE.md#5b8-get-apisellershopshopidproductgetproducts);
bu yerda takrorlanmaydi. Kod uni
[`readProductsPage`](../../../../extension/src/uzum/products.ts#L461) bilan o'qiydi:
tolerant (har yozuvni javobdagidek ham (`raw`), yozib olingan namunadagi turga
mos tiplangan ko'rinishda ham beradi; mos kelmagan yo'llar `mistyped` ro'yxatiga
tushadi, noma'lum maydon e'tiborsiz qoladi, hech qachon yiqilmaydi) va **hech narsa hisoblamaydi**. Tana shu shaklga
mos kelmasa, lookup shakldan mustaqil renderer
([`render.ts`](../../../../extension/src/tools/render.ts)) ga tushadi va buni
sarlavhada aytadi.

### 13.4. Sessiya — `localStorage.state` (bitta namuna)

Kontent skript kabinet varag'ining `localStorage` kaliti `state` ni o'qiydi
([`session.ts`](../../../../extension/src/uzum/session.ts#L72)). Namunada:

| Maydon | Ma'nosi (bitta namunadan) |
|---|---|
| `user.tokens.access` | Bearer tokeni — kontent skriptdan chiqmaydi |
| `user.permissions` | kalitlari — do'kon id'lari, qiymati — ruxsat kodlari ro'yxati (masalan `PRODUCT_READ`) |
| `user.sellerId`, `user.accountId` | butun sonlar |
| `user.tokens.accessExpiration` | **birligi va ma'nosi noma'lum** — kod uni o'qimaydi; eskirgan token API'dan `401` bo'lib ko'rinadi |

Kodning o'z farazlari — dalilsiz, shuning uchun noto'g'ri bo'lishi mumkin:
- **Har do'kon marshrutiga bitta ruxsat kodi kerak** degan faraz: mahsulot
  marshrutlariga `PRODUCT_READ`, SKU ro'yxatiga `SKU_READ`, nakladnoylarga
  `INVOICE_READ`, qaytarishlarga `SELLER_RETURN_READ`, shartnoma sanasiga
  `SHOP_READ` (13.6). Kod so'rovdan oldin mahalliy tekshiradi; kodlar o'z nomidan
  o'qilgan, server qaysi birini so'rashi hech qayerda yozilmagan. Marshrut boshqa
  kod so'rasa yoki umuman so'ramasa, kod ruxsatli so'rovni yubormasdan rad etadi.
  Do'kon nomlamaydigan to'rt marshrutda (do'konlar ro'yxati, bildirishnoma sanog'i,
  sharhlar, yorliq o'lchamlari) kod tekshirilmaydi — faqat kirgan sessiya. Sharhlar uchun
  `PRODUCT_REVIEW_READ`, yorliqlar uchun `PRINTING_READ` nomli kod sessiyada bor, lekin
  ular do'konga beriladi, yo'l esa do'kon nomlamaydi — solishtiradigan do'kon yo'q.
- **Varaq URL'idagi son — do'kon id'i.** Yo'lning raqamli qismi sotuvchining
  do'konlaridan biriga teng bo'lsa, shu do'kon ekranda deb olinadi
  (`currentShopId`). Kabinetning URL sxemasi yozib olinmagan.

### 13.5. Hal qilinmagan

Javobning umumiy shakli (ro'yxat qaysi maydonda, umumiy son bormi) endi bitta
javobdan **ma'lum**: `productList` va `totalProductsAmount`. Qolganlari ochiq:

| Savol | Nima hal qiladi |
|---|---|
| `WITHOUT_REQUIRED_FILTERS` nimani tanlaydi: **hamma** mahsulotni yoki kichik qismni | shu filtr bilan yozib olingan javob. Faraz: `products-statistic` da `ALL: 38`, `WITHOUT_REQUIRED_FILTERS: 22` (1 sessiya) — kichik qism; ammo bu filtr bilan javob yozilmagan ([5.B.8, 5.B.9](../../../../docs/API-REQUEST-RESPONSE.md#5b8-get-apisellershopshopidproductgetproducts)) |
| `totalProductsAmount` `filter` va `searchQuery` ga ergashadimi | `filter=WITHOUT_REQUIRED_FILTERS` yoki to'ldirilgan `searchQuery` bilan yozib olingan javob |
| `searchQuery` qanday moslashadi (nom, SKU, shtrixkod) | to'ldirilgan qidiruv bilan yozib olingan so'rov va javob |
| `size` 24 dan katta (kodda — 100 gacha) hurmat qilinadimi; sahifa o'rni `page × size` mi | `size=100` va `page>0` bilan yozib olingan javob |
| Tezlik chegarasi bormi, `Retry-After` qaytaradimi | real `429` namunasi (bitta javobda bunday header yo'q — bu chegara yo'qligini isbotlamaydi) |
| `accessExpiration` birligi | sessiya namunasi + tokenning real muddati |
| `PRODUCT_READ`, `SKU_READ`, `INVOICE_READ`, `SELLER_RETURN_READ`, `SHOP_READ` aynan shu marshrutlarga kerakmi | ruxsatsiz hisob bilan so'rov (`403`) |
| To'qqizta kichik marshrut haqiqiy token bilan kengaytmadan o'tadimi | kabinetga kirilgan varaqda sinash; hozircha oltitasi faqat almashtirgich javoblar bilan yurgan, `reviews.list`, `skus.list` va `barcodes.types` esa brauzerda umuman yurmagan — faqat testlar (`reviews.list` uchun yana tokensiz preflight; texnik spetsifikatsiya, 14.8) |
| `skus.list` da `search` qanday moslashadi; `search`siz so'rov nima qaytaradi | boshqa qidiruv matni bilan va qidiruvsiz yozib olingan so'rov va javob ([5.B.13](../../../../docs/API-REQUEST-RESPONSE.md#5b13-get-apisellershopshopidsku-list)) |
| `price` va saqlash summalarining birligi, `conversion` formulasi, `rankInfo.rank` shkalasi, boshqa enum qiymatlari | qo'shimcha javoblar; API-REQUEST-RESPONSE.md 5.B.8 "Ochiq savollar" |
| Kabinetning CORS/CSP siyosati kengaytma so'rovini o'tkazadimi | kabinetga kirilgan varaqda, haqiqiy token bilan sinash — texnik spetsifikatsiya, 14.8. Hozircha: preflight o'tadi (bitta namuna), kirilmagan bosh sahifada CSP yo'q va ramka yuklanadi (Chrome 157, Edge 157); haqiqiy `GET` va kirilgan sahifalar ko'rilmagan |

Shuning uchun kod bu marshrutni **"barcha mahsulotlar" deb atamaydi** va hech bir
sonni o'zidan "do'kondagi mahsulotlar" deb yozmaydi. Sahifani faqat javobning o'z
`totalProductsAmount` iga nisbatan joylaydi ("rows 1–24 of 38"), bunda o'rin `page ×
size` deb faraz qilinadi (javob buni tasdiqlamaydi) va jami son `filter`/qidiruvga
ergashishi noma'lum; jami son bo'lmasa yoki shakl tanilmasa — faqat "bu o'qish
qaytargan elementlar" va hech bir sahifa "oxirgi" deyilmaydi. Kodning o'z tezlik
qoidasi (ketma-ket, 400 ms oraliq, `429`da `Retry-After` yoki 2 s dan 60 s gacha
o'sib boruvchi kutish, ko'pi bilan 10 daqiqa) o'lchangan chegara emas,
ehtiyotkor taxmin.

### 13.6. To'qqizta kichik marshrut

Hammasi o'sha yopiq jadvalda
([`UZUM_ROUTES`](../../../../extension/src/uzum/routes.ts#L541)) va o'sha ko'prikdan
o'tadi; sakkiztasi `GET`, sharhlar — `POST`. Ikki tur bor: **do'kon** marshruti bitta
do'kon haqida — do'kon sessiyada va unda ruxsat kodi bo'lmasa so'rov yuborilmaydi;
**account** marshruti do'kon nomlamaydi — faqat kirgan sessiya tekshiriladi.

| Marshrut id (lookup ham shu nomda) | So'rov | Tur · ruxsat kodi (faraz) | Kod nimani qabul qiladi | Javobdan nima kutiladi | Dalil |
|---|---|---|---|---|---|
| `products.stats` | `GET /api/seller/shop/{shopId}/product/products-statistic` | do'kon · `PRODUCT_READ` | `shopId` | `{ statisticResultList: [{count, type, shopId}] }` | 1 so'rov, 1 javob ([5.B.9](../../../../docs/API-REQUEST-RESPONSE.md#5b9-get-apisellershopshopidproductproducts-statistic)) |
| `skus.list` | `GET /api/seller/shop/{shopId}/sku-list?page=&size=&search=` | do'kon · `SKU_READ` | `shopId`; `page` 0…100 000; `size` 1…100 (lookup'ning standarti — 20); `search` — ixtiyoriy matn, ≤ 100 belgi (berilmasa parametr **yuborilmaydi**) | `{ skuList: [...], totalPages, invoiceSkuLimit, skuLimit }` — sahifalar soni bor, qatorlar soni yo'q | 1 so'rov (`page=0&size=20&search=<shtrixkod>`), 1 qatorli 1 javob; `search`siz so'rov yozib olinmagan ([5.B.13](../../../../docs/API-REQUEST-RESPONSE.md#5b13-get-apisellershopshopidsku-list)) |
| `invoices.list` | `GET /api/seller/shop/{shopId}/invoice?page=&size=` | do'kon · `INVOICE_READ` | `shopId`; `page` 0…100 000; `size` 1…100 (lookup'ning standarti — 20) | yalang'och massiv, jami son yo'q | 1 so'rov (`page=0&size=20`), 20 qatorli 1 javob ([5.B.10](../../../../docs/API-REQUEST-RESPONSE.md#5b10-get-apisellershopshopidinvoice)) |
| `returns.list` | `GET /api/seller/shop/{shopId}/return?page=&size=` | do'kon · `SELLER_RETURN_READ` | `shopId`; `page` 0…100 000; `size` 1…100 (lookup'ning standarti — 20) | `{ payload: [...], timestamp }`, jami son yo'q | 1 so'rov (`page=0&size=20`), 20 qatorli 1 javob ([5.B.11](../../../../docs/API-REQUEST-RESPONSE.md#5b11-get-apisellershopshopidreturn)) |
| `reviews.list` | `POST /api/seller/product-reviews?page=&size=`, tana `{"filter":"<qiymat>"}` | account | `page` 0…100 000; `size` 1…100 (lookup'ning standarti — 20); `filter` — `ALL`, `NEW`, `NO_REPLY`, `WITH_REPLY`, `PINNED` dan biri (standart — `ALL`); **tanani panel yozmaydi** | `{ payload: [...], timestamp }`, jami son yo'q | 1 so'rov (`page=0&size=20`, `NO_REPLY`; tanasi alohida berilgan, uzunligi `content-length` ga mos), 1 javob — 7 qatordan keyin kesilgan; qolgan to'rt filtr — aytilgan, yozib olinmagan ([5.B.12](../../../../docs/API-REQUEST-RESPONSE.md#5b12-post-apisellerproduct-reviews)) |
| `shops.list` | `GET /api/seller/shop/` | account | hech narsa | yalang'och massiv | 2 so'rov, 2 javob, 3 kun oralig'ida ([5.B.3](../../../../docs/API-REQUEST-RESPONSE.md#5b3-get-apisellershop)) |
| `contract.end` | `GET /api/seller/committent/contract/end-date?shopId=` | do'kon · `SHOP_READ` | `shopId` | `{ payload, timestamp }` | 1 so'rov, 1 javob ([5.B.7](../../../../docs/API-REQUEST-RESPONSE.md#5b7-get-apisellercommittentcontractend-dateshopidshopid)) |
| `notifications.unread` | `GET /api/v1/seller/notification/unread-count` | account | hech narsa | `{ unreadCount }` | so'rovning o'zi **yozib olinmagan** — faqat preflight'i va unga javob deb berilgan tana ([5.B.5](../../../../docs/API-REQUEST-RESPONSE.md#5b5-get-apiv1sellernotificationunread-count-qisman)) |
| `barcodes.types` | `GET /api/seller/reports/barcodes/types` | account | hech narsa | `{ barcodeLabelTypes: [{id, title, printType, length, width}] }` | 1 so'rov, 1 javob ([5.B.14](../../../../docs/API-REQUEST-RESPONSE.md#5b14-get-apisellerreportsbarcodestypes)) |

Kodning o'z qarorlari — dalil emas:

- **Chegaralar bizniki.** `skus.list`, `invoices.list`, `returns.list` va `reviews.list` da `size` 1…100 va `page`
  0…100 000; yozib olingan yagona qiymatlar — `page=0`, `size=20`. Kattaroq `size` qabul qilinishi,
  `page=1` nima qaytarishi ko'rilmagan.
- **`invoices.list` va `returns.list` da filtr yo'q.** Yozib olingan so'rov faqat `page` va `size`
  yuborgan; holat, sana yoki saralash parametri o'ylab topilmagan, shuning uchun
  taklif ham qilinmaydi.
- **`skus.list` da `search` ixtiyoriy — va qidiruvsiz so'rov yozib olinmagan.** Yozib
  olingan yagona so'rov 13 xonali shtrixkodni qidirgan va shu shtrixkodli bitta SKU'ni
  olgan; qidiruv nom yoki SKU kodi bo'yicha ham moslashadimi — noma'lum. `search`
  berilmasa parametr umuman yuborilmaydi (bo'sh `search=` ham yozilmagan) — bu SKU'larni
  ro'yxatlashning yagona yo'li, lekin dalilsiz shakl: lookup buni har natijaning
  sarlavhasida aytadi. Matn faqat `URLSearchParams` orqali query'ga tushadi; boshqaruv
  belgili yoki 100 belgidan uzun matn so'rov yuborilmasdan rad etiladi.
- **`skus.list` sahifani javobning o'z `totalPages` iga nisbatan joylaydi.** Bu — sahifalar
  soni beradigan yagona kabinet javobi, shuning uchun "oxirgi sahifa" faqat shu yerda va
  faqat shu songa tayanib aytiladi (`page` 0 dan sanalishi — faraz). `availableToStock`
  ni lookup har natijada "qoldiq emas" deb belgilaydi (yozuvda sotuvda 0 dona bo'lgan
  SKU'da `1000043` edi).
- **`barcodes.types` faqat o'lchamlarni o'qiydi.** Stiker yaratadigan yoki chop etadigan
  so'rov yozib olinmagan va jadvalda yo'q; `length` / `width` birligi javobda aytilmagan
  (millimetr — taxmin).
- **`reviews.list` — yagona `POST`, va u ham o'qish.** Kabinet sharhlarni shunday o'qiydi:
  sahifa query'da, filtr JSON tanada. Tanani **jadvalning o'zi** yozadi
  ([`routes.ts`](../../../../extension/src/uzum/routes.ts)) — bitta kalit,
  `{"filter":"<qiymat>"}`: panel ko'prikka tana yubormaydi (xabarda bunday maydon yo'q),
  faqat `filter` parametrini nomlaydi, jadval esa uni beshta doimiy bilan butunligicha
  solishtiradi — boshqa qiymat so'rov yuborilmasdan rad etiladi.
- **`reviews.list` filtrlarining dalili teng emas.** `NO_REPLY` — so'rovi va javobi
  yozib olingan yagona filtr (u bilan tana aynan yozib olingan 21 bayt). `ALL`, `NEW`,
  `WITH_REPLY`, `PINNED` ni sotuvchi aytgan: javoblari yozib olinmagan, ma'nolari
  nomidan o'qiladi, `NEW` niki esa noma'lum (o'qilmaganmi, yaqindami). **Standart —
  `ALL`** (loyiha egasining qarori): filtr aytilmagan savol hamma sharhlar haqida,
  ya'ni standart o'qish javobi hali ko'rilmagan filtr bilan ketadi.
  Lookup har natijada qaysi filtr yuborilganini va uning
  dalilini aytadi; `replyStatus` obyekt bo'lib kelsa ochib chiqaradi, yozuvda
  uchramagan qator kalitini sarlavhada nomlaydi (5.B.12).
- **`reviews.list` ning so'rovi.** So'rov `content-type: application/json` bilan ketadi; shu yo'lning
  preflight'i haqiqiy serverda tokensiz sinalgan va `POST`, `authorization`,
  `content-type` ga ruxsat bergan (5.B.12). Jadvalga Uzum'da biror narsani o'zgartiradigan
  marshrut qo'shilmaydi; bitta noma'lum — ro'yxatni o'qish sharhni "o'qilgan" deb
  belgilaydimi (yozuvda hamma qator allaqachon `read: true` edi).
- **`reviews.list` xaridor ismini chiqarmaydi.** `customerName` — sotuvchi bo'lmagan
  odamning shaxsiy ma'lumoti, lookup natijasi esa sotuvchining LLM provayderiga ketadi.
  Ism tanilgan javobda ustun emas, tanilmagan javobda esa renderer'dan oldin olib
  tashlanadi; `anonymous` belgisi chiqadi.
- **Javob shaklini tanish — tolerant.** Har lookup faqat eng tashqi belgini
  tekshiradi (massivmi, `statisticResultList` / `skuList` / `payload` / `unreadCount` /
  `barcodeLabelTypes` kaliti bormi), qolgan har maydonni javobdagidek chiqaradi; belgi topilmasa shakldan
  mustaqil renderer ([`render.ts`](../../../../extension/src/tools/render.ts)) ishlaydi
  va sarlavha buni aytadi. Bu marshrutlar uchun `products.ts` kabi tiplangan
  o'quvchi **yo'q** — kod ulardan hech narsa hisoblamaydi.
- **OpenAPI egizagi ishlatilmaydi.** `invoices.list` va `returns.list` ning OpenAPI'da yaqinlari bor
  (`GET /v1/shop/{shopId}/invoice` — 11-bo'lim, `GET /v1/return` — 8-bo'lim); kengaytma faqat kabinet yo'lini
  chaqiradi va OpenAPI tokenini so'ramaydi.

Qo'shilmagan kabinet yo'llari (API-REQUEST-RESPONSE.md da kartasi bor): `check_token`
(tokenni tanada yoki query'da yuboradi — ko'prik tokenni faqat header'da yuboradi,
tanani esa faqat jadval yozadi), `account` (faqat sotuvchining ismi, telefoni va emaili),
`notifications` (yozib olingan yagona javob — bo'sh tana, ko'prik esa bo'sh tanani
JSON emas deb rad etadi) va `storage/{key}` (kabinet interfeysining bayrog'i).

### 13.6. Xatolarni qanday sinflaydi

Faqat HTTP holati bo'yicha (javob tanasi modelga uzatilmaydi, iqtibos qilinmaydi):
`401` → `unauthorized`, `403` → `forbidden`, `404` → `notFound`, `429` →
`rateLimited`, `5xx` → `server`, qolgan `4xx` → `client`. JSON bo'lmagan `200`
tanasi — `server`. Tarmoq uzilishi — `network`, 30 soniyada javob bo'lmasa —
`timeout`. Bu — kodning tanlovi, API xatolarining yozib olingan formati emas
(xato tanasi hech qachon ko'rilmagan).

Ikkita qoida sinfdan tashqarida turadi. **Yopiq ko'prik:** kontent tomoni
xayrlashgandan keyin har bir chaqiruv `code` = `BRIDGE_CLOSED` bilan rad etiladi
(`kind` — `client`, `unconfigured` emas): ulanish bor edi va yo'qoldi, hech qanday
so'rov Uzum'ga bormagan. **"So'rov yuborilmadi":** kengaytmaning o'zi mahalliy rad
etgan so'rov (do'kon sessiyada yo'q, ruxsat kodi yo'q, token yo'q) HTTP holatisiz
xato bo'lib keladi; lookup matni Uzum API nomidan faqat HTTP holatli javob haqiqatan
kelganda gapiradi, aks holda so'rov yuborilmaganini va sababini aytadi. Bu ham
kodning tanlovi: kabinet API'sining xato javoblari hali bitta ham ko'rilmagan.
