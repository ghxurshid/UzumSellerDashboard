# Uzum Seller API'lari — so'rov va javob shakllari katalogi

> **Holat:** ikki API bor: **OpenAPI** (`/api/seller-openapi/…`; kartalari kutilmoqda, §5.A bo'sh) va
> **kabinet ichki API'si** (`/api/seller/…`, seller.uzum.uz o'zi ishlatadi; 14 ta karta, §5.B).
> Kabinet kartalarining dalili — bitta sotuvchi hisobining (2 ta do'kon) yozib olingan brauzer trafigi:
> - **2026-11-13 03:01 GMT**, bitta sessiya — 5.B.1–5.B.9;
> - **2026-11-16 10:52 GMT**, ikkinchi sessiya — 5.B.3 ga ikkinchi namuna va 5.B.10 (`invoice`);
> - **2026-11-16 12:11 GMT**, boshqa sahifa yuklanishi — 5.B.11 (`return`);
> - **2026-11-17 08:49 GMT** — 5.B.12 (`product-reviews`, `POST`): javob 7 qatordan keyin kesilgan; so'rov
>   tanasi alohida, DevTools'ning Payload bo'limidan berilgan. `filter` ning yana to'rt qiymati sotuvchi
>   tomonidan **aytilgan** — ularning so'rovi ham, javobi ham yozib olinmagan;
> - **2026-11-17 11:58 va 12:00 GMT** — 5.B.14 (`reports/barcodes/types`) va 5.B.13 (`sku-list`): har biri
>   1 so'rov, 1 javob; `sku-list` javobida 1 qator (shtrixkod bo'yicha qidiruv).
>
> Hech bir maydon "tasdiqlangan" emas. 5.B.3 ning ikkinchi namunasida shakl o'zgarmagan, lekin bu o'sha
> hisobning o'sha ikki do'koni (taxmin, 5.B.3) — hisoblar orasidagi xilma-xillikni ko'rsatmaydi. 5.B.10 va
> 5.B.11 — to'liq 20 qatorli sahifalar, har biri 1 namuna. Eng boyi — 5.B.8 (`getProducts`): **ikki yozib
> olingan so'rov va bitta yozib olingan javob**; javob qisqartirilgan (24 qatorli sahifadan 1 mahsulot,
> 5 SKU), niqoblangan nusxasi repoda:
> [`getProducts.response.masked.json`](../extension/src/uzum/getProducts.response.masked.json). Uning ikkinchi
> so'rovi (A) ning vaqti va sessiyasi yozilmagan, tanasi yo'q.

## 1. Maqsad va boshqa hujjatlardan farqi

Bu hujjat Uzum API'larining simdagi **kuzatilgan** shartnomasini — har bir so'rov va javobning
maydonma-maydon shaklini — haqiqiy namunalarga tayanib yozadi.

| Hujjat | Nimaga javob beradi |
|---|---|
| [ENDPOINTS.md](../frontend/src/services/uzum/ENDPOINTS.md) | Kod har bir route bilan **qanday ishlaydi**: konvert o'qigichlari, sahifa hajmi, tekshiruv natijalari |
| **Shu hujjat** | Simdagi **haqiqiy shakl**: qaysi maydon, qaysi tur, qaysi birlik, nechta namuna asosida |
| [STORAGE.md](../frontend/src/services/storage/STORAGE.md) | Javob IndexedDB'ga **qanday saqlanadi** (jadvallar, indekslar) |
| [uzum-samples.json](../frontend/_design/v1/uploads/uzum-samples.json) | Yozib olingan xom namunalar (faqat o'qiladi, tahrirlanmaydi) |

Nega alohida hujjat: ENDPOINTS.md kod nuqtayi nazaridan yozilgan — maydonning simdagi ma'nosi va uni
nechta namuna qo'llashi u yerda yo'qoladi. Bu yerda aynan shu saqlanadi; kod bilan ziddiyat har kartaning
"Kod/ENDPOINTS.md bilan farq" bandida ko'rinadi.

Katalog **ikki sirtni** qamraydi: sotuvchi o'zi token olib chaqiradigan **OpenAPI**
(`/api/seller-openapi/…`, xom token; bo'lim raqami `5.A.N`) va kabinetning **ichki API'si**
(`/api/seller/…`, `Authorization: Bearer …`; `5.B.N`). Ikkinchisini sayt chaqirmaydi: uni kabinetning o'z
sahifasi va brauzer kengaytmasi ishlatadi. Ularning farqi va kabinet dalili nega kuchsizroq ekani —
ENDPOINTS.md [13-bo'lim](../frontend/src/services/uzum/ENDPOINTS.md#13-kabinetning-ichki-apisi-openapi-emas),
bu yerda takrorlanmaydi.

## 2. Umumiy qoidalar

| Nima | OpenAPI | Kabinet API |
|---|---|---|
| Base URL | `https://api-seller.uzum.uz/api/seller-openapi/` | `https://api-seller.uzum.uz/api/seller/…`; auth servisi `/api/auth/seller/…`; bittasi `/api/v1/seller/…` (5.B.5) |
| Avtorizatsiya | Token header'i, xom, `Bearer`siz (qiymati **yozilmaydi**) | `Authorization: Bearer <token>`; token — 27 belgili shaffof satr, JWT emas (uch kunning yozuvlarida ham 27 belgi). 2026-11-16 da 10:52 va 12:11 dagi so'rovlarda aynan bir xil satr edi — token kamida 79 daqiqa yashaydi; 2026-11-17 da 08:49, 11:58 va 12:00 dagi so'rovlarda ham bitta satr — kamida 3 soat 10 daqiqa. `check_token` shakl A da `Basic` (5.B.1). Ba'zi so'rovlarda `cookie` da `access_token=<JWT>` ham bor (pastda) |
| `dateFrom` / `dateTo` | So'rovda **sekundlarda**; javobda **millisekundlarda**; konvertatsiya faqat `toApiSeconds()` orqali | 14 ta kartaning hech bir so'rovida sana parametri yo'q |
| Vaqt formatlari | epoch ms | To'rt xil. (a) Epoch **millisekund** son: `rankInfo.dateUpdated`, `specialOffer.endDate`; 5.B.10 da `dateAccepted`, `timeSlots[].timeFrom`; 5.B.11 da hamma vaqt maydoni, `dateCreated` ham; 5.B.12 da `dateCreated`, `dateBought`. (b) Zonasiz ISO satr: `registrationDate: "2026-…T06:02:56.306"`; `timestamp` — 8 xonali kasr bilan, javob `date` header'iga mos (5.B.7), 9 xonali kasr bilan, `date` dan 1,06 s keyin (5.B.11) va 9 xonali kasr bilan, `date` bilan bir sekundda (5.B.12): zonasiz UTC, 3 namuna. (c) Faqat sana: `"2031-…-…"`. (d) `DD.MM.YYYY` satr: `dateCreated: "07.10.2026"` (5.B.10) — 5.B.11 da shu nomli maydon epoch ms: nom formatni bildirmaydi. Bundan tashqari soat — `HH:mm` satr (`stock.timeFrom: "06:00"`, 5.B.10) |
| Konvertlar | Yalang'och massiv / `{ payload: … }` / nomlangan maydonli obyekt — ENDPOINTS.md §1 | Har xil: yalang'och massiv (`shop/`, `invoice`), yalang'och obyekt (`account`, `check_token`), `{ payload, timestamp }` (committent, `return`, `product-reviews`), nomlangan ro'yxat maydoni (`productList`, `statisticResultList`, `skuList`, `barcodeLabelTypes`), bo'sh tana (`notifications`) |
| Sahifalash | Kartada | `getProducts`: `page` (0 dan) / `size` + `totalProductsAmount`. `invoice`, `return`, `product-reviews`: `page` / `size`, jami son **yo'q** (5.B.10–5.B.12); `product-reviews` da ular `POST` ning query'sida. `sku-list`: `page` / `size` + javobda **sahifalar** soni `totalPages` (5.B.13). Qolganida yo'q |
| Xato kodlari | `401`, `403`, `429` — kuzatilganda kartaga | **Kuzatilmagan** (401/403/429 yo'q); rate limit header'lari ham kuzatilmadi |
| Kim chaqira oladi / CORS | Sayt | Hamma javobda `access-control-allow-origin: https://seller.uzum.uz`, `access-control-allow-credentials: true`, `access-control-max-age: 3600`. So'rovning `Origin` i ham seller.uzum.uz edi — server origin'ni aks ettirayotgan bo'lishi mumkin, boshqa origin'ga ruxsat noma'lum |

### Kabinet API'sining umumiy kuzatuvlari (asosan 1 sessiya)

Kartalar quyidagilarni takrorlamaydi — transport tafsiloti shu yerda bir marta yoziladi.

**Kabinet yuboradigan so'rov header'lari.** `Authorization: Bearer <niqoblangan>`, `accept: application/json`,
`accept-language: ru-RU`, `Origin: https://seller.uzum.uz`, `Referer: https://seller.uzum.uz/`
(`sec-fetch-mode: cors`, `sec-fetch-site: same-site` — so'rov cross-origin, lekin same-site), sentry
`baggage` / `sentry-trace`. Ba'zi so'rovlarda yana uchtasi bor — quyidagi jadval:
`x-iid: <uuid>` (o'rnatish/qurilma id'si — taxmin; qiymati yozilmaydi), `access-content-allow-origin: *`
(ma'nosi noma'lum) va `cookie`. Javob matnlari (`category`, `status.title`) ruscha — tilga bog'liqligi
taxmin: kabinet API'sida boshqa til bilan namuna yo'q (bilvosita dalil — 5.B.10, kuzatuv 6).

| So'rov | Yozuv (GMT) | `access-content-allow-origin` | `x-iid` | `cookie` | upstream, ms |
|---|---|---|---|---|---|
| `check_token`, `account`, `shop/`, `notifications` | 11-13 03:01 | yozilmagan | alohida yozilmagan | yo'q | 25–79 |
| `unread-count`, `storage/{key}` (faqat preflight'lari yozilgan) | 11-13 03:01 | `unread-count` preflight'i so'ragan nomlar ichida (5.B.5) | — | — | — |
| committent, `products-statistic` | 11-13 03:01 | yozilmagan | alohida yozilmagan | `access_token=<JWT>` | 25–79 |
| `getProducts` B | 11-13 03:01 | bor | alohida yozilmagan | `access_token=<JWT>` | 937 |
| `getProducts` A | yozilmagan | bor | — | faqat analitika cookie'lari | — |
| `shop/` | 11-16 10:52 | **bor** | yo'q | yo'q | 35 |
| `invoice` | 11-16 10:52 | **yo'q** | yo'q | yo'q | 71 |
| `return` | 11-16 12:11 | **yo'q** | yo'q | yo'q | 66 |
| `product-reviews` (`POST`) | 11-17 08:49 | **bor** | yo'q | yo'q | 110 |
| `barcodes/types` | 11-17 11:58 | **yo'q** | yo'q | yo'q | 32 |
| `sku-list` | 11-17 12:00 | **yo'q** | yo'q | yo'q | 113 |

Yozib olingan so'rovlarning hammasi `200` olgan; "—" va "yozilmagan" — yozuvda yo'q degani. Xulosalar:

- **`access-content-allow-origin`** — kabinet uni har so'rovga qo'shmaydi: bitta sahifa yuklanishida `shop/`
  da bor, `invoice` da yo'q; `invoice`, `return`, `sku-list` va `barcodes/types` uchun majburiy emas (har
  biri 1 namunadan). `product-reviews` da bor edi — u yerda usiz so'rov yozilmagan.
- **`x-iid`** — har so'rovda yuborilmaydi va 2026-11-16 dagi uch yo'l hamda 2026-11-17 dagi uch yo'l
  (`product-reviews`, `barcodes/types`, `sku-list`) uchun majburiy emas. Birinchi sessiyada qaysi so'rovlarda borligi alohida yozilmagan.
- **Cookie.** `access_token` — Uzum ID JWT (`iss: "Uzum ID"`, `aud: ["uzum_apps","market/web"]`,
  `alg: EdDSA`, `exp − iat = 43200` s = 12 soat). Uning `exp` i 2026-11-12 22:49:23 UTC, so'rovlar esa
  2026-11-13 03:01 GMT da yuborilgan va `200` qaytgan — token ~4 soat oldin tugagan bo'lsa ham. Demak bu
  yo'llarni cookie emas, Bearer token avtorizatsiya qilgan ko'rinadi (1 namuna; server cookie'ni umuman
  tekshirmasligi ham mumkin). `getProducts` A `access_token`siz `200` olgan — shunga mos (1 so'rov; A ning
  sessiyasi yozilmagan, shuning uchun uni muddati o'tgan JWT kuzatuvi bilan bir sessiya deb bo'lmaydi).
- **Tezlik** (`x-envoy-upstream-service-time`): `getProducts` 937 ms, `sku-list` 113 ms, `product-reviews`
  110 ms, qolgan hammasi 25–79 ms.
- **Tana bilan so'rov.** Yagona JSON tanali so'rov — `product-reviews` (`POST`, `content-type: application/json`,
  `content-length: 21`): `{"filter":"NO_REPLY"}` (5.B.12); `filter` ning yana to'rt qiymati aytilgan, yozib
  olinmagan. `check_token` shakl A ning tanasi — forma (5.B.1).

**Javob header'lari** — `getProducts` B (11-13) va 2026-11-16 dagi uch javobda bir xil to'plam:
`content-type: application/json`; `access-control-allow-origin: https://seller.uzum.uz`;
`access-control-allow-credentials: true`; `access-control-allow-methods: POST, GET, OPTIONS, PUT, DELETE`;
`access-control-max-age: 3600`; `access-control-allow-headers` — 25 nomli ro'yxat (to'liq matni 5.B.8 da;
preflight va 2026-11-16 dagi uch `GET` javobida harfma-harf bir xil — 4 namuna; `getProducts` B javobida
to'liq matni yozilmagan);
`vary: Origin,Access-Control-Request-Method,Access-Control-Request-Headers`;
`cache-control: no-cache, no-store, max-age=0, must-revalidate` (2026-11-16 javoblarida `pragma: no-cache`,
`expires: 0` bilan); `server: istio-envoy`. CORS header'lari faqat preflight'da emas, `GET` ning o'z
javobida ham keladi. `X-RateLimit-*` va `Retry-After` hech bir javobda **yo'q** (bu chegara yo'qligini
isbotlamaydi); `invoice` va `return` javoblarida jami sonni bildiradigan header ham yo'q.

`product-reviews` javobi (11-17) shu to'plamdan **farq qiladi** (1 namuna): `access-control-allow-headers`
— **23** nom, tartibi boshqa: yuqoridagi 25 tadan `latitude`, `longitude`, `x-context` yo'q, `vary` qo'shilgan
(`authorization`, `content-type` ikkala yozilishda ham bor); `vary` va `build-info` header'lari yozuvda
**yo'q**; yozuvda yana `strict-transport-security: max-age=31536000 ; includeSubDomains`,
`x-content-type-options: nosniff`, `x-frame-options: DENY`, `x-xss-protection: 0` bor (oldingi kartalarda
bular yozilmagan). CORS'ning qolgani (`allow-origin`, `allow-credentials`, `allow-methods`, `max-age`) va
`cache-control` / `pragma` / `expires`, `server` — o'sha. Sharhlar boshqa backend servisda yoki boshqa
gateway sozlamasida turgan bo'lishi mumkin (taxmin). Shu yo'lning **preflight'i** qo'lda, tokensiz yuborilgan
(2026-11-17 10:26 GMT, 1 namuna; `access-control-request-method: POST`, `access-control-request-headers:
authorization,content-type`): `200`, `content-length: 0`, kabinet origin'i, `POST` va ikkala header ruxsat
etilgan; `access-control-allow-headers` — `POST` javobidagi bilan harfma-harf bir xil 23 nom.

`sku-list` va `barcodes/types` javoblari (11-17 12:00 va 11:58) esa **eski to'plamda**: `access-control-allow-headers`
— o'sha 25 nom, harfma-harf (endi 6 namuna, uchinchi build ostida), `build-info` bor. Ikkalasida yana
`strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: DENY` va
`x-xss-protection: 1; mode=block` yozilgan — `product-reviews` da bu oxirgisi `0` edi (sharhlar boshqa
servisda degan taxminga mos). `vary` `sku-list` javobida bor, `barcodes/types` javobida yozuvda **yo'q**
(1 namuna; nega — noma'lum).

**`build-info` va ikki backend servis (taxmin).** Host bir xil, header farq qiladi: auth yo'llarida
`Build: 1126958`, `/api/seller/…` da `Build-Number: 1193187; Commit:` (11-13). 2026-11-16 dagi uch javobda
`Build-Number: 1200005; Commit:` — raqam 3 kunda o'sgan, backend orada qayta chiqarilgan (taxmin); `shop/`
javobining shakli, CORS header'lari va `access-control-allow-headers` matni bunda o'zgarmagan. 2026-11-17
dagi ikki javobda (`sku-list`, `barcodes/types`) — `Build-Number: 1205638; Commit:`: raqam yana o'sgan.

**Sahifa yuklanishlari.** `shop/` va `invoice` (10:52) bitta yuklanishdan: javob vaqti bir xil sekund,
sentry trace id'si bir xil, tranzaksiya nomi `invoices-send` (kabinetning nakladnoylar sahifasi). Do'konlar
ro'yxati nakladnoylar sahifasida turganda ham so'ralgan — uni sahifa emas, kabinet qobig'i yuklaydi
(taxmin). `return` (12:11) — 79 daqiqa keyin, boshqa yuklanish: trace id'si boshqa, tranzaksiya
`invoices-return`; token o'sha satr. Sentry release: `uzum-seller-frontend@2.97.0` (ikkala kunda ham);
mahsulotlar sahifasi so'rovlarida yana `sx-products-frontend@3.17.5` bor → u alohida mikro-frontend (taxmin).
`product-reviews` (11-17 08:49) so'rovida ham ikki release: `sx-sgt-frontend@0.7.164` (tranzaksiya nomi
`NotFound`) va `uzum-seller-frontend@2.97.0`, ikki alohida trace id bilan → sharhlar sahifasi ham alohida
mikro-frontend (taxmin); `2.97.0` — uchinchi kunda ham o'sha. O'sha kuni 11:58 va 12:00 dagi so'rovlarda
release allaqachon `uzum-seller-frontend@2.99.0` — kabinet frontend'i 08:49 dan keyin yangilangan (yoki
sahifa yangi versiya bilan qayta yuklangan). `barcodes/types` ning tranzaksiya nomi `products-stickers`
(stikerlar sahifasi); 106 soniya keyingi `sku-list` so'rovining `baggage` ida tranzaksiya nomi yo'q, trace
id'si boshqa — uni qaysi sahifa yuborgani yozuvdan ko'rinmaydi.

### Maxfiy ma'lumot qoidasi

Bu hujjatga hech narsa yozishdan oldin **niqoblanadi**:

- token va `Authorization` header qiymati (`Bearer` ham, `Basic` ham) — butunlay olib tashlanadi; `Basic`
  ichidagi mijoz ma'lumoti ham yozilmaydi;
- `cookie` qiymatlari, `x-iid`, sentry kalitlari (`baggage`, `sentry-trace` ichidagi) — yozilmaydi;
- xaridorning **va sotuvchining** shaxsiy ma'lumoti (ism, telefon, email, manzil) — `***` yoki
  `998*********` bilan almashtiriladi;
- do'kon, buyurtma, mahsulot va SKU identifikatorlari — tuzilmani ko'rsatadigan, lekin real bo'lmagan qiymat
  bilan:

| Qayerda | Niqoblar |
|---|---|
| Kabinet kartalari (umumiy) | do'konlar `1001`, `1002`; `sellerId`/`seller_id` `5001`; `accountId` `9001`; `newSellerId` `00000000-0000-4000-8000-000000000001`; do'kon nomlari "Do'kon A"/"Do'kon B", `urlTitle` `dokona`/`dokonb`, `skuTitle` `SHOPA`/`SHOPB`; `productId` `200001`; `skuId` `10000001…10000005`; rasm URL'lari `https://images.uzum.uz/<image-id>/…` |
| 5.B.8 — niqoblangan fayl qiymatlari (fayl bilan solishtiriladi) | `productId` `4000001`; `skuId` `50000001…50000005`; shtrixkod `20000000000xx`; `ikpu` nollar; `advCpoId` `00000000-0000-7000-8000-000000000001`; SKU prefiksi `SELLER-SAMPLEKIT`; narx `120000` (asl kattalikda) |
| 5.B.10 | nakladnoy `id` `3000001…3000003`; `invoiceNumber` shu to'qilgan `id` dan, tuzilishi saqlangan holda qayta hisoblangan; `timeSlotReservation.id` `7000001…`; `fullPrice` to'qilgan (asl kattalikda); ombor `externalId` nollar, manzili qisqartirilgan |
| 5.B.11 | qaytarish `id` lari `1000000001` (10 xonali oila) va `100001…100002` (6 xonali oila); `timeSlotReservation.id` `7000004`; ombor `externalId` nollar, manzili qisqartirilgan |
| 5.B.12 | `reviewId` `80000001…80000002` (8 xonali, asl uzunlikda); `productId` `4100001…4100002`; mahsulot nomlari to'qilgan; SKU kodlari `SHOPA-…` / `SHOPB-…` (bo'laklar soni saqlangan); xaridor ismi `<ism>`. **`"***"` — niqob emas**: anonim sharhda API'ning o'zi shuni qaytaradi (kuzatuv 5) |
| 5.B.13 | do'kon `1001`; `skuId` `6000001` va `productId` `4100003` (7 xonali, asl uzunlikda); shtrixkod `1000060000018` — to'qilgan `skuId` dan asl qoida bilan **qayta hisoblangan**, shuning uchun kuzatuv 1 misoldan tekshiriladi; mahsulot nomi to'qilgan; SKU kodi `SHOPA-КОФТА-146` (prefiks va o'rta bo'lak to'qilgan; bo'laklar soni, kirill yozuvi va oxirgi bo'lak saqlangan); `purchasePrice` `60000` (asl kattalikda) |
| 5.B.14 | niqob yo'q: yorliq o'lchamlari — shaxsiy ham, do'konga xos ham emas |

Yozib olingan, lekin to'qilgan qiymatlardan chiqarib bo'lmaydigan kuzatuvlar kartada alohida belgilanadi.

### Dalil siyosati

Har bir maydonning ma'nosi va birligi **dalil kuchi** bilan yoziladi: nechta namuna qo'llab-quvvatlaydi.
Kabinet kartalarida ikki daraja alohida belgilanadi: **kuzatuv** — bir javob ichida ko'p nuqtada mos kelgan
arifmetika yoki tenglik; **taxmin** — mantiqiy, lekin tekshirilmagan.

| Dalil kuchi | Ma'nosi |
|---|---|
| `1 namuna` | Faqat bitta namunada ko'rilgan — **taxmin**, "tasdiqlangan" deb yozilmaydi |
| `N namuna` (N ≥ 2) | Bir necha mustaqil namunada bir xil — ishonchliroq, lekin hali ham kuzatuv |
| `kod+namuna` | Namuna ham, kodning ishlab turgan xatti-harakati ham mos |
| `hujjat` | Faqat Uzum hujjatiga tayangan, namuna yo'q — taxmin sifatida belgilanadi |

Misol — hal bo'lmagan maydon: `sellPrice` birligi (donasiga yoki qator bo'yicha jami). Donasiga degan
xulosani faqat bitta flat-mode namuna qo'llaydi, shuning uchun u `1 namuna` bo'lib qoladi va "Ochiq
savollar"da turadi (ENDPOINTS.md §12.3).

## 3. Endpointlar indeksi

OpenAPI guruhlari ENDPOINTS.md bilan bir xil: Akkaunt, Moliya, Katalog, FBS qoldiqlari,
FBS/DBS buyurtmalari, DBS, FBO nakladnoylari, FBS jo'natma nakladnoylari, Chop etiladigan hujjatlar.

| # | API | Method | Path | Guruh | Holat | Bo'lim |
|---|---|---|---|---|---|---|
| — | `openapi` | — | — | — | kutilmoqda | 5.A |
| 1 | `kabinet` | POST | `/api/auth/seller/check_token` | Auth | namuna bor (2 namuna) | 5.B.1 |
| 2 | `kabinet` | GET | `/api/seller/account` | Akkaunt | namuna bor | 5.B.2 |
| 3 | `kabinet` | GET | `/api/seller/shop/` | Do'konlar | namuna bor (2 namuna, 2 sessiya) | 5.B.3 |
| 4 | `kabinet` | GET | `/api/seller/notifications` | Bildirishnomalar | namuna bor (tana bo'sh) | 5.B.4 |
| 5 | `kabinet` | GET | `/api/v1/seller/notification/unread-count` | Bildirishnomalar | namuna bor (qisman) | 5.B.5 |
| 6 | `kabinet` | GET | `/api/seller/storage/{key}` | Interfeys holati | namuna bor (qisman) | 5.B.6 |
| 7 | `kabinet` | GET | `/api/seller/committent/contract/end-date` | Shartnoma | namuna bor | 5.B.7 |
| 8 | `kabinet` | GET | `/api/seller/shop/{shopId}/product/getProducts` | Katalog | namuna bor (2 so'rov, 1 javob) | 5.B.8 |
| 9 | `kabinet` | GET | `/api/seller/shop/{shopId}/product/products-statistic` | Katalog | namuna bor | 5.B.9 |
| 10 | `kabinet` | GET | `/api/seller/shop/{shopId}/invoice` | FBO nakladnoylari | namuna bor (to'liq sahifa, 20 qator) | 5.B.10 |
| 11 | `kabinet` | GET | `/api/seller/shop/{shopId}/return` | FBO nakladnoylari | namuna bor (to'liq sahifa, 20 qator) | 5.B.11 |
| 12 | `kabinet` | POST | `/api/seller/product-reviews` | Sharhlar | namuna bor (javob kesilgan, 7 qator) | 5.B.12 |
| 13 | `kabinet` | GET | `/api/seller/shop/{shopId}/sku-list` | Katalog | namuna bor (1 qator) | 5.B.13 |
| 14 | `kabinet` | GET | `/api/seller/reports/barcodes/types` | Chop etiladigan hujjatlar | namuna bor | 5.B.14 |

`Holat`: `namuna bor` — karta to'ldirilgan; `namuna bor (qisman)` — faqat `OPTIONS` preflight yozilgan,
javob uning ortidan kelgan `GET` niki deb olingan; `kutilmoqda` — namuna hali yo'q.

## 4. Endpoint kartasi shabloni

Yangi endpoint — quyidagi nusxa `5.A.N` (OpenAPI) yoki `5.B.N` (kabinet) bo'lim bo'ladi; indeksga qator
qo'shiladi. §2 dagi transport takrorlanmaydi; `http` misoli — faqat jadval ko'rsata olmaydigan shakl uchun.
Hamma qatorda bir xil qiymat ustun bo'lmaydi — jadval ustidagi jumlada bir marta aytiladi, farq qiladigan
qator buni "Ma'nosi"da yozadi; birlik — "Tur" ichida (`number, epoch ms`). "Yo'q / kuzatilmagan" bandlar
bitta qatorga yig'iladi, mazmuni bori `####` sarlavha oladi.

````markdown
### 5.N `METHOD /v?/yo'l`

**Guruh:** … · **Maqsad:** bitta jumla.

#### So'rov

| Maydon | Tur | Majburiy | Misol | Izoh |
|---|---|---|---|---|

#### Javob

Konvert: … Hamma qatorning dalil kuchi — `1 namuna`.

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|

```json
{}
```

**Sahifalash:** yo'q · **Kuzatilgan xatolar:** kuzatilmagan

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat shu yerga yoziladi, jim tuzatilmaydi: kod xato bo'lishi mumkin, u kod egasiga yetkaziladi.

#### Ochiq savollar
````

## 5. Endpoint kartalari

### 5.A OpenAPI

_Hozircha bo'sh; namunalar kelgach §4 shabloni bo'yicha `5.A.N` sifatida qo'shiladi._

### 5.B Kabinet API

Aks holda aytilmagan bo'lsa, karta 2026-11-13 dagi bitta brauzer sessiyasidan, dalil kuchi — `1 namuna`;
istisnolar (5.B.3, 5.B.8, 5.B.10–5.B.14) — hujjat boshidagi **Holat** blokida. Avtorizatsiya, umumiy
header'lar va cookie kuzatuvi — §2.

Brauzer kengaytmasi o'nta kartaning yo'lini chaqiradi, har biri bitta Copilot lookup'i: 5.B.8
(`products.list`), 5.B.9 (`products.stats`), 5.B.13 (`skus.list`), 5.B.10 (`invoices.list`), 5.B.11
(`returns.list`), 5.B.12 (`reviews.list` — yagona `POST`), 5.B.3 (`shops.list`), 5.B.7 (`contract.end`),
5.B.5 (`notifications.unread`), 5.B.14 (`barcodes.types`). Qolgan to'rttasi (5.B.1, 5.B.2, 5.B.4, 5.B.6)
chaqirilmaydi; nega — ENDPOINTS.md
[13.6](../frontend/src/services/uzum/ENDPOINTS.md#136-toqqizta-kichik-marshrut).

---

### 5.B.1 `POST /api/auth/seller/check_token`

**Guruh:** Auth · **Maqsad:** tokenni tekshirish va hisob profili / ruxsatlarini qaytarish.

#### So'rov

Ikki shakl yozib olingan (2 namuna), ikkalasi ham 200 va **bir xil javob** bilan. **Shakl A** — `Basic` ning
base64 qiymati `b2b-front` mijoz ma'lumoti (javobdagi `client_id` bilan bir xil); `content-length: 33` =
`token=` 6 + 27 belgi — mos:

```http
POST /api/auth/seller/check_token
Authorization: Basic <niqoblangan>
Content-Type: application/x-www-form-urlencoded

token=<token>
```

**Shakl B** — `content-type` yo'q, tana bo'sh (`content-length: 0`):

```http
POST /api/auth/seller/check_token?token=<token>
Authorization: Bearer <niqoblangan>
```

#### Javob

Konvert: yalang'och obyekt; OAuth2 token introspection uslubiga o'xshaydi (taxmin). Hamma qatorda
Nullable — yo'q, dalil kuchi — `2 namuna`.

| Maydon yo'li | Tur | Ma'nosi |
|---|---|---|
| `user_name` | string | telefon raqami ko'rinishida (`998…`) |
| `name` | string | xuddi shu telefon |
| `scope` | string[] | `["read","write"]` |
| `active` | boolean | `true` |
| `exp` | number, birligi noma'lum | **2600000** — epoch emas (1970-01-31 bo'lardi). Ikki so'rovda ham aynan shu son; teskari sanoq bo'lsa yumaloq son chiqishi ehtimoldan yiroq → doimiy qiymat bo'lishi mumkin (~30,1 kun sekundda). **Ma'nosi noma'lum** (`2 namuna` — qiymatga; ma'noga dalil yo'q) |
| `authorities` | string[] | `PRODUCT_MANAGER, VERIFIED, PHONE_VERIFIED, PARTNER, ENTREPRENEUR_PARTNER, ROLE_SELLER` |
| `client_id` | string | `b2b-front` |
| `newSellerId` | string (UUID) | `sellerId` dan tashqari ikkinchi identifikator |
| `locale` | string | `ru` |
| `accountId` | number | hisob id'si |
| `firstName` | string | bo'sh satr |
| `sellerId`, `seller_id` | number | ikkalasi bir xil qiymat (dublikat) |
| `phoneNumber` | string | `+`siz, 12 raqam |
| `permissions` | `Record<ruxsatKodi, number[]>` | qiymat — shu ruxsat berilgan do'kon id'lari (`[1001, 1002]`) |
| `registrationDate` | string, zonasiz ISO | ro'yxatdan o'tgan vaqt |
| `organizations` | `Record<shopId (string), { role: string, permissions: string[] }>` | kalitlar `GET /api/seller/shop/` dagi `id` lar bilan bir xil; `role` ikkalasida `"UNKNOWN"` |
| `banned` | boolean | `false` |
| `email` | string | `***` |

`permissions` (kod → do'konlar) va `organizations[shopId].permissions` (do'kon → kodlar) — bir xil
ma'lumotning ikki teskari ko'rinishi; chalkashtirmaslik kerak.

Ruxsat kodlari `RESURS_AMAL` shaklida (`PRODUCT_READ`); har ikki do'konda bir xil **93** ta kod (qo'lda
sanalgan), resurs bo'yicha:

- **To'liq CRUD** (`CREATE`, `READ`, `UPDATE`, `DELETE`): `EMPLOYEE, PRODUCT, PRODUCT_REVIEW, BUNDLE, PROMO_CODE, PHOTO_REQUEST, MARKETING, SELLER_RETURN, PRODUCT_IMPORT, DISCOUNT, SKU, CALENDAR_EVENT, SHOP, PRODUCT_FILTER, INVOICE, VOLUME_DISCOUNT, MODERATION, CHAT`.
- **Qisman:** `WITHDRAW` (CREATE, READ, UPDATE); `AUCTION` (CREATE, READ, DELETE); `FBS_INVOICE` (CREATE, READ); `FBS_ORDER` (READ, UPDATE); `REVIEW_PIN` (CREATE, UPDATE).
- **Bitta kod:** `TRANSFER_PRODUCT_CREATE, SHOP_OWNER_READ, EXTERNAL_MARKETING_CREATE, SERVICE_FEEDBACK_CREATE, EXPENSES_READ, PRINTING_READ, LEFTOVER_READ, FINANCE_READ, ANALYTICS_READ`.

```json
{
  "user_name": "998*********", "name": "998*********", "scope": ["read", "write"], "active": true,
  "exp": 2600000, "authorities": ["PRODUCT_MANAGER", "…"], "client_id": "b2b-front",
  "newSellerId": "00000000-0000-4000-8000-000000000001", "locale": "ru", "accountId": 9001,
  "firstName": "", "sellerId": 5001, "seller_id": 5001, "phoneNumber": "998*********",
  "permissions": { "PRODUCT_READ": [1001, 1002], "…": ["…"] },
  "registrationDate": "2026-01-10T06:02:56.306",
  "organizations": {
    "1001": { "role": "UNKNOWN", "permissions": ["PRODUCT_READ", "…"] },
    "1002": { "role": "UNKNOWN", "permissions": ["PRODUCT_READ", "…"] }
  },
  "banned": false, "email": "***"
}
```

**Sahifalash:** yo'q · **Kuzatilgan xatolar:** kuzatilmagan · **Kod/ENDPOINTS.md bilan farq:** yo'q

#### Ochiq savollar

- `exp` ning ma'nosi va birligi.
- `role: "UNKNOWN"` ning boshqa qiymatlari.
- Xodim (employee) hisobida ruxsatlar qanday ko'rinadi.

---

### 5.B.2 `GET /api/seller/account`

**Guruh:** Akkaunt · **Maqsad:** hisob profili.

**So'rov:** query / body yo'q.

#### Javob

Konvert: yalang'och obyekt. Hamma qatorda Nullable — kuzatilmagan, dalil kuchi — `1 namuna`.

| Maydon yo'li | Tur | Ma'nosi |
|---|---|---|
| `name` | string | bo'sh satr |
| `email` | string | `***` |
| `phone` | string | `+`siz |

```json
{ "name": "", "email": "***", "phone": "998*********" }
```

**Sahifalash:** yo'q · **Kuzatilgan xatolar:** kuzatilmagan · **Kod/ENDPOINTS.md bilan farq:** yo'q

#### Ochiq savollar

- `name` har doim bo'shmi yoki bu hisobda to'ldirilmaganmi — noma'lum.

---

### 5.B.3 `GET /api/seller/shop/`

**Guruh:** Do'konlar · **Maqsad:** sotuvchining do'konlari ro'yxati. Yo'l oxirida `/` bor (ikkala namunada
yozib olinganidek).

**Dalil qanchalik kuchli:** **2 namuna, 2 sessiya** — 2026-11-13 (03:01 GMT) va 2026-11-16 (10:52 GMT),
ikkalasi `200`; ikkinchisi so'rov header'lari va **to'liq** javob tanasi bilan yozilgan. Orada backend
build'i o'zgargan (§2), shakl o'zgarmagan: hujjatdagi birinchi namuna bilan bir xil 9 kalit, bir xil
tartibda va turlarda. Lekin bu **bitta hisobning o'sha ikki do'koni** deb olinadi (taxmin: yana 2 do'kon,
id'lari ENDPOINTS.md [12-bo'lim](../frontend/src/services/uzum/ENDPOINTS.md#12-real-javoblar-bilan-tekshiruv-natijalari)dagi
OpenAPI namunalarining do'konlari bilan bir xil; birinchi namunaning xom qiymatlari saqlanmagan, shuning
uchun qiymatma-qiymat solishtirilmagan). Demak "2 namuna" shaklning **vaqt bo'yicha** barqarorligini
ko'rsatadi, hisoblar orasidagi xilma-xillikni emas: `null` kelgan maydonlarning haqiqiy turi va
`transferred: true` hali ko'rilmagan.

**So'rov:** query / body yo'q; header'lar — §2.

#### Javob

Konvert: **yalang'och massiv**, 2 element (ikkala namunada). Hamma qatorning dalil kuchi — `2 namuna`.
"2026-11-16" deb belgilangan kuzatuvlar ikkinchi namunaning haqiqiy qiymatlaridan olingan; misoldagi
to'qilgan qiymatlardan ularni chiqarib bo'lmaydi.

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `[].id` | number | yo'q | do'kon id'si; 5 va 6 xonali butun son (2026-11-16) |
| `[].shopTitle` | string | yo'q | do'kon nomi; ichida bo'shliq yoki chiziqcha bo'lishi mumkin (2026-11-16) |
| `[].shortTitle` | null | ha | ikkala namunada 2/2 da `null`; haqiqiy turi noma'lum |
| `[].urlTitle` | string | yo'q | slug: kichik lotin harflari, `shopTitle` ning bo'shliq va chiziqchasiz yozilgani (2/2, 2026-11-16) |
| `[].skuTitle` | string | yo'q | lotin, katta harf; SKU to'liq nomining prefiksi (5.B.8 `skuFullTitle`: `SHOPB-…`). `shopTitle` dan mexanik hosil bo'lmaydi: bir do'konda `urlTitle` ning katta harfli shakli, ikkinchisida nomning faqat birinchi so'zi (2026-11-16) — sotuvchi o'zi tanlagan bo'lishi mumkin (taxmin) |
| `[].shopDescription` | null | ha | ikkala namunada 2/2 da `null`; haqiqiy turi noma'lum |
| `[].description` | `{ uz: string, ru: string }` | yo'q | tavsif, ikki tilda; ikkala do'konda ikkala til ham to'ldirilgan, erkin matn, 1–3 jumla (2026-11-16) |
| `[].transferred` | boolean | yo'q | ikkala namunada 2/2 da `false` |
| `[].chatAvatarUrl` | string (URL) | yo'q | rasm; `https://images.uzum.uz/<20 belgili id>/original.jpg`, id — kichik lotin harflari va raqamlar (2/2, 2026-11-16) |

Kuzatuv: `id` lar check_token `organizations` kalitlari va `permissions` qiymatlari bilan bir xil to'plam
(2026-11-13 sessiyasi; 2026-11-16 da `check_token` yozib olinmagan).

Misol (niqoblangan; shakli ikkala namunaga mos; ikkinchi element shu shaklda, niqoblari — §2):

```json
[
  {"id":1001,"shopTitle":"Do'kon A","shortTitle":null,"urlTitle":"dokona","skuTitle":"SHOPA","shopDescription":null,"description":{"uz":"…","ru":"…"},"transferred":false,"chatAvatarUrl":"https://images.uzum.uz/<image-id>/original.jpg"}
]
```

**Sahifalash:** yo'q ko'rinadi (2 do'kon, parametr yo'q — ikkala namunada) · **Kuzatilgan xatolar:**
kuzatilmagan

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat yo'q. Kengaytma bu yo'lni `shops.list` lookup'i bilan chaqiradi
([`shopsList.ts`](../extension/src/tools/shopsList.ts); ENDPOINTS.md 13.6). Kodning o'z qarorlari:

- **Do'kon va ruxsat kodi tekshirilmaydi:** yo'l hech bir do'konni nomlamaydi, ko'prik faqat kirgan
  sessiyani talab qiladi (server biror kod so'rashi yozilmagan).
- **Massiv kutiladi**; nima chiqarilishi (to'qqiz maydondan sakkiztasi, `chatAvatarUrl` ataylab yo'q) —
  texnik spetsifikatsiya 14.6.
- **Do'kon id'lari baribir sessiyadan olinadi** (ENDPOINTS.md 13.4); ro'yxat va sessiya farq qilsa, natija
  buni aytadi — yuqoridagi "`id` lar bir xil to'plam" kuzatuvi bitta sessiyadan, kafolat emas.

#### Ochiq savollar

- `transferred` ma'nosi (do'kon boshqa hisobga o'tkazilganmi — taxmin).
- Ko'p do'konli hisobda sahifalash bormi.
- `shortTitle` va `shopDescription` ning `null` bo'lmagan turi; `shopDescription` (`null`) bilan
  `description` (`{ uz, ru }`) qanday farqlanadi.
- Faqat `accept` va `authorization` bilan (kabinet qo'shadigan `access-content-allow-origin` va sentry
  header'larisiz) `200` keladimi — ikkala namuna ham kabinetning o'z so'rovi. Yaqin dalil: o'sha sahifaning
  `invoice` so'rovi `access-content-allow-origin`siz `200` olgan (5.B.10) — lekin bu boshqa marshrut.
- Boshqa hisobda (bitta do'kon, xodim hisobi) javob qanday ko'rinadi.

---

### 5.B.4 `GET /api/seller/notifications`

**Guruh:** Bildirishnomalar · **Maqsad:** bildirishnomalar ro'yxati (taxmin — nomidan).

**So'rov:** query / body yo'q; header'lar — §2.

#### Javob

`200`, `content-length: 0`, `content-type` yo'q — tana **bo'sh**. Shu bitta namunadan javob shakli
**noma'lum**; bo'sh tana "bildirishnoma yo'q" degani bo'lishi mumkin (taxmin).

**Sahifalash:** kuzatilmagan · **Kuzatilgan xatolar:** kuzatilmagan · **Kod/ENDPOINTS.md bilan farq:** yo'q

#### Ochiq savollar

- Bildirishnoma bo'lganda tana shakli; bo'sh tana nimani bildiradi.

---

### 5.B.5 `GET /api/v1/seller/notification/unread-count` (qisman)

**Guruh:** Bildirishnomalar · **Maqsad:** o'qilmagan bildirishnomalar soni.

#### So'rov

Yozib olingan yozuv — `OPTIONS` preflight (`access-control-request-method: GET`,
`access-control-request-headers: access-content-allow-origin,authorization,baggage,sentry-trace`,
javob `content-length: 0`). Haqiqiy `GET` ning header'lari **yozib olinmagan**; preflight `authorization`
so'raganidan Bearer yuboriladi deb taxmin qilinadi. `/api/v1/` prefiksi boshqa yo'llardan farq qiladi.

#### Javob

Foydalanuvchi qo'shgan javob (pastda) preflight'ga tegishli bo'la olmaydi (uning tanasi 0 bayt) — ortidan
kelgan `GET` ning javobi deb olinadi. Dalil kuchi — `1 namuna (qisman)`.

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `unreadCount` | number, dona | kuzatilmagan | o'qilmaganlar soni |

```json
{ "unreadCount": 1 }
```

**Sahifalash:** yo'q · **Kuzatilgan xatolar:** kuzatilmagan

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat yo'q, lekin kod **dalildan oldinda**: kengaytma bu yo'lni `notifications.unread` lookup'i bilan
chaqiradi ([`notificationsUnread.ts`](../extension/src/tools/notificationsUnread.ts); ENDPOINTS.md 13.6),
holbuki `GET` ning o'zi hech qachon yozib olinmagan. Kod `accept` va `authorization` bilan `GET` yuboradi
(preflight aynan `authorization` ni so'ragan), do'kon so'ramaydi va javobda `unreadCount` kalitini kutadi
(topilmasa nima bo'lishi — ENDPOINTS.md 13.6). Natija va toolkit legendasi bu zaiflikni aytadi.

#### Ochiq savollar

- Haqiqiy `GET` so'rovining header'lari.
- 5.B.4 `notifications` tanasi bo'sh, bu esa `unreadCount: 1` — ular qanday bog'liq, noma'lum.

---

### 5.B.6 `GET /api/seller/storage/{key}` (qisman)

**Guruh:** Interfeys holati · **Maqsad:** foydalanuvchi interfeys bayroqlari (kalit-qiymat). Kabinetning
onboarding holati uchun server tomonidagi kalit-qiymat ombori (taxmin).

#### So'rov

5.B.5 dagidek: yozuv — `OPTIONS` preflight, javob keyingi `GET` niki deb olingan. Yagona parametr —
`{key}` (yo'lda): string, majburiy; misol `ONBOARDING_TELEGRAM_BOT` (yozib olingan yagona kalit).

#### Javob

Konvert: yalang'och obyekt. Hamma qatorning dalil kuchi — `1 namuna (qisman)`.

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `id` | number | kuzatilmagan | yozuv id'si (niqoblangan) |
| `readonly` | boolean | kuzatilmagan | `false` |
| `key` | string | kuzatilmagan | so'ralgan kalit |
| `value` | **string** | kuzatilmagan | `"true"` — boolean emas, o'quvchi satr sifatida taqqoslashi kerak |

```json
{ "id": 7001, "readonly": false, "key": "ONBOARDING_TELEGRAM_BOT", "value": "true" }
```

**Sahifalash:** yo'q · **Kuzatilgan xatolar:** kuzatilmagan · **Kod/ENDPOINTS.md bilan farq:** yo'q

#### Ochiq savollar

- Boshqa kalitlar va ularning qiymat turlari; mavjud bo'lmagan kalitga javob.

---

### 5.B.7 `GET /api/seller/committent/contract/end-date?shopId={shopId}`

**Guruh:** Shartnoma · **Maqsad:** komitent shartnomasi tugash sanasi.

#### So'rov

Yagona parametr — `shopId` (query): number, majburiy (taxmin); misol `1002`; do'kon id'si. So'rovda
`cookie` (`access_token=<JWT>`) ham bor edi — §2.

#### Javob

Konvert: `{ payload, timestamp }`. Hamma qatorning dalil kuchi — `1 namuna`.

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `payload` | string, faqat sana | kuzatilmagan | shartnoma tugash sanasi |
| `timestamp` | string, zonasiz ISO (8 xonali kasr), UTC | kuzatilmagan | server vaqti; javob `date` header'i bilan mos |

```json
{ "payload": "2031-01-10", "timestamp": "2026-11-13T03:01:48.81889819" }
```

Kuzatuv: `payload` sanasi check_token `registrationDate` (niqoblangan misolda
`2026-01-10T06:02:56.306`) dan aynan 5 yil keyin — real qiymatlarda ham kun va oy bir xil, yil +5
(1 namuna). "Shartnoma muddati 5 yil" degan xulosa — taxmin. Namuna do'kon `1002` uchun; `1001` uchun yo'q.

**Sahifalash:** yo'q · **Kuzatilgan xatolar:** kuzatilmagan

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat yo'q. Kengaytma bu yo'lni `contract.end` lookup'i bilan chaqiradi
([`contractEnd.ts`](../extension/src/tools/contractEnd.ts); ENDPOINTS.md 13.6). Kodning o'z farazlari —
dalil emas:

- **`SHOP_READ` ruxsat kodi** — kod so'rovdan oldin do'konda shu kodni tekshiradi: shartnoma nomli kod
  sessiyada yo'q, bu eng yaqini; server qaysi kodni so'rashi yozilmagan.
- **Cookie yuborilmaydi** — yozib olingan so'rovda `access_token` cookie'si bor edi, kengaytma faqat
  `Authorization: Bearer` yuboradi (`credentials: 'omit'`). §2 dagi kuzatuvga ko'ra cookie kerak emas
  ko'rinadi, lekin aynan shu yo'l uchun cookie'siz so'rov yozib olinmagan.
- **`payload` ning ma'nosi ("shartnoma tugash sanasi") yo'l nomidan o'qilgan**; kod buni har natijada
  aytadi. Natija ko'rinishi (`payload: null` holati ham) — texnik spetsifikatsiya 14.6.

#### Ochiq savollar

- Shartnomasi yo'q do'kon uchun javob; 5 yillik moslik tasodifmi.

---

### 5.B.8 `GET /api/seller/shop/{shopId}/product/getProducts`

**Guruh:** Katalog · **Maqsad:** do'konning mahsulotlari ro'yxati, har mahsulot ichida SKU'lari bilan (qoldiq, sotilgan/qaytarilgan soni, narx, pullik saqlash, aksiya). Eng muhim karta.

**API:** kabinet (ichki), OpenAPI emas — farqi ENDPOINTS.md [13.2](../frontend/src/services/uzum/ENDPOINTS.md#132-openapidan-farqi). Sayt chaqirmaydi: kabinetning mahsulotlar sahifasi va kengaytmaning `products.list` lookup'i chaqiradi.

**Dalil qanchalik kuchli:** **ikki yozib olingan so'rov, bitta yozib olingan javob** (B so'rovniki). Javobni yozib olgan kishi qisqartirgan: `productList` da 24 qatorli sahifadan **1 mahsulot** (5 SKU), yuqori darajadagi jami sonlar esa yozilganidek. Shuning uchun "N ta ichida N ta" sanog'i — faqat shu bitta mahsulot ichidagi nusxalar soni. Misol — niqoblangan nusxa: [`getProducts.response.masked.json`](../extension/src/uzum/getProducts.response.masked.json); unda `productId`, `skuId`, shtrixkod, nomlar, SKU kodlari, kategoriya, rasm yo'llari, `ikpu`, narx, aksiya nomi va identifikatorlari, `advCpoId` — to'qilgan; kalit nomlari, tartibi, ichma-ichligi, `null`lar, enum kodlari, miqdorlar, foizlar va vaqt tamg'alari — yozilganidek.

#### So'rov

Ikki so'rov yozib olingan, ikkalasi ham `200`. B (niqoblangan):

```http
GET /api/seller/shop/1002/product/getProducts?page=0&size=24&filter=ALL&sortBy=id&searchQuery=&order=descending
```

| | So'rov A | So'rov B |
|---|---|---|
| Query (yozilgan tartibda) | `?page=0&size=5&filter=WITHOUT_REQUIRED_FILTERS` | yuqoridagi satr |
| Javob tanasi | yozib olinmagan | shu kartadagi javob |
| Nimaga o'xshaydi (taxmin) | kichik vidjet so'roviga (`size` 5, saralash va qidiruvsiz) | kabinetning asosiy mahsulotlar jadvali so'roviga: `size=24` kabinet o'zi saqlagan sahifa hajmiga (`localStorage` kaliti `products_page_size` = 24) teng — 1 sessiya |

A ning vaqti va sessiyasi yozilmagan. `sentry` tranzaksiya nomlari ikkalasida bir xil edi — ular bilan A va B ni farqlab bo'lmadi. Cookie farqi (A da `access_token` yo'q, B da bor) — §2.

| Maydon | Tur | Majburiy | Misol | Izoh |
|---|---|---|---|---|
| `{shopId}` (yo'lda) | number | ha | `1002` | do'kon id'i; tokenda ruxsat berilgan do'konlardan biri |
| `page` | number | kuzatilmadi (ikkalasida bor) | `0` | ikkalasida faqat `0`; "0 dan boshlanadi" va "sahifa tartib raqami" ekani — taxmin |
| `size` | number, dona (taxmin) | kuzatilmadi (ikkalasida bor) | `5` (A), `24` (B) | `24` dan katta qiymat qabul qilinadimi — noma'lum |
| `filter` | string | kuzatilmadi (ikkalasida bor) | `ALL` (B), `WITHOUT_REQUIRED_FILTERS` (A) | yozilgan ikki qiymat; boshqalari bor-yo'qligi noma'lum. `WITHOUT_REQUIRED_FILTERS` nimani tanlashi hujjatlashtirilmagan |
| `sortBy` | string | **yo'q**: A da yo'q, `200` | `id` | faqat B da; boshqa qiymat yozilmagan |
| `searchQuery` | string | **yo'q**: A da yo'q, `200` | (bo'sh) | B da **bo'sh satr** (`searchQuery=`); to'ldirilgan qiymat bilan so'rov yozilmagan |
| `order` | string | **yo'q**: A da yo'q, `200` | `descending` | faqat B da; boshqa qiymat yozilmagan |

`sortBy`, `searchQuery`, `order` majburiy emas ko'rinadi (1 namuna — A); berilmagandagi standart tartib noma'lum.

#### Javob

Konvert: nomlangan maydonli obyekt (`productList` + ikkita jami son). Javob header'lari (B, 1 namuna) — §2 dagi to'plam; `access-control-allow-headers` ro'yxatida `authorization`, `Authorization`, `content-type`, `Content-Type`, `baggage`, `sentry-trace`, `x-requested-with` bor (to'liq matni yozilmagan).

**Preflight (1 namuna, 2026-11-13).** Brauzerdan emas, qo'lda yuborilgan: tokensiz va cookie'siz `OPTIONS`, `Origin: https://seller.uzum.uz`, `Access-Control-Request-Method: GET`, `Access-Control-Request-Headers: authorization` — kengaytma so'rovi uchun brauzer so'raydigan narsaning o'zi (kengaytmaning `GET` i faqat `accept` va `authorization` yuboradi; Chrome 157 va Edge 157 preflight'da aynan `authorization` ni so'ragani kuzatilgan — texnik spetsifikatsiya, 14.8). Yo'ldagi do'kon id'si (`1`) va `sortBy`/`order` qiymatlari o'ylab topilgan, sotuvchiniki emas. Javob: `200`, `content-length: 0`, §2 dagi CORS header'lari (`allow-origin`, `allow-credentials`, `allow-methods`, `max-age`), `server: istio-envoy`, `build-info: Build-Number: 1193187; Commit:` va `access-control-allow-headers` ning to'liq matni:

```
baggage, Access-Control-Allow-Origin, sentry-trace, Access-Control-Allow-Methods, X-XSRF-TOKEN, latitude, User-Agent, authorization, Authorization, responseType, credential, x-apollo-tracing, Access-Content-Allow-Origin, Access-Control-Allow-Credentials, Jwt-Token, content-type, qa-stub, Build-Info, x-iid, Content-Type, longitude, apollo-query-plan-experimental, Access-Control-Allow-Headers, x-requested-with, x-context
```

Xuddi shu matn (harfma-harf, shu tartibda) 2026-11-16 da 5.B.3, 5.B.10 va 5.B.11 `GET` larining o'z javoblarida, boshqa build (`1200005`) ostida ham kelgan: ro'yxat marshrutga, method'ga va build'ga bog'liq emas ko'rinadi (4 namuna).

Bu ko'rsatadi: server kabinet origin'idan `authorization` li `GET` ga preflight bosqichida ruxsat beradi. Ko'rsatmaydi: haqiqiy token bilan `GET` ning o'zi faqat `accept` va `authorization` bilan qabul qilinishini (yozib olingan `GET` lar kabinetniki, ular qo'shimcha header'lar ham yuborgan — §2), boshqa origin'ga javobni va boshqa marshrutlarni.

5.B.8 ning uchala maydon jadvalida (yuqori daraja, mahsulot, SKU) hamma qatorning dalil kuchi — `1 namuna`, aksi aytilmasa; birlik "Tur" ichida. "Nullable": `ha (n/n)` — shu nusxalarning hammasida `null` keldi, haqiqiy turi noma'lum; `ha (k/n)` — ba'zisida; `kuzatilmagan` — `null` ko'rilmadi (boshqa javobda bo'lishi mumkin). "Ma'nosi"dagi "taxmin" — kalit nomidan yoki mantiqdan chiqarilgan, namuna isbotlamaydi. Ba'zi sonlar yozuvda kasr nuqtasi bilan (`25.5`, `100.0`, `0.0`, `40.0`, `7.0`); JSON `100.0` ni `100` deb chiqaradi — tur ikkala holda `number`.

**Yuqori daraja** (Nullable — uchalasida `kuzatilmagan`)

| Maydon yo'li | Tur | Ma'nosi |
|---|---|---|
| `productList` | massiv (mahsulot obyektlari) | sahifadagi mahsulotlar; bu yozuvda 1 ta (qisqartirilgan) |
| `totalProductsAmount` | number, dona (taxmin) | `38`; 5.B.9 dagi `ALL: 38` ga teng. Jami son `filter` va `searchQuery` ga ergashadimi — noma'lum (B da `filter=ALL`, qidiruv bo'sh) |
| `totalProductsAmountWithoutWeightDimensional` | number, dona (taxmin) | `0`; 5.B.9 dagi `WITHOUT_WEIGHT_DIMENSIONAL: 0` ga teng. "Og'irlik-gabaritsiz mahsulotlar soni" — nomidan taxmin |

**Mahsulot darajasi** (`productList[]`)

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `productId` | number | kuzatilmagan | mahsulot id'i |
| `category` | string | kuzatilmagan | kategoriya nomi, ruscha — tilga bog'liqligi taxmin (§2) |
| `rating` | **string** (`"5.0"`) | kuzatilmagan | reyting; son emas |
| `feedbackQuantity` | number, dona (taxmin) | kuzatilmagan | `2`; sharhlar soni — nomidan taxmin |
| `status` | `{id: number, title: string, value: string, description: string, color: string, additional: []}` | kuzatilmagan | mahsulot holati; `value` = `IN_STOCK`; `title`/`description` ruscha; `additional` bo'sh massiv (turi noma'lum) |
| `moderationStatus` | `{title: string, color: string, value: string, hasAnySkuBlocked: null}` | `hasAnySkuBlocked` — ha (1/1) | `value` = `MODERATED`; `title` ruscha |
| `commission` | null | ha (1/1) | mahsulot darajasida `null`, SKU larda `25.5`; to'ldirilgandagi turi noma'lum |
| `commissionDto` | `{minCommission: number, maxCommission: number}`; ehtimol foiz — birligi payload'da yo'q | kuzatilmagan | ikkalasi `25.5`, SKU `commission` ga teng |
| `skuList` | massiv (SKU obyektlari) | kuzatilmagan | mahsulotning SKU lari; bu yerda 5 ta |
| `skuTitle` | string | kuzatilmagan | mahsulot artikuli (niqoblangan: `SAMPLEKIT`) |
| `image`, `previewImg` | string (URL) | kuzatilmagan | rasmlar; ikkinchisi kichik nusxa (URL oxiri `t_product_80_low.jpg`) |
| `title` | string | kuzatilmagan | mahsulot nomi |
| `quantityAvailable`, `quantityActive` | number, dona (taxmin) | kuzatilmagan | ikkalasi `15`; SKU larning mos maydonlari yig'indisiga teng (kuzatuv 1) |
| `quantitySold`, `quantityReturned` | number, dona (taxmin) | kuzatilmagan | `8`, `9`; SKU yig'indisiga teng (kuzatuv 1). Qaysi davr uchun (butun tarixmi) — noma'lum |
| `quantityAvailableByStockType` | `{fbo: number, fbs: number}`, dona (taxmin) | kuzatilmagan | `{fbo: 15, fbs: 0}`; `fbo` = `quantityAvailable` |
| `quantityReserved`, `quantityFbs`, `quantityAdditional`, `quantityOnPhotoStudio`, `quantityCreated`, `quantityMissing`, `quantityDefected`, `quantityPending`, `quantityArchived` | number, dona (taxmin) | kuzatilmagan | hammasi `0`; noldan farqli qiymat ko'rilmagan, ma'nolari faqat nomdan taxmin |
| `returnedPercentage` | number (`52.9`), foiz (taxmin) | kuzatilmagan | 1 xonagacha yaxlitlangan (kuzatuv 2) |
| `newYearStatus` | `{title: string, color: string, value: string}` | kuzatilmagan | `value` = `NONE`; `title` ruscha |
| `price` | number (`120000`, niqoblangan); birligi **payload'da yo'q** | kuzatilmagan | SKU `price` ga teng. Asl qiymat kiyim to'plami uchun taxminan 110 000 — so'm narxining kattaligi; so'm ekani taxmin (kuzatuv 9) |
| `clicks` | null | ha (1/1) | to'ldirilgandagi turi noma'lum |
| `viewers` | number (`774`) | kuzatilmagan | ko'rishlar soni (taxmin); davri noma'lum |
| `conversion` | number (`1.16`), foiz (taxmin) | kuzatilmagan | formulasi noma'lum (kuzatuv 7) |
| `roi` | **string** (`"-100.0"`), foiz (taxmin) | kuzatilmagan | son emas; kuzatuv 8 |
| `rankInfo` | `{rank: string, rankValue: string, dateUpdated: number}`; `dateUpdated` — epoch ms | kuzatilmagan | `rank` = `A`; `rankValue` = `rank`; `dateUpdated` 13 xonali son. `rank` shkalasi noma'lum |
| `blockReason`, `blockComment`, `dateModerated`, `volumeDiscount` | null | ha (1/1) | to'ldirilgandagi turi noma'lum |
| `blockingReasons` | massiv (`[]`) | kuzatilmagan | bo'sh; element turi noma'lum |
| `skusHasAllRequiredFilters`, `allFiltersFilled` | boolean | kuzatilmagan | `true`, `false`. So'rov A dagi `filter=WITHOUT_REQUIRED_FILTERS` ga eng yaqin narsa — bog'liqligi taxmin |
| `auctionMember`, `isDeletable`, `isIlliquid`, `switchbackActive`, `isWithoutWeightDimensional` | boolean | kuzatilmagan | hammasi `false` |
| `isEditable`, `isEditableSku`, `isActive`, `createdByFlowB`, `pstorage` | boolean | kuzatilmagan | hammasi `true`. `pstorage` — "pullik saqlash qo'llanadi" (taxmin, kuzatuv 3) |
| `promotionStatus` | string | kuzatilmagan | `PROMOTION_AVAILABLE` |
| `cpoAdvertisementsDetails` | `{advCpoId: string (UUID), productId: number, commissionPercentage: number, minCommissionPercentage: number, maxCommissionPercentage: number, status: string, cpoVersion: number}`, foiz (taxmin) | kuzatilmagan | `7`, `3`, `60`; `status` = `ACTIVE`; `cpoVersion` = `2`; `productId` mahsulotniki bilan bir xil. CPO reklama sozlamasi — nomidan taxmin |

**SKU darajasi** (`productList[].skuList[]`, 5 ta SKU)

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `skuTitle` | string | kuzatilmagan | o'lcham-rang belgisi (`КРАСН-L`, `КРАСН-M`, …) |
| `skuFullTitle` | string | kuzatilmagan | asl yozuvda: do'kon `skuTitle` + mahsulot `skuTitle` + SKU `skuTitle`, `-` bilan (5/5); niqoblangan faylda tuzilma saqlangan, prefiks to'qilgan: `SELLER-SAMPLEKIT-КРАСН-L` |
| `productTitle` | string | kuzatilmagan | mahsulot nomi (mahsulotniki bilan bir xil) |
| `skuId` | number | kuzatilmagan | SKU id'i |
| `quantityAvailable`, `quantityActive` | number, dona (taxmin) | kuzatilmagan | `5, 0, 4, 2, 4`; ikkalasi teng (5/5) |
| `quantityAvailableByStockType` | `{fbo: number, fbs: number}`, dona (taxmin) | kuzatilmagan | `fbo` = `quantityAvailable`, `fbs` = `0` (5/5) |
| `quantitySold`, `quantityReturned` | number, dona (taxmin) | kuzatilmagan | sotilgan `0, 4, 1, 2, 1`; qaytarilgan `2, 2, 1, 2, 2`; davri noma'lum |
| `quantityCreated`, `quantityFbs`, `quantityAdditional`, `quantityOnPhotoStudio`, `quantityArchived`, `quantityMissing`, `quantityDefected`, `quantityPending` | number, dona (taxmin) | kuzatilmagan | hammasi `0` (5/5); mahsulotdagi `quantityReserved` SKU da yo'q |
| `returnedPercentage` | number, foiz (taxmin) | kuzatilmagan | yaxlitlanmagan float (`33.333333333333336`, `66.66666666666667`); kuzatuv 2 |
| `barcode` | **number** (13 xona) | kuzatilmagan | shtrixkod, son bo'lib keladi; asl yozuvda `skuId` ga bog'liq tuzilma (kuzatuv 6) |
| `archived`, `blocked`, `activeSale`, `switchbackActive`, `isWithoutWeightDimensional` | boolean | kuzatilmagan | hammasi `false` (5/5) |
| `commission` | number (`25.5`); ehtimol foiz — birligi payload'da yo'q | kuzatilmagan | 5/5 da bir xil; kuzatuv 10 |
| `characteristics` | string (`"L, Красный"`) | kuzatilmagan | o'lcham va rang, ruscha ko'rinish matni |
| `characteristicsList` | `[{characteristicTitle: {uz, ru}, definedType: boolean, characteristicValue: {uz, ru}}]` | kuzatilmagan | har SKU da 2 element (o'lcham, rang); `uz` va `ru` ikkalasi bor; `definedType` = `true` |
| `previewImage` | string (URL) | kuzatilmagan | rasm |
| `ikpu` | **string** (17 xona) | kuzatilmagan | soliq kodi; bosh nol bo'lishi mumkin — son deb o'qilmasin (niqoblangan: nollar) |
| `photo`, `purchasePrice`, `recommendedTotalPrice`, `blockingReason`, `skuBlockReason`, `article`, `paidStorageDimensionalGroup`, `actualDimensionalGroup`, `hasStudioPhoto`, `sellerItemCode` | null | ha (5/5) | to'ldirilgandagi turi noma'lum |
| `blockReasons` | massiv (`[]`) | kuzatilmagan | bo'sh (5/5); element turi noma'lum |
| `price`, `marketPrice` | number (`120000`, niqoblangan); birligi **payload'da yo'q** | kuzatilmagan | ikkalasi teng va mahsulot `price` ga teng (5/5); so'm — taxmin (kuzatuv 9) |
| `rankInfo` | `{rank: string, rankValue: string, dateUpdated: number (epoch ms)}` | kuzatilmagan | `rank` = `A` (3 SKU) yoki `C` (2 SKU); `rankValue` = `rank`; shkalasi noma'lum |
| `turnover` | number, kun (taxmin) | ha (4/5) | bitta SKU da `40`, qolganida `null`; kuzatuv 4 |
| `dimensionalGroup` | string | ha (1/5) | `"СГТ"` (4 SKU), kirillcha; `null` — qoldiqsiz SKU |
| `paidStoragePriceItem` | number, so'm/dona (taxmin) | ha (1/5) | `96, 120, 96, 60`; qoldiqsiz SKU da `null` |
| `paidStorageAmount` | number, so'm (taxmin) | ha (2/5) | `480, 480, 192`; `null` — `pstorage: false` (1 SKU) va qoldiqsiz SKU (1); kuzatuv 3 |
| `forecastOutOfStock` | boolean | kuzatilmagan | `true` faqat qoldiqsiz SKU da, qolgan 4 tasida `false`; API'ning o'z bayrog'i, qanday hisoblanishi noma'lum |
| `updatedFromWms` | boolean | kuzatilmagan | 5/5 `true` |
| `hasActiveDiscount` | boolean | kuzatilmagan | `true` (4), `false` (1, qoldiqsiz SKU) |
| `status` | `{value: string, title: string, color: string}` | kuzatilmagan | `value` = `IN_STOCK` (4) yoki `RUN_OUT` (1, qoldiqsiz SKU); `title` ruscha |
| `skuDimension` | `{length, width, height, weight}` number; birligi **payload'da yo'q** | kuzatilmagan | masalan `378 × 281 × 35` va `365` — mm va g bo'lishi mumkin (taxmin) |
| `specialOffer` | `{inOffer: boolean, hasRecommendation: boolean, mechanicType: string, mechanicPrice: null, endDate: number (epoch ms), promoName: string, selfExit: null, promoIds: number[]}` | `mechanicPrice`, `selfExit` — ha (5/5) | 5/5 da bir xil: `inOffer: true`, `hasRecommendation: false`, `mechanicType: "UZUM_PROMO"`, `endDate` (`1796324340000`), `promoName`; `promoIds` bitta element; kuzatuv 5 |
| `avgdsales` | number | ha (1/5) | `0` (3 SKU), `0.1` (1), `null` (qoldiqsiz SKU) |
| `avgdquantity` | number | ha (1/5) | `5, 4, 2, 4`; ko'rilgan 4/4 da `quantityAvailable` ga teng |
| `pstorage` | boolean | ha (1/5) | `true` (3), `false` (1), `null` (qoldiqsiz SKU) |

Enum kodlari (faqat yozilgani; boshqalari, shubhasiz, bor): `status.value` — `IN_STOCK`, `RUN_OUT`; `moderationStatus.value` — `MODERATED`; `promotionStatus` — `PROMOTION_AVAILABLE`; `rankInfo.rank` — `A`, `C`; `specialOffer.mechanicType` — `UZUM_PROMO`; `cpoAdvertisementsDetails.status` — `ACTIVE`; `newYearStatus.value` — `NONE`. `color`: `#51AE42` — mahsulot `status`, `moderationStatus`, `IN_STOCK` SKU; `#E4981B` — `RUN_OUT` SKU.

**Qoldiqsiz SKU** (`КРАСН-M`): `status.value` = `RUN_OUT`, `forecastOutOfStock` = `true`, `quantityAvailable` = 0; `dimensionalGroup`, `paidStoragePriceItem`, `paidStorageAmount`, `avgdsales`, `avgdquantity`, `pstorage` — hammasi `null`: demak, bu "noma'lum/qo'llanmaydi", **nol emas** (1 SKU).

**Lokalizatsiya.** Ruscha: `category`, `status.title`/`description`, `moderationStatus.title`, `newYearStatus.title`, SKU `status.title` (tilga bog'liqligi taxmin — §2); `characteristicsList` ikkala tilni (`uz`, `ru`) birga beradi. Kodlar (`status.value` va h.k.) tilga qarab o'zgarishi kuzatilmagan.

**Arifmetik kuzatuvlar** (bitta javob ichida; "kuzatuv" — taxmin emas, lekin 1 mahsulot, shu sababli `1 namuna`):

1. Mahsulotning `quantityAvailable` (15), `quantityActive` (15), `quantitySold` (8), `quantityReturned` (9) va `quantityAvailableByStockType.fbo` (15) i SKU qiymatlari yig'indisiga teng (masalan sotilgan 0+4+1+2+1, qaytarilgan 2+2+1+2+2).
2. `returnedPercentage = quantityReturned / (quantitySold + quantityReturned) × 100` — 6 nuqtada mos (5 SKU, yaxlitlanmagan: 2/2=100, 2/6=33,33, 1/2=50, 2/4=50, 2/3=66,67; mahsulot: 9/17=52,94 → `52.9`). Mahsulotda 1 xonaga yaxlitlanadi, SKU da yo'q.
3. `paidStorageAmount = paidStoragePriceItem × quantityAvailable` — `pstorage: true` li 3/3 SKU da mos (96×5=480, 120×4=480, 96×2=192). `pstorage: false` li SKU da `paidStoragePriceItem` (60) to'ldirilgan, `paidStorageAmount` esa `null`; `pstorage` `null` bo'lsa, ikkalasi `null`. Davr (kunlikmi) va birlik (so'm — taxmin) noma'lum.
4. `turnover = avgdquantity / avgdsales` — `avgdsales > 0` bo'lgan 1/1 SKU da mos (4 / 0,1 = 40). `avgdsales` `0` (3 SKU) yoki `null` (1) bo'lsa, `turnover` `null` (nolga bo'lish yo'q — mos). Ma'nolar — taxmin: `avgdsales` kunlik o'rtacha sotuv, `avgdquantity` o'rtacha qoldiq, `turnover` zaxira necha kunga yetishi.
5. `specialOffer.endDate` (13 xonali) — epoch **millisekund**: asl yozuvda 2026-12-03 18:59:00 UTC = 23:59 Toshkent vaqti, aksiya nomidagi tugash sanasiga mos (1 namuna). `rankInfo.dateUpdated` ham 13 xonali (6/6 nusxa).
6. `barcode` — asl yozuvda `"1000"` + 8 xonali `skuId` + bitta raqam (5/5 SKU); oxirgi raqam EAN-13 nazorat raqami bo'lishi mumkin (taxmin). **Niqoblangan faylda bu tuzilma saqlanmagan** (shtrixkod va `skuId` to'qilgan) — kuzatuvni fayldan qayta tekshirib bo'lmaydi.
7. `conversion` (1,16) va `viewers` (774): `9 / 774 × 100` = 1,16 ga yaxlitlanadi. Lekin `9` `quantityReturned` ga ham teng, payload'da yo'q buyurtmalar soni ham bo'lishi mumkin; `quantitySold / viewers` = 8/774 = 1,03 — mos kelmaydi. **Formula noma'lum.**
8. `roi: "-100.0"` va barcha SKU da `purchasePrice: null` — tannarx kiritilmaganda ROI −100 chiqishi mumkin (taxmin).
9. `price` kattaligi so'm narxiga mos (asl qiymat kiyim to'plami uchun taxminan 110 000; niqoblangan misolda `120000` — o'sha kattalik). Birlik payload'da aytilmagan.
10. `commission` (25,5) SKU larda `commissionDto.minCommission` va `maxCommission` ga teng; mahsulot darajasida `commission` `null`.
11. `quantitySold` / `quantityReturned` qaysi davr uchun (butun tarixmi) — noma'lum.

Javob misoli — niqoblangan [faylda](../extension/src/uzum/getProducts.response.masked.json); quyida faqat ichma-ichlik (5 SKU dan biri, qolgan kalitlar `…`):

```json
{
  "productList": [
    {
      "productId": 4000001, "status": { "id": 1, "value": "IN_STOCK", "…": "…" },
      "skuList": [
        { "skuTitle": "КРАСН-L", "skuId": 50000002, "rankInfo": { "rank": "C", "rankValue": "C", "dateUpdated": 1794472997270 }, "…": "…" },
        "…"
      ],
      "quantityAvailable": 15, "rankInfo": { "rank": "A", "rankValue": "A", "dateUpdated": 1794452671174 }, "…": "…"
    }
  ],
  "totalProductsAmount": 38,
  "totalProductsAmountWithoutWeightDimensional": 0
}
```

#### Sahifalash

`page` / `size` so'rovda, jami son javobning o'zida — `totalProductsAmount` (`38`). Javobda `productList` 1 qatorli, `size=24`, jami 38: yozuv qisqartirilganini yozib olgan kishi aytgan, javobning o'zi ko'rsatmaydi. Tugash belgisi — `page × size ≥ totalProductsAmount` (taxmin; oxirgi sahifa yozib olinmagan).

**Noma'lum:** `24` dan katta `size` hurmat qilinishi (A da `5`, B da `24` yozilgan; javobda qator soni qisqartirilgan, shuning uchun `5` ni ham tekshirib bo'lmaydi); sahifa o'rni qanday aniqlanishi (`page × size` ofsetmi yoki boshqami — faqat `page=0` yozilgan); oxirgi sahifadan keyingisi nima qaytarishi; jami son `filter` va `searchQuery` ga ergashishi.

**Kuzatilgan xatolar:** kuzatilmagan — ikkala so'rov `200` oldi; `401`, `403`, `429` va xato tanasi yozilmagan.

#### Kod/ENDPOINTS.md bilan farq

Kod chaqiruvi — [`routes.ts`](../extension/src/uzum/routes.ts#L241) va [`productsList.ts`](../extension/src/tools/productsList.ts#L100). Mos kelmaydigan yoki dalilsiz joylar:

1. **B shakli yuboriladi, A shakli hech qachon.** Parametrlar B tartibida (`page, size, filter, sortBy, searchQuery, order`); `sortBy=id` va `order=descending` qat'iy (yagona yozilgan qiymatlar), `searchQuery` bo'sh yoki sotuvchi so'ragan matn. `filter=WITHOUT_REQUIRED_FILTERS` bilan `sortBy`/`order`/`searchQuery` birikmasi **yozib olinmagan** — kod uni yuborishi mumkin.
2. **Kodning o'z chegaralari — dalil emas:** `size` 1…100 (standart 24), `page` 0…100 000, `searchQuery` ≤ 100 belgi; hech bir javob ko'rsatmagan.
3. **Faqat `null` ko'rilgan maydonlarga kod tur faraz qiladi** ([`products.ts`](../extension/src/uzum/products.ts)), dalilsiz: son — `purchasePrice`, `recommendedTotalPrice`, `mechanicPrice`, `clicks`, `dateModerated`, `volumeDiscount`, mahsulot `commission`; satr — `article`, `sellerItemCode`, `blockingReason`, `paidStorageDimensionalGroup`, `actualDimensionalGroup`, `blockReason`, `blockComment`; mantiqiy — `hasStudioPhoto`, `selfExit`, `hasAnySkuBlocked`. `photo`, `skuBlockReason`, `blockReasons` va `blockingReasons` ga tur faraz qilinmagan. Tur boshqacha chiqsa, qiymat yo'qolmaydi: yo'l `mistyped` ro'yxatiga tushadi, lookup qiymatni javobdagidek (`raw`) ko'rsatib, sarlavhada "unexpected:" deydi.
4. **Sahifa o'rni `page × size` deb faraz qilinadi** ([`pagingText`](../extension/src/tools/productsView.ts#L198)): "rows 1–24 of 38" shunga tayanadi, javob buni tasdiqlamaydi (faqat `page=0`). Sahifa farazga mos kelmasa, matn buni aytadi (holatlari — texnik spetsifikatsiya, 14.6).
5. **Maydon izohi** ([`tools/index.ts`](../extension/src/tools/index.ts#L99)) bu hujjatga mos: `commission` — "birligi payload'da yo'q, ehtimol foiz"; saralash so'ralgani, qidiruv bo'sh yozilgani va tilni bitta namuna bilan cheklaydi. Prompt ([`host/prompt.ts`](../extension/src/host/prompt.ts#L14)) hech bir maydon nomini kafolatlamaydi — bu kod egasining qarori.

#### Ochiq savollar

- `filter=WITHOUT_REQUIRED_FILTERS` nimani tanlaydi va u bilan javob qanday ko'rinadi: 5.B.9 da `ALL: 38`, `WITHOUT_REQUIRED_FILTERS: 22` — kichik qismni tanlashi mumkin (1 sessiya, taxmin); bu filtr bilan javob yozilmagan. Qolgan `filter` qiymatlari.
- `searchQuery` qanday moslashadi (nom, SKU, shtrixkod) va jami son unga ergashadimi — to'ldirilgan qidiruv bilan so'rov yozilmagan.
- `price`, `paidStoragePriceItem`, `paidStorageAmount` birligi (so'mmi?) va `paidStorageAmount` davri (kunlikmi?).
- `conversion` formulasi (kuzatuv 7).
- `rankInfo.rank` shkalasi (`A`, `C` yozilgan; boshqalari, tartibi noma'lum).
- `status`, `moderationStatus`, `promotionStatus`, `newYearStatus`, `mechanicType`, `cpoAdvertisementsDetails.status` ning boshqa qiymatlari.
- `size` yuqori chegarasi, sahifa o'rni, `sortBy`/`order` ning boshqa qiymatlari va berilmagandagi standart tartib.
- `quantitySold`/`quantityReturned`/`viewers` qaysi davr uchun.
- Rate limit: yozib olingan bitta javobda `X-RateLimit-*` va `Retry-After` yo'q (§2) — bu chegara yo'qligini isbotlamaydi.
- Server `GET` da `access-content-allow-origin: *` so'rov header'ini talab qiladimi: kabinet uni yuboradi, kengaytma yubormaydi (faqat `accept` va `authorization`) — noma'lum, faqat haqiqiy token bilan so'rov hal qiladi. Preflight o'tadi (yuqoridagi "Preflight", 1 namuna: `authorization` ning o'zi so'ralganda server ruxsat berdi). Yaqin dalil (2026-11-16, §2): kabinet `…/invoice` ga bu header'siz `GET` yuborib `200` olgan (5.B.10) — server uni hamma marshrutda talab qilmaydi; `getProducts` uchun bu hali isbot emas (boshqa marshrut, 1 namuna).
- Boshqa do'konlar (`1001`) va bo'sh/ko'p SKU li mahsulotlar uchun javob.

---

### 5.B.9 `GET /api/seller/shop/{shopId}/product/products-statistic`

**Guruh:** Katalog · **Maqsad:** mahsulot filtrlari bo'yicha sonlar.

**So'rov:** parametr yo'q (yo'lda `shopId`).

#### Javob

Konvert: nomlangan maydon `statisticResultList`, 8 element `{count: number, type: string, shopId: number}`. Hammasi `1 namuna`.

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

Kuzatuvlar:

- `ALL` (38) = 5.B.8 `totalProductsAmount`; `WITHOUT_WEIGHT_DIMENSIONAL` (0) = `totalProductsAmountWithoutWeightDimensional` (0).
- Turlar bir-birini kesib o'tadi — bo'linma emas (IN_STOCK 30 + OUT_OF_STOCK 5 + ARCHIVED 1 = 36 ≠ 38; INACTIVE bilan 43).
- `type` qiymatlari `getProducts` `filter` qiymatlari bilan bir xil to'plam bo'lishi mumkin — faqat `ALL` va `WITHOUT_REQUIRED_FILTERS` ikkalasida ko'rilgan (taxmin).
- Payload'da `shopId` bor, lekin loyiha qoidasi bo'yicha `store_id` so'ralgan do'kondan olinadi, payload'dan emas.

```json
{ "statisticResultList": [
  {"count": 5, "type": "OUT_OF_STOCK", "shopId": 1002},
  {"count": 38, "type": "ALL", "shopId": 1002},
  "…"
] }
```

**Sahifalash:** yo'q · **Kuzatilgan xatolar:** kuzatilmagan

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat yo'q. `WITHOUT_REQUIRED_FILTERS` soni uchun qarang 5.B.8. Kengaytma bu yo'lni `products.stats` lookup'i bilan chaqiradi ([`productsStats.ts`](../extension/src/tools/productsStats.ts); ENDPOINTS.md 13.6): `PRODUCT_READ` ni mahalliy tekshiradi (faraz), `statisticResultList` massivini kutadi; natija va legendasi — texnik spetsifikatsiya 14.6. Yozib olingan so'rovda `cookie` bor edi (§2), kengaytma uni yubormaydi (cookie'siz so'rov bu yo'l uchun yozib olinmagan).

#### Ochiq savollar

- `type` ning to'liq to'plami; boshqa do'kon uchun (1001) sonlar.

---

### 5.B.10 `GET /api/seller/shop/{shopId}/invoice`

**Guruh:** FBO nakladnoylari · **Maqsad:** do'konning Uzum omboriga yetkazib berish (FBO) nakladnoylari ro'yxati: holat, summa, topshirilgan va qabul qilingan son, band qilingan vaqt, ombor.

**API:** kabinet (ichki); nakladnoylar sahifasi chaqiradi (§2). OpenAPI egizagi — `GET /v1/shop/{shopId}/invoice` (ENDPOINTS.md [12.4](../frontend/src/services/uzum/ENDPOINTS.md#124-kichik-kuzatuvlar)); farqlari — pastda, "Kod/ENDPOINTS.md bilan farq" da.

**Dalil qanchalik kuchli:** **1 namuna** — 2026-11-16 10:52 GMT, bitta do'kon (`1001`), `page=0&size=20`, `200`; javob **to'liq** yozilgan (20 element). "N/20" sanoqlari — shu bitta sahifadagi qatorlar: bir do'kon, bitta ombor, ikki holat. Yagona mustaqil tayanch — OpenAPI egizagining 2026-08-10 dagi namunasi ([`uzum-samples.json`](../frontend/_design/v1/uploads/uzum-samples.json), `fbo_invoices_shop`, 20 qator); u bilan mos kelgan joyi alohida aytiladi.

#### So'rov

Uchala parametr — number (`size` birligi — dona). Holat, sana yoki saralash parametri yo'q. Body yo'q.

| Maydon | Majburiy | Misol | Izoh |
|---|---|---|---|
| `{shopId}` (yo'lda) | ha | `1001` | do'kon id'i |
| `page` | bor; majburiyligi kuzatilmadi | `0` | faqat `0` yozilgan — "0 dan boshlanadi" taxmin |
| `size` | bor; majburiyligi kuzatilmadi | `20` | javobda aynan 20 element; kattaroq qiymat qabul qilinadimi — noma'lum |

So'rovda `access-content-allow-origin`, `x-iid` va `cookie` **yo'q** edi — va `200` kelgan (§2). Kengaytma yuboradigan to'plamdan (`accept`, `authorization`) farqi faqat sentry header'lari va `accept-language`.

#### Javob

Konvert: **yalang'och massiv**, 20 element (= `size`); header'lari — §2.

"Nullable" ustuni 5.B.8 dagidek o'qiladi: `ha (n/20)` — 20 qatordan n tasida `null`. Hamma qatorning dalil kuchi — `1 namuna`.

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `[].id` | number | kuzatilmagan | nakladnoy id'i; 7 xonali |
| `[].invoiceNumber` | number (13 xonali) | kuzatilmagan | nakladnoy raqami; tuzilishi — kuzatuv 1 |
| `[].deliveryCertificate` | null | ha (20/20) | to'ldirilgandagi turi noma'lum |
| `[].dateCreated` | string, `DD.MM.YYYY`, sana | kuzatilmagan | yaratilgan sana (taxmin — nomidan); vaqt va zona yo'q |
| `[].status` | string | kuzatilmagan | holat **matni**; 20/20 da `invoiceStatus.text` bilan bir xil; tilga bog'liq (kuzatuv 6) |
| `[].invoiceStatus` | `{ text: string, color: string, value: string }` | kuzatilmagan | `value` — holat kodi: `CREATED` (3/20, `#000000`, "Создана"), `ACCEPTED` (17/20, `#00c853`, "Принята на складе"); `color` — `#rrggbb` |
| `[].fullPrice` | number; birligi noma'lum (so'm — taxmin) | kuzatilmagan | nakladnoy summasi (taxmin — nomidan); butun sonlar, 3 xonalidan 7 xonaligacha |
| `[].timeSlotReservation.id` | number | kuzatilmagan | bron id'i |
| `[].timeSlotReservation.timeSlots[]` | `{ timeFrom: number, timeTo: number }[]`, epoch ms | kuzatilmagan | band qilingan oyna(lar): 19/20 da 1 element, 1/20 da 2 ta ketma-ket (birinchisining `timeTo` = ikkinchisining `timeFrom`); bitta oyna 60, 75 yoki 90 daqiqa |
| `[].timeSlotReservation.status` | string | kuzatilmagan | 20/20 `RESERVED` — `ACCEPTED` nakladnoyda ham |
| `[].timeSlotReservation.timeFrom`, `.timeTo` | number, epoch ms | kuzatilmagan | `timeSlots` ning eng kichik `timeFrom` i va eng katta `timeTo` si (20/20) |
| `[].totalAccepted` | number, dona | kuzatilmagan | ombor qabul qilgan soni; `CREATED` da `0` (3/3); `totalToStock` dan oshmaydi (20/20) |
| `[].totalToStock` | number, dona | kuzatilmagan | topshirish rejalashtirilgan soni |
| `[].remainingAmountOfUpdates` | number, marta (taxmin) | kuzatilmagan | `1` yoki `2`; "qolgan o'zgartirishlar soni" — nomidan taxmin |
| `[].dateAccepted` | number, epoch ms | ha (5/20) | qabul qilingan vaqt (taxmin). `CREATED` da `null` (3/3), lekin **`ACCEPTED` da ham 2/17 da `null`** |
| `[].expressAcceptanceDate` | number, epoch ms | ha (6/20) | "tezkor qabul" vaqti — nomidan taxmin. `CREATED` da `null` (3/3), `ACCEPTED` da 3/17 da `null` |
| `[].stock` | obyekt | kuzatilmagan | ombor; 20/20 da aynan bitta obyekt |
| `[].stock.id`, `.externalId` | number, string (UUID) | kuzatilmagan | ombor id'lari (`34`) |
| `[].stock.title`, `.address` | string | kuzatilmagan | nomi ("Фулфилмент центр") va manzili, ruscha |
| `[].stock.timeFrom`, `.timeTo` | string, `HH:mm`, mahalliy vaqt (kuzatuv 3) | kuzatilmagan | `"06:00"`, `"23:59"` — ish vaqti (taxmin) |
| `[].stock.poolSource` | string | kuzatilmagan | `FULLFILMENT` (yozilganidek, ikki `L` bilan) |
| `[].stock.dimensionalGroups[]` | `{ group: string, title: string }[]` | kuzatilmagan | gabarit guruhlari: `SMALL` ("МГТ"), `MEDIUM` ("СГТ"), `UNKNOWN` ("Неопределенная"); `title` tilga bog'liq, tartibi barqaror emas (kuzatuv 6) |
| `[].hasIssue` | boolean | kuzatilmagan | 3/20 da `true`; kuzatuv 5 |
| `[].externalNumber` | null | ha (20/20) | to'ldirilgandagi turi noma'lum |
| `[].invoiceEttn` | `{ isEditable: boolean, warningFlag: boolean, slaEttnUpdate: null, ettn: null }` | `slaEttnUpdate`, `ettn` — ha (20/20) | ETTN (elektron tovar-transport nakladnoyi — taxmin) holati. `isEditable` 20/20 `true`; `warningFlag` `CREATED` da `true` (3/3), `ACCEPTED` da `false` (17/17) |
| `[].fines` | massiv | kuzatilmagan | 20/20 bo'sh `[]`; element shakli noma'lum ("jarimalar" — nomidan taxmin) |
| `[].createdInvoiceCount` | number | kuzatilmagan | 20/20 `0`; ma'nosi noma'lum |

Kuzatuvlar (shu sahifa ichida, haqiqiy qiymatlardan; misoldagi to'qilgan qiymatlar ham shu tuzilishni saqlaydi):

1. **`invoiceNumber` tuzilishi.** `"11000"` + `id` (7 xona) + bitta nazorat raqami; u EAN-13 qoidasi bilan hisoblanganiga teng — 20/20, OpenAPI namunasida ham 20/20. Demak raqam `id` dan hosil bo'ladi va shtrixkod sifatida chop etilishi mumkin (taxmin).
2. **Tartib.** Avval `CREATED` (3 ta), keyin `ACCEPTED` (17 ta); har guruh ichida `id` kamayish tartibida. Umumiy ro'yxat `id` bo'yicha saralanmagan. So'rovda saralash parametri yo'q — bu server standarti.
3. **Vaqt zonasi.** Epoch ms qiymatlari UTC+5 (Toshkent) da o'qilganda 21 ta oynaning hammasi (masalan 16:00–17:30) omborning `"06:00"`–`"23:59"` oralig'iga sig'adi; UTC da o'qilsa 5 nakladnoyning oynasi 06:00 dan oldin boshlanadi. Demak `stock.timeFrom`/`timeTo` — Toshkent vaqti (kuzatuv). `dateCreated` qaysi zonadagi sana ekani noma'lum.
4. **Qabul bosqichlari.** Ikkala vaqt ham bor 12 qatorda `expressAcceptanceDate` < `dateAccepted` (12/12, farq 13 soatdan ~2,2 kungacha) — avval tezkor qabul, keyin yakuniy qabul (taxmin). `expressAcceptanceDate` band qilingan oynaga bog'lanmagan: 14 tadan 11 tasida oyna boshlanishidan **oldin**. Bitta qatorda `dateAccepted` oynadan ~18 kun oldin — oyna tovar qachon topshirilganini bildirmaydi.
5. **`ACCEPTED` to'liq qabulni anglatmaydi.** 17 tadan 2 tasida `totalAccepted` < `totalToStock` (50/55, 51/54) va ikkalasida `hasIssue: true`. Uchinchi `hasIssue: true` qatorda sonlar teng (24/24) — `hasIssue` faqat kam qabulni bildirmaydi. `hasIssue: false` bo'lib kam qabul qilingan qator yo'q.
6. **Matnlar tilga bog'liq.** Bu javobda (`accept-language: ru-RU`) `status`, `invoiceStatus.text`, `dimensionalGroups[].title` ruscha; OpenAPI namunasida xuddi shu maydonlar o'zbekcha ("Stokda qabul qilingan", "KGT"), `dimensionalGroups` tartibi ham boshqa. Holatni faqat `invoiceStatus.value` dan o'qish kerak.
7. Oyna odatda `dateCreated` dan keyingi kunga band qilingan (17/20; 2 tasida o'sha kun, 1 tasida 19 kun keyin) — UTC+5 da o'qilganda.

Javob misoli (20 tadan 2 qator; niqoblar — §2; kalitlar, tartibi, `null`lar, holatlar, sonlar va vaqt tamg'alari — yozilganidek):

```json
[
  { "id": 3000002, "invoiceNumber": 1100030000021, "deliveryCertificate": null,
    "dateCreated": "07.10.2026", "status": "Создана",
    "invoiceStatus": { "text": "Создана", "color": "#000000", "value": "CREATED" },
    "fullPrice": 2500000,
    "timeSlotReservation": { "id": 7000002,
      "timeSlots": [{ "timeFrom": 1791457200000, "timeTo": 1791462600000 }],
      "status": "RESERVED", "timeFrom": 1791457200000, "timeTo": 1791462600000 },
    "totalAccepted": 0, "totalToStock": 36, "remainingAmountOfUpdates": 1,
    "dateAccepted": null, "expressAcceptanceDate": null,
    "stock": { "id": 34, "externalId": "00000000-0000-4000-8000-000000000034",
      "title": "Фулфилмент центр", "address": "Город Ташкент, …",
      "timeFrom": "06:00", "timeTo": "23:59", "poolSource": "FULLFILMENT",
      "dimensionalGroups": [{ "group": "SMALL", "title": "МГТ" },
        { "group": "MEDIUM", "title": "СГТ" }, { "group": "UNKNOWN", "title": "Неопределенная" }] },
    "hasIssue": false, "externalNumber": null,
    "invoiceEttn": { "isEditable": true, "warningFlag": true, "slaEttnUpdate": null, "ettn": null },
    "fines": [], "createdInvoiceCount": 0 },
  { "id": 3000003, "invoiceNumber": 1100030000038, "deliveryCertificate": null,
    "dateCreated": "10.10.2026", "status": "Принята на складе",
    "invoiceStatus": { "text": "Принята на складе", "color": "#00c853", "value": "ACCEPTED" },
    "fullPrice": 3000000,
    "timeSlotReservation": { "id": 7000003,
      "timeSlots": [{ "timeFrom": 1791700200000, "timeTo": 1791703800000 }],
      "status": "RESERVED", "timeFrom": 1791700200000, "timeTo": 1791703800000 },
    "totalAccepted": 50, "totalToStock": 55, "remainingAmountOfUpdates": 2,
    "dateAccepted": null, "expressAcceptanceDate": 1791683727860,
    "stock": { "id": 34, "…": "yuqoridagidek" },
    "hasIssue": true, "externalNumber": null,
    "invoiceEttn": { "isEditable": true, "warningFlag": false, "slaEttnUpdate": null, "ettn": null },
    "fines": [], "createdInvoiceCount": 0 }
]
```

#### Sahifalash

`page` (yozilgani `0`) va `size` (`20`). Javob aynan `size` ta element qaytargan — keyingi sahifa bor bo'lishi mumkin, lekin `page=1` yozib olinmagan. **Jami son hech qayerda yo'q**: tana yalang'och massiv, header'da ham yo'q. Tugash belgisi — `size` dan qisqa (yoki bo'sh) sahifa (taxmin; tekshirilmagan).

**Kuzatilgan xatolar:** kuzatilmagan (bitta `200`).

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat yo'q. Kengaytma bu yo'lni `invoices.list` lookup'i bilan chaqiradi ([`invoicesList.ts`](../extension/src/tools/invoicesList.ts); ENDPOINTS.md 13.6); sayt esa OpenAPI'ning `GET /v1/invoice` ini ishlatadi (ENDPOINTS.md 8-bo'lim). Kodning o'z qarorlari — dalil emas:

- **`INVOICE_READ` ruxsat kodi** so'rovdan oldin mahalliy tekshiriladi (nomidan o'qilgan faraz).
- **Chegaralar bizniki:** `size` 1…100 (standart 20 — yozib olingan qiymat), `page` 0…100 000. Kattaroq `size` va `page=1` ko'rilmagan.
- **Filtr yuborilmaydi:** yozib olingan so'rovda bunday parametr yo'q, kod ham o'ylab topmaydi.
- **Ustunlar tanlangan:** 19 kalitning hammasi emas, nomlangan ustunlar chiqadi (ro'yxati — texnik spetsifikatsiya 14.6).
- **Kuzatuvlar legendada**, dalil kuchi bilan: 2, 4, 5, 6. Kuzatuv 3 (vaqt zonasi) legendaga kirmagan: `.utc` ustuni UTC, sotuvchi zonasiga o'tkazishni prompt aytadi.

OpenAPI egizagi (`GET /v1/shop/{shopId}/invoice?size=20&page=0`, 2026-08-10 namunasi) bilan solishtiruv:

- **Kalitlar va tartibi:** kabinetda 19 kalit; OpenAPI'da o'sha kalitlar, o'sha tartibda — **`fines`siz** (18 kalit). `fines` (kabinetda 20/20 bo'sh massiv) kabinetga xosmi yoki avgustdan keyin qo'shilganmi — noma'lum (namunalar orasida 3 oy).
- **Matnlar tili:** kabinetda ruscha, OpenAPI'da o'zbekcha.
- **`invoiceStatus.value`:** kabinetda `CREATED`, `ACCEPTED`; OpenAPI'da `ACCEPTANCE_IN_PROGRESS` (`#eb8d00`), `ACCEPTED`.
- **Bir xil (ikkalasida 20/20):** `invoiceNumber` tuzilishi, `dateCreated` formati, `timeSlotReservation.status: RESERVED`, ombor `34`.

ENDPOINTS.md 12.4 dagi tavsif ("`status`, `hasIssue`, `externalNumber`, `invoiceEttn`, `createdInvoiceCount` bor; `shopId`/`shopTitle` va `productForInvoiceDto` yo'q") kabinet javobiga ham to'g'ri keladi.

#### Ochiq savollar

- `fullPrice` birligi va nimaning yig'indisi ekani (sotuv narximi, xarid narximi).
- `invoiceStatus.value` ning to'liq to'plami (uchta kod ko'rilgan: `CREATED`, `ACCEPTANCE_IN_PROGRESS`, `ACCEPTED`) va guruhlar tartibi qoidasi.
- `ACCEPTED` bo'la turib `dateAccepted: null` nimani anglatadi (2/17; birida kam qabul, birida to'liq).
- `expressAcceptanceDate` ning aniq ma'nosi; u `null` bo'lgan `ACCEPTED` qatorlar (3/17) qanday qabul qilingan.
- `deliveryCertificate`, `externalNumber`, `invoiceEttn.ettn`, `invoiceEttn.slaEttnUpdate` ning to'ldirilgandagi turi; `fines[]` elementining shakli; `createdInvoiceCount` va `remainingAmountOfUpdates` ma'nosi.
- `timeSlotReservation.status` ning boshqa qiymatlari; bekor qilingan nakladnoy qanday ko'rinadi.
- Sahifalash: `page=1`, `size` ning yuqori chegarasi, jami sonni olish yo'li, holat yoki sana bo'yicha filtr bormi.
- Nakladnoy tarkibi (mahsulotlar) kabinetda qaysi yo'ldan olinadi — bu javobda yo'q.
- Ikkinchi do'kon (`1002`) va boshqa ombor uchun javob.

---

### 5.B.11 `GET /api/seller/shop/{shopId}/return`

**Guruh:** FBO nakladnoylari · **Maqsad:** do'konning ombordan qaytarishlari ro'yxati — Uzum omboridan sotuvchiga qaytarilayotgan tovar (brak va boshqalar): turi, holati, bosqich vaqtlari, pullik saqlash oralig'i va ombor. Xaridor qaytargan buyurtmalar emas.

**API:** kabinet (ichki); qaytarish nakladnoylari sahifasi chaqiradi (tranzaksiya `invoices-return`, §2). OpenAPI'dagi yaqini — `GET /v1/return` (ENDPOINTS.md [8-bo'lim](../frontend/src/services/uzum/ENDPOINTS.md#8-fbo--yetkazib-berish-va-qaytarish-nakladnoylari)); farqi pastda.

**Dalil qanchalik kuchli:** **1 namuna** — 2026-11-16 12:11 GMT, bitta do'kon (`1001`), `page=0&size=20`, `200`; javob **to'liq** yozilgan (20 element). "N/20" sanoqlari shu sahifa ichida: bir do'kon, bitta ombor, bitta holat (`COMPLETED`), ikki tur. Mustaqil tayanch — OpenAPI `GET /v1/return` ning 2026-08-10 dagi namunasi ([`uzum-samples.json`](../frontend/_design/v1/uploads/uzum-samples.json), `returns_list`, 21 qator).

#### So'rov

| Maydon | Tur | Majburiy | Misol | Izoh |
|---|---|---|---|---|
| `{shopId}` (yo'lda) | number | ha | `1001` | do'kon id'i |
| `page` | number | bor; majburiyligi kuzatilmadi | `0` | faqat `0` yozilgan |
| `size` | number, dona | bor; majburiyligi kuzatilmadi | `20` | javobda aynan 20 element |

Holat, tur, sana, saralash parametri va body yo'q; `access-content-allow-origin`, `x-iid`, `cookie` ham yo'q edi (§2).

#### Javob

Konvert: **`{ payload, timestamp }`**, `payload` — massiv. Hamma qatorning dalil kuchi — `1 namuna`; `ha (n/20)` — 20 qatordan n tasida `null`.

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `payload[].id` | number | kuzatilmagan | qaytarish id'i; ikki oila: `DEFECTED` da 10 xonali, `RETURN` da 6 xonali (kuzatuv 1) |
| `payload[].dateCreated` | number, epoch ms | kuzatilmagan | yaratilgan vaqt (taxmin — nomidan); 5.B.10 da shu nom — `DD.MM.YYYY` satr |
| `payload[].status` | string | kuzatilmagan | holat **kodi**: 20/20 `COMPLETED`; 5.B.10 da `status` — tilga bog'liq matn |
| `payload[].type` | string | kuzatilmagan | `DEFECTED` (4/20), `RETURN` (16/20); ma'nosi nomidan (brak / oddiy qaytarish — taxmin) |
| `payload[].stock` | obyekt | kuzatilmagan | ombor; kalitlari 5.B.10 `stock` nikidek (8 ta). 20/20 da bitta ombor: `id` `3`, "Сергели", `poolSource` `SERGELI`, `timeFrom`/`timeTo` `"06:00"`/`"23:59"` |
| `payload[].timeSlotReservation` | obyekt | ha (19/20) | band qilingan oyna; to'ldirilgan yagona qatorda 5.B.10 dagi shakl (`id`, `timeSlots[]`, `status: RESERVED`, `timeFrom`, `timeTo`); kuzatuv 5 |
| `payload[].paidStorage` | `{ startDate: number, endDate: number, status: string }`, epoch ms | kuzatilmagan | pullik saqlash oralig'i (taxmin — nomidan); `status` 20/20 `COMPLETED`; kuzatuv 2–3 |
| `payload[].assembledDate` | number, epoch ms | kuzatilmagan | yig'ilgan vaqt (taxmin — nomidan) |
| `payload[].executionDate`, `.completedDate` | number, epoch ms | kuzatilmagan | 20/20 da ikkalasi teng; yakunlangan vaqt (tovar olib ketilgan — taxmin) |
| `payload[].canceledDate` | null | ha (20/20) | to'ldirilgandagi turi noma'lum (ehtimol epoch ms) |
| `payload[].externalNumber`, `.ettnInfo`, `.returnDropInfo` | null | ha (20/20) | to'ldirilgandagi turi noma'lum |
| `timestamp` | string, zonasiz ISO (9 xonali kasr), UTC | kuzatilmagan | server vaqti; javob `date` header'idan 1,06 s keyin — zonasiz UTC kuzatuviga (§2) ikkinchi namuna |

Kuzatuvlar (haqiqiy qiymatlardan; misoldagi to'qilgan `id` lar tuzilishni saqlaydi):

1. **Tartib — `id` kamayish tartibida** (20/20): `DEFECTED` id'lari kattaroq oiladan, shuning uchun ular (4 ta) boshida, keyin `RETURN` (16 ta). `dateCreated` bo'yicha umumiy tartib **yo'q** — faqat tur ichida kamayadi. So'rovda saralash parametri yo'q.
2. **`paidStorage.startDate` = `assembledDate` + aniq 10 kun** (864 000 000 ms; 20/20, OpenAPI namunasida 20/21); `paidStorage.endDate` = `executionDate` = `completedDate` (20/20). Pullik saqlash yig'ilgandan 10 kun o'tib boshlanib, yakunlanganda tugaydi (taxmin).
3. **14/20 da `endDate` < `startDate`** — tovar pullik saqlash boshlanishidan oldin yakunlangan; 6/20 da `endDate` > `startDate` (0,08 kundan 38,4 kungacha). `paidStorage.status` ikkalasida ham `COMPLETED`: pul olingan-olinmaganini bildirmaydi; summa javobda **yo'q**.
4. **Bosqichlar:** `dateCreated` ≤ `assembledDate` ≤ `completedDate` (20/20); yaratilgandan yig'ilguncha 1,5 soatdan 22 kungacha, yig'ilgandan yakunlanguncha 2,8 kundan 48 kungacha.
5. **Oyna yakunlangan vaqt emas:** `timeSlotReservation` to'ldirilgan yagona qatorda oyna 120 daqiqa, `status: RESERVED`; qaytarish oynadan 36 kun **keyin** yakunlangan.
6. **Javobda tarkib yo'q:** mahsulot, dona, summa maydonlari yo'q — nechta tovar qaytarilganini bu ro'yxatdan o'qib bo'lmaydi (OpenAPI `GET /v1/return` da bor, pastda).
7. Bitta sahifa (20 qator) bir yillik davrni qamraydi: `dateCreated` 2025-09-26 … 2026-09-18.

Javob misoli (20 tadan 2 qator; niqoblar — §2; kalitlar, tartibi, `null`lar, kodlar va vaqt tamg'alari yozilganidek):

```json
{ "payload": [
  { "id": 1000000001, "dateCreated": 1758865224083, "status": "COMPLETED",
    "stock": { "id": 3, "externalId": "00000000-0000-4000-8000-000000000003", "title": "Сергели",
      "address": "Ташкент, …", "timeFrom": "06:00", "timeTo": "23:59", "poolSource": "SERGELI",
      "dimensionalGroups": [{ "group": "MEDIUM", "title": "СГТ" },
        { "group": "UNKNOWN", "title": "Неопределенная" }, { "group": "SMALL", "title": "МГТ" }] },
    "timeSlotReservation": { "id": 7000004,
      "timeSlots": [{ "timeFrom": 1759910400000, "timeTo": 1759917600000 }],
      "status": "RESERVED", "timeFrom": 1759910400000, "timeTo": 1759917600000 },
    "paidStorage": { "startDate": 1759734481210, "endDate": 1763049003771, "status": "COMPLETED" },
    "executionDate": 1763049003771, "assembledDate": 1758870481210, "completedDate": 1763049003771,
    "canceledDate": null, "externalNumber": null, "type": "DEFECTED",
    "ettnInfo": null, "returnDropInfo": null },
  { "id": 100001, "dateCreated": 1781691676419, "status": "COMPLETED",
    "stock": { "id": 3, "…": "yuqoridagidek" }, "timeSlotReservation": null,
    "paidStorage": { "startDate": 1782566841379, "endDate": 1782483532662, "status": "COMPLETED" },
    "executionDate": 1782483532662, "assembledDate": 1781702841379, "completedDate": 1782483532662,
    "canceledDate": null, "externalNumber": null, "type": "RETURN",
    "ettnInfo": null, "returnDropInfo": null }
], "timestamp": "2026-11-16T12:11:07.060963973" }
```

#### Sahifalash

`page` / `size` (yozilgani `0` / `20`). Javob aynan `size` ta element — keyingi sahifa bo'lishi mumkin, `page=1` yozib olinmagan. **Jami son hech qayerda yo'q**: konvertda faqat `payload` va `timestamp`, header'da ham yo'q. Tugash belgisi — `size` dan qisqa (yoki bo'sh) sahifa (taxmin, tekshirilmagan).

**Kuzatilgan xatolar:** kuzatilmagan (bitta `200`).

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat yo'q. Kengaytma bu yo'lni `returns.list` lookup'i bilan chaqiradi ([`returnsList.ts`](../extension/src/tools/returnsList.ts); ENDPOINTS.md 13.6). Kodning o'z qarorlari — dalil emas:

- `SELLER_RETURN_READ` ruxsat kodini so'rovdan oldin mahalliy tekshiradi — nomidan o'qilgan faraz;
- chegaralar bizniki: `size` 1…100 (standart 20 — yozib olingan qiymat), `page` 0…100 000; kattaroq `size` va `page=1` ko'rilmagan;
- filtr yubormaydi — yozib olingan so'rovda yo'q;
- faqat `{ payload: [...] }` konvertini taniydi; boshqa shakl (jumladan yalang'och massiv) — shakldan mustaqil renderer;
- natija ko'rinishi — texnik spetsifikatsiya 14.6; legendada kuzatuv 1, 2–3 (model haq haqida gapirmaydi), 4 (bosqichlar tartibi), 5 va 6 dalil kuchi bilan.

Shu OpenAPI namunasi (`GET /v1/return?size=30&page=0`) bilan solishtiruv:

- konvert — yalang'och massiv (kabinetda `{ payload, timestamp }`);
- kalitlar — kabinetdagi 14 ta, o'sha tartibda, **va yana 7 ta**: `shopId`, `shopTitle`, `returnItems[]`, `totalAmount`, `totalPackedAmount` (shu uchtasi — tarkib va dona, kabinetda yo'q), `countAllowedChange`, `maxCountAllowedChange`;
- bir xil: `type` (`DEFECTED`, `RETURN`) va `status` (`COMPLETED`) qiymatlari, `dateCreated` (epoch ms), ombor (`id` `3`);
- 10 kunlik moslik (kuzatuv 2) — 20/21, kabinetda 20/20;
- do'kon kesimidagi egizagi (`GET /v1/shop/{shopId}/return`) yozib olinmagan — solishtiruv butun hisob ro'yxati bilan.

#### Ochiq savollar

- Qaytarilgan mahsulotlar va donasi kabinetda qaysi yo'ldan olinadi (bitta qaytarish tafsiloti yozib olinmagan).
- `status` ning boshqa kodlari; yakunlanmagan qaytarishda `executionDate`/`completedDate`/`paidStorage` ko'rinishi.
- `type` ning to'liq to'plami va ma'nosi; ikki id oilasi nimani anglatadi.
- 10 kunlik moslik qoida ekani; `paidStorage.status` ning boshqa qiymatlari; pullik saqlash summasi qayerda.
- `executionDate` va `completedDate` qachon farq qiladi.
- `canceledDate`, `externalNumber`, `ettnInfo`, `returnDropInfo` ning to'ldirilgandagi shakli.
- Sahifalash: `page=1`, `size` ning yuqori chegarasi, jami son, filtr bormi.
- Ikkinchi do'kon (`1002`) va boshqa ombor uchun javob.

---

### 5.B.12 `POST /api/seller/product-reviews`

**Guruh:** Sharhlar · **Maqsad:** xaridorlarning mahsulot sharhlari ro'yxati — hisobning **hamma do'konlari** bo'yicha bitta ro'yxat: baho, matn, mahsulot va SKU, do'kon, javob holati. Metodi `POST`, lekin javobi — ro'yxat: o'qish so'rovi, filtr tanada yuboriladi. Yozib olingan filtr — `NO_REPLY`: sotuvchi javob bermagan sharhlar (ma'nosi nomidan; kuzatuv 9 unga mos). Yana to'rt qiymat — `ALL`, `NEW`, `WITH_REPLY`, `PINNED` — aytilgan, javoblari yozib olinmagan.

**API:** kabinet (ichki); sharhlar sahifasi chaqiradi (sentry release `sx-sgt-frontend`, §2). Yo'lda do'kon yo'q. OpenAPI'da sharh marshruti yo'q (ENDPOINTS.md da uchramaydi).

**Dalil qanchalik kuchli:** **1 namuna** — 2026-11-17 08:49 GMT, `page=0&size=20`, `200`. Uch joyi to'liq emas:

- **Javob kesilgan:** yozib olgan kishi `payload` ni 7-elementdan keyin kesgan (7-elementdan keyin vergul turibdi: kamida 8 element bor edi). "n/7" sanoqlari shu 7 qator ichida: ikki do'kon, 5 xil mahsulot.
- **Tana alohida berilgan:** header'lar bilan birga yozilmagan, keyin DevTools'ning Payload bo'limidan olingan. U yerda bezatilgan ko'rinishda edi; ixcham yozilishi `{"filter":"NO_REPLY"}` — aynan **21 bayt**, yozib olingan `content-length: 21` bilan mos. Simdagi shakl shu deb olinadi.
- **Filtrning qolgan qiymatlari — aytilgan, yozib olinmagan:** sotuvchi 2026-11-17 da tanalarni DevTools Payload ko'rinishidagidek (kalit qo'shtirnoqsiz) sanab berdi: `{filter: "ALL"}`, `{filter: "NEW"}`, `{filter: "NO_REPLY"}`, `{filter: "WITH_REPLY"}`, `{filter: "PINNED"}`. `NO_REPLY` dan boshqa to'rttasining na header'i, na query'si, na javobi berilgan: bular — **qiymat nomlari**, namuna emas. Pastdagi javob jadvali va kuzatuvlarning hammasi faqat `NO_REPLY` javobidan.

#### So'rov

```http
POST /api/seller/product-reviews?page=0&size=20
Content-Type: application/json

{"filter":"NO_REPLY"}
```

| Maydon | Tur | Majburiy | Misol | Izoh |
|---|---|---|---|---|
| `page` (query) | number | bor; majburiyligi kuzatilmadi | `0` | faqat `0` yozilgan |
| `size` (query) | number, dona | bor; majburiyligi kuzatilmadi | `20` | javob kesilgan — nechta element qaytgani noma'lum |
| `filter` (tana) | string | bor; majburiyligi kuzatilmadi | `NO_REPLY` | so'rovi va javobi yozilgan yagona qiymat; aytilgan yana to'rttasi — pastdagi jadvalda. Tanada boshqa kalit yo'q |

`filter` qiymatlari (tartib — aytilgan tartib; beshtadan boshqasi bor-yo'qligi noma'lum):

| `filter` | Dalil | Nimani tanlaydi |
|---|---|---|
| `ALL` | aytilgan; so'rovi ham, javobi ham yozilmagan | hamma sharhlar (taxmin — nomidan) |
| `NEW` | aytilgan; yozilmagan | **noma'lum**: "yangi" — o'qilmagan (`read: false`) sharhlarmi yoki yaqinda yozilganlarmi, nom ajratmaydi |
| `NO_REPLY` | **1 so'rov, 1 javob** (shu karta) | sotuvchi javob bermagan sharhlar (nomidan; `replyStatus` 7/7 `null` unga mos) |
| `WITH_REPLY` | aytilgan; yozilmagan | sotuvchi javob bergan sharhlar (taxmin — nomidan); `replyStatus` to'ldirilgan shakli shu yerda ko'rinishi kerak (taxmin) |
| `PINNED` | aytilgan; yozilmagan | mahkamlangan sharhlar — `pinned: true` (taxmin — nomidan) |

`page` va `size` — `POST` bo'lsa ham query'da. `access-content-allow-origin: *` bor; `x-iid` va `cookie` yo'q (§2). **Preflight** kabinetniki yozilmagan; qo'lda, tokensiz yuborilgani `200` oldi va `POST`, `authorization`, `content-type` ga ruxsat berdi (§2).

#### Javob

Konvert: **`{ payload, timestamp }`**, `payload` — massiv; qatorda 18 kalit. Hamma qatorning dalil kuchi — `1 namuna`; `ha (n/7)` — yozilgan 7 qatordan n tasida `null`. Header'lari boshqa kartalarnikidan farq qiladi — §2.

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `payload[].reviewId` | number | kuzatilmagan | sharh id'i; 8 xonali |
| `payload[].dateCreated` | number, epoch ms | kuzatilmagan | sharh yozilgan vaqt (taxmin — nomidan) |
| `payload[].rating` | number; shkala 1…5 (taxmin) | kuzatilmagan | mahsulot bahosi; ko'rilgani `1`, `3`, `4`, `5` |
| `payload[].packagingQualityRating`, `.deliveryRating` | number | ha (2/7) | qadoq va yetkazish bahosi (taxmin — nomidan); ikkalasi birga `null` yoki birga to'ldirilgan (7/7); ko'rilgani `1`, `4`, `5`; kuzatuv 3 |
| `payload[].content`, `.pros`, `.cons` | string | kuzatilmagan | sharh matni, afzalliklar, kamchiliklar (taxmin — nomidan). Yozilmaganda **bo'sh satr**, `null` emas: 5/7 da uchalasi bo'sh; kuzatuv 4 |
| `payload[].photos` | massiv | kuzatilmagan | 7/7 bo'sh `[]`; element shakli noma'lum (xaridor qo'shgan rasmlar — taxmin) |
| `payload[].customerName` | string | kuzatilmagan | xaridor ismi yoki uning o'rnidagi matn; kuzatuv 5 |
| `payload[].anonymous` | boolean | kuzatilmagan | 1/7 `true` |
| `payload[].product.productId` | number | kuzatilmagan | mahsulot id'i; 7 xonali |
| `payload[].product.productTitle` | string | kuzatilmagan | mahsulot nomi, ruscha |
| `payload[].product.skuTitle` | string | kuzatilmagan | sharh yozilgan SKU'ning to'liq kodi (`SHOPA-…`); prefiksi bir do'konning hamma qatorida bir xil (5/5 va 2/2) va 5.B.3 dagi `skuTitle` tavsifiga mos (uning xom qiymati bilan solishtirilmagan); ichida kirill harflari bor; kuzatuv 7 |
| `payload[].product.photos[]` | `{ photo, photoKey, color, hasVerticalPhoto }[]` | kuzatilmagan | 7/7 da 1 element; kuzatuv 6 |
| `payload[].product.photos[].photo` | `Record<string, { high: string, low: string }>` | kuzatilmagan | o'lcham kaliti → ikki URL; 9 kalit, yozilgan tartibda: `800`, `720`, `480`, `240`, `80`, `24034`, `120`, `540`, `60` |
| `payload[].product.photos[].photoKey` | string | kuzatilmagan | rasm id'i (20 belgi) — URL'lardagi bilan bir xil (7/7) |
| `payload[].product.photos[].color` | null | ha (7/7) | to'ldirilgandagi turi noma'lum |
| `payload[].product.photos[].hasVerticalPhoto` | boolean | kuzatilmagan | 7/7 `false` |
| `payload[].replyStatus` | null | ha (7/7) | sotuvchi javobining holati (taxmin — nomidan); to'ldirilgandagi turi noma'lum |
| `payload[].dateBought` | number, epoch ms | kuzatilmagan | xarid vaqti (taxmin — nomidan); 7/7 da `dateCreated` dan oldin (kuzatuv 8) |
| `payload[].characteristics[]` | `{ characteristic: string, characteristicValue: string }[]` | kuzatilmagan | SKU xususiyatlari; 7/7 da 2 element — rang va o'lcham; kuzatuv 7 |
| `payload[].shop` | `{ id: number, title: string, rating: number }` | kuzatilmagan | sharh qaysi do'konga tegishli: `id` va `title` — 5.B.3 dagi do'konlar; `rating` — bitta kasr xonali son (`4.8`, `4.7`), bir do'konning hamma qatorida bir xil — do'kon reytingi (taxmin) |
| `payload[].read` | boolean | kuzatilmagan | 7/7 `true` |
| `payload[].pinned` | boolean | kuzatilmagan | 7/7 `false` |
| `timestamp` | string, zonasiz ISO (9 xonali kasr), UTC | kuzatilmagan | server vaqti; javob `date` header'i bilan bir sekundda — zonasiz UTC kuzatuviga (§2) uchinchi namuna |

Kuzatuvlar (haqiqiy qiymatlardan; misoldagi to'qilgan qiymatlar tuzilishni saqlaydi):

1. **Tartib.** `dateCreated` kamayish tartibida (7/7) — `reviewId` ham (7/7): qaysi biri saralash kaliti ekanini bu namuna ajratmaydi. 7 qator 40 kunni qamraydi (2026-10-04 … 2026-11-13).
2. **Bitta javobda ikki do'kon**, aralash: `1001` — 5/7, `1002` — 2/7. Ro'yxat do'kon bo'yicha emas, hisob bo'yicha: so'rovda (yo'l, query, tana) do'kon yo'q. Tanaga do'kon filtri qo'shib bo'ladimi — noma'lum.
3. **Uch baho.** Qadoq va yetkazish bahosi to'ldirilgan 5 qatorning 4 tasida uchala baho teng (`5/5/5` ikki marta, `4/4/4`, `1/1/1`), bittasida farq qiladi (`rating` 3, qolgan ikkisi 5). Ular `null` bo'lgan 2 qatorda `rating` — 4.
4. **Matn xaridor yozganidek.** Matnli 2 qator: birida uchala maydon o'zbekcha (lotin), ikkinchisida `content` va `cons` ruscha, `pros` bo'sh. Til `accept-language` ga bog'liq emas; oxiridagi bo'shliq ham saqlangan. Matnli qatorlarning `rating` i 1 va 3; 4–5 baholi 5 qatorning hammasi matnsiz.
5. **`customerName` uch xil.** `anonymous: true` da `"***"` — buni API'ning o'zi qaytaradi (1/1). `anonymous: false` da faqat ism, familiyasiz (4/6; kirill va lotin yozuvida) yoki `"Безымянный"` (2/6) — ismi yo'q xaridor uchun to'ldirgich (taxmin; tilga bog'liq bo'lishi mumkin).
6. **Rasm mahsulotniki, SKU'niki emas.** Bir mahsulotning ikki xil rangli SKU'siga yozilgan sharhlarda `photoKey` bir xil (2 juftda 2/2). To'qqiz o'lcham kaliti to'rt juft faylga tushadi: `800`, `720` → `original.jpg` / `t_product_low.jpg`; `480`, `540` → `t_product_540_high.jpg` / `…_low.jpg`; `240`, `24034`, `120` → `t_product_240_…`; `80`, `60` → `t_product_80_…`.
7. **`characteristics` va `skuTitle`.** Xususiyat nomlari ruscha (`Цвет`, `Размер одежды RUS`, `Размер одежды`, `Мужской размер обуви RUS`); `Цвет` 2/7 da birinchi, 5/7 da ikkinchi — tartib barqaror emas. `skuTitle` ning oxirgi ikki bo'lagi rang va o'lchamga to'g'ri keladi (`52-54` → `5254`), lekin mexanik emas: uni sotuvchi yozgan (bir qatorda o'lcham xato bilan terilgan).
8. **Xariddan sharhgacha** (`dateCreated − dateBought`): 6,7 kundan 155 kungacha (7/7 musbat).
9. **Ko'rilmagan qiymatlar.** `replyStatus` 7/7 `null` — `filter: NO_REPLY` ga mos: bu ro'yxat **hamma sharhlar emas**, faqat javobsizlari, shuning uchun `replyStatus` ning to'ldirilgan shakli bu filtr bilan ko'rinmaydi ham — uni `WITH_REPLY` yoki `ALL` javobi ko'rsatishi kerak (yozib olinmagan). `read` 7/7 `true`, `pinned` 7/7 `false`, `photos` 7/7 bo'sh. `read` hammasida `true` bo'lgani uchun ro'yxatni o'qishning o'zi sharhni "o'qilgan" qilib belgilaydimi — bu namunadan bilib bo'lmaydi.

Javob misoli (yozilgan 7 tadan 2 qator; niqoblar — §2; kalitlar, tartibi, `null`lar, baholar, sharh matni, xususiyatlar va vaqt tamg'alari yozilganidek; `photo` ning to'qqiz kalitidan ikkitasi ko'rsatilgan):

```json
{ "payload": [
  { "reviewId": 80000001, "dateCreated": 1794541715125, "rating": 4,
    "packagingQualityRating": null, "deliveryRating": null,
    "content": "", "pros": "", "cons": "", "photos": [],
    "customerName": "***", "anonymous": true,
    "product": { "productId": 4100001, "productTitle": "Женский костюм для дома",
      "skuTitle": "SHOPA-KOSTYUM-ХРОМ-5254",
      "photos": [{ "photo": {
          "800": { "high": "https://images.uzum.uz/<image-id>/original.jpg",
                   "low": "https://images.uzum.uz/<image-id>/t_product_low.jpg" },
          "240": { "high": "https://images.uzum.uz/<image-id>/t_product_240_high.jpg",
                   "low": "https://images.uzum.uz/<image-id>/t_product_240_low.jpg" },
          "…": "yana 7 kalit" },
        "photoKey": "<image-id>", "color": null, "hasVerticalPhoto": false }] },
    "replyStatus": null, "dateBought": 1793961625585,
    "characteristics": [
      { "characteristic": "Размер одежды RUS", "characteristicValue": "52-54" },
      { "characteristic": "Цвет", "characteristicValue": "Хром" }],
    "shop": { "id": 1001, "title": "Do'kon A", "rating": 4.8 },
    "read": true, "pinned": false },
  { "reviewId": 80000002, "dateCreated": 1791889352475, "rating": 1,
    "packagingQualityRating": 1, "deliveryRating": 1,
    "content": "rasvo", "pros": "yomon", "cons": "yomon", "photos": [],
    "customerName": "<ism>", "anonymous": false,
    "product": { "productId": 4100002, "productTitle": "Бутсы для искусственного газона",
      "skuTitle": "SHOPB-BUTSA-САЛАТ-39", "photos": [{ "…": "yuqoridagidek" }] },
    "replyStatus": null, "dateBought": 1783073573076,
    "characteristics": [
      { "characteristic": "Мужской размер обуви RUS", "characteristicValue": "39" },
      { "characteristic": "Цвет", "characteristicValue": "Салатовый" }],
    "shop": { "id": 1002, "title": "Do'kon B", "rating": 4.7 },
    "read": true, "pinned": false }
], "timestamp": "2026-11-17T08:49:57.918060343" }
```

#### Sahifalash

`page` / `size` (yozilgani `0` / `20`), query'da. Javob kesilgani uchun sahifada nechta element bo'lgani **noma'lum** (kamida 8). **Jami son yo'q**: konvertning oxiri yozilgan — `payload` dan keyin faqat `timestamp`; header'da ham yo'q. Tugash belgisi — `size` dan qisqa (yoki bo'sh) sahifa (taxmin, tekshirilmagan).

**Kuzatilgan xatolar:** kuzatilmagan (bitta `200`).

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat yo'q. Kengaytma bu yo'lni `reviews.list` lookup'i bilan chaqiradi ([`reviewsList.ts`](../extension/src/tools/reviewsList.ts); ENDPOINTS.md 13.6) — ko'prikdagi yagona `POST`. Kodning o'z qarorlari — dalil emas:

- **Tana — jadvalniki.** Marshrut jadvali ([`routes.ts`](../extension/src/uzum/routes.ts)) tanani o'zi yozadi: bitta kalit — `{"filter":"<qiymat>"}`. Panel tana yubormaydi; u faqat `filter` **parametrini** nomlaydi, jadval esa uni yuqoridagi beshta doimiy (`REVIEWS_FILTERS`) bilan butunligicha solishtiradi. Boshqa har qanday qiymat — boshqacha yozilgani, satr bo'lmagani — so'rov yuborilmasdan rad etiladi, ya'ni tanaga jadval yozmagan matn tusha olmaydi.
- **Standart filtr — `ALL`** (loyiha egasining qarori, 2026-11-17): filtr aytilmagan savol hamma sharhlar haqida. Bu yozib olingan filtr **emas** — `ALL` ning javobi ko'rilmagan, shuning uchun standart o'qishda ham natijaning sarlavhasi va birinchi satri ma'no faqat nomdan o'qilganini aytadi (yozilmagan to'rt filtrning hammasida shunday). `NO_REPLY` so'ralganda tana aynan yozib olingan 21 bayt. `NEW` ni model "o'qilmagan" yoki "yaqinda yozilgan" deb tushuntirmaydi.
- **Ko'rilmagan qator shakliga tayyorgarlik:** `replyStatus` obyekt bo'lib kelsa, shakl belgisi (`{a,b}`) o'rniga bir daraja ochib chiqariladi (`kalit: qiymat; …`); yozuvdagi 18 kalitdan boshqa qator kaliti sarlavhada **nomi bilan** aytiladi, qiymati chiqarilmaydi.
- **Account marshruti:** yo'lda do'kon yo'q, shuning uchun do'kon va ruxsat kodi tekshirilmaydi — faqat kirgan sessiya. `PRODUCT_REVIEW_READ` kodi sessiyada bor (5.B.1), lekin u do'konga beriladi, bu yo'l esa do'kon nomlamaydi.
- **Header'lar:** `accept`, `authorization`, `content-type: application/json`; cookie'siz. Kabinet qo'shgan `access-content-allow-origin` yuborilmaydi — usiz so'rov shu yo'lda ko'rilmagan.
- **Chegaralar bizniki:** `size` 1…100 (standart 20 — yozib olingan qiymat), `page` 0…100 000; kattaroq `size` va `page=1` ko'rilmagan.
- **Xaridor ismi modelga berilmaydi:** `customerName` hech bir natijada chiqmaydi (tanilmagan shaklda ham — shakldan mustaqil renderer'dan oldin olib tashlanadi); `anonymous` chiqadi. Mahsulot rasmi manzillari ham chiqmaydi.
- **Sharh matni** (`content`, `pros`, `cons`) 300 belgigacha kesib, ma'lumot sifatida chiqadi; natija va legenda uni hech qachon ko'rsatma deb o'qimaslikni aytadi — bu begona odam yozgan matn.
- Natija ko'rinishi — texnik spetsifikatsiya 14.6; legendada kuzatuv 1, 2, 3, 4, 8 va 9 dalil kuchi bilan.

#### Ochiq savollar

- **Aytilgan to'rt filtrning javobi** (`ALL`, `NEW`, `WITH_REPLY`, `PINNED`): qator shakli `NO_REPLY` nikidek qoladimi; `NEW` nimani tanlaydi; beshtadan boshqa qiymat bormi. Tanada yana qanday kalit qabul qilinadi (do'kon, baho, sana); tanasiz yoki `{}` bilan so'rov nima qaytaradi.
- **Ro'yxatni o'qish yon ta'sir qiladimi** — sharhni "o'qilgan" qilib belgilaydimi (`read` 7/7 `true` edi).
- Sahifadagi haqiqiy elementlar soni; `page=1`; `size` ning yuqori chegarasi; jami sonni olish yo'li.
- `replyStatus` ning qiymatlari; javob berilgan sharhda sotuvchining javob matni qayerda keladi; `read: false` va `pinned: true` qanday ko'rinadi.
- `photos[]` elementining shakli; `product.photos[].color` ning to'ldirilgandagi turi; `hasVerticalPhoto: true`.
- `"Безымянный"` `accept-language` ga bog'liqmi; `anonymous: true` da `customerName` dan boshqa maydon ham yashiriladimi.
- `rating` shkalasi (`2` ko'rilmagan); qadoq va yetkazish bahosi qachon `null`.
- `shop.rating` nima ekani va qanday yaxlitlanishi.
- `access-content-allow-origin`siz, faqat `accept` + `authorization` + `content-type` bilan so'rov `200` oladimi (preflight o'tadi — §2).
- Bitta do'konli hisobda va boshqa hisobda javob; xodim hisobida (bir do'konda `PRODUCT_REVIEW_READ` yo'q) nima qaytadi.

---

### 5.B.13 `GET /api/seller/shop/{shopId}/sku-list`

**Guruh:** Katalog · **Maqsad:** do'konning SKU'lari ro'yxati (har o'lcham/rang — alohida qator), qidiruv bilan: shtrixkod, SKU va mahsulot holati, sotuvdagi son, omborga yuborish mumkinligi va chegaralari. Shtrixkod bo'yicha SKU'ni topishga yaraydi.

**API:** kabinet (ichki). Qaysi sahifa chaqirgani **yozilmagan**: so'rovning `baggage` ida tranzaksiya nomi yo'q. Undan 106 soniya oldin stikerlar sahifasining so'rovi yozilgan (5.B.14), lekin trace id'lari boshqa — bir sahifa ekani isbotlanmagan. Javobdagi `invoiceSkuLimit`, `quantityToStock`, `supplyDecision` nomlari omborga yuborish (nakladnoy tuzish) jarayoniga ishora qiladi (taxmin). OpenAPI egizagi yozilmagan.

**Dalil qanchalik kuchli:** **1 namuna** — 2026-11-17 12:00 GMT, do'kon `1001`, `page=0&size=20&search=<13 xonali shtrixkod>`, `200`; javob to'liq, **1 qator**. Hamma "n/1" — shu bitta SKU. Qidiruvsiz so'rov va bir nechta qatorli javob yozilmagan.

#### So'rov

```http
GET /api/seller/shop/1001/sku-list?page=0&size=20&search=1000060000018
```

| Maydon | Tur | Majburiy | Misol | Izoh |
|---|---|---|---|---|
| `{shopId}` (yo'lda) | number | ha | `1001` | do'kon id'i |
| `page` | number | bor; majburiyligi kuzatilmadi | `0` | faqat `0` yozilgan |
| `size` | number, dona (taxmin) | bor; majburiyligi kuzatilmadi | `20` | javobda 1 qator — `size` hurmat qilinishini ko'rsatmaydi |
| `search` | string | bor; majburiyligi kuzatilmadi | `1000060000018` | yozilgan qiymat qaytgan SKU'ning `barcode` iga **teng** (1/1; kuzatuv 2). Nom, SKU kodi yoki qisman matn bo'yicha moslashishi yozilmagan; `search`siz yoki bo'sh `search=` bilan so'rov ham yozilmagan |

So'rovda `access-content-allow-origin`, `x-iid` va `cookie` **yo'q** edi — `200` (§2). Kengaytma yuboradigan to'plamdan (`accept`, `authorization`) farqi faqat sentry header'lari va `accept-language`.

#### Javob

Konvert: nomlangan maydonli obyekt — `skuList` va uchta yuqori daraja qiymati; qatorda 29 kalit. Hamma qatorning dalil kuchi — `1 namuna`; `ha (1/1)` — yagona qatorda `null`. Header'lar — §2 dagi to'plam.

**Yuqori daraja** (hech birida `null` ko'rilmagan)

| Maydon yo'li | Tur | Ma'nosi |
|---|---|---|
| `skuList` | massiv (SKU obyektlari) | sahifadagi SKU'lar; bu yozuvda 1 ta |
| `totalPages` | number | `1`; **sahifalar** soni (nomidan) — qatorlar soni emas; "Sahifalash" ga qarang |
| `invoiceSkuLimit` | boolean | `true`; ma'nosi noma'lum (nomidan: nakladnoydagi SKU soniga chegara qo'llanadimi) |
| `skuLimit` | number | `100`; ma'nosi noma'lum (nomidan: bitta nakladnoydagi SKU soni chegarasi — taxmin) |

**SKU darajasi** (`skuList[]`)

| Maydon yo'li | Tur | Nullable | Ma'nosi |
|---|---|---|---|
| `skuId` | number | kuzatilmagan | SKU id'i; 7 xonali (5.B.8 dagi SKU'larniki 8 xonali) |
| `productId` | number | kuzatilmagan | mahsulot id'i; 7 xonali |
| `image`, `imageHigh` | string (URL) | kuzatilmagan | mahsulot rasmi: `…/t_product_80_low.jpg` va `…/t_product_240_high.jpg`; rasm id'si ikkalasida bir xil |
| `productTitle` | string | kuzatilmagan | mahsulot nomi, ruscha |
| `characteristics` | string (`"146"`) | kuzatilmagan | SKU xususiyati bitta matn bo'lib; bu yerda faqat o'lcham |
| `skuTitle` | string | kuzatilmagan | SKU'ning **to'liq** kodi (`SHOPA-КОФТА-146`); oxirgi bo'lagi `characteristics` ga teng (1/1). Prefiksi — 5.B.3 dagi do'kon `skuTitle` i |
| `productFields` | null | ha (1/1) | to'ldirilgandagi turi noma'lum |
| `quantityToStock` | number, dona (taxmin) | kuzatilmagan | `0`; omborga yuborilayotgan son (nomidan) |
| `quantityActive` | number, dona (taxmin) | kuzatilmagan | `0`, `productStatus: RUN_OUT` bilan birga — sotuvdagi qoldiq (5.B.8 dagi shu nomli maydonga mos; taxmin) |
| `availableToStock` | number | kuzatilmagan | **`1000043`** — qoldiq emas (kuzatuv 3); ma'nosi noma'lum |
| `purchasePrice` | number (`60000`, niqoblangan); birligi **payload'da yo'q** | kuzatilmagan | tannarx (nomidan); asl qiymat ham besh xonali — so'm narxi kattaligi |
| `expirationDateRequired`, `identifierRequired` | boolean | kuzatilmagan | ikkalasi `false` |
| `identifierType` | null | ha (1/1) | `identifierRequired: false` bilan birga; to'ldirilgandagi turi noma'lum |
| `barcode` | **string** (13 xona) | kuzatilmagan | shtrixkod; tuzilishi — kuzatuv 1 |
| `hasAllRequiredFilters` | boolean | kuzatilmagan | `true` |
| `dimensionalGroup` | `{ group: string, title: string }` | kuzatilmagan | `{ "group": "SMALL", "title": "МГТ" }`; `title` kirillcha |
| `forecastOutOfStock` | null | ha (1/1) | to'ldirilgandagi turi bu yo'lda ko'rilmagan |
| `recommendQty`, `maxQty` | null | ha (1/1) | tavsiya etilgan va eng ko'p son (nomidan); to'ldirilgandagi turi noma'lum |
| `isSoldByFbo` | boolean | kuzatilmagan | `true` |
| `skuStatus` | string | kuzatilmagan | `ACTIVE` |
| `productStatus` | string | kuzatilmagan | `RUN_OUT` — 5.B.8 dagi `status.value` kodlaridan biri |
| `supplyDecision`, `supplyReason` | string | kuzatilmagan | `ALLOW`, `OK` — omborga yuborishga ruxsat va sababi (nomidan) |
| `inTransitQty` | number, dona (taxmin) | kuzatilmagan | `0`; yo'ldagi son (nomidan) |
| `lastSaleDate`, `daysUntilRunOut` | null | ha (1/1) | to'ldirilgandagi turi va formati noma'lum |

Enum kodlari (faqat yozilgani; boshqalari, shubhasiz, bor): `skuStatus` — `ACTIVE`; `productStatus` — `RUN_OUT`; `supplyDecision` — `ALLOW`; `supplyReason` — `OK`; `dimensionalGroup.group` — `SMALL`.

Kuzatuvlar (haqiqiy qiymatlardan):

1. **Shtrixkod tuzilishi.** `barcode` = `"1000"` + 8 xonagacha nol bilan to'ldirilgan `skuId` + bitta raqam, va bu oxirgi raqam — oldingi 12 xonaning **EAN-13 nazorat raqami** (asl qiymatda hisoblab tekshirildi, 1/1). Bu 5.B.8 kuzatuv 6 dagi tuzilmaning o'zi — u yerda `skuId` 8 xonali, nazorat raqami esa taxmin edi; endi ikki kartada, 6 SKU. Bunday shtrixkodni Uzum bergan ko'rinadi (taxmin); sotuvchining o'z shtrixkodi boshqacha bo'lishi mumkin. **Niqoblangan misolda tuzilma saqlangan**: shtrixkod to'qilgan `skuId` dan shu qoida bilan qayta hisoblangan.
2. **Qidiruv shtrixkodni topdi.** `search` qiymati qaytgan yagona qatorning `barcode` iga teng. Bu aniq tenglikmi yoki qisman moslikmi, boshqa maydonlar ham qidiriladimi — bitta qatordan bilib bo'lmaydi.
3. **`availableToStock` qoldiq emas.** Shu qatorda `quantityActive: 0`, `productStatus: RUN_OUT`, `inTransitQty: 0` — `availableToStock` esa `1000043`. Nomidan — omborga yana yuborish mumkin bo'lgan son; kattaligidan — "chegarasiz"ga yaqin sun'iy qiymat (ikkalasi ham taxmin).
4. **Faol SKU, tugagan mahsulot.** `skuStatus: ACTIVE` va `productStatus: RUN_OUT` bitta qatorda: ikki holat bir-biridan mustaqil (1/1).
5. **Bir nomli maydon kartalar orasida turli shaklda** — nomga qarab tur faraz qilib bo'lmaydi:

   | Maydon | Bu yerda | 5.B.8 da | 5.B.12 da |
   |---|---|---|---|
   | `barcode` | string | number | — |
   | `dimensionalGroup` | `{ group, title }` | string (`"СГТ"`) | — |
   | `skuTitle` | to'liq kod | faqat oxirgi bo'lak (to'liq kod — `skuFullTitle`) | to'liq kod |
   | `characteristics` | string, faqat o'lcham | string, `"L, Красный"` | massiv |
   | `forecastOutOfStock` | `null` | boolean | — |
   | `purchasePrice` | number | `null` (5/5) | — |

6. **`totalPages`** — kabinet kartalari ichida sahifalar sonini beradigan yagona javob: 5.B.8 qatorlar sonini beradi, 5.B.10–5.B.12 hech narsa.

Javob misoli (niqoblar — §2; kalitlar, tartibi, `null`lar, kodlar va miqdorlar yozilganidek):

```json
{ "skuList": [
  { "skuId": 6000001, "productId": 4100003,
    "image": "https://images.uzum.uz/<image-id>/t_product_80_low.jpg",
    "imageHigh": "https://images.uzum.uz/<image-id>/t_product_240_high.jpg",
    "productTitle": "Детская кофта", "characteristics": "146",
    "skuTitle": "SHOPA-КОФТА-146", "productFields": null,
    "quantityToStock": 0, "quantityActive": 0, "availableToStock": 1000043,
    "purchasePrice": 60000,
    "expirationDateRequired": false, "identifierRequired": false, "identifierType": null,
    "barcode": "1000060000018", "hasAllRequiredFilters": true,
    "dimensionalGroup": { "group": "SMALL", "title": "МГТ" },
    "forecastOutOfStock": null, "recommendQty": null, "isSoldByFbo": true,
    "skuStatus": "ACTIVE", "productStatus": "RUN_OUT",
    "supplyDecision": "ALLOW", "supplyReason": "OK",
    "maxQty": null, "inTransitQty": 0, "lastSaleDate": null, "daysUntilRunOut": null }
], "totalPages": 1, "invoiceSkuLimit": true, "skuLimit": 100 }
```

#### Sahifalash

`page` / `size` so'rovda; javobda `totalPages` (`1`) — **sahifalar** soni. Yozilgani: `page=0`, 1 qator, `totalPages: 1`. `page` 0 dan sanalishi (`page=0` — birinchi va, shu songa ko'ra, oxirgi sahifa) — taxmin. `totalPages` qidiruv natijasining sahifalarimi yoki do'konning hamma SKU'lariniki — bitta qatorli javob ajratmaydi. `page ≥ totalPages` nima qaytarishi yozilmagan; qatorlarning jami soni hech qayerda yo'q.

**Kuzatilgan xatolar:** kuzatilmagan (bitta `200`).

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat yo'q. Kengaytma bu yo'lni `skus.list` lookup'i bilan chaqiradi ([`skusList.ts`](../extension/src/tools/skusList.ts); ENDPOINTS.md 13.6). Kodning o'z qarorlari — dalil emas:

- **`SKU_READ` ruxsat kodi** so'rovdan oldin mahalliy tekshiriladi — nomidan o'qilgan faraz (bunday kod sessiyada bor, 5.B.1).
- **`search` ixtiyoriy.** Berilsa — chetidagi bo'shliqlar olinadi, ≤ 100 belgi, boshqaruv belgisiz (chegaralar bizniki). Berilmasa `search` parametri **umuman yuborilmaydi** — bunday so'rov yozib olinmagan, lookup buni har natijaning sarlavhasida aytadi. Bo'sh `search=` ham yozilmagan, shuning uchun yuborilmaydi.
- **Chegaralar bizniki:** `size` 1…100 (standart 20 — yozib olingan qiymat), `page` 0…100 000.
- **Sahifa o'rni `totalPages` ga nisbatan aytiladi:** "oxirgi sahifa" — faqat javobning o'z soni shuni desa, sahifa uzunligidan emas. `page` 0 dan sanalishi — faraz. `totalPages` yo'q yoki butun son bo'lmasa, lookup jami sonsiz javobning so'zlariga qaytadi.
- **Header'lar:** faqat `accept` va `authorization`, cookie'siz.
- `image` chiqadi (mahsulot kartochkasining rasmi, 5.B.8 dagi `previewImg` kabi); `imageHigh` — o'sha rasmning kattasi — chiqmaydi.
- Natija ko'rinishi va legendasi — texnik spetsifikatsiya 14.6; legendada kuzatuv 1–4 dalil kuchi bilan.

#### Ochiq savollar

- `search` qanday moslashadi (aniq shtrixkodmi, qisman matnmi; nom va SKU kodi ham qidiriladimi); `search`siz so'rov nima qaytaradi va unda `totalPages` qancha.
- `availableToStock` nima (`1000043`); `quantityToStock`, `inTransitQty`, `maxQty`, `recommendQty` ning to'ldirilgan qiymatlari va ma'nosi.
- `supplyDecision` / `supplyReason` ning boshqa qiymatlari (taqiq qanday ko'rinadi); `skuStatus` va `productStatus` ning to'liq to'plami.
- `invoiceSkuLimit` va `skuLimit` nimani cheklaydi.
- `purchasePrice` birligi; `lastSaleDate` formati; `daysUntilRunOut` birligi; `productFields`, `identifierType` shakli.
- Sotuvchining o'z shtrixkodi bo'lgan SKU qanday ko'rinadi (kuzatuv 1 dagi tuzilma hamma SKU'da bo'lmasligi mumkin).
- `size` ning yuqori chegarasi; `page=1`; tartib (bitta qator ko'rsatmaydi).
- Boshqa do'kon (`1002`) va `SKU_READ` yo'q xodim hisobi uchun javob.

---

### 5.B.14 `GET /api/seller/reports/barcodes/types`

**Guruh:** Chop etiladigan hujjatlar · **Maqsad:** shtrixkod stikerini chop etish uchun yorliq o'lchamlari ro'yxati.

**API:** kabinet (ichki); stikerlar sahifasi chaqiradi (sentry tranzaksiya nomi `products-stickers`, §2). Yo'lda do'kon yo'q.

**Dalil qanchalik kuchli:** **1 namuna** — 2026-11-17 11:58 GMT, `200`; javob to'liq (5 element).

**So'rov:** parametr yo'q, tana yo'q. `access-content-allow-origin`, `x-iid` va `cookie` yo'q (§2).

#### Javob

Konvert: nomlangan maydon `barcodeLabelTypes`, 5 element `{ id: number, title: string, printType: string, length: number, width: number }`; hech birida `null` ko'rilmagan. Hammasi `1 namuna`. Niqob yo'q — javobda shaxsiy yoki do'konga xos qiymat yo'q, yozilganidek.

| `id` | `title` | `printType` | `length` | `width` |
|---|---|---|---|---|
| 5 | `43 х 25` | `ThermalPrinter` | 43 | 25 |
| 4 | `70 x 37` | `A4` | 70 | 37 |
| 3 | `48.5 x 25.4` | `A4` | 48.5 | 25.4 |
| 2 | `38 x 21.2` | `A4` | 38 | 21.2 |
| 1 | `30 x 20` | `ThermalPrinter` | 30 | 20 |

Kuzatuvlar:

- **Tartib:** `id` kamayish tartibida (5/5).
- **`title` = `length` + ajratgich + `width`** (5/5): ikki son — yorliqning ikki tomoni. Yozuvda butun sonlar ham kasr nuqtasi bilan (`43.0`, `25.0`), `title` da esa kasrsiz.
- **Birlik aytilmagan**; kattaligidan millimetr (taxmin — stiker o'lchamlari).
- **Ajratgich bir xil emas:** `id: 5` da kirill `х` (U+0445), qolgan to'rttasida lotin `x` (U+0078). `title` ni aniq matn bilan solishtirib bo'lmaydi.
- **`printType`** — ikki qiymat: `ThermalPrinter` (2), `A4` (3); `A4` — bir varaqda ko'p yorliqli qog'oz (taxmin).

```json
{ "barcodeLabelTypes": [
  { "id": 5, "title": "43 х 25", "printType": "ThermalPrinter", "length": 43.0, "width": 25.0 },
  { "id": 3, "title": "48.5 x 25.4", "printType": "A4", "length": 48.5, "width": 25.4 },
  "…"
] }
```

**Sahifalash:** yo'q · **Kuzatilgan xatolar:** kuzatilmagan

#### Kod/ENDPOINTS.md bilan farq

Ziddiyat yo'q. Kengaytma bu yo'lni `barcodes.types` lookup'i bilan chaqiradi ([`barcodesTypes.ts`](../extension/src/tools/barcodesTypes.ts); ENDPOINTS.md 13.6): account marshruti — do'kon va ruxsat kodi tekshirilmaydi, faqat kirgan sessiya (`PRINTING_READ` kodi sessiyada bor, 5.B.1, lekin u do'konga beriladi, bu yo'l esa do'kon nomlamaydi); `barcodeLabelTypes` massivini kutadi. Lookup faqat o'lchamlarni o'qiydi: stiker yaratilmaydi va chop etilmaydi.

#### Ochiq savollar

- Stikerning o'zini yaratadigan so'rov (shu sahifaning keyingi qadami) yozilmagan: unga `id` va SKU qanday berilishi noma'lum.
- `length` / `width` birligi; ro'yxat hisobga yoki do'konga bog'liqmi.
- `printType` ning boshqa qiymatlari.

## 6. Ochiq savollar

Kartalararo (umumiy) savollar:

- Kabinet tokeni OpenAPI'da ishlaydimi va aksincha.
- Token muddati: `exp: 2600000` ma'nosi (5.B.1); pastki chegara ma'lum — bitta token 3 soat 10 daqiqa oralig'idagi so'rovlarda ishlagan (2026-11-17, §2).
- Rate limit: header'lar kuzatilmadi, chegara noma'lum.
- Xato tanalari: `401` / `403` / `429` ko'rilmagan.
- `accept-language` o'zgarsa matn maydonlari (`category`, `status.title`, …) tili. Bilvosita dalil: nakladnoy matnlari kabinetda ruscha, OpenAPI egizagi namunasida o'zbekcha (5.B.10, kuzatuv 6) — lekin OpenAPI so'rovining `accept-language` i yozilmagan, sabab til header'i ekani isbotlanmagan.
- Cookie umuman kerakmi (muddati o'tgan JWT bilan 200 kelgan — §2).
- seller.uzum.uz dan boshqa origin CORS'dan o'tadimi (server origin'ni aks ettirishi mumkin).
- Ikki backend servis (`Build` / `Build-Number`) taxmini tekshirilmagan.
- `x-iid` qaysi so'rovlarda yuboriladi va qayerda majburiy: 2026-11-16 dagi `shop/`, `invoice`, `return` da va 2026-11-17 dagi `product-reviews`, `barcodes/types`, `sku-list` da yo'q edi, `200` keldi (5.B.3, 5.B.10–5.B.14, §2).
- `access-content-allow-origin: *` ni kabinet qaysi so'rovlarga qo'shadi va server qayerda talab qiladi: bitta yuklanishda `shop/` da bor, `invoice` da yo'q, ikkalasi `200`; `return`, `sku-list` va `barcodes/types` da ham yo'q, `200`; `product-reviews` da bor (§2).
