# Savdo Copilot — Funksional spetsifikatsiya

**Versiya:** 3.1.0
**Hujjat sanasi:** 2026-11-13
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

### Ikki shakl

Mahsulot ikki ko'rinishda mavjud:

| | Nima | Qayerda |
|---|---|---|
| **Panel (sayt)** | Yuqorida va keyingi bo'limlarda tasvirlangan to'liq boshqaruv paneli | Alohida sayt |
| **Brauzer kengaytmasi** | Faqat AI Copilot, Uzum kabinetining o'zida ochiladi va o'sha do'konning mahsulot ro'yxatini o'qiydi | `seller.uzum.uz` ustida, Chrome, Edge yoki Firefox'da |

Bu hujjatning 2–4-bo'limlari va 6-bo'limi panelga tegishli. Kengaytma — 5-bo'limdagi
"Brauzer kengaytmasi"; u nimani qila olishi va qila olmasligi o'sha yerda va 7-bo'limda.

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
> ulanmagan. Batafsil: [ENDPOINTS.md](../frontend/src/services/uzum/ENDPOINTS.md),
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
| **AI** | To'qqizta provayderning har biri — o'z kaliti, modeli va parametrlari bilan; qaysi biri ishlatilishini tanlash, har birini alohida tekshirish, bugungi token sarfi (Gemini uchun — qolgan limit ko'rsatkichi ham) |
| **Ma'lumotlar** | Yangilik oynasi, saqlangan hajm, do'kon bo'yicha qamrov, tarixni davom ettirish, o'chirish |
| **Umumiy** | Til (o'zbek/rus/ingliz), mavzu (yorug'/qorong'i), raqam formati |
| **Klaviatura** | Tezkor tugmalar ro'yxati |

**Ma'lumotlar** bo'limi alohida ahamiyatli: u har bir do'kon uchun **qaysi
davrlar yuklangani** ni chizma ko'rinishida ko'rsatadi. Foydalanuvchi qayerda
teshik borligini ko'radi va uni to'ldirishni so'rashi mumkin.

**AI** bo'limi to'qqizta provayderning — OpenAI, Claude, Gemini, OpenRouter,
DeepSeek, Mistral, Grok, Ollama va o'zi ko'rsatgan boshqa (`custom`)
provayderning — kartochkalar to'plami. Kartochkaga bosish uni faqat pastda
ochib ko'rsatadi — provayderni ishlatishga **o'tkazmaydi**. Har bir kartada
o'sha provayderning butunlay o'z sozlamasi bor: kalit, manzil (aksariyat
provayderlarda o'zgartirib bo'lmaydi), model ("Modellarni yuklash" tugmasi
bilan kalit ko'rgan ro'yxatdan tanlab yoki qo'lda kiritib), so'rov kutish
muddati, qo'llab-quvvatlansa — harorat va maksimal token (odatda "Avto" —
ilova shu model uchun tanlagan muvozanatli byudjet: javob sifati yetarli
bo'lsin, limit va tokenlar bekorga ketmasin; sotuvchi slayder bilan aniq son
tanlashi, hatto modelning o'z maksimumigacha ko'tarishi, so'ng "Avto"ga
qaytishi mumkin; karta haqiqatan yuboriladigan sonni ko'rsatadi), va o'sha
provayderga xos qo'shimcha parametrlar (masalan, OpenAI'ning tashkilot va
loyiha identifikatori, Claude'ning API versiyasi, Gemini'ning fikrlash
chuqurligi, DeepSeek'ning fikrlash rejimi) — har biri qaysi so'rov maydoniga
tushishi bilan birga yoziladi. Bir provayderning kartasida kiritilgan hech
narsa boshqasining kartasiga o'tmaydi va uni bosib yozmaydi.

Har bir kartada ikkita tugma bor: **"Faollashtirish"** — faqat karta to'liq
sozlangandan keyin bosiladigan bo'ladi, bosilsa Copilot shu provayderga
o'tadi — va **ulanishni tekshirish**, u aynan shu kartaning o'z sozlamasi
bilan haqiqiy so'rov yuboradi, karta hozir faol yoki emasligidan qat'i
nazar.

Har bir kartada, pastroqda, **shu provayderning bugungi token sarfi**
paneli bor: nechta so'rov ketgani, kiruvchi/keshlangan/chiquvchi/fikrlash
tokenlari (provayder bu raqamni aytmagan bo'lsa, hech qachon nolga
aylanmaydi — "aytilmagan" deb yoziladi), bir nechta model ishlatilgan
bo'lsa — model bo'yicha taqsimot, oxirgi javob bergan so'rov vaqti va —
narxi ilovaga ma'lum modellarda — taxminiy xarajat (dollarda, ilova ichidagi
narx ro'yxatidan).

Gemini kartasida bundan tashqari alohida "Qolgan limit" paneli ham bor:
har bir model nomi ostida — daqiqadagi so'rov, daqiqadagi token va kunlik
so'rov sonidan eng tor joyi — qisqa chiziq, tanlangan model uchun esa
uchala o'lchov alohida-alohida chiziq, son va qachon tiklanishi bilan
chiqadi. Bu raqamlar faqat **shu brauzerda** yuborilgan so'rovlardan
hisoblanadi — boshqa qurilma, boshqa brauzer yoki bir loyihaning boshqa
kaliti ko'rinmaydi, shuning uchun ular "qolganining yuqori chegarasi", aniq
qoldiq emas — va Google AI Studio'ning bepul tarif jadvalidan olingan,
manba va sana panel ostida yozilgan. Bu ko'rsatkich faqat Gemini'ning
katalogdagi modellarida bor — boshqa provayderlarda va Gemini'ning erkin
matn bilan kiritiladigan modelida yo'q, chunki ularning nashr qilingan
limiti yo'q. Bugungi token sarfi paneli esa — Gemini bilan bir qatorda —
**har bir provayderda** bor.

---

## 5. Qo'shimcha imkoniyatlar

### AI Copilot

Yon panelda ochiladigan suhbat oynasi. Foydalanuvchi o'z ma'lumoti haqida oddiy
tilda savol beradi — "shu oy qaysi mahsulot eng ko'p foyda keltirdi?", "qaytarish
foizi nega oshdi?" — va javob ekrandagi davr va do'konlar bo'yicha hisoblangan
haqiqiy raqamlardan tuziladi.

**Suhbat qanday kechadi.** Model suhbat boshida faqat bitta qisqa ko'rsatma
oladi: u kimligi, qaysi mavzular chegarasida gaplashishi va hech qanday
ma'lumotga hali ega emasligi. Kerak bo'lsa o'zi so'raydi — avval qaysi
so'rovlarni yubora olishi va ularni qanday chaqirishi haqidagi ro'yxatni, keyin
javobni ekranda qanday chizish mumkinligi haqidagi qo'llanmani. So'rov
yuborilganda panel avval shu mashinadagi arxivga qaraydi; davr saqlanmagan
bo'lsa, faqat yetishmagan qismini Uzum API'dan olib, saqlab, keyin javob
beradi. Model bir savol ustida bir necha marta o'qishi mumkin: birinchi natija
ikkinchi savolni tug'dirsa, yana so'raydi. Bir suhbatda ochilgan ro'yxat va
qo'llanma keyingi savollarda ham modelda qoladi — qayta so'ralmaydi.

**Raqamlar qayerdan keladi.** Model ma'lumotning o'zini oladi va o'zi tahlil
qiladi. Ikki xil o'qish bor:
- **Tayyor hisoblangan jadvallar** — davr yakuni, ikki davrni taqqoslash, kun
  yoki hafta kesimidagi sotuv (bir nechta mahsulotni yonma-yon ham), eng ko'p
  sotilgan mahsulotlar reytingi, soat va hafta kuni bo'yicha sotuv. Bu
  hisob-kitob panelning o'zida har bir qator ustida bajariladi.
- **Xom qatorlar** — har bir sotuv, xarajat, buyurtma yoki SKU. Tayyor jadval
  javob bermaydigan chuqurroq savol uchun (bitta buyurtmada nechta tovar,
  qaysi o'lcham ko'proq qaytariladi va hokazo).

Model shu ma'lumotdan kerakli raqamni hisoblaydi va o'zi hisoblagan raqamni
qanday olganini ko'rsatadi — masalan, hisob-kitob zanjiri bilan. Ma'lumotda
bo'lmagan raqamni o'ylab topmaydi: yetishmasa yana so'raydi yoki
"ma'lumot yo'q" deydi. Bashorat qilmaydi.

Javob yozilishi bilan ekranda paydo bo'la boshlaydi: model gapni tugatishini
kutmasdan, yozilayotgan jumla kursor bilan ko'rinib turadi va jumla tugagach
o'z o'rnida to'liq blokka aylanadi. Jadval, chizma va ko'rsatkich bloklari esa
faqat butun holda chiqadi — yarim jadval kichik jadval emas, noto'g'ri jadval.

Suhbatda o'qilgan har bir so'rov ko'rinib turadi — qaysi davr, nechta qator —
shuning uchun javobdagi raqamni qayerdan kelganini tekshirsa bo'ladi. Javob
shakli savolga qarab o'zgaradi: qisqa savolga bir jumla, "oxirgi 7 kun qanday
o'tdi" savoliga topilma va chiziqli grafik, "nega" savoliga hisob-kitob
zanjiri, "nima qilay" savoliga esa dalil va tugma. Chizmalarni ham, jadval yoki
ko'rsatkich blokini ham model o'zi tanlaydi. Bloklardagi raqamlar ekrandagi
boshqa raqamlar kabi formatlanadi (so'm, foiz, guruhlash). Model noto'g'ri
shakldagi blok yuborsa, u ko'rsatilmaydi va modelga sababi aytilib, bir marta
qayta yuborish so'raladi.

Bitta mahsulot haqidagi javob **mahsulot kartasi** bo'lib chiqadi: rasmi, nomi,
holati va uni tavsiflovchi bir nechta raqam. Ikki narsa — ikki mahsulot yoki ikki
davr — **taqqoslash** blokida yonma-yon ko'rsatiladi; orasidagi farqni ilova
hisoblaydi va faqat model qaysi yo'nalish yaxshi ekanini aytgandagina yashil
yoki qizilga bo'yaydi (sotuv o'ssa yaxshi, qaytarish o'ssa yomon).

**Copilot qayta so'raydi.** Savolni bir necha xil tushunish mumkin bo'lsa va
javob shunga qarab o'zgarsa — bir nomga uchta mahsulot mos kelsa, davr
aytilmagan bo'lib xulosa unga bog'liq bo'lsa — Copilot taxmin qilmaydi, savol
beradi. Bir ma'nosi aniq ko'rinib turgan savolda so'ramaydi: javob beradi va
qaysi ma'noda tushunganini aytadi.

Savol **modal forma** bo'lib chiqadi: u yozish maydonining o'rnini egallaydi va
fokusni o'ziga oladi. Forma ochiq turganda boshqa xabar yozib bo'lmaydi; suhbat
tarixi yuqorida o'qiladigan va aylantiriladigan holda qoladi. Formadan uch yo'l
bilan chiqiladi:

| Yo'l | Nima bo'ladi |
|---|---|
| Variantni bosish (2–4 ta) | Variant matni sotuvchining xabari bo'lib yuboriladi, Copilot dastlabki savolga shu yo'ldan javob beradi |
| O'z javobini yozish | Formaning o'zidagi maydonga yoziladi va yuboriladi — bu ham to'liq javob |
| Savolni bekor qilish | Forma yopiladi, yozish maydoni qaytadi. Suhbatda "Savol bekor qilindi" deb yoziladi va Copilot uni qayta so'ramaydi |

- Model bitta variantni **Tavsiya** deb belgilashi mumkin; fokus ochilganda
  o'sha variantda turadi.
- Klaviatura: strelkalar variantlar orasida yuradi va oxirgisidan pastga
  maydonga o'tadi; 1–4 raqami variantni tanlaydi; harf terila boshlasa, u
  maydonga yoziladi; Tab formaning ichida aylanadi; **Esc** savolni bekor
  qiladi (panelni yopmaydi).
- Forma chiqqan paytda sotuvchi yozish maydonida nimadir yozayotgan bo'lsa,
  yozgani formadagi maydonga o'tadi va kursor shu yerda qoladi — yozilayotgan
  gap yo'qolmaydi va undagi raqam variant tanlovi deb o'qilmaydi.
- Forma paydo bo'lgan ondagi tasodifiy bosish hisobga olinmaydi (soniyaning
  uchdan biri).
- Bekor qilingan savolni, suhbat davom etmagan bo'lsa, "Javob berish" bilan
  qayta ochish mumkin. Bekor qilganda maydonga yozilgan matn yozish maydoniga
  qaytadi.
- Javob hali kelayotgan paytda forma ochilmaydi. Bitta javobda bitta savol
  beriladi.

**Provayder javob bermasa.** AI provayder band bo'lsa (`503`), daqiqalik so'rov
chegarasi oshsa yoki ulanish uzilsa, panel so'rovni o'zi uch marta takrorlaydi —
har safar oldingisidan uzunroq kutib, provayder aytgan vaqtni hisobga olib.
Shunda ham bo'lmasa, javob ostida sabab va **Davom ettirish** tugmasi chiqadi:
bosilsa, javob boshidan emas, to'xtagan bosqichidan davom etadi — o'qib
bo'lingan so'rovlar qayta o'qilmaydi va o'sha bosqichgacha yozilgan matn joyida
qoladi. Kalit noto'g'ri bo'lsa yoki so'rov rad etilsa tugma chiqmaydi: uni
qayta bosish hech narsani o'zgartirmaydi.

**Kunlik chegara — alohida holat.** Gemini modellarida kunlik so'rov soni
tugasa, yuqoridagi qoida ishlamaydi: panel qayta urinmaydi, chunki bu chegara
faqat ertasi kuni (Tinch okean vaqti bo'yicha yarim tunda) ochiladi — qayta
so'rash faqat bir xil rad javobini yana bir marta hisoblatib qo'yardi. Buning
o'rniga javob ostida darhol "ushbu modelning kunlik limiti tugadi — [soat]da
yangilanadi, Sozlamalarda boshqa modelni tanlash mumkin" degan xabar chiqadi,
**Davom ettirish** tugmasisiz.

**Yozish amallari.** Model narx yoki qoldiqni o'zi o'zgartirmaydi. U tugma
qo'yadi — tugmada qaysi route chaqirilishi va xavf darajasi yozilgan — bosishni
sotuvchi hal qiladi, yuqori xavfli amal esa qo'shimcha tasdiq oynasidan o'tadi.
Ekranni almashtirish yoki davrni o'zgartirish kabi hech narsani yozmaydigan
amallarni model darhol bajaradi. Keyingi savol taklifini esa o'zi so'ramaydi —
u javob ostida chip bo'lib chiqadi, bosishni sotuvchi hal qiladi.

Ko'p SKU'ni bir yo'la o'zgartiradigan taklif esa ro'yxat bilan ochiladi: qaysi
SKU, hozirgi qiymat, yangi qiymat — har qatorni belgisidan olib tashlash mumkin,
va yuboriladigan narsa aynan sotuvchi ko'rgan narsa bo'ladi.

> Uzum sotuvchi API'sida mahsulot nomini o'zgartirish va sharhlarga javob berish
> uchun route yo'q. Model bu haqda so'ralganda API bunday imkoniyat bermasligini
> aytadi — o'ylab topmaydi.

**Javobni panelga qadash.** Yoqqan javobni "Panelga qadash" tugmasi bilan
Overview'ga qo'yish mumkin. Karta javobni **yozilgan holicha** saqlaydi va
qachon saqlangani hamda qaysi davr haqida ekanini ko'rsatib turadi. Raqamlar
javob jumlalarining ichida bo'lgani uchun ular o'z-o'zidan yangilanmaydi —
aks holda eski jumla ostida yangi raqam turib qolardi. Yangilash uchun kartadagi
"yangi ma'lumot bilan qayta so'rash" tugmasi bosiladi: savol Copilot'ga qayta
beriladi, u joriy davr ma'lumotini o'qib, tahlilni qaytadan yozadi. Karta ichida
amal tugmasi qolmaydi: eski parametrlar bilan turgan narx yozish tugmasi tuzoq
bo'lardi.

**Doimiy qoidalar.** Sotuvchi chatda "SKU tugasa ayt" yoki "buyurtma tasdig'iga
6 soat qolganda ayt" desa, bu qoida bo'lib saqlanadi va har sinxronizatsiyadan
keyin tekshiriladi — qo'ng'iroq belgisi ostida xabar chiqadi. Qoida o'zi hech
narsa yuklab olmaydi: mavjud ma'lumot ustidan hisoblanadi. Bir xil topilma
bo'yicha o'zini takrorlamaydi, lekin topilma o'zgarsa (yana bitta SKU tugasa)
darhol aytadi. Qo'yilgan qoidalarni Sozlamalar → AI bo'limida ko'rish va
o'chirish mumkin.

AI kaliti kiritilmagan bo'lsa, panel ushbu funksiyasiz to'liq ishlaydi.

### Brauzer kengaytmasi

Kengaytma — Copilot'ning ixcham shakli: panelni ochmasdan, Uzum kabinetining
o'zida savol berish uchun. U panelning o'rnini bosmaydi.

> **Holat.** Kengaytma Chrome va Edge'da ishga tushirib ko'rilgan, lekin sinov
> ma'lumoti bilan: haqiqiy kabinet sessiyasi va haqiqiy AI kaliti bilan hali
> sinalmagan, Firefox'da umuman sinalmagan. Kabinetning ichki
> API'si ham hali yaxshi o'rganilmagan: uning bitta javobi ko'rilgan (quyida). Shu sabab u hozircha tor
> imkoniyat bilan, ehtiyotkor va'dalar bilan chiqadi.

**Qanday ochiladi.** `seller.uzum.uz` sahifalarining o'ng pastki burchagida
yumaloq tugma turadi. Bosilsa yoki **Ctrl+J** (Mac'da **⌘J**) bosilsa — o'sha
burchakda ramka ochiladi: balandligi oynaning 80 foizi, kengligi 433 piksel (tor
oynada deyarli butun kenglik). Yopish uchun — shu tugma, yana Ctrl+J yoki ramka ichida **Esc**.
Ramka ochiq yoki yopiqligi, tanlangan tema va til keyingi sahifalarda ham eslab
qolinadi; ramka yopilganda va kabinetning sahifa ichidagi o'tishlarida suhbat
saqlanadi (sahifa qayta yuklansa — yangi suhbat). Kengaytma Chrome, Edge va
Firefox'ga o'rnatiladi.

**Nima ko'rinadi.** Ramka ichida ikki ko'rinish bor:
- **Suhbat** — panelnikidek, bir xil javob bloklari (matn, jadval, ko'rsatkich,
  chizma, hisob-kitob zanjiri), bir xil "Davom ettirish" va xato xabarlari;
- **Sozlamalar** — faqat Copilot'ga tegishli uch bo'lim: **Umumiy** (til, mavzu,
  raqam formati — ikkita bildirishnoma tumblerchasi bundan mustasno: kengaytmada
  bildirishnomalar jurnali yo'q), **AI** (to'qqiz provayder, saytdagidek: kalit, model,
  token sarfi) va **Klaviatura**. Uzum tokeni va ma'lumotlar bo'limlari yo'q.

**Token kiritilmaydi.** Kengaytma sotuvchining kabinetdagi o'z sessiyasidan
foydalanadi — kabinetga kirgan bo'lish kifoya. Bu sessiya faqat Uzum'ning o'ziga
yuboriladi va AI provayderga hech qachon ketmaydi; AI provayderga ketadigan narsa —
savol va o'qilgan ma'lumot, sotuvchi Sozlamalarda kiritgan o'z kaliti bilan.
O'rnatilgan provayderlar uchun qo'shimcha ruxsat so'ralmaydi; o'zi ko'rsatgan manzil
(`custom`, Ollama) uchun brauzer ruxsatni **ixtiyoriy** so'raydi — bermasa ham, server
kengaytmalardan so'rovni qabul qilsa, ishlaydi.

**Nimani o'qiy oladi.** Hozir faqat bitta narsani — **do'konning mahsulot
ro'yxatini**, sahifa-sahifa, kabinetning o'z so'rovi bilan, jonli: mahsulotlar va
ularning o'lcham/rang bo'yicha qatorlari, do'kondagi mahsulotlarning umumiy soni
(Uzum o'zi aytgan son), har qator uchun FBO va FBS qoldig'i, sotilgan va
qaytarilgan dona hamda qaytarish foizi, narx, holat (tugab qolgani ham), pullik
saqlash va aksiya belgilari; mahsulotni matn bo'yicha qidirish ham mumkin. Hammasi
savol berilgan paytdagi holat. Buyurtmalar, moliya va tarix o'qilmaydi, Uzum'ga
hech narsa yozilmaydi. Qaysi do'kon:
sotuvchi savolda o'zi aytgan (faqat o'ziniki bo'lsa), aks holda kabinet hozir
ko'rsatayotgan do'kon, aks holda yagona do'koni; bir nechta do'koni bo'lib,
kabinet birortasini ko'rsatmasa — Copilot qaysi do'kon ekanini so'raydi, taxmin
qilmaydi. Boshlang'ich takliflar ham shu doirada ("mahsulotlarimni FBO va FBS qoldiqlari bilan
ko'rsat", "qaysi mahsulotlarimda ba'zi o'lchamlar tugab qolgan?", "qaysi
mahsulotlarda qaytarish foizi eng yuqori, nechta dona sotilgan va qaytarilgan?").

**Ehtiyotkorlik — nega.** Kabinetning bu API'si hujjatlashtirilmagan va undan faqat
bitta javob ko'rilgan (bitta mahsulot, besh o'lcham): ko'p maydonning ma'nosi, narx
birligi, qidiruv qanday moslashishi va ayrim filtr hamma mahsulotni qaytarishi yoki
bir qismini ekani hali noma'lum. Shuning uchun Copilot:
- maydonlarni API qanday atasa shunday ko'rsatadi, birlikni (so'mmi, tiyinmi) va
  ma'noni taxmin qilmaydi va noaniq raqam haqida buni bir marta aytadi;
- umumiy sonni faqat Uzum o'zi aytgan son sifatida keltiradi va uni o'zidan
  uydirmaydi; qidiruv yoki filtr bilan bu son o'zgarishi-o'zgarmasligi noma'lum
  ekanini aytadi;
- sahifani faqat Uzum aytgan songa nisbatan joylaydi, sonsiz bo'lsa "oxirgisi"
  demaydi — ko'proq bor-yo'qligini bilish uchun keyingi sahifani so'raydi;
- bashorat qilmaydi va avvalgi davr bilan taqqoslamaydi: ma'lumot o'zi shuni bermasa,
  taqqoslanadigan narsa yo'q.

**Nimani qila olmaydi.** Quyidagilar kengaytmada **yo'q** (panelda bor):

| Yo'q | Nega |
|---|---|
| Savdo, buyurtma, moliya, qoldiq, nakladnoy ma'lumoti | Hozircha faqat mahsulot ro'yxati o'qiladi; so'ralsa Copilot "buni hozircha qila olmayman" deydi va mahsulot ro'yxati nimani ko'rsata olishini taklif qiladi |
| Yozish amallari (narx, qoldiq, buyurtma) | Kengaytma Uzum'ga hech narsa yozmaydi; yagona tugma — keyingi savol taklifi (chip) |
| Arxiv, sinxronizatsiya, internetsiz ishlash | Har bir so'rov — kabinetdan jonli o'qish, hech narsa saqlanmaydi; "Tarixni davom ettirish" yo'q |
| Tanlangan davr, do'kon tanlagich | Davr yo'q: Copilot qaysi vaqt oralig'ini ko'rishini o'zi so'ramaydi, ma'lumotda ko'ringanini aytadi |
| Javobni qadash, insights paneli, doimiy qoidalar | Kengaytmada Overview va bildirishnomalar yo'q |

**Sotuvchi ko'radigan holatlar.**

| Holat | Nima ko'rinadi |
|---|---|
| Kabinetga kirmagan | "Bu varaqda kabinetga kirmagansiz. seller.uzum.uz saytiga kiring va qayta so'rang." Ma'lumot talab qilmaydigan savolga javob beriladi. Kirgandan keyin "Qayta tekshirish" tugmasi |
| Akkauntda do'kon yo'q | "Bu akkaunt uchun kabinetda do'konlar ko'rinmayapti." |
| Kabinet varag'i javob bermadi | "Kabinet varag'i javob bermadi. Sahifani qayta yuklab, qayta urinib ko'ring." |
| Kabinet sahifasi bilan aloqa uzildi | "Kabinet sahifasi bilan aloqa uzildi. Qayta ulanish uchun Copilot'ni qayta yuklang…" va **Qayta yuklash** tugmasi; suhbat shu paytgacha ekranda qoladi. Kabinet sahifasi qayta yuklansa yoki boshqa sahifaga o'tsa shunday bo'ladi; yangi so'rov yuborilmaydi |
| Panel kabinet ramkasidan tashqarida ochilgan | Faqat ishlab chiqish (dev) build'ida: "Copilot Uzum sotuvchi kabineti ichida ishlamayapti…" — mahsulotni o'qib bo'lmaydi. O'rnatilgan kengaytmada bunday holat yo'q: panel kabinet bilan aloqani tasdiqlamaguncha hech narsa ko'rsatmaydi (quyidagi "Ramka ulanmagan") |
| AI sozlanmagan | Panelniki kabi banner va uning tugmasi AI bo'limini ochadi |
| Ramka ulanmagan | Bitta jumla va **Qayta yuklash** tugmasi: panel kabinet bilan aloqani tasdiqlamaguncha hech narsa bosib bo'lmaydi (nega — texnik spetsifikatsiya 14.7) |
| Ramka yuklanmadi | Ramka ichida xabar va **Qayta urinish** tugmasi — jimgina ishlamaydigan tugma qolmaydi |
| Panelda kutilmagan xato | "Copilot panelida nimadir xato ketdi. Qayta yuklash xavfsiz — do'koningizga hech narsa yozilmadi." |

**Sessiya muddati.** Kabinetdagi sessiya tugagan bo'lsa, Uzum so'rovni rad etadi va
Copilot buni aytadi: tuzatish — kabinetga qayta kirish, qayta so'rash emas.

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
| **Kengaytma — faqat mahsulot ro'yxati** | Savdo, buyurtma, moliya va qoldiq kengaytmada o'qilmaydi; yozish amallari, arxiv, davr tanlash va qadash yo'q (5-bo'lim) |
| **Kengaytma — kabinet API'si kam o'rganilgan** | Mahsulot ro'yxatining faqat bitta javobi ko'rilgan; narx birligi, qidiruvning moslashishi, ba'zi filtr qaytaradigan to'plam va sahifa chegarasi noma'lum, shuning uchun Copilot birlikni taxmin qilmaydi, sonni faqat Uzum o'zi aytgan son deb keltiradi |
| **Kengaytma to'liq sinalmagan** | Chrome va Edge'da sinov ma'lumoti bilan ishga tushirilgan; haqiqiy kabinet sessiyasi, haqiqiy AI kaliti va Firefox bilan sinalmagan. Kabinetga kirilgan sahifalarning xavfsizlik siyosati ramkaga yo'l qo'ymasligi mumkin, Ctrl+J ba'zi brauzerda band bo'lishi mumkin. Texnik tafsilot — texnik spetsifikatsiya 14.8 |
| **Copilot hisob-kitobi** | Ekrandagi KPI'lar panel kodida hisoblanadi. Copilot javobidagi raqamlarni esa model o'qigan ma'lumotdan hisoblaydi. Tayyor hisoblangan jadvaldan olingan raqam aniq; xom qatorlardan model o'zi qo'shgan raqamda xato bo'lishi mumkin — shuning uchun javobda qaysi so'rovlar o'qilgani va hisob-kitob zanjiri ko'rsatiladi |

---

## 8. Muvaffaqiyat mezonlari

Foydalanuvchi uchun mahsulot ishlayapti deyish uchun:

1. Token kiritilgandan keyin **1 daqiqa ichida** birinchi raqamlar ekranda bo'lishi
2. Yuklangan davrni qayta tanlash **tarmoqsiz, bir zumda** javob berishi
3. Ekrandagi har bir raqamning manbasi ko'rsatilishi
4. Yozish amali natijasi (muvaffaqiyat yoki xato sababi) darhol aytilishi
5. Sinxronizatsiya yarim yo'lda to'xtatilsa, yuklangani saqlanib qolishi
6. Internetsiz ham yuklangan ma'lumot to'liq ko'rinishi
