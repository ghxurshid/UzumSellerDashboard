# Uzum Seller API'lari — so'rov va javob shakllari katalogi

> **Holat:** Uzumning ikki API'si bor: **OpenAPI** (`/api/seller-openapi/…`) va **kabinet ichki API'si**
> (`/api/seller/…`, seller.uzum.uz o'zi ishlatadi). OpenAPI kartalari hali kutilmoqda (§5.A bo'sh).
> Kabinet API'sida 9 ta karta bor (§5.B) — hammasi (5.B.8 ning A so'rovidan tashqari) 2026-11-13 dagi **bitta brauzer sessiyasidan**
> (bitta sotuvchi hisobi, 2 ta do'kon, 03:01 GMT). Shu sababli hech bir maydon "tasdiqlangan" emas.
> Eng boyi — 5.B.8 (`getProducts`): **ikki yozib olingan so'rov va bitta yozib olingan javob**; javob
> qisqartirilgan (24 qatorli sahifadan 1 mahsulot, 5 SKU), uning niqoblangan nusxasi repoda
> [`getProducts.response.masked.json`](../extension/src/uzum/getProducts.response.masked.json).
> Ikkinchi so'rovning (A) vaqti va sessiyasi yozilmagan, tanasi yo'q.

## 1. Maqsad va boshqa hujjatlardan farqi

Bu hujjat Uzum API'lari bilan simdagi **kuzatilgan** shartnomani — har bir so'rov va javobning
maydonma-maydon shaklini — haqiqiy namunalarga tayanib yozadi.

| Hujjat | Nimaga javob beradi |
|---|---|
| [ENDPOINTS.md](../frontend/src/services/uzum/ENDPOINTS.md) | Kod har bir route bilan **qanday ishlaydi**: konvert o'qigichlari, sahifa hajmi, tekshiruv natijalari |
| **Shu hujjat** | Simdagi **haqiqiy shakl**: qaysi maydon, qaysi tur, qaysi birlik, nechta namuna asosida |
| [STORAGE.md](../frontend/src/services/storage/STORAGE.md) | Javob IndexedDB'ga **qanday saqlanadi** (jadvallar, indekslar) |
| [uzum-samples.json](../frontend/_design/uploads/uzum-samples.json) | Yozib olingan xom namunalar (faqat o'qiladi, tahrirlanmaydi) |

Nega alohida hujjat: ENDPOINTS.md kod nuqtayi nazaridan yozilgan, shu sababli maydonning
"simdagi" ma'nosi va uni qancha namuna qo'llab-quvvatlashi u yerda yo'qoladi. Bu yerda
aynan shu saqlanadi, kod va hujjat orasidagi ziddiyat esa "Kod/ENDPOINTS.md bilan farq"
bandida ko'rinadi.

Katalog **ikki sirtni** qamraydi: sotuvchi o'zi token olib chaqiradigan **OpenAPI**
(`/api/seller-openapi/…`, xom token) va kabinetning **ichki API'si** (`/api/seller/…`,
`Authorization: Bearer …`). Ikkinchisini sayt chaqirmaydi: uni kabinetning o'z sahifasi
va brauzer kengaytmasi ishlatadi. Ular qanday farqlanishi va kabinet API'sining dalili
nega kuchsizroq ekani — ENDPOINTS.md [13-bo'lim](../frontend/src/services/uzum/ENDPOINTS.md#13-kabinetning-ichki-apisi-openapi-emas),
bu yerda takrorlanmaydi. Har kartaning sarlavhasidagi bo'lim raqami sirni ko'rsatadi:
`5.A.N` — OpenAPI, `5.B.N` — kabinet.

## 2. Umumiy qoidalar

| Nima | OpenAPI | Kabinet API |
|---|---|---|
| Base URL | `https://api-seller.uzum.uz/api/seller-openapi/` | `https://api-seller.uzum.uz/api/seller/…`; auth servisi `/api/auth/seller/…`; bittasi `/api/v1/seller/…` (5.B.5) |
| Avtorizatsiya | Token header'i, xom, `Bearer`siz (qiymati **yozilmaydi**) | `Authorization: Bearer <token>`; token 27 belgili shaffof satr (JWT emas). check_token shakl A da `Basic` (5.B.1). Ba'zi so'rovlarda `cookie` da `access_token=<JWT>` ham bor — qarang "Cookie kuzatuvi" |
| `dateFrom` / `dateTo` | So'rovda **sekundlarda**; javobda **millisekundlarda**; konvertatsiya faqat `toApiSeconds()` orqali | Kuzatilgan 9 ta so'rovda sana parametri yo'q |
| Vaqt formatlari | epoch ms | Uch xil: (a) epoch **millisekund** son (`rankInfo.dateUpdated`, `specialOffer.endDate`); (b) zonasiz ISO satr (`registrationDate: "2026-…T06:02:56.306"`, `timestamp` 8 xonali kasr bilan; javob `date` header'i bilan mos, demak zonasiz UTC — 1 namuna); (c) faqat sana `"2031-…-…"` |
| Konvertlar | Yalang'och massiv / `{ payload: … }` / nomlangan maydonli obyekt — ENDPOINTS.md §1 | Har xil: yalang'och massiv (`shop/`), yalang'och obyekt (`account`, `check_token`), `{ payload, timestamp }` (committent), nomlangan ro'yxat maydoni (`productList`, `statisticResultList`), bo'sh tana (`notifications`) |
| Sahifalash | Kartada | `getProducts` da `page` (0 dan) / `size` + `totalProductsAmount`; qolganida yo'q |
| Xato kodlari | `401`, `403`, `429` — kuzatilganda kartaga | **Kuzatilmagan** (401/403/429 yo'q); rate limit header'lari ham kuzatilmadi |
| Kim chaqira oladi / CORS | Sayt | Hamma javobda `access-control-allow-origin: https://seller.uzum.uz`, `access-control-allow-credentials: true`, `access-control-max-age: 3600`. So'rovning `Origin` i ham seller.uzum.uz edi — server origin'ni aks ettirayotgan bo'lishi mumkin, boshqa origin'ga ruxsat noma'lum. |

### Kabinet API'sining umumiy kuzatuvlari (1 sessiya)

- **Ikki backend servis (taxmin).** Host bir xil, lekin javob `build-info` header'i farq qiladi:
  auth yo'llarida `Build: 1126958`, `/api/seller/…` da `Build-Number: 1193187; Commit:`.
  `server: istio-envoy`.
- **So'rov header'lari:** `accept: application/json`; `accept-language: ru-RU` (javobdagi `category`,
  `status.title` kabi matnlar ruscha — tilga bog'liqligi taxmin, boshqa til bilan namuna yo'q);
  `x-iid: <uuid>` (o'rnatish/qurilma id'si — taxmin; qiymati yozilmaydi); sentry `baggage` /
  `sentry-trace`. Mahsulotlar sahifasi so'rovlarida ikkita sentry release bor:
  `uzum-seller-frontend@2.97.0` va `sx-products-frontend@3.17.5` → mahsulotlar sahifasi alohida
  mikro-frontend (taxmin).
- **Cookie kuzatuvi.** committent, `getProducts` va `products-statistic` so'rovlarida `cookie` da
  `access_token=<Uzum ID JWT>` bor (`iss: "Uzum ID"`, `aud: ["uzum_apps","market/web"]`, `alg: EdDSA`,
  `exp − iat = 43200` s = 12 soat). Shu JWT ning `exp` i 2026-11-12 22:49:23 UTC, so'rovlar esa
  2026-11-13 03:01 GMT da yuborilgan va 200 qaytgan — cookie'dagi token ~4 soat oldin tugagan bo'lsa
  ham javob keldi. Demak bu endpointlarni cookie emas, Bearer token avtorizatsiya qilgan ko'rinadi
  (1 namuna; server cookie'ni umuman tekshirmasligi ham mumkin). `getProducts` ning ikkinchi
  yozib olingan so'rovi (5.B.8, A) faqat analitika cookie'lari bilan, `access_token`siz yuborilgan
  va `200` olgan — Bearer header yetarli degan kuzatuvga mos (1 so'rov; A ning sessiyasi
  yozilmagan, shuning uchun uni yuqoridagi muddati o'tgan JWT kuzatuvi bilan bir sessiya deb
  bo'lmaydi). Dastlabki so'rovlarda
  (`check_token`, `account`, `shop/`, `notifications`) cookie umuman yo'q.
- **Tezlik:** `x-envoy-upstream-service-time` — `getProducts` 937 ms, qolganlari 25–79 ms.

### Maxfiy ma'lumot qoidasi

Bu hujjatga hech narsa yozishdan oldin **niqoblanadi**:

- token va `Authorization` header qiymati (`Bearer` ham, `Basic` ham) — butunlay olib tashlanadi;
  `Basic` ichidagi mijoz ma'lumoti ham yozilmaydi;
- `cookie` qiymatlari, `x-iid`, sentry kalitlari (`baggage`, `sentry-trace` ichidagi) — yozilmaydi;
- xaridorning **va sotuvchining** shaxsiy ma'lumoti (ism, telefon, email, manzil) — `***` yoki
  `998*********` bilan almashtiriladi;
- do'kon, buyurtma, mahsulot va SKU identifikatorlari — tuzilmani ko'rsatadigan, lekin real bo'lmagan
  qiymat bilan. Kabinet kartalarida ishlatiladigan niqoblar: do'konlar `1001`, `1002`;
  `sellerId`/`seller_id` `5001`; `accountId` `9001`; `newSellerId`
  `00000000-0000-4000-8000-000000000001`; do'kon nomlari "Do'kon A"/"Do'kon B", `urlTitle`
  `dokona`/`dokonb`, `skuTitle` `SHOPA`/`SHOPB`; `productId` `200001`; `skuId` `10000001…10000005`;
  rasm URL'lari `https://images.uzum.uz/<image-id>/…`. 5.B.8 kartasi esa niqoblangan fayl
  qiymatlarini ishlatadi, shuning uchun u fayl bilan solishtiriladi: `productId` `4000001`,
  `skuId` `50000001…50000005`, shtrixkod `20000000000xx`, `ikpu` nollar, `advCpoId`
  `00000000-0000-7000-8000-000000000001`, SKU prefiksi `SELLER-SAMPLEKIT`, narx `120000`
  (asl kattalikda). Yozib olingan, lekin to'qilgan qiymatlardan chiqarib bo'lmaydigan
  kuzatuvlar kartada alohida belgilanadi.

### Dalil siyosati

Har bir maydonning ma'nosi va birligi **dalil kuchi** bilan yoziladi: nechta namuna
qo'llab-quvvatlaydi. Kabinet kartalarida ikki daraja alohida belgilanadi: **kuzatuv** — bir javob
ichida ko'p nuqtada mos kelgan arifmetika yoki tenglik; **taxmin** — mantiqiy, lekin tekshirilmagan.

| Dalil kuchi | Ma'nosi |
|---|---|
| `1 namuna` | Faqat bitta namunada ko'rilgan — **taxmin**, "tasdiqlangan" deb yozilmaydi |
| `N namuna` (N ≥ 2) | Bir necha mustaqil namunada bir xil — ishonchliroq, lekin hali ham kuzatuv |
| `kod+namuna` | Namuna ham, kodning ishlab turgan xatti-harakati ham mos |
| `hujjat` | Faqat Uzum hujjatiga tayangan, namuna yo'q — taxmin sifatida belgilanadi |

Misol — hal bo'lmagan maydon: `sellPrice` birligi (donasiga yoki qator bo'yicha jami).
Donasiga degan xulosani faqat bitta flat-mode namuna qo'llaydi, shuning uchun u
`1 namuna` bo'lib qoladi va "Ochiq savollar"da turadi (ENDPOINTS.md §12.3).

## 3. Endpointlar indeksi

OpenAPI guruhlari ENDPOINTS.md bilan bir xil: Akkaunt, Moliya, Katalog, FBS qoldiqlari,
FBS/DBS buyurtmalari, DBS, FBO nakladnoylari, FBS jo'natma nakladnoylari, Chop etiladigan hujjatlar.

| # | API | Method | Path | Guruh | Holat | Bo'lim |
|---|---|---|---|---|---|---|
| — | `openapi` | — | — | — | kutilmoqda | 5.A |
| 1 | `kabinet` | POST | `/api/auth/seller/check_token` | Auth | namuna bor (2 namuna) | 5.B.1 |
| 2 | `kabinet` | GET | `/api/seller/account` | Akkaunt | namuna bor | 5.B.2 |
| 3 | `kabinet` | GET | `/api/seller/shop/` | Do'konlar | namuna bor | 5.B.3 |
| 4 | `kabinet` | GET | `/api/seller/notifications` | Bildirishnomalar | namuna bor (tana bo'sh) | 5.B.4 |
| 5 | `kabinet` | GET | `/api/v1/seller/notification/unread-count` | Bildirishnomalar | namuna bor (qisman) | 5.B.5 |
| 6 | `kabinet` | GET | `/api/seller/storage/{key}` | Interfeys holati | namuna bor (qisman) | 5.B.6 |
| 7 | `kabinet` | GET | `/api/seller/committent/contract/end-date` | Shartnoma | namuna bor | 5.B.7 |
| 8 | `kabinet` | GET | `/api/seller/shop/{shopId}/product/getProducts` | Katalog | namuna bor (2 so'rov, 1 javob) | 5.B.8 |
| 9 | `kabinet` | GET | `/api/seller/shop/{shopId}/product/products-statistic` | Katalog | namuna bor | 5.B.9 |

`Holat` qiymatlari: `namuna bor` (karta to'ldirilgan), `namuna bor (qisman)` (faqat `OPTIONS`
preflight yozilgan, javob esa uning ortidan kelgan `GET` niki deb olingan) yoki `kutilmoqda`
(namuna hali yo'q).

## 4. Endpoint kartasi shabloni

Yangi endpoint uchun quyidagini nusxalab, `5.A.N` (OpenAPI) yoki `5.B.N` (kabinet) bo'lim sifatida
qo'ying va indeksga qator qo'shing. So'rov misolidagi yo'l har API uchun o'zinikidir
(`/api/seller-openapi/…` yoki `/api/seller/…`).

````markdown
### 5.N `METHOD /v?/yo'l`

**Guruh:** … · **Maqsad:** bitta jumla.

#### So'rov

Path parametrlari / Query parametrlari / Body (bo'lmasa — "yo'q"):

| Maydon | Tur | Majburiy | Birlik | Misol | Izoh |
|---|---|---|---|---|---|
| | | | | | |

So'rov misoli (niqoblangan):

```http
GET /api/seller-openapi/…
Authorization: <niqoblangan>
```

#### Javob

Konvert: yalang'och massiv / `{ payload }` / nomlangan maydon (qaysi).

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| | | | | | |

Javob misoli (qisqartirilgan, niqoblangan):

```json
{}
```

#### Sahifalash

Parametrlar, sahifa hajmi, jami son qaysi maydonda, tugash belgisi.

#### Kuzatilgan xatolar

| Kod | Qachon | Tana |
|---|---|---|
| | | |

#### Kod/ENDPOINTS.md bilan farq

Kuzatilgan shakl kod yoki ENDPOINTS.md bilan mos kelmasa — shu yerda. Hujjatni jim
tuzatmang: kod xato bo'lishi mumkin, shuning uchun ziddiyat kod egasiga yetkaziladi.

#### Ochiq savollar

- …
````

## 5. Endpoint kartalari

### 5.A OpenAPI

_Hozircha bo'sh. Namunalar kelgach, shabloni (§4) bo'yicha `5.A.N` sifatida qo'shiladi._

### 5.B Kabinet API

Hamma kartalar 2026-11-13 dagi bitta brauzer sessiyasidan; aks holda aytilmagan bo'lsa — `1 namuna`.
Hamma so'rovlarda `Authorization: Bearer <niqoblangan>` (5.B.1 shakl A dan tashqari). Umumiy
header'lar va cookie kuzatuvi — §2. 5.B.8 (`getProducts`) istisno: u ikki so'rov va bitta
javobdan, 5.B.8 ni brauzer kengaytmasi ham chaqiradi.

---

### 5.B.1 `POST /api/auth/seller/check_token`

**Guruh:** Auth · **Maqsad:** tokenni tekshirish va hisob profili / ruxsatlarini qaytarish.

#### So'rov

Ikki shakl yozib olingan (2 namuna), ikkalasi ham 200 va **bir xil javob** bilan:

| | Shakl A | Shakl B |
|---|---|---|
| Yo'l | `POST /api/auth/seller/check_token` | `POST /api/auth/seller/check_token?token=<token>` |
| `Authorization` | `Basic <niqoblangan>` (base64 qiymati `b2b-front` mijoz ma'lumoti — javobdagi `client_id` bilan bir xil; qiymat yozilmaydi) | `Bearer <niqoblangan>` |
| `content-type` | `application/x-www-form-urlencoded` | yo'q |
| Tana | `token=<token>` (`content-length: 33` = `token=` 6 + 27 belgi — mos) | bo'sh (`content-length: 0`) |

```http
POST /api/auth/seller/check_token
Authorization: Basic <niqoblangan>
Content-Type: application/x-www-form-urlencoded

token=<token>
```

#### Javob

Konvert: yalang'och obyekt. OAuth2 token introspection uslubiga o'xshaydi (taxmin).

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| `user_name` | string | yo'q | — | telefon raqami ko'rinishida (`998…`) | 2 namuna |
| `name` | string | yo'q | — | xuddi shu telefon | 2 namuna |
| `scope` | string[] | yo'q | — | `["read","write"]` | 2 namuna |
| `active` | boolean | yo'q | — | `true` | 2 namuna |
| `exp` | number | yo'q | noma'lum | **2600000** — epoch emas (1970-01-31 bo'lardi). Ikki so'rovda ham aynan 2600000; teskari sanoq bo'lsa yumaloq son chiqishi ehtimoldan yiroq → doimiy qiymat bo'lishi mumkin (~30,1 kun sekundda). **Ma'nosi noma'lum** | 2 namuna (qiymat); ma'no — yo'q |
| `authorities` | string[] | yo'q | — | `PRODUCT_MANAGER, VERIFIED, PHONE_VERIFIED, PARTNER, ENTREPRENEUR_PARTNER, ROLE_SELLER` | 2 namuna |
| `client_id` | string | yo'q | — | `b2b-front` | 2 namuna |
| `newSellerId` | string (UUID) | yo'q | — | `sellerId` dan tashqari ikkinchi identifikator | 2 namuna |
| `locale` | string | yo'q | — | `ru` | 2 namuna |
| `accountId` | number | yo'q | — | hisob id'si | 2 namuna |
| `firstName` | string | yo'q | — | bo'sh satr | 2 namuna |
| `sellerId`, `seller_id` | number | yo'q | — | ikkalasi bir xil qiymat (dublikat) | 2 namuna |
| `phoneNumber` | string | yo'q | — | `+`siz, 12 raqam | 2 namuna |
| `permissions` | `Record<ruxsatKodi, number[]>` | yo'q | — | kalit — ruxsat kodi, qiymat — shu ruxsat berilgan do'kon id'lari (`[1001, 1002]`) | 2 namuna |
| `registrationDate` | string, zonasiz ISO | yo'q | — | ro'yxatdan o'tgan vaqt | 2 namuna |
| `organizations` | `Record<shopId (string), { role: string, permissions: string[] }>` | yo'q | — | kalitlar `GET /api/seller/shop/` dagi `id` lar bilan bir xil; `role` ikkalasida `"UNKNOWN"` | 2 namuna |
| `banned` | boolean | yo'q | — | `false` | 2 namuna |
| `email` | string | yo'q | — | `***` | 2 namuna |

Ruxsat kodlari: har ikki do'konda bir xil **93** ta kod (qo'lda sanalgan). Resurs bo'yicha guruhlangan:

| Guruh | Resurslar |
|---|---|
| To'liq CRUD (`CREATE`, `READ`, `UPDATE`, `DELETE`) | `EMPLOYEE`, `PRODUCT`, `PRODUCT_REVIEW`, `BUNDLE`, `PROMO_CODE`, `PHOTO_REQUEST`, `MARKETING`, `SELLER_RETURN`, `PRODUCT_IMPORT`, `DISCOUNT`, `SKU`, `CALENDAR_EVENT`, `SHOP`, `PRODUCT_FILTER`, `INVOICE`, `VOLUME_DISCOUNT`, `MODERATION`, `CHAT` |
| Qisman | `WITHDRAW` (CREATE, READ, UPDATE); `AUCTION` (CREATE, READ, DELETE); `FBS_INVOICE` (CREATE, READ); `FBS_ORDER` (READ, UPDATE); `REVIEW_PIN` (CREATE, UPDATE) |
| Bitta kod | `TRANSFER_PRODUCT_CREATE`, `SHOP_OWNER_READ`, `EXTERNAL_MARKETING_CREATE`, `SERVICE_FEEDBACK_CREATE`, `EXPENSES_READ`, `PRINTING_READ`, `LEFTOVER_READ`, `FINANCE_READ`, `ANALYTICS_READ` |

Kod `RESURS_AMAL` shaklida (`PRODUCT_READ`).

Javob misoli (qisqartirilgan, niqoblangan):

```json
{
  "user_name": "998*********", "name": "998*********",
  "scope": ["read", "write"], "active": true, "exp": 2600000,
  "authorities": ["PRODUCT_MANAGER", "VERIFIED", "PHONE_VERIFIED", "PARTNER", "ENTREPRENEUR_PARTNER", "ROLE_SELLER"],
  "client_id": "b2b-front",
  "newSellerId": "00000000-0000-4000-8000-000000000001",
  "locale": "ru", "accountId": 9001, "firstName": "",
  "sellerId": 5001, "seller_id": 5001, "phoneNumber": "998*********",
  "permissions": { "PRODUCT_READ": [1001, 1002], "…": ["…"] },
  "registrationDate": "2026-01-10T06:02:56.306",
  "organizations": {
    "1001": { "role": "UNKNOWN", "permissions": ["PRODUCT_READ", "…"] },
    "1002": { "role": "UNKNOWN", "permissions": ["PRODUCT_READ", "…"] }
  },
  "banned": false, "email": "***"
}
```

#### Sahifalash

Yo'q.

#### Kuzatilgan xatolar

Kuzatilmagan.

#### Kod/ENDPOINTS.md bilan farq

Yo'q. Shu javob ichida: `permissions` (kod → do'konlar) va `organizations[shopId].permissions`
(do'kon → kodlar) bir xil ma'lumotning ikki teskari ko'rinishi — chalkashtirmaslik kerak.

#### Ochiq savollar

- `exp` ning ma'nosi va birligi.
- `role: "UNKNOWN"` ning boshqa qiymatlari.
- Xodim (employee) hisobida ruxsatlar qanday ko'rinadi.

---

### 5.B.2 `GET /api/seller/account`

**Guruh:** Akkaunt · **Maqsad:** hisob profili.

#### So'rov

Query / body yo'q. `Authorization: Bearer <niqoblangan>`, cookie yo'q.

```http
GET /api/seller/account
Authorization: Bearer <niqoblangan>
```

#### Javob

Konvert: yalang'och obyekt.

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| `name` | string | kuzatilmagan | — | bo'sh satr | 1 namuna |
| `email` | string | kuzatilmagan | — | `***` | 1 namuna |
| `phone` | string | kuzatilmagan | — | `+`siz | 1 namuna |

```json
{ "name": "", "email": "***", "phone": "998*********" }
```

#### Sahifalash

Yo'q.

#### Kuzatilgan xatolar

Kuzatilmagan.

#### Kod/ENDPOINTS.md bilan farq

Yo'q.

#### Ochiq savollar

- `name` har doim bo'shmi yoki bu hisobda to'ldirilmaganmi — noma'lum.

---

### 5.B.3 `GET /api/seller/shop/`

**Guruh:** Do'konlar · **Maqsad:** sotuvchining do'konlari ro'yxati. Yo'l oxirida `/` bor (yozib olinganidek).

#### So'rov

Query / body yo'q. `Authorization: Bearer <niqoblangan>`, cookie yo'q.

#### Javob

Konvert: **yalang'och massiv**, 2 element.

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| `[].id` | number | yo'q | — | do'kon id'si | 1 namuna |
| `[].shopTitle` | string | yo'q | — | do'kon nomi | 1 namuna |
| `[].shortTitle` | null | ha | — | 2/2 da `null` | 1 namuna |
| `[].urlTitle` | string | yo'q | — | slug | 1 namuna |
| `[].skuTitle` | string | yo'q | — | lotin, katta harf; SKU to'liq nomining prefiksi (5.B.8 `skuFullTitle`: `SHOPB-…`) | 1 namuna |
| `[].shopDescription` | null | ha | — | 2/2 da `null` | 1 namuna |
| `[].description` | `{ uz: string, ru: string }` | yo'q | — | tavsif | 1 namuna |
| `[].transferred` | boolean | yo'q | — | `false` | 1 namuna |
| `[].chatAvatarUrl` | string (URL) | yo'q | — | rasm | 1 namuna |

Kuzatuv: `id` lar check_token `organizations` kalitlari va `permissions` qiymatlari bilan bir xil to'plam.

```json
[
  {"id":1001,"shopTitle":"Do'kon A","shortTitle":null,"urlTitle":"dokona","skuTitle":"SHOPA","shopDescription":null,"description":{"uz":"…","ru":"…"},"transferred":false,"chatAvatarUrl":"https://images.uzum.uz/<image-id>/original.jpg"},
  {"id":1002,"shopTitle":"Do'kon B","shortTitle":null,"urlTitle":"dokonb","skuTitle":"SHOPB","shopDescription":null,"description":{"uz":"…","ru":"…"},"transferred":false,"chatAvatarUrl":"https://images.uzum.uz/<image-id>/original.jpg"}
]
```

#### Sahifalash

Yo'q ko'rinadi (2 do'kon, parametr yo'q). Ko'p do'konli hisobda noma'lum.

#### Kuzatilgan xatolar

Kuzatilmagan.

#### Kod/ENDPOINTS.md bilan farq

Yo'q.

#### Ochiq savollar

- `transferred` ma'nosi (do'kon boshqa hisobga o'tkazilganmi — taxmin).
- Ko'p do'konli hisobda sahifalash bormi.

---

### 5.B.4 `GET /api/seller/notifications`

**Guruh:** Bildirishnomalar · **Maqsad:** bildirishnomalar ro'yxati (taxmin — nomidan).

#### So'rov

Query / body yo'q. `Authorization: Bearer <niqoblangan>`, cookie yo'q.

#### Javob

200, `content-length: 0`, `content-type` yo'q — tana **bo'sh**. Shu bitta namunadan javob shakli
**noma'lum**; bo'sh tana "bildirishnoma yo'q" degani bo'lishi mumkin (taxmin).

#### Sahifalash

Kuzatilmagan.

#### Kuzatilgan xatolar

Kuzatilmagan.

#### Kod/ENDPOINTS.md bilan farq

Yo'q.

#### Ochiq savollar

- Bildirishnoma bo'lganda tana shakli; bo'sh tana nimani bildiradi.

---

### 5.B.5 `GET /api/v1/seller/notification/unread-count` (qisman)

**Guruh:** Bildirishnomalar · **Maqsad:** o'qilmagan bildirishnomalar soni.

#### So'rov

Diqqat: yozib olingan yozuv `OPTIONS` preflight (`access-control-request-method: GET`,
`access-control-request-headers: access-content-allow-origin,authorization,baggage,sentry-trace`,
javob `content-length: 0`). Haqiqiy `GET` so'rovining header'lari **yozib olinmagan**; preflight
`authorization` so'raganidan Bearer yuboriladi deb taxmin qilinadi. `/api/v1/` prefiksi boshqa
yo'llardan farq qiladi.

#### Javob

Foydalanuvchi qo'shgan javob `{"unreadCount":1}` preflight'ga tegishli bo'la olmaydi (uning tanasi 0
bayt) — u ortidan kelgan `GET` ning javobi deb olinadi.

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| `unreadCount` | number | kuzatilmagan | dona | o'qilmaganlar soni | 1 namuna (qisman) |

```json
{ "unreadCount": 1 }
```

#### Sahifalash

Yo'q.

#### Kuzatilgan xatolar

Kuzatilmagan.

#### Kod/ENDPOINTS.md bilan farq

Yo'q.

#### Ochiq savollar

- Haqiqiy `GET` so'rovining header'lari.
- 5.B.4 `notifications` tanasi bo'sh, bu esa `unreadCount: 1` — ular qanday bog'liq, noma'lum.

---

### 5.B.6 `GET /api/seller/storage/{key}` (qisman)

**Guruh:** Interfeys holati · **Maqsad:** foydalanuvchi interfeys bayroqlari (kalit-qiymat). Kabinetning
onboarding holati uchun server tomonidagi kalit-qiymat ombori (taxmin).

#### So'rov

Xuddi 5.B.5 dagidek: yozuv `OPTIONS` preflight, javob — keyingi `GET` niki deb olingan.

| Maydon | Tur | Majburiy | Birlik | Misol | Izoh |
|---|---|---|---|---|---|
| `{key}` (yo'lda) | string | ha | — | `ONBOARDING_TELEGRAM_BOT` | yozib olingan yagona kalit |

#### Javob

Konvert: yalang'och obyekt.

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| `id` | number | kuzatilmagan | — | yozuv id'si (niqoblangan) | 1 namuna (qisman) |
| `readonly` | boolean | kuzatilmagan | — | `false` | 1 namuna (qisman) |
| `key` | string | kuzatilmagan | — | so'ralgan kalit | 1 namuna (qisman) |
| `value` | **string** | kuzatilmagan | — | `"true"` — boolean emas, o'quvchi satr sifatida taqqoslashi kerak | 1 namuna (qisman) |

```json
{ "id": 7001, "readonly": false, "key": "ONBOARDING_TELEGRAM_BOT", "value": "true" }
```

#### Sahifalash

Yo'q.

#### Kuzatilgan xatolar

Kuzatilmagan.

#### Kod/ENDPOINTS.md bilan farq

Yo'q.

#### Ochiq savollar

- Boshqa kalitlar va ularning qiymat turlari; mavjud bo'lmagan kalitga javob.

---

### 5.B.7 `GET /api/seller/committent/contract/end-date?shopId={shopId}`

**Guruh:** Shartnoma · **Maqsad:** komitent shartnomasi tugash sanasi.

#### So'rov

| Maydon | Tur | Majburiy | Birlik | Misol | Izoh |
|---|---|---|---|---|---|
| `shopId` (query) | number | ha (taxmin) | — | `1002` | do'kon id'si |

`Authorization: Bearer <niqoblangan>` + `cookie` (`access_token=<JWT>`, §2 cookie kuzatuvi).

#### Javob

Konvert: `{ payload, timestamp }`.

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| `payload` | string, faqat sana | kuzatilmagan | — | shartnoma tugash sanasi | 1 namuna |
| `timestamp` | string, zonasiz ISO (8 xonali kasr) | kuzatilmagan | UTC | server vaqti; javob `date` header'i bilan mos | 1 namuna |

```json
{ "payload": "2031-01-10", "timestamp": "2026-11-13T03:01:48.81889819" }
```

Kuzatuv: `payload` sanasi check_token `registrationDate` (niqoblangan misolda
`2026-01-10T06:02:56.306`) dan aynan 5 yil keyin — real qiymatlarda ham kun va oy bir xil, yil +5
(1 namuna). "Shartnoma muddati 5 yil" degan xulosa — taxmin. Namuna do'kon `1002` uchun; `1001` uchun yo'q.

#### Sahifalash

Yo'q.

#### Kuzatilgan xatolar

Kuzatilmagan.

#### Kod/ENDPOINTS.md bilan farq

Yo'q.

#### Ochiq savollar

- Shartnomasi yo'q do'kon uchun javob; 5 yillik moslik tasodifmi.

---

### 5.B.8 `GET /api/seller/shop/{shopId}/product/getProducts`

**Guruh:** Katalog · **Maqsad:** do'konning mahsulotlari ro'yxati, har bir mahsulot ichida SKU'lari bilan (qoldiq, sotilgan/qaytarilgan soni, narx, pullik saqlash, aksiya). Eng muhim karta.

**API:** kabinet (ichki), OpenAPI emas — farqi ENDPOINTS.md [13.2](../frontend/src/services/uzum/ENDPOINTS.md#132-openapidan-farqi). Uni sayt chaqirmaydi: kabinetning o'z mahsulotlar sahifasi chaqiradi va brauzer kengaytmasi (`products.list` lookup'i) ham shu yo'lga so'rov yuboradi.

**Dalil qanchalik kuchli:** **ikki yozib olingan so'rov, bitta yozib olingan javob** (B so'rovniki). Javob yozib olgan kishi tomonidan qisqartirilgan: `productList` da 24 qatorli sahifadan **1 mahsulot** (5 SKU) turibdi, yuqori darajadagi jami sonlar esa yozilganidek. Shu sababli quyidagi hech bir maydon "tasdiqlangan" emas va "N ta ichida N ta" degan sanoq faqat shu bitta mahsulot ichidagi nusxalar sonidir. Misol uchun niqoblangan nusxa ishlatilgan: [`getProducts.response.masked.json`](../extension/src/uzum/getProducts.response.masked.json) (`productId`, `skuId`, shtrixkod, nomlar, SKU kodlari, kategoriya, rasm yo'llari, `ikpu`, narx, aksiya nomi va identifikatorlari, `advCpoId` — to'qilgan; kalit nomlari, tartibi, ichma-ichligi, `null`lar, enum kodlari, miqdorlar, foizlar va vaqt tamg'alari — yozilganidek).

#### So'rov

Ikki so'rov yozib olingan, ikkalasi ham `200`:

| | So'rov A | So'rov B |
|---|---|---|
| Query (yozilgan tartibda) | `?page=0&size=5&filter=WITHOUT_REQUIRED_FILTERS` | `?page=0&size=24&filter=ALL&sortBy=id&searchQuery=&order=descending` |
| Javob tanasi | yozib olinmagan | shu kartadagi javob |
| Ko'rinishi | kichik vidjet so'roviga o'xshaydi (`size` 5, saralash va qidiruvsiz) — taxmin | kabinetning asosiy mahsulotlar jadvali so'roviga o'xshaydi: `size=24` kabinetning o'zi saqlagan sahifa hajmiga (`localStorage` kaliti `products_page_size` = 24) teng — taxmin, 1 sessiya |
| Cookie | faqat analitika cookie'lari (`access_token` yo'q) | `access_token` cookie bor (§2) |

Ikkala so'rovda `sentry` tranzaksiya nomlari bir xil edi, shuning uchun ular bilan A va B ni farqlab bo'lmadi. A so'rovining vaqti va sessiyasi yozilmagan.

| Maydon | Tur | Majburiy | Birlik | Misol | Izoh |
|---|---|---|---|---|---|
| `{shopId}` (yo'lda) | number | ha | — | `1002` | do'kon id'i; tokenda ruxsat berilgan do'konlardan biri |
| `page` | number | ikkalasida bor; majburiyligi kuzatilmadi | — | `0` | ikkalasida faqat `0` — "0 dan boshlanadi" va nuqta "sahifa tartib raqami" ekani taxmin |
| `size` | number | ikkalasida bor; majburiyligi kuzatilmadi | dona (taxmin) | `5` (A), `24` (B) | `24` dan katta qiymat qabul qilinadimi — noma'lum |
| `filter` | string | ikkalasida bor; majburiyligi kuzatilmadi | — | `ALL` (B), `WITHOUT_REQUIRED_FILTERS` (A) | yozilgan ikki qiymat; boshqalari bor-yo'qligi noma'lum. `WITHOUT_REQUIRED_FILTERS` nimani tanlashi hujjatlashtirilmagan |
| `sortBy` | string | **yo'q**: A da yo'q, `200` | — | `id` | faqat B da; boshqa qiymat yozilmagan |
| `searchQuery` | string | **yo'q**: A da yo'q, `200` | — | (bo'sh) | B da **bo'sh satr** yuborilgan (`searchQuery=`); to'ldirilgan qiymat bilan so'rov yozilmagan |
| `order` | string | **yo'q**: A da yo'q, `200` | — | `descending` | faqat B da; boshqa qiymat yozilmagan |

A da `sortBy`, `searchQuery` va `order` bo'lmagan va `200` qaytgan — demak ular majburiy emas ko'rinadi (1 namuna). Berilmaganda standart tartib qanday — noma'lum.

So'rov misoli (niqoblangan, B):

```http
GET /api/seller/shop/1002/product/getProducts?page=0&size=24&filter=ALL&sortBy=id&searchQuery=&order=descending
Authorization: Bearer <niqoblangan>
Accept: application/json
Accept-Language: ru-RU
Origin: https://seller.uzum.uz
```

Kabinet bundan tashqari sentry `baggage` / `sentry-trace` va `access-content-allow-origin: *` nomli **so'rov** header'ini ham yuborgan (ikkala so'rovda); oxirgisining ma'nosi noma'lum, qiymatlari yozilmaydi (§2).

#### Javob

Konvert: nomlangan maydonli obyekt (`productList` + ikkita jami son). `content-type: application/json`.

Javob header'lari (B, 1 namuna): `access-control-allow-origin: https://seller.uzum.uz`, `access-control-allow-credentials: true`, `access-control-allow-methods: POST, GET, OPTIONS, PUT, DELETE`, `access-control-allow-headers` — ro'yxatda `authorization`, `Authorization`, `content-type`, `Content-Type`, `baggage`, `sentry-trace`, `x-requested-with` bor (ro'yxatning to'liq matni yozilmagan), `access-control-max-age: 3600`, `vary: Origin,Access-Control-Request-Method,Access-Control-Request-Headers`, `cache-control: no-cache, no-store, max-age=0, must-revalidate`, `server: istio-envoy`. `X-RateLimit-*` va `Retry-After` header'lari **yo'q**.

**Preflight (1 namuna, 2026-11-13).** Brauzerdan emas, qo'lda yuborilgan: tokensiz va cookie'siz `OPTIONS`, `Origin: https://seller.uzum.uz`, `Access-Control-Request-Method: GET`, `Access-Control-Request-Headers: authorization` — ya'ni kengaytma so'rovi uchun brauzer so'raydigan narsaning o'zi (kengaytmaning `GET` i faqat `accept` va `authorization` yuboradi; Chrome 157 va Edge 157 preflight'da aynan `authorization` ni so'ragani kuzatilgan — texnik spetsifikatsiya, 14.8). Yo'ldagi do'kon id'si (`1`) va `sortBy`/`order` qiymatlari o'ylab topilgan, sotuvchiniki emas. Javob: `200`, `content-length: 0`, `access-control-allow-origin: https://seller.uzum.uz`, `access-control-allow-credentials: true`, `access-control-allow-methods: POST, GET, OPTIONS, PUT, DELETE`, `access-control-max-age: 3600`, `server: istio-envoy`, `build-info: Build-Number: 1193187; Commit:` va `access-control-allow-headers` ning to'liq matni:

```
baggage, Access-Control-Allow-Origin, sentry-trace, Access-Control-Allow-Methods, X-XSRF-TOKEN, latitude, User-Agent, authorization, Authorization, responseType, credential, x-apollo-tracing, Access-Content-Allow-Origin, Access-Control-Allow-Credentials, Jwt-Token, content-type, qa-stub, Build-Info, x-iid, Content-Type, longitude, apollo-query-plan-experimental, Access-Control-Allow-Headers, x-requested-with, x-context
```

Bu nimani ko'rsatadi: server kabinet origin'idan `authorization` li `GET` ga preflight bosqichida ruxsat beradi. Nimani ko'rsatmaydi: haqiqiy token bilan `GET` ning o'zi faqat `accept` va `authorization` bilan qabul qilinishini (yozib olingan `GET` lar kabinetniki, ular qo'shimcha header'lar ham yuborgan), boshqa origin'ga javobni va boshqa marshrutlarni.

Quyidagi jadvallarda "Nullable": `ha (n/n)` — shu nusxalarning hammasida `null` keldi, haqiqiy turi noma'lum; `ha (k/n)` — ba'zisida; `kuzatilmagan` — `null` ko'rilmadi (boshqa javobda bo'lishi mumkin). Hamma qatorning dalil kuchi — `1 namuna`, aksi aytilmasa. Ma'no ustunida "taxmin" — kalit nomidan yoki mantiqdan chiqarilgan, namuna isbotlamaydi. Ba'zi sonlar yozuvda kasr nuqtasi bilan yozilgan (`25.5`, `100.0`, `0.0`, `40.0`, `7.0`); JSON `100.0` ni `100` deb chiqaradi — tur ikkala holda `number`.

**Yuqori daraja**

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| `productList` | massiv (mahsulot obyektlari) | kuzatilmagan | — | sahifadagi mahsulotlar; bu yozuvda 1 ta (qisqartirilgan) | 1 namuna |
| `totalProductsAmount` | number | kuzatilmagan | dona (taxmin) | `38`; 5.B.9 dagi `ALL: 38` ga teng. Jami son `filter` va `searchQuery` ga ergashadimi — noma'lum (B da `filter=ALL`, qidiruv bo'sh) | 1 namuna |
| `totalProductsAmountWithoutWeightDimensional` | number | kuzatilmagan | dona (taxmin) | `0`; 5.B.9 dagi `WITHOUT_WEIGHT_DIMENSIONAL: 0` ga teng. "Og'irlik-gabaritsiz mahsulotlar soni" — nomidan chiqarilgan taxmin | 1 namuna |

**Mahsulot darajasi** (`productList[]`)

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| `productId` | number | kuzatilmagan | — | mahsulot id'i | 1 namuna |
| `category` | string | kuzatilmagan | — | kategoriya nomi, ruscha; `accept-language: ru-RU` ga bog'liqligi taxmin | 1 namuna |
| `rating` | **string** (`"5.0"`) | kuzatilmagan | — | reyting; son emas | 1 namuna |
| `feedbackQuantity` | number | kuzatilmagan | dona (taxmin) | `2`; sharhlar soni — nomidan taxmin | 1 namuna |
| `status` | `{id: number, title: string, value: string, description: string, color: string, additional: []}` | kuzatilmagan | — | mahsulot holati; `value` = `IN_STOCK`; `title`/`description` ruscha; `additional` bo'sh massiv (turi noma'lum) | 1 namuna |
| `moderationStatus` | `{title: string, color: string, value: string, hasAnySkuBlocked: null}` | `hasAnySkuBlocked` — ha (1/1) | — | `value` = `MODERATED`; `title` ruscha | 1 namuna |
| `commission` | null | ha (1/1) | — | mahsulot darajasida `null`, SKU larda `25.5`; to'ldirilgandagi turi noma'lum | 1 namuna |
| `commissionDto` | `{minCommission: number, maxCommission: number}` | kuzatilmagan | ehtimol foiz — birligi payload'da yo'q | ikkalasi `25.5`, SKU `commission` ga teng | 1 namuna |
| `skuList` | massiv (SKU obyektlari) | kuzatilmagan | — | mahsulotning SKU lari; bu yerda 5 ta | 1 namuna |
| `skuTitle` | string | kuzatilmagan | — | mahsulot artikuli (niqoblangan: `SAMPLEKIT`) | 1 namuna |
| `image`, `previewImg` | string (URL) | kuzatilmagan | — | rasmlar; ikkinchisi kichik nusxa (URL oxiri `t_product_80_low.jpg`) | 1 namuna |
| `title` | string | kuzatilmagan | — | mahsulot nomi | 1 namuna |
| `quantityAvailable`, `quantityActive` | number | kuzatilmagan | dona (taxmin) | ikkalasi `15`; SKU larning mos maydonlari yig'indisiga teng (kuzatuv 1) | 1 namuna |
| `quantitySold`, `quantityReturned` | number | kuzatilmagan | dona (taxmin) | `8`, `9`; SKU yig'indisiga teng (kuzatuv 1). Qaysi davr uchun (butun tarixmi) — noma'lum | 1 namuna |
| `quantityAvailableByStockType` | `{fbo: number, fbs: number}` | kuzatilmagan | dona (taxmin) | `{fbo: 15, fbs: 0}`; `fbo` = `quantityAvailable` | 1 namuna |
| `quantityReserved`, `quantityFbs`, `quantityAdditional`, `quantityOnPhotoStudio`, `quantityCreated`, `quantityMissing`, `quantityDefected`, `quantityPending`, `quantityArchived` | number | kuzatilmagan | dona (taxmin) | hammasi `0` — shu namunada; nolga teng bo'lmagan qiymat ko'rilmagan, ma'nolari faqat nomdan taxmin | 1 namuna |
| `returnedPercentage` | number (`52.9`) | kuzatilmagan | foiz (taxmin) | 1 xonagacha yaxlitlangan (kuzatuv 2) | 1 namuna |
| `newYearStatus` | `{title: string, color: string, value: string}` | kuzatilmagan | — | `value` = `NONE`; `title` ruscha | 1 namuna |
| `price` | number (`120000`, niqoblangan) | kuzatilmagan | **payload'da yo'q** | SKU `price` ga teng. Asl qiymat kiyim to'plami uchun taxminan 110 000 — so'm narxining kattaligi; so'm ekani taxmin (kuzatuv 9) | 1 namuna |
| `clicks` | null | ha (1/1) | — | to'ldirilgandagi turi noma'lum | 1 namuna |
| `viewers` | number (`774`) | kuzatilmagan | — | ko'rishlar soni (taxmin); davri noma'lum | 1 namuna |
| `conversion` | number (`1.16`) | kuzatilmagan | foiz (taxmin) | formulasi noma'lum (kuzatuv 7) | 1 namuna |
| `roi` | **string** (`"-100.0"`) | kuzatilmagan | foiz (taxmin) | son emas; kuzatuv 8 | 1 namuna |
| `rankInfo` | `{rank: string, rankValue: string, dateUpdated: number}` | kuzatilmagan | `dateUpdated` — epoch ms | `rank` = `A`; `rankValue` = `rank`; `dateUpdated` 13 xonali son. `rank` shkalasi noma'lum | 1 namuna |
| `blockReason`, `blockComment`, `dateModerated`, `volumeDiscount` | null | ha (1/1) | — | to'ldirilgandagi turi noma'lum | 1 namuna |
| `blockingReasons` | massiv (`[]`) | kuzatilmagan | — | bo'sh; element turi noma'lum | 1 namuna |
| `skusHasAllRequiredFilters`, `allFiltersFilled` | boolean | kuzatilmagan | — | `true`, `false`. So'rov A dagi `filter=WITHOUT_REQUIRED_FILTERS` ga eng yaqin narsa — bog'liqligi taxmin | 1 namuna |
| `auctionMember`, `isDeletable`, `isIlliquid`, `switchbackActive`, `isWithoutWeightDimensional` | boolean | kuzatilmagan | — | hammasi `false` | 1 namuna |
| `isEditable`, `isEditableSku`, `isActive`, `createdByFlowB`, `pstorage` | boolean | kuzatilmagan | — | hammasi `true`. `pstorage` — "pullik saqlash qo'llanadi" (taxmin, kuzatuv 3) | 1 namuna |
| `promotionStatus` | string | kuzatilmagan | — | `PROMOTION_AVAILABLE` | 1 namuna |
| `cpoAdvertisementsDetails` | `{advCpoId: string (UUID), productId: number, commissionPercentage: number, minCommissionPercentage: number, maxCommissionPercentage: number, status: string, cpoVersion: number}` | kuzatilmagan | foiz (taxmin) | `7`, `3`, `60`; `status` = `ACTIVE`; `cpoVersion` = `2`; `productId` mahsulotniki bilan bir xil. CPO reklama sozlamasi — nomidan taxmin | 1 namuna |

**SKU darajasi** (`productList[].skuList[]`, 5 ta SKU)

| Maydon yo'li | Tur | Nullable | Birlik | Ma'nosi | Dalil kuchi |
|---|---|---|---|---|---|
| `skuTitle` | string | kuzatilmagan | — | o'lcham-rang belgisi (`КРАСН-L`, `КРАСН-M`, …) | 1 namuna |
| `skuFullTitle` | string | kuzatilmagan | — | asl yozuvda: do'kon `skuTitle` + mahsulot `skuTitle` + SKU `skuTitle`, `-` bilan (5/5; niqoblangan fayl tuzilmani saqlaydi, prefiks to'qilgan: `SELLER-SAMPLEKIT-КРАСН-L`) | 1 namuna |
| `productTitle` | string | kuzatilmagan | — | mahsulot nomi (mahsulotniki bilan bir xil) | 1 namuna |
| `skuId` | number | kuzatilmagan | — | SKU id'i | 1 namuna |
| `quantityAvailable` | number | kuzatilmagan | dona (taxmin) | `5, 0, 4, 2, 4`; `quantityActive` ga 5/5 da teng | 1 namuna |
| `quantityActive` | number | kuzatilmagan | dona (taxmin) | `quantityAvailable` ga 5/5 da teng | 1 namuna |
| `quantityAvailableByStockType` | `{fbo: number, fbs: number}` | kuzatilmagan | dona (taxmin) | `fbo` = `quantityAvailable`, `fbs` = `0` — 5/5 | 1 namuna |
| `quantitySold`, `quantityReturned` | number | kuzatilmagan | dona (taxmin) | sotilgan `0, 4, 1, 2, 1`; qaytarilgan `2, 2, 1, 2, 2`. Davri noma'lum | 1 namuna |
| `quantityCreated`, `quantityFbs`, `quantityAdditional`, `quantityOnPhotoStudio`, `quantityArchived`, `quantityMissing`, `quantityDefected`, `quantityPending` | number | kuzatilmagan | dona (taxmin) | hammasi `0` — 5/5; mahsulot darajasidagi `quantityReserved` SKU da yo'q | 1 namuna |
| `returnedPercentage` | number | kuzatilmagan | foiz (taxmin) | yaxlitlanmagan float (`33.333333333333336`, `66.66666666666667`); kuzatuv 2 | 1 namuna |
| `barcode` | **number** (13 xona) | kuzatilmagan | — | shtrixkod; son sifatida keladi. Asl yozuvda `skuId` bilan bog'liq tuzilma bor edi (kuzatuv 6) | 1 namuna |
| `archived`, `blocked`, `activeSale`, `switchbackActive`, `isWithoutWeightDimensional` | boolean | kuzatilmagan | — | hammasi `false` (5/5) | 1 namuna |
| `commission` | number (`25.5`) | kuzatilmagan | ehtimol foiz — birligi payload'da yo'q | 5/5 da bir xil; `commissionDto` min/max ga teng | 1 namuna |
| `characteristics` | string (`"L, Красный"`) | kuzatilmagan | — | o'lcham va rang, ruscha ko'rinish matni | 1 namuna |
| `characteristicsList` | `[{characteristicTitle: {uz, ru}, definedType: boolean, characteristicValue: {uz, ru}}]` | kuzatilmagan | — | har SKU da 2 element (o'lcham, rang); `uz` va `ru` ikkalasi bor; `definedType` = `true` | 1 namuna |
| `previewImage` | string (URL) | kuzatilmagan | — | rasm | 1 namuna |
| `ikpu` | **string** (17 xona) | kuzatilmagan | — | soliq kodi; bosh nol bo'lishi mumkin — son sifatida o'qilmasin (niqoblangan: nollar) | 1 namuna |
| `photo`, `purchasePrice`, `recommendedTotalPrice`, `blockingReason`, `skuBlockReason`, `article`, `paidStorageDimensionalGroup`, `actualDimensionalGroup`, `hasStudioPhoto`, `sellerItemCode` | null | ha (5/5) | — | to'ldirilgandagi turi noma'lum | 1 namuna |
| `blockReasons` | massiv (`[]`) | kuzatilmagan | — | bo'sh (5/5); element turi noma'lum | 1 namuna |
| `price`, `marketPrice` | number (`120000`, niqoblangan) | kuzatilmagan | **payload'da yo'q** | 5/5 da ikkalasi teng va mahsulot `price` ga teng; birligi — so'm (taxmin, kuzatuv 9) | 1 namuna |
| `rankInfo` | `{rank: string, rankValue: string, dateUpdated: number}` | kuzatilmagan | `dateUpdated` — epoch ms | `rank` = `A` (3 SKU) yoki `C` (2 SKU); `rankValue` = `rank`. Shkalasi noma'lum | 1 namuna |
| `turnover` | number | ha (4/5) | kun (taxmin) | bitta SKU da `40`, qolganida `null`; kuzatuv 4 | 1 namuna |
| `dimensionalGroup` | string | ha (1/5) | — | `"СГТ"` (4 SKU), kirillcha; `null` — qoldiqsiz SKU | 1 namuna |
| `paidStoragePriceItem` | number | ha (1/5) | so'm/dona (taxmin) | `96, 120, 96, 60`; qoldiqsiz SKU da `null` | 1 namuna |
| `paidStorageAmount` | number | ha (2/5) | so'm (taxmin) | `480, 480, 192`; `null` — `pstorage: false` (1 SKU) va qoldiqsiz SKU (1); kuzatuv 3 | 1 namuna |
| `forecastOutOfStock` | boolean | kuzatilmagan | — | `true` faqat qoldiqsiz SKU da, qolgan 4 tasida `false`. API'ning o'z bayrog'i — qanday hisoblanishi noma'lum | 1 namuna |
| `updatedFromWms` | boolean | kuzatilmagan | — | 5/5 `true` | 1 namuna |
| `hasActiveDiscount` | boolean | kuzatilmagan | — | `true` (4), `false` (1, qoldiqsiz SKU) | 1 namuna |
| `status` | `{value: string, title: string, color: string}` | kuzatilmagan | — | `value` = `IN_STOCK` (4) yoki `RUN_OUT` (1, qoldiqsiz SKU); `title` ruscha | 1 namuna |
| `skuDimension` | `{length, width, height, weight}` number | kuzatilmagan | **payload'da yo'q** | masalan `378 × 281 × 35` va `365` — mm va g bo'lishi mumkin (taxmin) | 1 namuna |
| `specialOffer` | `{inOffer: boolean, hasRecommendation: boolean, mechanicType: string, mechanicPrice: null, endDate: number, promoName: string, selfExit: null, promoIds: number[]}` | `mechanicPrice`, `selfExit` — ha (5/5) | `endDate` — epoch ms | 5/5 da bir xil: `inOffer: true`, `hasRecommendation: false`, `mechanicType: "UZUM_PROMO"`, bir xil `endDate`, bir xil `promoName`, `promoIds` bitta element; kuzatuv 5 | 1 namuna |
| `avgdsales` | number | ha (1/5) | — | `0` (3 SKU), `0.1` (1), `null` (qoldiqsiz SKU) | 1 namuna |
| `avgdquantity` | number | ha (1/5) | — | `5, 4, 2, 4`; ko'rilgan 4/4 da `quantityAvailable` ga teng | 1 namuna |
| `pstorage` | boolean | ha (1/5) | — | `true` (3), `false` (1), `null` (qoldiqsiz SKU) | 1 namuna |

Enum kodlari (faqat yozilgani; boshqa qiymatlar, shubhasiz, bor): `status.value` — `IN_STOCK`, `RUN_OUT`; `moderationStatus.value` — `MODERATED`; `promotionStatus` — `PROMOTION_AVAILABLE`; `rankInfo.rank` — `A`, `C`; `specialOffer.mechanicType` — `UZUM_PROMO`; `cpoAdvertisementsDetails.status` — `ACTIVE`; `newYearStatus.value` — `NONE`.

**Qoldiqsiz SKU** (`КРАСН-M`): `status.value` = `RUN_OUT`, `forecastOutOfStock` = `true`, `quantityAvailable` = 0 va `dimensionalGroup`, `paidStoragePriceItem`, `paidStorageAmount`, `avgdsales`, `avgdquantity`, `pstorage` — hammasi `null`. Demak bu maydonlardagi `null` — "noma'lum/qo'llanmaydi", **nol emas** (1 SKU).

**Lokalizatsiya.** `category`, `status.title`/`description`, `moderationStatus.title`, `newYearStatus.title` va SKU `status.title` ruscha edi, so'rovda esa `accept-language: ru-RU` bor edi — bog'liqligi taxmin, boshqa til bilan javob yo'q. `characteristicsList` ikkala tilni (`uz`, `ru`) birga olib keladi. Kodlar (`status.value` va h.k.) tilga qarab o'zgarishi kuzatilmagan.

**Arifmetik kuzatuvlar** (bitta javob ichida; "kuzatuv" — taxmin emas, lekin 1 mahsulot va shu sababli `1 namuna`):

1. Mahsulot darajasidagi `quantityAvailable` (15), `quantityActive` (15), `quantitySold` (8), `quantityReturned` (9) va `quantityAvailableByStockType.fbo` (15) — SKU qiymatlari yig'indisiga teng (masalan sotilgan 0+4+1+2+1, qaytarilgan 2+2+1+2+2).
2. `returnedPercentage = quantityReturned / (quantitySold + quantityReturned) × 100` — 6 nuqtada mos (5 SKU, yaxlitlanmagan: 2/2=100, 2/6=33,33, 1/2=50, 2/4=50, 2/3=66,67; mahsulot: 9/17=52,94 → `52.9`). Mahsulot darajasida 1 xonaga yaxlitlanadi, SKU darajasida yo'q.
3. `paidStorageAmount = paidStoragePriceItem × quantityAvailable` — `pstorage: true` bo'lgan 3/3 SKU da mos (96×5=480, 120×4=480, 96×2=192). `pstorage: false` bo'lgan SKU da `paidStoragePriceItem` (60) to'ldirilgan, lekin `paidStorageAmount` `null`. `pstorage` `null` bo'lganda ikkalasi `null`. Davr (kunlikmi) va birlik (so'm — taxmin) noma'lum.
4. `turnover = avgdquantity / avgdsales` — `avgdsales > 0` bo'lgan 1/1 SKU da mos (4 / 0,1 = 40). `avgdsales` `0` (3 SKU) yoki `null` (1) bo'lganda `turnover` `null` (nolga bo'lish yo'q — mos). Ma'nolar — taxmin: `avgdsales` kunlik o'rtacha sotuv, `avgdquantity` o'rtacha qoldiq, `turnover` zaxira necha kunga yetishi.
5. `specialOffer.endDate` (13 xonali) epoch **millisekund**: asl yozuvda 2026-12-03 18:59:00 UTC = 23:59 Toshkent vaqti — aksiya nomidagi tugash sanasi bilan mos (1 namuna). Xuddi shunday `rankInfo.dateUpdated` 13 xonali (6/6 nusxa).
6. `barcode` — asl yozuvda `"1000"` + 8 xonali `skuId` + bitta raqam (5/5 SKU); oxirgi raqam EAN-13 nazorat raqami bo'lishi mumkin (taxmin). **Niqoblangan faylda bu tuzilma saqlanmagan** (shtrixkod va `skuId` to'qilgan), shuning uchun kuzatuvni fayldan qayta tekshirib bo'lmaydi.
7. `conversion` (1,16) va `viewers` (774): `9 / 774 × 100` = 1,16 ga yaxlitlanadi. Lekin `9` — bu `quantityReturned` ga ham teng, va payload'da yo'q buyurtmalar soni ham bo'lishi mumkin; `quantitySold / viewers` = 8/774 = 1,03 — mos kelmaydi. **Formula noma'lum.**
8. `roi: "-100.0"` va barcha SKU da `purchasePrice: null` — tannarx kiritilmaganda ROI −100 chiqishi mumkin (taxmin).
9. `price` kattaligi so'm narxiga mos (asl qiymat kiyim to'plami uchun taxminan 110 000; niqoblangan misolda — `120000`, o'sha kattalik). Birlik payload'da aytilmagan.
10. `commission` (25,5) SKU larda `commissionDto.minCommission` va `maxCommission` ga teng; mahsulot darajasida `commission` `null`.
11. `quantitySold` / `quantityReturned` qaysi davr uchun (butun tarixmi) — noma'lum.

Javob misoli (qisqartirilgan, niqoblangan; [fayldan](../extension/src/uzum/getProducts.response.masked.json) — 5 SKU dan ikkitasi, ko'p maydon `…` bilan qisqartirilgan):

```json
{
  "productList": [
    {
      "productId": 4000001,
      "category": "…",
      "rating": "5.0",
      "feedbackQuantity": 2,
      "status": { "id": 1, "title": "…", "value": "IN_STOCK", "description": "…", "color": "#51AE42", "additional": [] },
      "moderationStatus": { "title": "…", "color": "#51AE42", "value": "MODERATED", "hasAnySkuBlocked": null },
      "commission": null,
      "commissionDto": { "minCommission": 25.5, "maxCommission": 25.5 },
      "skuList": [
        {
          "skuTitle": "КРАСН-L", "skuFullTitle": "SELLER-SAMPLEKIT-КРАСН-L", "skuId": 50000002,
          "quantityAvailable": 5, "quantityAvailableByStockType": { "fbo": 5, "fbs": 0 },
          "quantitySold": 0, "quantityReturned": 2, "returnedPercentage": 100,
          "barcode": 2000000000024, "ikpu": "00000000000000000", "price": 120000, "marketPrice": 120000,
          "purchasePrice": null, "turnover": null,
          "rankInfo": { "rank": "C", "rankValue": "C", "dateUpdated": 1794472997270 },
          "paidStoragePriceItem": 96, "paidStorageAmount": 480, "pstorage": true,
          "avgdsales": 0, "avgdquantity": 5, "forecastOutOfStock": false,
          "status": { "value": "IN_STOCK", "title": "…", "color": "#51AE42" },
          "specialOffer": { "inOffer": true, "hasRecommendation": false, "mechanicType": "UZUM_PROMO", "mechanicPrice": null, "endDate": 1796324340000, "promoName": "…", "selfExit": null, "promoIds": [1] },
          "…": "…"
        },
        {
          "skuTitle": "КРАСН-M", "skuId": 50000005,
          "quantityAvailable": 0, "quantitySold": 4, "quantityReturned": 2,
          "returnedPercentage": 33.333333333333336,
          "dimensionalGroup": null, "paidStoragePriceItem": null, "paidStorageAmount": null,
          "avgdsales": null, "avgdquantity": null, "pstorage": null, "forecastOutOfStock": true,
          "status": { "value": "RUN_OUT", "title": "…", "color": "#E4981B" },
          "…": "…"
        },
        "…"
      ],
      "skuTitle": "SAMPLEKIT", "title": "…",
      "quantityAvailable": 15, "quantityAvailableByStockType": { "fbo": 15, "fbs": 0 },
      "quantitySold": 8, "quantityReturned": 9, "returnedPercentage": 52.9,
      "price": 120000, "clicks": null, "viewers": 774, "conversion": 1.16, "roi": "-100.0",
      "rankInfo": { "rank": "A", "rankValue": "A", "dateUpdated": 1794452671174 },
      "promotionStatus": "PROMOTION_AVAILABLE",
      "cpoAdvertisementsDetails": { "advCpoId": "00000000-0000-7000-8000-000000000001", "productId": 4000001, "commissionPercentage": 7, "minCommissionPercentage": 3, "maxCommissionPercentage": 60, "status": "ACTIVE", "cpoVersion": 2 },
      "pstorage": true,
      "…": "…"
    }
  ],
  "totalProductsAmount": 38,
  "totalProductsAmountWithoutWeightDimensional": 0
}
```

#### Sahifalash

`page` / `size` so'rovda, jami son javobning o'zida — `totalProductsAmount` (`38`). Yozib olingan javobda `productList` da 1 qator bor, `size=24` va jami 38 — yozuv qisqartirilganini yozib olgan kishi aytgan, javobning o'zi buni ko'rsatmaydi. Tugash belgisi — `page × size ≥ totalProductsAmount` (taxmin; oxirgi sahifa yozib olinmagan).

**Noma'lum:** `size` ning `24` dan kattasi hurmat qilinishi (A da `5`, B da `24` yozilgan; javobda qator soni qisqartirilgan, shuning uchun `5` ham tekshirib bo'lmaydi); sahifa o'rni qanday aniqlanishi (`page × size` ofsetmi yoki boshqami — faqat `page=0` yozilgan); oxirgi sahifadan keyingi sahifa nima qaytaradi; jami son `filter` va `searchQuery` ga ergashadimi.

#### Kuzatilgan xatolar

Kuzatilmagan: ikkala yozib olingan so'rov `200` oldi. `401`, `403`, `429` va xato tanasi yozilmagan.

#### Kod/ENDPOINTS.md bilan farq

Kodning shu marshrutni chaqirishi — [`routes.ts`](../extension/src/uzum/routes.ts#L112) va [`productsList.ts`](../extension/src/tools/productsList.ts#L100). Mos kelmaydigan yoki dalilsiz joylar:

1. **B shakli yuboriladi, A shakli hech qachon.** Kod parametrlarni B dagi tartibda (`page, size, filter, sortBy, searchQuery, order`) yuboradi; `sortBy=id` va `order=descending` qat'iy (yagona yozilgan qiymatlar), `searchQuery` bo'sh yoki sotuvchi so'ragan matn. A shakli (`sortBy`/`order`/`searchQuery`siz) kod tomonidan yuborilmaydi, va `filter=WITHOUT_REQUIRED_FILTERS` bilan `sortBy`/`order`/`searchQuery` birikmasi **yozib olinmagan** — kod uni yuborishi mumkin.
2. **Kodning o'z chegaralari — dalil emas:** `size` 1…100 (standart 24), `page` 0…100 000, `searchQuery` ≤ 100 belgi. Ularni hech bir javob ko'rsatmagan.
3. **Faqat `null` ko'rilgan maydonlarga kod tur faraz qiladi** — [`products.ts`](../extension/src/uzum/products.ts): son — `purchasePrice`, `recommendedTotalPrice`, `mechanicPrice`, `clicks`, `dateModerated`, `volumeDiscount`, mahsulot `commission`; satr — `article`, `sellerItemCode`, `blockingReason`, `paidStorageDimensionalGroup`, `actualDimensionalGroup`, `blockReason`, `blockComment`; mantiqiy — `hasStudioPhoto`, `selfExit`, `hasAnySkuBlocked`. Haqiqiy tur boshqacha bo'lsa, o'quvchi bu yo'lni `mistyped` ro'yxatiga yozadi, lookup esa qiymatni javobdagidek (`raw`) ko'rsatadi va sarlavhada "unexpected:" deydi — qiymat yo'qolmaydi. Faraz o'zi baribir dalilsiz. `photo`, `skuBlockReason`, `blockReasons` va `blockingReasons` uchun tur faraz qilinmagan.
4. **Sahifa o'rni `page × size` deb faraz qilinadi** ([`pagingText`](../extension/src/tools/productsView.ts#L278)): "rows 1–24 of 38" shu farazga tayanadi; javob buni tasdiqlamaydi (faqat `page=0`). Sahifa farazga mos kelmasa, matn buni aytadi.
5. **Maydon izohi** ([`tools/index.ts`](../extension/src/tools/index.ts#L74)) bu hujjat bilan mos: `commission` — "birligi payload'da yo'q, ehtimol foiz"; saralash so'ralgani, qidiruv bo'sh yozilgani va tilni bitta namuna bilan cheklaydi.
6. **Eskirgan izohlar:** [`host/prompt.ts`](../extension/src/host/prompt.ts#L14) sarlavhasi ("one recorded request, no recorded response") va `fieldNames` izohi ("no cabinet response has ever been recorded") endi to'g'ri emas: bitta javob yozib olingan. Prompt hamon hech bir maydon nomini kafolatlamaydi — bu kod egasining qarori.
7. ENDPOINTS.md 13-bo'limi shu karta uchun yangilandi (ilgari "javob noma'lum", "bitta so'rov" deyilgan edi).

#### Ochiq savollar

- `filter=WITHOUT_REQUIRED_FILTERS` nimani tanlaydi va u bilan javob qanday ko'rinadi: 5.B.9 da `ALL: 38`, `WITHOUT_REQUIRED_FILTERS: 22` — kichik qismni tanlashi mumkin (1 sessiya, taxmin); bu filtr bilan javob yozilmagan. Qolgan `filter` qiymatlari.
- `searchQuery` qanday moslashadi (nom, SKU, shtrixkod) va jami son unga ergashadimi — to'ldirilgan qidiruv bilan so'rov yozilmagan.
- `price`, `paidStoragePriceItem`, `paidStorageAmount` birligi (so'mmi?) va `paidStorageAmount` davri (kunlikmi?).
- `conversion` formulasi (kuzatuv 7).
- `rankInfo.rank` shkalasi (`A`, `C` yozilgan; boshqalari, tartibi noma'lum).
- `status`, `moderationStatus`, `promotionStatus`, `newYearStatus`, `mechanicType`, `cpoAdvertisementsDetails.status` ning boshqa qiymatlari.
- `size` yuqori chegarasi, sahifa o'rni, `sortBy`/`order` ning boshqa qiymatlari va berilmagandagi standart tartib.
- `quantitySold`/`quantityReturned`/`viewers` qaysi davr uchun.
- Rate limit: yozib olingan bitta javobda `X-RateLimit-*` va `Retry-After` header'i yo'q — bu chegara yo'qligini isbotlamaydi.
- Kabinet `access-content-allow-origin: *` nomli so'rov header'ini yuboradi, kengaytma yubormaydi (faqat `accept` va `authorization`): server uni `GET` da talab qiladimi — noma'lum, faqat haqiqiy token bilan so'rov hal qiladi. Preflight bosqichi o'tadi (yuqoridagi "Preflight", 1 namuna): `authorization` ning o'zi so'ralganda server ruxsat berdi.
- Boshqa do'konlar (`1001`) va bo'sh/ko'p SKU li mahsulotlar uchun javob.

---

### 5.B.9 `GET /api/seller/shop/{shopId}/product/products-statistic`

**Guruh:** Katalog · **Maqsad:** mahsulot filtrlari bo'yicha sonlar.

#### So'rov

Parametr yo'q (yo'lda `shopId`). `Authorization: Bearer <niqoblangan>` + `cookie`.

#### Javob

Konvert: nomlangan maydon `statisticResultList`, 8 element `{count: number, type: string, shopId: number}`.

| `type` | `count` |
|---|---|
| `OUT_OF_STOCK` | 5 |
| `INACTIVE` | 7 |
| `WARN` | 0 |
| `ARCHIVED` | 1 |
| `WITHOUT_REQUIRED_FILTERS` | 22 |
| `WITHOUT_WEIGHT_DIMENSIONAL` | 0 |
| `IN_STOCK` | 30 |
| `ALL` | 38 |

Hammasi `1 namuna`. Kuzatuvlar:

- `ALL` (38) = 5.B.8 `totalProductsAmount`; `WITHOUT_WEIGHT_DIMENSIONAL` (0) =
  `totalProductsAmountWithoutWeightDimensional` (0).
- Turlar bir-birini kesib o'tadi — bo'linma emas (IN_STOCK 30 + OUT_OF_STOCK 5 + ARCHIVED 1 = 36 ≠ 38;
  INACTIVE bilan 43).
- `type` qiymatlari `getProducts` `filter` qiymatlari bilan bir xil to'plam bo'lishi mumkin — faqat
  `ALL` va `WITHOUT_REQUIRED_FILTERS` ikkalasida ko'rilgan (taxmin).
- Payload'da `shopId` bor, lekin loyiha qoidasi bo'yicha `store_id` so'ralgan do'kondan olinadi,
  payload'dan emas.

```json
{ "statisticResultList": [
  {"count": 5, "type": "OUT_OF_STOCK", "shopId": 1002},
  {"count": 22, "type": "WITHOUT_REQUIRED_FILTERS", "shopId": 1002},
  {"count": 38, "type": "ALL", "shopId": 1002},
  "…"
] }
```

#### Sahifalash

Yo'q.

#### Kuzatilgan xatolar

Kuzatilmagan.

#### Kod/ENDPOINTS.md bilan farq

Yo'q. `WITHOUT_REQUIRED_FILTERS` soni uchun qarang 5.B.8.

#### Ochiq savollar

- `type` ning to'liq to'plami; boshqa do'kon uchun (1001) sonlar.

## 6. Ochiq savollar

Kartalararo (umumiy) savollar:

- Kabinet tokeni OpenAPI'da ishlaydimi va aksincha.
- Token muddati: `exp: 2600000` ma'nosi (5.B.1).
- Rate limit: header'lar kuzatilmadi, chegara noma'lum.
- Xato tanalari: `401` / `403` / `429` hali ko'rilmagan.
- `accept-language` o'zgartirilsa matn maydonlari (`category`, `status.title`, …) tili.
- Cookie umuman kerakmi (muddati o'tgan JWT bilan 200 kelgan kuzatuv, §2).
- seller.uzum.uz dan boshqa origin CORS'dan o'tadimi (server origin'ni aks ettirishi mumkin).
- Ikki backend servis (`Build` / `Build-Number`) taxmini tekshirilmagan.
