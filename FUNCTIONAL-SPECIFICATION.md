# Savdo Copilot — Funksional spetsifikatsiya

**Versiya:** 2.4.0
**Hujjat sanasi:** 2026-08-16
**Maqsad:** Mahsulot oddiy foydalanuvchi — Uzum Market sotuvchisi — nuqtai nazaridan
nima qilishini ifodalash. Bu yerda texnik yechim yo'q; u
[TECHNICAL-SPECIFICATION.md](./TECHNICAL-SPECIFICATION.md) da.

---

## 1. Mahsulot nima

Savdo Copilot — Uzum Market'da savdo qiladigan sotuvchi uchun boshqaruv paneli.
U sotuvchining Uzum'dagi barcha ma'lumotini — sotuvlar, xarajatlar, mahsulotlar,
qoldiqlar, buyurtmalar, nakladnoylar — bitta joyga yig'adi, ular ustida hisob-kitob
qiladi va Uzum'ga qaytarib yozish imkonini beradi (narx o'zgartirish, qoldiq
yangilash, buyurtma tasdiqlash, etiketka chiqarish).

### Kimga mo'ljallangan

Uzum Seller Cabinet'ga kirish huquqi va API tokeni bor sotuvchi. Bir kishi bir
nechta do'kon boshqarayotgan bo'lsa, hammasi bitta panelda ko'rinadi.

### Nima uchun kerak

Uzum'ning o'z kabineti bitta do'konni, bitta ekranni va bitta davrni ko'rsatadi.
Bu mahsulot uchta narsani qo'shadi:

1. **Konsolidatsiya** — bir nechta do'kon bitta ko'rinishda
2. **Tarix** — Uzum sizga faqat hozirgi holatni beradi; bu panel o'qiganini
   saqlab qoladi va vaqt bo'yicha taqqoslash imkonini beradi
3. **Hisob-kitob** — sof foyda, birlik iqtisodiyoti, qaytarish foizi, ROI —
   Uzum tayyor bermaydigan raqamlar

### Asosiy va'da

> **Ekrandagi har bir raqam qaysi API chaqiruvidan kelganini ko'rsatib turadi.**

Panel hech qanday raqamni "o'ylab topmaydi". Agar Uzum bir ko'rsatkichni
bermasa, panel uni ko'rsatmaydi — taxminiy qiymat bilan to'ldirmaydi. Har bir
KPI ostida uning manbasi yozilgan (masalan `GET /v1/finance/orders`).

---

## 2. Ishni boshlash

### 2.1. Ulanish

Panel ochilganda foydalanuvchi **Sozlamalar → API** bo'limiga o'tadi va Uzum
Seller Cabinet'dan olgan **tokenini** kiritadi. Boshqa hech narsa talab
qilinmaydi — ro'yxatdan o'tish yo'q, parol yo'q, server hisobi yo'q.

Token kiritilgach panel darhol tekshiradi: do'konlar ro'yxatini so'raydi.

| Natija | Foydalanuvchi nima ko'radi |
|---|---|
| Muvaffaqiyat | Do'konlar ro'yxati, panel ochiladi |
| Token noto'g'ri | "Avtorizatsiya rad etildi" — token qayta kiritiladi |
| Tarmoq yo'q | "Ulanib bo'lmadi" — qayta urinish tugmasi |

Token faqat foydalanuvchining o'z brauzerida saqlanadi. U hech qanday serverga
yuborilmaydi (Uzum'ning o'zidan tashqari).

### 2.2. Birinchi sinxronizatsiya

Ulangandan keyin panel ma'lumot yig'a boshlaydi. Birinchi marta bu **oxirgi 90
kunni** oladi va oyma-oy, yangisidan eskisiga qarab yuklaydi.

Foydalanuvchi kutib o'tirmaydi: yuklangan qismi darhol ko'rinadi, qolgani fonda
davom etadi. Yuqori panelda jarayon ko'rsatkichi turadi va istalgan payt
to'xtatish mumkin.

Undan eskiroq tarix keyingi sinxronizatsiyalarda asta-sekin qo'shiladi, yoki
foydalanuvchi **Sozlamalar → Ma'lumotlar** da "tarixni davom ettirish" tugmasini
bosib tezlashtiradi. Eng chuqur chegara — **2 yil**.

---

## 3. Umumiy boshqaruv elementlari

Bu uchtasi har bir ekranda, yuqori panelda turadi va butun panelga ta'sir qiladi.

### 3.1. Do'kon tanlagich

Bitta do'kon, bir nechtasi yoki hammasi tanlanishi mumkin. Tanlov o'zgarganda
barcha ekranlar shu tanlovga moslashadi.

### 3.2. Davr tanlagich

Tayyor variantlar (bugun, 7 kun, 30 kun, joriy oy, joriy yil) yoki qo'lda
kiritilgan oraliq.

**Muhim xatti-harakat:** allaqachon yuklangan davr tanlansa — **tarmoqqa umuman
chiqilmaydi**, javob bir zumda keladi. Yangi davr tanlansa, faqat yetishmayotgan
qismi so'raladi.

### 3.3. Sinxronizatsiya tugmasi

"Hozir borib qara" degani. Bosilganda:
- Ekrandagi ma'lumot yangilanadi
- Yaqin 14 kunlik sotuvlar qayta o'qiladi (ular hali o'zgarishi mumkin —
  quyida 6-bo'limga qarang)
- Mahsulot, qoldiq va nakladnoy ro'yxatlari to'liq qayta olinadi

Jarayon davomida nima yuklanayotgani ko'rinib turadi. Ikkinchi marta bosilsa
yangi jarayon boshlanmaydi — birinchisiga qo'shiladi.

---

## 4. Ekranlar

### 4.1. Umumiy (Overview)

Boshlang'ich ekran. Tanlangan davr va do'konlar bo'yicha umumiy manzara.

| Blok | Nima ko'rsatadi |
|---|---|
| KPI qatori | Aylanma, sotilgan birlik, sof foyda, komissiya, logistika, bekor qilish foizi, qaytarish foizi |
| Daromad grafigi | Vaqt bo'yicha aylanma va foyda. Davr uzunligiga qarab soat/kun/hafta/oy avtomatik tanlanadi |
| Birlik iqtisodiyoti | Bitta sotuvning tarkibi: narx → komissiya → logistika → tannarx → sof foyda |
| Talab issiqlik xaritasi | Hafta kuni × soat kesimida sotuvlar zichligi — qachon savdo jonlanishini ko'rsatadi |
| Portfel reytingi | Mahsulotlarni holati bo'yicha guruhlash. Bosilsa Mahsulotlar ekraniga filtr bilan o'tadi |
| Jonli lenta | Oxirgi sotuvlar oqimi |

"Hisoblash usuli" tugmasi har bir KPI qanday hisoblangani va qaysi endpointdan
kelganini ochib beradi.

### 4.2. Mahsulotlar (Products)

Katalogning ish ko'rsatkichlari bilan jadvali.

Ustunlar: nom, holat, narx, tannarx, sotilgan, qoldiq, qaytarish %, ROI,
konversiya, ko'rishlar, reyting.

Imkoniyatlar:
- Nom yoki artikul bo'yicha qidiruv
- Holat bo'yicha filtr (sotuvda, tugagan, arxiv, bloklangan)
- Istalgan ustun bo'yicha saralash
- CSV ga eksport
- Mahsulot ustiga bosilsa — **tafsilot sahifasi**: SKU'lar ro'yxati, har birining
  narxi, qoldig'i, shtrix-kodi, va shu SKU bo'yicha sotuv tarixi

**Yozish amali:** narxni o'zgartirish. Bir yoki bir nechta SKU tanlanadi, yangi
narx kiritiladi, tasdiqlanadi — Uzum'ga yoziladi.

### 4.3. Ombor (Inventory)

SKU kesimidagi qoldiqlar.

KPI: jami SKU soni, umumiy qoldiq, qoldig'i nol bo'lganlar soni, manfiy
qoldiqlar (rezerv qoldiqdan oshgan), FBS'ga ulanganlar soni.

Ustunlar: SKU nomi, shtrix-kod, xususiyatlar, mavjud, sotilgan, qaytarilgan, FBS
qoldig'i.

**Yozish amallari:**
- **Qoldiqni yangilash** — FBS/DBS qoldiqlarini o'zgartirish
- **Etiketka chop etish** — tanlangan SKU'lar uchun shtrix-kod etiketkalari PDF

### 4.4. Operatsiyalar (Operations)

Buyurtmalar. Ikki xil ko'rinish yorliqlar orqali:

**Moliyaviy buyurtmalar** — statuslar bo'yicha yorliqlar (`TO_WITHDRAW`,
`PROCESSING`, `CANCELED`). Har bir qatorda: sana, buyurtma raqami, SKU, soni,
sotuv narxi, tannarx, komissiya, logistika, sof foyda, status.

**FBS · DBS** — yig'ish va yetkazish jarayonidagi buyurtmalar. Har bir qatorda
qabul qilish va yetkazish muddatlari ko'rinadi.

**Yozish amallari:**
| Amal | Nima qiladi |
|---|---|
| Tasdiqlash | Buyurtmani yig'ishga qabul qilish |
| Bekor qilish | Sabab tanlab bekor qilish |
| Yetkazishga uzatish | DBS buyurtmani `DELIVERING` ga o'tkazish |
| Topshirilganini tasdiqlash | DBS buyurtmani yopish |
| Qaytarish rasmiylashtirish | Topshirilgan DBS buyurtma bo'yicha |
| Identifikator biriktirish | IMEI, seriya raqami kabi |
| Etiketka chop etish | Buyurtma yorlig'i PDF |

Bir nechta buyurtmani belgilab, ular ustida **birdaniga** amal bajarish mumkin.
Jarayon ko'rsatkichi haqiqiy bajarilgan so'rovlarni sanaydi.

### 4.5. Nakladnoylar (Invoices)

Uch yorliq:

**FBO yetkazib berish** — Uzum omboriga topshirilgan tovarlar. Eng muhim ustun —
**topshirilgan va qabul qilingan miqdor farqi** (nesortitsa). KPI qatorida
umumiy farq ko'rinadi.

**Qaytarishlar** — Uzum omboridan sotuvchiga qaytayotgan tovarlar (brak, arxiv).

**FBS nakladnoylari** — yig'ilgan buyurtmalarni qabul punktiga topshirish uchun
jo'natmalar.

**Yozish amallari:** nakladnoy yaratish, bekor qilish, tarkibini o'zgartirish,
vaqt oynasini almashtirish, yetkazib berish va qabul qilish aktlarini PDF chop
etish.

> ⚠️ **Cheklov:** hozircha FBS nakladnoy yaratish to'liq ishlamaydi — qabul
> punkti va vaqt oynasi ro'yxatlarini olib keladigan ikkita endpoint hali
> ulanmagan. Batafsil: [ENDPOINTS.md](./frontend/src/services/uzum/ENDPOINTS.md),
> 11-bo'lim.

### 4.6. Moliya (Finance)

Uch yorliq:

**Buyurtma pozitsiyalari** — har bir sotuv qatori to'liq moliyaviy tafsiloti bilan.

**Xarajatlar** — logistika, marketing, jarimalar va boshqa to'lovlar. Kategoriya
bo'yicha guruhlangan.

**Xulosa** — davr bo'yicha yig'ma: aylanma, komissiya, logistika, boshqa
xarajatlar, sof foyda.

### 4.7. Sozlamalar (Settings)

| Bo'lim | Nima sozlanadi |
|---|---|
| **API** | Uzum tokeni, asosiy URL, ulanishni tekshirish |
| **AI** | Sun'iy intellekt provayderi, model, kalit (ixtiyoriy) |
| **Ma'lumotlar** | Yangilik oynasi, saqlangan hajm, do'kon bo'yicha qamrov, tarixni davom ettirish, o'chirish |
| **Umumiy** | Til (o'zbek/rus/ingliz), mavzu (yorug'/qorong'i), raqam formati |
| **Klaviatura** | Tezkor tugmalar ro'yxati |

**Ma'lumotlar** bo'limi alohida ahamiyatli: u har bir do'kon uchun **qaysi
davrlar yuklangani** ni chizma ko'rinishida ko'rsatadi. Foydalanuvchi qayerda
teshik borligini ko'radi va uni to'ldirishni so'rashi mumkin.

---

## 5. Qo'shimcha imkoniyatlar

### AI Copilot

Yon panelda ochiladigan suhbat oynasi. Foydalanuvchi o'z ma'lumoti haqida oddiy
tilda savol beradi — "shu oy qaysi mahsulot eng ko'p foyda keltirdi?", "qaytarish
foizi nega oshdi?" — va javob ekrandagi davr va do'konlar bo'yicha hisoblangan
haqiqiy raqamlardan tuziladi.

AI kaliti kiritilmagan bo'lsa, panel ushbu funksiyasiz to'liq ishlaydi.

### Buyruqlar palitrasi

`Ctrl/Cmd + K` — ekranlar orasida o'tish, sinxronizatsiya boshlash, do'kon yoki
davr almashtirish, sozlamalarni ochish — hammasi klaviaturadan.

### Bildirishnomalar

Qo'ng'iroq belgisi ostida: bajarilgan yozish amallari, sinxronizatsiya natijalari,
xatolar. Har biri vaqt tamg'asi bilan.

### Til va mavzu

Uch til: o'zbek, rus, ingliz. Yorug' va qorong'i mavzu. Tanlov saqlanadi.

### Mobil ko'rinish

Panel telefonda ham ishlaydi: yon menyu tortma bo'ladi, pastda navigatsiya
paneli chiqadi, jadvallar gorizontal siljiydi.

---

## 6. Ma'lumot qanday "tirik" bo'ladi

Bu bo'lim foydalanuvchi kutishi kerak bo'lgan xatti-harakatni tushuntiradi.

### Ikki turdagi ma'lumot

**O'zgarmas (sotuv amaliyotlari).** Tovar sotildi, narxi shu edi, komissiya
olindi — bu fakt o'zgarmaydi. Panel uni bir marta o'qiydi va abadiy saqlaydi.
O'sha davr qayta so'ralganda tarmoqqa chiqilmaydi.

**O'zgaruvchan (hozirgi holat).** Narx, qoldiq, tavsif, nakladnoy statusi — bular
istalgan payt o'zgarishi mumkin. Panel ularni har sinxronizatsiyada to'liq qayta
o'qiydi.

### 14 kunlik "cho'kish" davri

Yangi sotuv darhol yakuniy bo'lmaydi: buyurtma avval `PROCESSING` bo'ladi, keyin
`TO_WITHDRAW` yoki `CANCELED` ga o'tadi; qaytarishlar yanada kechroq keladi.

Shuning uchun panel **oxirgi 14 kunni har sinxronizatsiyada qayta o'qiydi**,
undan eskisini esa qayta so'ramaydi. Foydalanuvchi uchun bu shuni anglatadi:
kechagi raqam bir hafta ichida biroz o'zgarishi mumkin, bir oylik raqam esa yo'q.

**Ma'lumotlar** bo'limida qaysi sana chegarasigacha ma'lumot "yakuniy" ekani
ko'rsatib turiladi.

### Internetsiz

Panel yuklangan ma'lumot bilan internetsiz ham ishlaydi: barcha ekranlar
ochiladi, grafiklar chiziladi, qidiruv va filtr ishlaydi. Faqat yangi ma'lumot
olish va yozish amallari ishlamaydi — va bu aniq aytiladi.

### So'rovlar tezligi

Uzum API soatiga cheklangan sonda so'rov qabul qiladi. Panel bunga moslashgan:
so'rovlarni ketma-ket, o'lchangan tezlikda yuboradi. Chegaraga yaqinlashilsa
foydalanuvchi ogohlantiriladi.

---

## 7. Hozirgi cheklovlar

Ochiq aytilishi kerak bo'lganlar:

| Cheklov | Tafsilot |
|---|---|
| **Server tomoni yo'q** | Panel to'g'ridan-to'g'ri Uzum API bilan ishlaydi. `backend/` papkasi hozircha bo'sh shablon. Ya'ni: ma'lumot faqat foydalanuvchi brauzerida, jamoaviy ishlash va serverdagi zaxira yo'q |
| **Bir sahifa = bir brauzer** | Ma'lumot brauzer xotirasida. Boshqa kompyuterda ochilsa, qaytadan yuklanadi |
| **FBS nakladnoy yaratish** | Qabul punkti va vaqt oynasi endpointlari ulanmagan |
| **Tarix chuqurligi** | Eng ko'pi 2 yil |
| **Bir so'rovdagi hajm** | Juda katta davrlarda API o'z chegarasini qo'yadi; panel buni ko'rsatadi va davrni bo'lib o'qiydi |
| **O'zgarish tarixi** | Narx o'zgarishlari faqat panel o'rnatilgan kundan boshlab kuzatiladi — Uzum eski narxlarni bermaydi |

---

## 8. Muvaffaqiyat mezonlari

Foydalanuvchi uchun mahsulot ishlayapti deyish uchun:

1. Token kiritilgandan keyin **1 daqiqa ichida** birinchi raqamlar ekranda bo'lishi
2. Yuklangan davrni qayta tanlash **tarmoqsiz, bir zumda** javob berishi
3. Ekrandagi har bir raqamning manbasi ko'rsatilishi
4. Yozish amali natijasi (muvaffaqiyat yoki xato sababi) darhol aytilishi
5. Sinxronizatsiya yarim yo'lda to'xtatilsa, yuklangani saqlanib qolishi
6. Internetsiz ham yuklangan ma'lumot to'liq ko'rinishi
