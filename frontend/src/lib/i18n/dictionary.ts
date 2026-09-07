import type { Language } from '@/types/domain';

/**
 * Translation table, ported from the design source.
 *
 * Each entry is a `[en, ru, uz]` tuple — the same order the design file used,
 * so the two stay diffable. `TranslationKey` is derived from this object, which
 * makes a missing or misspelled key a compile error rather than a blank label.
 */
const TUPLES = {
  /* — window chrome — */
  tagline: [
    'AI operator for marketplace sellers',
    'ИИ-оператор для продавцов маркетплейса',
    'Marketplace sotuvchilari uchun AI operator',
  ],
  dock: ['Dock as side panel', 'Закрепить сбоку', 'Yon panelga biriktirish'],
  min: ['Minimise', 'Свернуть', "Yig'ish"],
  max: ['Maximise', 'Развернуть', 'Yoyish'],
  close: ['Close', 'Закрыть', 'Yopish'],
  reopen: ['Open Savdo', 'Открыть Savdo', "Savdo'ni ochish"],
  restore: ['Restore', 'Восстановить', 'Qaytarish'],

  /* — stores & range — */
  allStores: ['All stores (consolidated)', 'Все магазины (сводно)', "Barcha do'konlar (jamlangan)"],
  allShort: ['All stores', 'Все магазины', "Barcha do'konlar"],
  r7: ['Last 7 days', 'Последние 7 дней', 'Oxirgi 7 kun'],
  r30: ['Last 30 days', 'Последние 30 дней', 'Oxirgi 30 kun'],
  r90: ['Last 90 days', 'Последние 90 дней', 'Oxirgi 90 kun'],
  ryear: ['This year', 'Этот год', 'Shu yil'],
  vsPrev: ['vs previous period', 'к пред. периоду', 'oldingi davrga nisbatan'],
  compareTo: ['Compare to', 'Сравнить с', 'Solishtirish'],
  prevPeriod: ['Previous period', 'Предыдущий период', 'Oldingi davr'],

  /* — topbar — */
  searchPh: [
    'Search products, metrics, actions',
    'Поиск товаров, метрик, действий',
    "Mahsulot, ko'rsatkich, amal qidirish",
  ],
  notifs: ['Notifications', 'Уведомления', 'Bildirishnomalar'],
  markRead: ['Mark all read', 'Прочитать всё', "Barchasini o'qildi"],
  allRead: ['You are all caught up', 'Всё прочитано', "Hammasi o'qildi"],
  theme: ['Theme', 'Тема', 'Mavzu'],
  lang: ['Language', 'Язык', 'Til'],
  askCopilot: ['Ask Copilot', 'Спросить Copilot', "Copilot'dan so'rash"],
  syncingL: ['Syncing…', 'Синхронизация…', 'Sinxronlanmoqda…'],
  syncedAgo: ['Synced {n} min ago', 'Обновлено {n} мин назад', '{n} daqiqa oldin yangilandi'],
  syncedJust: ['Synced just now', 'Только что обновлено', 'Hozir yangilandi'],
  syncNever: ['Never synced', 'Ещё не синхронизировано', 'Hali sinxronlanmagan'],

  /* — navigation — */
  nOverview: ['Overview', 'Обзор', 'Umumiy'],
  nProducts: ['Products', 'Товары', 'Mahsulotlar'],
  nInventory: ['Inventory', 'Склад', 'Ombor'],
  nStocks: ['Inventory', 'Склад', 'Ombor'],
  nOps: ['Operations', 'Операции', 'Operatsiyalar'],
  nOrders: ['Operations', 'Операции', 'Operatsiyalar'],
  nInvoices: ['Invoices', 'Накладные', 'Nakladnoylar'],
  nFinance: ['Finance', 'Финансы', 'Moliya'],
  settings: ['Settings', 'Настройки', 'Sozlamalar'],

  /* — KPI labels — */
  kRev: ['Revenue', 'Выручка', 'Tushum'],
  kProf: ['Net profit', 'Чистая прибыль', 'Sof foyda'],
  kMarg: ['Margin', 'Маржа', 'Marja'],
  kOrd: ['Orders', 'Заказы', 'Buyurtmalar'],
  kAov: ['AOV', 'Средний чек', "O'rtacha chek"],
  kTurn: ['Stock turn', 'Оборачиваемость', 'Aylanish'],
  kCash: ['Cash flow', 'Денежный поток', 'Pul oqimi'],

  /* — live ticker — */
  tkLive: ['Live', 'Онлайн', 'Jonli'],
  tkToday: ['Today', 'Сегодня', 'Bugun'],
  tkOrders: ['Orders', 'Заказы', 'Buyurtma'],
  tkCancels: ['Cancels', 'Отмены', 'Bekor'],
  tkReturns: ['Returns', 'Возвраты', 'Qaytarish'],
  tkBuyout: ['Buyout', 'Выкуп', 'Sotib olish'],

  /* — unit economics — */
  unitEcon: ['Unit economics', 'Юнит-экономика', 'Birlik iqtisodi'],
  srcFinOrders: ['finance/orders', 'finance/orders', 'finance/orders'],
  srcFinOrdersLong: [
    'GET /v1/finance/orders · summed client-side',
    'GET /v1/finance/orders · сумма на клиенте',
    'GET /v1/finance/orders · klientda yig‘iladi',
  ],
  econNote: [
    'Every line is summed from what the seller API returns — nothing is modelled.',
    'Каждая строка — сумма ответов API продавца, ничего не моделируется.',
    'Har bir qator sotuvchi API javobidan yig‘iladi — modellashtirilmaydi.',
  ],
  method: ['Method', 'Методика', 'Metodika'],

  /* — chart — */
  chartTitle: ['Revenue & profit', 'Выручка и прибыль', 'Tushum va foyda'],
  chartBuckets: ['{n} buckets', 'интервалов: {n}', '{n} ta interval'],
  drill: ['Drill down', 'Детализация', 'Batafsil'],
  cRev: ['Revenue', 'Выручка', 'Tushum'],
  cProf: ['Profit', 'Прибыль', 'Foyda'],
  cOrd: ['Orders', 'Заказы', 'Buyurtma'],
  cMarg: ['Margin', 'Маржа', 'Marja'],
  cRet: ['Returns', 'Возвраты', 'Qaytarish'],

  /* — portfolio rank — */
  rankTitle: ['Catalogue by status', 'Каталог по статусу', 'Katalog holat bo‘yicha'],
  rankNote: [
    'status.value from the product card. rankInfo.rank is not scored on most accounts, so the catalogue is grouped by status instead. Click one to filter the table.',
    'status.value из карточки товара. rankInfo.rank у большинства аккаунтов не заполнен, поэтому группировка по статусу. Нажмите, чтобы отфильтровать.',
    'Mahsulot kartochkasidagi status.value. Ko‘p akkauntlarda rankInfo.rank hisoblanmaydi, shuning uchun guruhlash holat bo‘yicha. Filtrlash uchun bosing.',
  ],

  /* — demand heatmap — */
  demand: ['Demand rhythm', 'Ритм спроса', 'Talab ritmi'],
  demandSub: [
    '{n} order items · local time',
    'позиций: {n} · местное время',
    '{n} pozitsiya · mahalliy vaqt',
  ],
  demandNote: [
    'Order items bucketed by weekday and hour from their date field. An empty cell means no order landed in it — across 168 hourly cells a short window leaves many blank, and that is missing sample, not missing demand.',
    'Позиции сгруппированы по дню недели и часу по полю date. Пустая ячейка — не было заказов; на 168 почасовых ячейках короткое окно оставляет много пустых, и это нехватка выборки, а не отсутствие спроса.',
    'Pozitsiyalar date maydoni bo‘yicha hafta kuni va soatga guruhlangan. Bo‘sh katak — buyurtma bo‘lmagan; 168 ta soatlik katakda qisqa oyna ko‘pini bo‘sh qoldiradi, bu esa tanlanma yetishmasligi, talab yo‘qligi emas.',
  ],
  low: ['low', 'мало', 'kam'],
  high: ['high', 'много', "ko'p"],
  wdMon: ['Mon', 'Пн', 'Du'],
  wdTue: ['Tue', 'Вт', 'Se'],
  wdWed: ['Wed', 'Ср', 'Ch'],
  wdThu: ['Thu', 'Чт', 'Pa'],
  wdFri: ['Fri', 'Пт', 'Ju'],
  wdSat: ['Sat', 'Сб', 'Sh'],
  wdSun: ['Sun', 'Вс', 'Ya'],

  /* — products table — */
  prodPerf: ['Product performance', 'Эффективность товаров', 'Mahsulot samaradorligi'],
  backList: ['All products', 'Все товары', 'Barcha mahsulotlar'],
  pickHint: [
    'Click a product for its full breakdown',
    'Нажмите товар для полного разбора',
    "To'liq tahlil uchun mahsulotni bosing",
  ],
  metaTpl: ['{n} of {m} products', '{n} из {m} товаров', '{n} / {m} mahsulot'],
  filters: ['Filters', 'Фильтры', 'Filtrlar'],
  exportCsv: ['Export CSV', 'Экспорт CSV', 'CSV eksport'],
  noMatch: [
    'No products match these filters',
    'Нет товаров по этим фильтрам',
    "Bu filtrlarga mos mahsulot yo'q",
  ],
  clearAll: ['Clear all', 'Сбросить всё', 'Tozalash'],
  cProduct: ['Product', 'Товар', 'Mahsulot'],
  cPrice: ['Price', 'Цена', 'Narx'],
  cPurchase: ['Cost', 'Себестоимость', 'Tannarx'],
  cTurnover: ['Turnover', 'Оборот', 'Aylanma'],
  cSold: ['Sold', 'Продано', 'Sotilgan'],
  cReturns: ['Returns', 'Возвраты', 'Qaytarish'],
  cActive: ['Active', 'Активно', 'Faol'],
  cAvailable: ['Available', 'Доступно', 'Mavjud'],
  searchProdPh: ['Title or productId', 'Название или productId', 'Nom yoki productId'],
  cFbs: ['FBS', 'FBS', 'FBS'],
  cClass: ['Class', 'Класс', 'Sinf'],
  cStatus: ['Status', 'Статус', 'Holat'],
  cSkuTitle: ['SKU', 'SKU', 'SKU'],
  prev: ['Prev', 'Пред.', 'Oldingi'],
  next: ['Next', 'След.', 'Keyingi'],

  /* — product detail — */
  skuList: ['SKU breakdown', 'Разбивка по SKU', 'SKU bo‘yicha'],
  skuListSub: ['Variants of this product', 'Варианты этого товара', 'Shu mahsulot variantlari'],
  priceFix: ['Apply price fix', 'Исправить цену', 'Narxni tuzatish'],
  updStock: ['Update stock', 'Обновить остаток', 'Qoldiqni yangilash'],
  printLabels: ['Print labels', 'Печать этикеток', 'Yorliq chop etish'],

  /* — modules — */
  refreshL: ['Refresh', 'Обновить', 'Yangilash'],
  selectedL: ['selected', 'выбрано', 'tanlangan'],
  rowsPer: ['Rows', 'Строк', 'Qator'],
  expandAll: ['Expand all', 'Развернуть всё', 'Hammasini ochish'],
  collapseAll: ['Collapse all', 'Свернуть всё', 'Hammasini yopish'],

  /* — module KPIs — */

  /* — module tabs — */

  /* — module columns — */
  cCourier: ['Courier', 'Курьер', 'Kuryer'],
  cLine: ['Line', 'Статья', 'Modda'],
  cThis: ['This period', 'Период', 'Davr'],
  cShare: ['% of revenue', '% выручки', 'Tushum %'],
  cFees: ['Fees', 'Комиссии', 'Komissiya'],

  /* — row detail: stock movement & order timeline — */

  /* — status pills — */

  /* — bulk & row actions — */
  bulkExport: ['Export selection', 'Экспорт выбранного', 'Tanlanganni eksport'],
  openRow: ['Open details', 'Открыть', 'Ochish'],
  copySku: ['Copy SKU', 'Копировать SKU', 'SKU nusxalash'],
  hideRow: ['Hide row', 'Скрыть строку', 'Qatorni yashirish'],
  aLabel: ['Print labels', 'Печать этикеток', 'Yorliq chop etish'],
  aPrice: ['Update price', 'Обновить цену', 'Narxni yangilash'],
  aCancelOrd: ['Cancel order', 'Отменить заказ', 'Buyurtmani bekor qilish'],
  aCreateInv: ['Create invoice', 'Создать накладную', 'Nakladnoy yaratish'],
  aConfirm: ['Confirm order', 'Подтвердить заказ', 'Buyurtmani tasdiqlash'],
  aIdent: ['Bind identifiers', 'Привязать идентификаторы', 'Identifikator biriktirish'],
  aDeliver: ['Hand to delivery', 'Передать в доставку', 'Yetkazishga topshirish'],
  aComplete: ['Confirm handover', 'Подтвердить выдачу', 'Topshirishni tasdiqlash'],
  aRefund: ['Create refund', 'Создать возврат', 'Qaytarish yaratish'],
  aUpdContent: ['Change invoice content', 'Изменить состав', "Tarkibni o'zgartirish"],
  aCancelInv: ['Cancel invoice', 'Отменить накладную', 'Nakladnoyni bekor qilish'],
  aPrintSupply: ['Print supply act', 'Печать акта поставки', 'Yetkazish aktini chop etish'],
  aPrintAcceptance: ['Print acceptance act', 'Печать акта приёмки', 'Qabul aktini chop etish'],
  aSlot: ['Change point & slot', 'Изменить пункт и слот', 'Punkt va slotni almashtirish'],
  gAct: ['Actions', 'Действия', 'Amallar'],

  /* — blocked states — */
  blInitT: ['Not connected yet', 'Кабинет не подключён', 'Hali ulanmagan'],
  blInitB: [
    'Paste your Uzum seller API token in Settings. Savdo reads orders, stock and finance directly from api-seller.uzum.uz with it — nothing is shown until it does.',
    'Вставьте токен Uzum seller API в настройках. Savdo читает заказы, склад и финансы напрямую с api-seller.uzum.uz — до этого показывать нечего.',
    "Sozlamalarga Uzum seller API tokenini kiriting. Savdo buyurtma, ombor va moliyani to'g'ridan-to'g'ri api-seller.uzum.uz dan o'qiydi — shungacha ko'rsatadigan narsa yo'q.",
  ],
  blInitC: ['Open API settings', 'Открыть настройки API', 'API sozlamalarini ochish'],
  blEmptyT: ['No data for this period', 'Нет данных за период', "Bu davr uchun ma'lumot yo'q"],
  blEmptyB: [
    'The API returned no rows for {range} on the selected shops. Widen the range, or switch to another shop.',
    'API не вернул записей за {range} по выбранным магазинам. Расширьте период или смените магазин.',
    "API tanlangan do'konlar bo'yicha {range} uchun hech qanday yozuv qaytarmadi. Davrni kengaytiring yoki do'konni almashtiring.",
  ],
  blEmptyC: ['Widen to 90 days', 'Расширить до 90 дней', '90 kunga kengaytirish'],
  blSearchT: ['No results', 'Нет результатов', "Natija yo'q"],
  blSearchB: [
    'Nothing in the {n} rows read matches “{q}”. Check the spelling, or search by id instead.',
    'Среди прочитанных строк ({n}) нет совпадений с «{q}». Проверьте написание или ищите по id.',
    "O'qilgan {n} qator ichida «{q}» ga mos keladigani yo'q. Imloni tekshiring yoki id bo'yicha qidiring.",
  ],
  blSearchC: ['Clear search', 'Очистить поиск', 'Qidiruvni tozalash'],
  blFilterT: ['No rows match these filters', 'Нет строк под фильтры', "Filtrlarga mos qator yo'q"],
  blFilterB: [
    'Filters are narrowing the list to nothing. Drop one condition, or reset them all to see the full table again.',
    'Фильтры не оставили строк. Снимите одно условие или сбросьте все.',
    "Filtrlar hech nima qoldirmadi. Bitta shartni olib tashlang yoki hammasini tiklang.",
  ],
  blFilterC: ['Reset filters', 'Сбросить фильтры', 'Filtrlarni tiklash'],
  blErrT: ['Could not load this screen', 'Не удалось загрузить экран', "Ekranni yuklab bo'lmadi"],
  blErrB: [
    'The Uzum seller API answered with an error. Nothing was written on your side, so retrying is safe.',
    'Uzum seller API ответил ошибкой. На вашей стороне ничего не записано — повтор безопасен.',
    "Uzum seller API xato qaytardi. Sizning tomonda hech nima yozilmadi — qayta urinish xavfsiz.",
  ],
  blErrC: ['Retry now', 'Повторить', 'Qayta urinish'],
  blOffT: ['Cannot reach Uzum', 'Uzum недоступен', "Uzum ga ulanib bo'lmadi"],
  blOffB: [
    'The request did not leave the machine, or Uzum did not answer. Anything already synced stays readable; live figures resume as soon as the connection is back.',
    'Запрос не ушёл, либо Uzum не ответил. Уже синхронизированное остаётся доступным; живые данные вернутся вместе со связью.',
    "So'rov ketmadi yoki Uzum javob bermadi. Sinxronlangani o'qishga ochiq qoladi; ulanish tiklansa, jonli ma'lumot qaytadi.",
  ],
  blOffC: ['Try again', 'Попробовать снова', 'Qayta urinish'],
  blTimeT: ['The request timed out', 'Истекло время ожидания', 'Kutish vaqti tugadi'],
  blTimeB: [
    'Uzum did not answer in time. A long window over a large catalogue can take more than one attempt — retry, or narrow the range.',
    'Uzum не ответил вовремя. Длинный период по большому каталогу может потребовать нескольких попыток — повторите или сузьте период.',
    "Uzum vaqtida javob bermadi. Katta katalog bo'yicha uzun davr bir necha urinish talab qilishi mumkin — qayta urining yoki davrni qisqartiring.",
  ],
  blTimeC: ['Retry request', 'Повторить запрос', 'Qayta yuborish'],
  blUnauthT: ['Token rejected', 'Токен отклонён', 'Token rad etildi'],
  blUnauthB: [
    'Uzum answered 401 with the stored token. Seller tokens expire — paste a fresh one in API settings and the screens fill in again.',
    'Uzum ответил 401 на сохранённый токен. Токены продавца истекают — вставьте новый в настройках API.',
    "Uzum saqlangan token bilan 401 qaytardi. Sotuvchi tokeni muddati tugaydi — API sozlamalariga yangisini kiriting.",
  ],
  blUnauthC: ['Open API settings', 'Открыть настройки API', 'API sozlamalarini ochish'],
  blForbT: ['This account cannot read that', 'Нет доступа к этим данным', "Bu ma'lumotga ruxsat yo'q"],
  blForbB: [
    'Uzum answered 403. The token is valid but the seller account it belongs to is not permitted on this endpoint.',
    'Uzum ответил 403. Токен действителен, но у аккаунта нет прав на этот эндпоинт.',
    "Uzum 403 qaytardi. Token yaroqli, lekin akkauntga bu endpoint uchun ruxsat berilmagan.",
  ],
  blForbC: ['Open API settings', 'Открыть настройки API', 'API sozlamalarini ochish'],

  /* — banners — */
  bnOffT: [
    'Working offline — showing the {time} snapshot',
    'Офлайн — данные на {time}',
    'Oflayn — {time} holati',
  ],
  bnPartT: [
    'Partial data — {ok} of {total} sources loaded',
    'Данные частично — {ok} из {total} источников',
    "Qismli ma'lumot — {total} dan {ok} manba",
  ],
  bnPartA: ['Retry the rest', 'Повторить остальные', 'Qolganini qayta urinish'],
  bnRoT: [
    'Read-only — no token is configured',
    'Только чтение — токен не задан',
    "Faqat o'qish — token kiritilmagan",
  ],
  bnRoA: ['Open API settings', 'Открыть настройки API', 'API sozlamalarini ochish'],
  bnWarnT: [
    'These figures are {n} min old',
    'Данные устарели на {n} мин',
    "Ma'lumot {n} daqiqa eskirgan",
  ],
  bnWarnA: ['Refresh now', 'Обновить', 'Yangilash'],
  bnDisT: [
    'Writes are paused while a sync is running',
    'Запись приостановлена на время синхронизации',
    "Sinxronizatsiya davomida yozuv to'xtatilgan",
  ],
  bnSuccT: [
    '{ok} of {total} sources synced · {rows} rows',
    'Синхронизировано источников: {ok} из {total} · строк: {rows}',
    '{total} dan {ok} manba sinxronlandi · {rows} qator',
  ],
  bnTruncT: [
    'Showing the first {n} rows of {total} — narrow the range to read the rest',
    'Показаны первые {n} из {total} строк — сузьте период',
    "{total} qatordan birinchi {n} tasi ko'rsatilmoqda — davrni qisqartiring",
  ],

  /* — settings — */
  sGeneral: ['General', 'Общие', 'Umumiy'],
  sApi: ['Uzum API', 'Uzum API', 'Uzum API'],
  sAi: ['AI provider', 'ИИ-провайдер', 'AI provayder'],
  sKeys: ['Keyboard', 'Клавиатура', 'Klaviatura'],
  live: ['live', 'live', 'faol'],
  gSub: [
    'Appearance, locale and how the extension behaves inside the seller cabinet.',
    'Внешний вид, язык и поведение расширения в кабинете.',
    "Ko'rinish, til va kengaytmaning kabinetdagi ishlashi.",
  ],
  themeHint: [
    'Dark is the default for long sessions',
    'Тёмная по умолчанию для долгих сессий',
    "Uzoq seans uchun qorong'i standart",
  ],
  dark: ['Dark', 'Тёмная', "Qorong'i"],
  light: ['Light', 'Светлая', "Yorug'"],
  system: ['System', 'Системная', 'Tizim'],
  langHint: ['Interface and AI answers', 'Интерфейс и ответы ИИ', 'Interfeys va AI javoblari'],
  curLbl: ['Currency', 'Валюта', 'Valyuta'],
  curHint: ['All money figures', 'Все суммы', 'Barcha summalar'],
  tzLbl: ['Timezone', 'Часовой пояс', 'Vaqt mintaqasi'],
  tzHint: ['Reports and daypart analysis', 'Отчёты и анализ по времени', 'Hisobot va kun vaqti tahlili'],
  nfLbl: ['Number format', 'Формат чисел', 'Raqam formati'],
  nfHint: ['Thousands and decimals', 'Разряды и десятичные', 'Minglik va kasr'],
  tgCrit: ['Critical alerts', 'Критические оповещения', 'Muhim ogohlantirish'],
  tgCritH: [
    'Browser notification for critical insights',
    'Push для критических инсайтов',
    'Muhim tahlillar uchun bildirishnoma',
  ],
  tgDig: ['Daily digest', 'Ежедневная сводка', 'Kunlik xulosa'],
  tgDigH: ['Morning summary at 08:30', 'Сводка в 08:30', 'Ertalab 08:30 da xulosa'],
  tgBad: ['Inline badges', 'Встроенные значки', 'Ichki belgilar'],
  tgBadH: [
    'Profit and stock badges in the cabinet',
    'Значки прибыли и склада в кабинете',
    'Kabinetda foyda va zaxira belgilari',
  ],
  tgSnd: ['Sound', 'Звук', 'Ovoz'],
  tgSndH: [
    'Tone for stockout and fraud alerts',
    'Звук для дефицита и фрода',
    'Zaxira va firibgarlik uchun tovush',
  ],
  onL: ['On', 'Вкл', 'Yoniq'],
  offL: ['Off', 'Выкл', "O'chiq"],
  save: ['Save changes', 'Сохранить', 'Saqlash'],
  reset: ['Reset', 'Сбросить', 'Tiklash'],
  savedLive: [
    'Changes apply immediately and are stored in this browser.',
    'Изменения применяются сразу и хранятся в этом браузере.',
    'O‘zgarishlar darhol qo‘llanadi va shu brauzerda saqlanadi.',
  ],
  savedT: ['Settings saved', 'Настройки сохранены', 'Sozlamalar saqlandi'],
  resetT: ['Reset to defaults', 'Сброшено', 'Standartga qaytdi'],
  apiSub: [
    'Seller API credentials, synchronisation and connection diagnostics.',
    'Данные API, синхронизация и диагностика.',
    "API ma'lumotlari, sinxronizatsiya va diagnostika.",
  ],
  connected: ['Connected', 'Подключено', 'Ulangan'],
  syncNow: ['Sync now', 'Синхронизировать', 'Sinxronlash'],
  tokenLbl: ['Authorization token', 'Токен Authorization', 'Authorization tokeni'],
  replace: ['Replace', 'Заменить', 'Almashtirish'],
  cancel: ['Cancel', 'Отмена', 'Bekor'],
  saveShort: ['Save', 'Сохранить', 'Saqlash'],
  tokenNote: [
    'Kept in this browser and sent only to the base URL above. It is stored as plain text — revoke it in the seller cabinet if this machine is shared.',
    'Хранится в этом браузере и отправляется только на указанный выше базовый URL. Хранится открытым текстом — отзовите его в кабинете продавца, если машина общая.',
    "Shu brauzerda saqlanadi va faqat yuqoridagi baza URL ga yuboriladi. Ochiq matn sifatida saqlanadi — kompyuter umumiy bo'lsa, sotuvchi kabinetida bekor qiling.",
  ],
  showHide: ['Show / hide', 'Показать / скрыть', "Ko'rsatish / yashirish"],
  copy: ['Copy', 'Копировать', 'Nusxalash'],
  rateLimit: [
    'Authorization header · no Bearer prefix',
    'Заголовок Authorization · без Bearer',
    'Authorization · Bearer prefiksisiz',
  ],
  runDiag: ['Run diagnostics', 'Диагностика', 'Diagnostika'],
  diagRun: ['Running diagnostics…', 'Выполняется…', 'Bajarilmoqda…'],
  diagDone: ['Diagnostics complete', 'Диагностика завершена', 'Diagnostika tugadi'],
  diag1: ['API reachability', 'Доступность API', 'API mavjudligi'],
  diag2: ['Auth token validity', 'Токен действителен', 'Token yaroqli'],
  diag3: ['Shops visible to this token', 'Магазинов доступно токену', 'Token ko‘ra oladigan do‘konlar'],
  ok: ['OK', 'OK', 'OK'],
  copied: ['Token copied', 'Токен скопирован', 'Token nusxalandi'],
  tokenSaved: ['Token updated', 'Токен обновлён', 'Token yangilandi'],
  aiSub: [
    'Provider-independent by design — the analysis layer talks to one interface, so any model can be swapped in without touching your data.',
    'Не зависит от провайдера — слой анализа говорит с одним интерфейсом, модель можно заменить.',
    "Provayderga bog'liq emas — tahlil qatlami bitta interfeys bilan ishlaydi, modelni almashtirish mumkin.",
  ],
  testConn: ['Test connection', 'Проверить соединение', 'Ulanishni tekshirish'],
  testing: ['Testing…', 'Проверка…', 'Tekshirilmoqda…'],
  testOk: ['Connected · 380 ms', 'Подключено · 380 мс', 'Ulandi · 380 ms'],
  apiKey: ['API key', 'API-ключ', 'API kalit'],
  baseUrl: ['Base URL', 'Базовый URL', 'Baza URL'],
  orgId: ['Organization ID', 'ID организации', 'Tashkilot ID'],
  modelTier: ['Model tier', 'Уровень модели', 'Model darajasi'],
  timeout: ['Timeout', 'Тайм-аут', 'Kutish vaqti'],
  temp: ['Temperature', 'Температура', 'Temperatura'],
  maxTok: ['Max tokens', 'Макс. токенов', 'Maks. token'],
  tempHint: [
    'Low — analytical, reproducible answers',
    'Низкая — аналитичные ответы',
    'Past — tahliliy, takrorlanuvchi javoblar',
  ],
  tokHint: [
    'Enough for a full P&L narrative with tables',
    'Хватает на полный отчёт с таблицами',
    "Jadvalli to'liq hisobot uchun yetarli",
  ],
  keysSub: ['Everything reachable without the mouse.', 'Всё доступно без мыши.', 'Sichqonchasiz hammasi mavjud.'],

  /* — settings storage — */
  model: ['Model', 'Модель', 'Model'],
  adapters: [
    'Strategy pattern · {count} adapters',
    'Strategy pattern · {count} адаптеров',
    'Strategy pattern · {count} ta adapter',
  ],
  addAdapter: ['Add adapter', 'Добавить адаптер', "Adapter qo‘shish"],
  addAdapterMeta: [
    'Drop in a new strategy class',
    'Новый strategy-класс',
    'Yangi strategy klassi',
  ],
  providerConfig: ['{name} configuration', 'Конфигурация {name}', '{name} konfiguratsiyasi'],
  adapterRegistry: [
    'adapter v3 · loaded from registry',
    'adapter v3 · из реестра',
    'adapter v3 · reyestrdan',
  ],
  syncHistory: ['Sync history', 'История синхронизации', 'Sinxronizatsiya tarixi'],

  /* — live sync progress — */
  syncOverall: ['Overall', 'Всего', 'Umumiy'],
  syncStQueued: ['queued', 'в очереди', 'navbatda'],
  syncStRunning: ['reading', 'чтение', "o'qilmoqda"],
  syncStOk: ['done', 'готово', 'tayyor'],
  syncStFailed: ['failed', 'ошибка', 'xato'],
  syncStStopped: ['stopped', 'остановлено', "to'xtatildi"],
  syncStIdle: ['not read yet', 'ещё не читалось', "hali o'qilmagan"],
  syncRowsOf: ['{loaded} of {total} rows', '{loaded} из {total} строк', '{total} qatordan {loaded} ta'],
  syncRowsRead: ['{n} rows', 'строк: {n}', '{n} qator'],
  syncNoTotal: [
    'this route reports no total',
    'этот маршрут не отдаёт общее число',
    'bu route umumiy sonni bermaydi',
  ],
  syncTruncL: ['page ceiling reached', 'достигнут предел страниц', 'sahifa chegarasiga yetdi'],
  syncArchiveL: ['Archive (history)', 'Архив (история)', 'Arxiv (tarix)'],
  syncArcShops: ['{done} of {total} stores', '{done} из {total} магазинов', "{total} do'kondan {done} ta"],
  syncArcWindows: ['{done} of {total} periods', '{done} из {total} периодов', '{total} davrdan {done} ta'],
  syncArcAdded: ['+{rows} rows · {changes} changes', '+{rows} строк · изменений: {changes}', "+{rows} qator · {changes} o'zgarish"],
  syncArcIdle: [
    'runs after the sources land',
    'запускается после источников',
    'manbalardan keyin ishga tushadi',
  ],
  syncLiveSub: [
    'Live state of the current run. Every figure is the row count the API itself reported.',
    'Состояние текущего запуска. Каждая цифра — количество строк, отданное самим API.',
    "Joriy ishga tushirish holati. Har bir raqam — API ning o'zi bergan qator soni.",
  ],

  /* — capture freshness —
     The `buf*` keys are named after the buffer store that used to back this
     panel. The store is gone; the keys are kept because they are referenced by
     name across the settings screen, but every string now describes what the
     panel actually measures: the snapshot captures. */
  freshLbl: ['Refresh live data every', 'Обновлять живые данные каждые', "Jonli ma'lumotni yangilash"],
  freshHint: [
    'Catalogue, stock and invoices are served from this device until this long has passed. Settled sales and orders are never governed by it — they are held by period instead.',
    'Каталог, остатки и накладные отдаются с этого устройства, пока не пройдёт это время. Закрытых продаж и заказов это не касается — они хранятся по периодам.',
    "Katalog, qoldiq va nakladnoylar shu vaqt o'tguncha shu qurilmadan beriladi. Yakunlangan sotuv va buyurtmalarga bu tegishli emas — ular davrlar bo'yicha saqlanadi.",
  ],
  freshMin: ['{n} min', '{n} мин', '{n} daqiqa'],
  freshHour: ['{n} h', '{n} ч', '{n} soat'],
  bufLbl: ['Captures', 'Снимки', 'Suratlar'],
  bufSlots: ['{n} stored rows', 'Сохранённых строк: {n}', '{n} ta saqlangan qator'],
  bufHint: [
    'The catalogue, stock and invoices as this device last captured them.',
    'Каталог, остатки и накладные — какими их в последний раз получило это устройство.',
    "Katalog, qoldiq va nakladnoylar — shu qurilma ularni oxirgi marta olgan holicha.",
  ],
  bufClear: ['Clear the captures', 'Очистить снимки', 'Suratlarni tozalash'],
  bufCleared: ['Captures cleared', 'Снимки очищены', 'Suratlar tozalandi'],
  bufClearFail: [
    'Could not clear the captures',
    'Не удалось очистить снимки',
    "Suratlarni tozalab bo'lmadi",
  ],

  /* — data archive — */
  sData: ['Data', 'Данные', "Ma'lumotlar"],
  dSub: [
    'What each store has archived locally, and which periods are still missing.',
    'Что заархивировано локально по каждому магазину и какие периоды ещё не закрыты.',
    "Har bir do'kon uchun lokal arxiv holati va hali yig'ilmagan davrlar.",
  ],
  dCoverage: ['Archived period', 'Заархивированный период', 'Arxivlangan davr'],
  dCovNone: [
    'Nothing archived yet — the next sync pulls the first instalment',
    'Пока ничего не заархивировано — первая порция придёт со следующей синхронизацией',
    "Hali arxiv yo'q — keyingi sinxronizatsiya birinchi qismni olib keladi",
  ],
  dCovDays: ['{n} days held', 'Сохранено дней: {n}', "{n} kunlik ma'lumot saqlangan"],
  dCovGaps: [
    'has gaps — the next sync fills them',
    'есть пропуски — следующая синхронизация их закроет',
    "bo'shliqlar bor — keyingi sinxronizatsiya to'ldiradi",
  ],
  dCovWhole: ['continuous, no gaps', 'непрерывно, без пропусков', "uzluksiz, bo'shliqsiz"],
  dSettled: ['Settled through', 'Закрыто до', 'Yakunlangan sana'],
  dSettledH: [
    'Rows older than this no longer change and are never re-read',
    'Строки старше этой даты больше не меняются и не перечитываются',
    "Bu sanadan eski qatorlar o'zgarmaydi va qayta o'qilmaydi",
  ],
  dPending: [
    'The last two weeks stay provisional — cancellations and refunds still land there',
    'Последние две недели остаются предварительными — туда ещё приходят отмены и возвраты',
    "Oxirgi ikki hafta vaqtinchalik — bekor qilish va qaytarishlar hali tushadi",
  ],
  dRows: ['Order rows', 'Строк заказов', 'Buyurtma qatorlari'],
  dExpRows: ['Expense rows', 'Строк расходов', 'Xarajat qatorlari'],
  dSkus: ['SKU tracked', 'SKU отслеживается', 'Kuzatilayotgan SKU'],
  dStorage: ['Storage used', 'Занято в хранилище', 'Xotira band'],
  dBackfill: ['Fetch older history', 'Загрузить более раннюю историю', 'Eskiroq tarixni yuklash'],
  dBackfillRun: ['Fetching…', 'Загрузка…', 'Yuklanmoqda…'],
  dBackfillDone: [
    'The whole history this token can see is archived',
    'Вся доступная токену история заархивирована',
    "Token ko'ra oladigan butun tarix arxivlandi",
  ],
  dClear: ['Clear this store', 'Очистить магазин', "Do'konni tozalash"],
  dClearQ: ["Clear this store's archive?", 'Очистить архив магазина?', "Do'kon arxivi tozalansinmi?"],
  dClearB: [
    'Every archived row for this store is deleted. Other stores keep theirs, and the next sync starts this one from scratch.',
    'Все заархивированные строки этого магазина будут удалены. Другие магазины не затрагиваются, а следующая синхронизация начнёт этот с нуля.',
    "Bu do'konning barcha arxiv qatorlari o'chiriladi. Boshqa do'konlarga tegilmaydi, keyingi sinxronizatsiya buni noldan boshlaydi.",
  ],
  dCleared: ['Store archive cleared', 'Архив магазина очищен', 'Do‘kon arxivi tozalandi'],

  /* — change journal (group 3) — */
  dJournal: ['Price and stock changes', 'Изменения цен и остатков', "Narx va qoldiq o'zgarishlari"],
  dJournalSub: [
    'The seller API publishes no change history, so this is observed: every sync compares the catalogue against the previous capture and records what moved.',
    'API продавца не отдаёт историю изменений, поэтому она наблюдается: каждая синхронизация сравнивает каталог с прошлым снимком и фиксирует расхождения.',
    "Sotuvchi API o'zgarishlar tarixini bermaydi, shuning uchun u kuzatiladi: har sinxronizatsiya katalogni oldingi holat bilan solishtiradi va farqni yozib qo'yadi.",
  ],
  dJournalEmpty: [
    'No changes recorded yet — the journal starts from the first sync and grows from there',
    'Изменений пока нет — журнал начинается с первой синхронизации',
    "Hali o'zgarish yo'q — jurnal birinchi sinxronizatsiyadan boshlanadi",
  ],
  dJournalSince: ['Recording since {date}', 'Ведётся с {date}', '{date} dan beri yozilmoqda'],
  dImpact: ['What the price change did', 'Что дало изменение цены', "Narx o'zgarishi nima berdi"],
  dImpactEmpty: [
    'No price move yet has enough sales on both sides to compare',
    'Пока ни одно изменение цены не имеет достаточно продаж по обе стороны',
    "Hozircha hech bir narx o'zgarishida ikkala tomonda yetarli sotuv yo'q",
  ],
  dImpactBefore: ['before', 'до', 'oldin'],
  dImpactAfter: ['after', 'после', 'keyin'],
  dImpactPerDay: ['{n} units/day', '{n} шт/день', '{n} dona/kun'],
  dImpactWeak: ['too few sales to be sure', 'слишком мало продаж', "ishonch uchun sotuv kam"],
  dImpactNote: [
    'Demand moves for many reasons at once — season, stock, campaigns. This pairs a price change with the sales around it; it does not prove one caused the other.',
    'Спрос меняется сразу по многим причинам — сезон, остатки, кампании. Здесь изменение цены сопоставлено с продажами рядом; это не доказывает причинность.',
    "Talab bir vaqtda ko'p sabablarga ko'ra o'zgaradi — mavsum, qoldiq, kampaniyalar. Bu yerda narx o'zgarishi atrofidagi sotuv bilan solishtirilgan; sababiy bog'liqlik isbotlanmaydi.",
  ],
  dFieldPrice: ['price', 'цена', 'narx'],
  dFieldPurchase: ['cost', 'себестоимость', 'tannarx'],
  dFieldStock: ['stock', 'остаток', 'qoldiq'],
  dFieldRank: ['rank', 'ранг', 'rank'],
  dFieldDiscount: ['discount', 'скидка', 'chegirma'],
  dOn: ['on', 'вкл', 'yoqilgan'],
  dOff: ['off', 'выкл', "o'chirilgan"],
  dNoStores: [
    'Connect the API and run a sync — the archive fills per store from there',
    'Подключите API и синхронизируйте — архив заполняется по магазинам',
    "API ni ulang va sinxronlang — arxiv do'konlar bo'yicha to'ladi",
  ],

  /* — local database — */
  dbLbl: ['Local database', 'Локальная база', "Mahalliy ma'lumotlar bazasi"],
  dbHint: [
    'Every screen reads from here first; the API is only asked for what is missing',
    'Все экраны читают отсюда; к API обращаемся только за недостающим',
    "Har bir ekran avval shu yerdan o'qiydi; API faqat yetishmayotgani uchun so'raladi",
  ],
  dbRows: ['{n} rows stored', 'Сохранено строк: {n}', '{n} qator saqlangan'],
  dbQuota: ['{used} of {quota}', '{used} из {quota}', '{quota} dan {used}'],
  dbQuotaNone: ['size not reported', 'размер не сообщается', "hajm ma'lum emas"],
  dbPersisted: ['protected from eviction', 'защищено от очистки', "o'chirilishdan himoyalangan"],
  dbEvictable: ['may be cleared under pressure', 'может быть очищено', "joy yetmasa o'chirilishi mumkin"],
  dbUnavailable: [
    'Local storage is unavailable — this session will not be saved',
    'Локальное хранилище недоступно — сессия не сохранится',
    "Mahalliy xotira mavjud emas — bu sessiya saqlanmaydi",
  ],
  dLoading: ['Reading the archive…', 'Чтение архива…', "Arxiv o'qilmoqda…"],

  /* — background and lazy sync — */
  lazyTitle: ['Background fetches', 'Фоновые загрузки', 'Fon rejimidagi yuklashlar'],
  lazySub: [
    'Periods a chart or an analysis asked for that this machine did not hold yet',
    'Периоды, которые запросил график или анализ, но их не было локально',
    "Grafik yoki tahlil so'ragan, lekin lokalda bo'lmagan davrlar",
  ],
  lazyIdle: [
    'Nothing is being fetched in the background',
    'Фоновых загрузок нет',
    "Fonda hech nima yuklanmayapti",
  ],
  lazyWindows: ['{done} of {total} windows', 'Окон: {done} из {total}', '{total} oynadan {done}'],
  lazyRows: ['{n} rows fetched', 'Загружено строк: {n}', '{n} qator yuklandi'],
  lazyClear: ['Clear finished', 'Убрать завершённые', 'Tugaganlarni tozalash'],
  tBackfillDone: [
    'Archive extended · {rows} rows added',
    'Архив расширен · добавлено строк: {rows}',
    "Arxiv kengaytirildi · {rows} qator qo'shildi",
  ],
  notSet: ['not set', 'не задано', "kiritilmagan"],
  optional: ['optional', 'необязательно', 'ixtiyoriy'],
  modelHint: [
    'Model id exactly as your endpoint spells it',
    'ID модели точно как у вашего endpoint',
    "Model id — endpoint'ingizdagi kabi aynan",
  ],
  flags: ['Integration flags', 'Флаги интеграции', 'Integratsiya bayroqlari'],
  flMask: ['Mask credentials', 'Скрывать ключи', 'Kalitlarni yashirish'],
  flMaskH: [
    'Keys and tokens stay hidden until revealed',
    'Ключи скрыты, пока их не раскроют',
    "Kalitlar ochilmaguncha yashirin turadi",
  ],
  flDiag: ['Auto diagnostics', 'Автодиагностика', 'Avto diagnostika'],
  flDiagH: [
    'Run the connection check when this pane opens',
    'Проверять соединение при открытии раздела',
    'Bo‘lim ochilganda ulanishni tekshirish',
  ],
  resetAll: ['Reset settings', 'Сбросить настройки', 'Sozlamalarni tiklash'],
  resetAllQ: [
    'Reset all settings?',
    'Сбросить все настройки?',
    'Barcha sozlamalar tiklansinmi?',
  ],
  resetAllBody: [
    'Stored endpoints, keys, model choice and flags are cleared and the defaults restored. This cannot be undone.',
    'Сохранённые endpoint, ключи, выбор модели и флаги будут очищены, вернутся значения по умолчанию. Отменить нельзя.',
    "Saqlangan endpoint, kalit, model tanlovi va bayroqlar o‘chiriladi va standart qiymatlar tiklanadi. Buni qaytarib bo‘lmaydi.",
  ],
  storedLocal: [
    'Saved in this browser only. Anything kept here is readable by scripts on this page — use a key you can revoke, never a server-side secret.',
    'Хранится только в этом браузере. Всё здесь доступно скриптам страницы — используйте отзываемый ключ, не серверный секрет.',
    "Faqat shu brauzerda saqlanadi. Bu yerdagi hamma narsani sahifadagi skriptlar o‘qiy oladi — bekor qilsa bo‘ladigan kalitdan foydalaning, server sirini emas.",
  ],

  /* — command palette — */
  palPh: ['Type a command, SKU or question…', 'Команда, SKU или вопрос…', 'Buyruq, SKU yoki savol…'],
  palNo: ['No results', 'Нет результатов', "Natija yo'q"],
  palNav: ['navigate', 'навигация', 'harakat'],
  palOpen: ['open', 'открыть', 'ochish'],
  palAsk: ['ask Copilot', 'спросить Copilot', "Copilot'ga"],
  palIdxL: ['{n} products indexed', 'товаров в индексе: {n}', 'indeksda {n} mahsulot'],
  gAsk: ['Ask Copilot', 'Спросить Copilot', "Copilot'dan so'rash"],
  gProd: ['Products', 'Товары', 'Mahsulotlar'],
  gGo: ['Go to', 'Перейти', "O'tish"],
  aSync: ['Sync Uzum data now', 'Синхронизировать данные', "Uzum ma'lumotini sinxronlash"],
  aExport: ['Export products to CSV', 'Экспорт товаров в CSV', 'Mahsulotlarni CSV ga eksport'],
  aTheme: ['Toggle theme', 'Переключить тему', 'Mavzuni almashtirish'],

  /* — modals — */
  mMethod: [
    'How these numbers are derived',
    'Как считаются эти цифры',
    'Bu raqamlar qanday hisoblanadi',
  ],
  mMethodBody: [
    'Every figure on this screen is summed client-side from what the seller OpenAPI returns for the selected shopIds and date range: sellerPrice, purchasePrice, commission, logisticDeliveryFee and sellerProfit come from GET /v1/finance/orders, expenses from GET /v1/finance/expenses, order counts from GET /v2/fbs/orders/count, stock from GET /v3/fbs/sku/stocks and product rank, status and quantities from GET /v1/product/shop/{shopId}. The API exposes no aggregate, score or forecast endpoint, so nothing here is modelled — only added up.',
    'Все цифры на этом экране суммируются на клиенте из ответов seller OpenAPI за выбранные shopIds и период: sellerPrice, purchasePrice, commission, logisticDeliveryFee и sellerProfit — из GET /v1/finance/orders, расходы — из GET /v1/finance/expenses, количество заказов — из GET /v2/fbs/orders/count, остатки — из GET /v3/fbs/sku/stocks, ранг и статусы товаров — из GET /v1/product/shop/{shopId}. Агрегатов, скорингов и прогнозов в API нет.',
    "Bu ekrandagi har bir raqam tanlangan shopIds va davr uchun seller OpenAPI qaytargan ma'lumotdan klientda yig'iladi: sellerPrice, purchasePrice, commission, logisticDeliveryFee va sellerProfit — GET /v1/finance/orders, xarajatlar — GET /v1/finance/expenses, buyurtma soni — GET /v2/fbs/orders/count, qoldiq — GET /v3/fbs/sku/stocks, mahsulot rangi va holati — GET /v1/product/shop/{shopId}.",
  ],
  mDrill: [
    'sellerPrice & sellerProfit — expanded',
    'sellerPrice и sellerProfit — детально',
    'sellerPrice va sellerProfit — kengaytirilgan',
  ],
  mConfirm: ['Confirm & send', 'Подтвердить', 'Tasdiqlash'],
  mClose: ['Close', 'Закрыть', 'Yopish'],

  /* — forms — */
  fBarcode: ['Barcode', 'Штрих-код', 'Shtrix-kod'],
  fAmountF: ['Amount', 'Количество', 'Miqdor'],
  fFullPriceF: ['Full price', 'Полная цена', "To'liq narx"],
  fSellPrice: ['Sell price', 'Цена продажи', 'Sotuv narxi'],
  fReason: ['Reason', 'Причина', 'Sabab'],
  fComment: ['Comment', 'Комментарий', 'Izoh'],
  fOrdersF: ['Orders', 'Заказы', 'Buyurtmalar'],
  fDropOff: ['Drop-off point', 'Пункт отгрузки', 'Topshirish nuqtasi'],
  fTimeSlot: ['Time slot', 'Временной слот', 'Vaqt sloti'],
  fErrs: ['{n} fields need attention', 'Поля требуют внимания: {n}', "{n} maydon e'tibor talab qiladi"],
  fReq: ['Required', 'Обязательно', 'Majburiy'],
  fInt: ['Whole number required', 'Нужно целое число', 'Butun son kerak'],
  fNeg: ['Must be 0 or more', 'Не меньше 0', "0 dan kam bo'lmasin"],
  fUnique: ['Values must not repeat', 'Значения не должны повторяться', 'Qiymatlar takrorlanmasligi kerak'],
  fPriceOrder: [
    'Sell price cannot exceed full price',
    'Цена продажи не может превышать полную',
    "Sotuv narxi to'liq narxdan oshmasligi kerak",
  ],
  fMaxLabels: ['At most 100 labels per SKU', 'Не более 100 этикеток на SKU', 'Har SKU uchun 100 tagacha'],
  fSend: ['Send', 'Отправить', 'Yuborish'],
  fLabelSize: ['Label size', 'Размер этикетки', "Yorliq o'lchami"],
  fBarcodeType: ['Label type', 'Тип этикетки', 'Yorliq turi'],
  fCount: ['Labels per SKU', 'Этикеток на SKU', 'SKU uchun yorliq'],
  fIdentType: ['Identifier type', 'Тип идентификатора', 'Identifikator turi'],
  fIdentValues: ['Values (one per line)', 'Значения (по одному в строке)', 'Qiymatlar (har qatorda bitta)'],
  fIssueCode: ['Issue code', 'Код выдачи', 'Berish kodi'],
  fIdemp: ['Idempotency key', 'Ключ идемпотентности', 'Idempotentlik kaliti'],
  nfStock: [
    'Writes to the FBS stock endpoint for every barcode listed.',
    'Записывает остатки FBS по каждому штрих-коду.',
    'Har bir shtrix-kod uchun FBS qoldig‘ini yozadi.',
  ],
  nfPrice: [
    'sellPrice must not exceed fullPrice — Uzum rejects the pair otherwise.',
    'sellPrice не должен превышать fullPrice — иначе Uzum отклонит.',
    'sellPrice fullPrice dan oshmasligi kerak — aks holda Uzum rad etadi.',
  ],
  nfCancel: [
    'Cancellation is final and is reported to the buyer immediately.',
    'Отмена окончательна и сразу видна покупателю.',
    'Bekor qilish yakuniy va xaridorga darhol ko‘rinadi.',
  ],
  nfInvoice: [
    'Only drop-off points matching the dimensional group of these orders are offered.',
    'Предлагаются только пункты, подходящие по габаритам.',
    'Faqat ushbu buyurtmalar o‘lchamiga mos nuqtalar taklif qilinadi.',
  ],
  nfLabels: [
    'Up to 100 SKU per request and up to 100 labels per SKU. Sizes come from the barcode-types reference.',
    'До 100 SKU в запросе и до 100 этикеток на SKU. Размеры — из справочника типов.',
    "So'rovda 100 tagacha SKU, har SKU uchun 100 tagacha yorliq. O'lchamlar turlar ma'lumotnomasidan.",
  ],
  nfIdent: [
    'Values must be unique inside one order item. The types come from the order itself.',
    'Значения не должны повторяться внутри позиции. Типы приходят из заказа.',
    "Bir pozitsiya ichida qiymatlar takrorlanmasligi kerak. Turlar buyurtmadan keladi.",
  ],
  nfComplete: [
    'DBS handover is confirmed with the issue code the customer shows.',
    'Выдача DBS подтверждается кодом, который называет покупатель.',
    'DBS topshirish xaridor aytgan kod bilan tasdiqlanadi.',
  ],
  nfContent: [
    'Removes one customer order from the invoice. The invoice keeps its point and slot.',
    'Удаляет заказ из накладной. Пункт и слот сохраняются.',
    "Nakladnoydan bitta buyurtmani olib tashlaydi. Punkt va slot saqlanadi.",
  ],

  /* — progress & toasts — */
  prExport: ['Preparing the export', 'Готовим экспорт', 'Eksport tayyorlanmoqda'],
  prLabels: ['Printing labels', 'Печатаем этикетки', 'Yorliqlar chop etilmoqda'],
  prSend: ['Sending to Uzum', 'Отправляем в Uzum', 'Uzumga yuborilmoqda'],
  tExport: ['CSV downloaded', 'CSV скачан', 'CSV yuklab olindi'],
  tConfd: ['{n} orders confirmed', 'Подтверждено заказов: {n}', '{n} buyurtma tasdiqlandi'],
  tFail: ['Uzum rejected the request', 'Uzum отклонил запрос', 'Uzum so‘rovni rad etdi'],
  tSkuCopied: ['Copied', 'Скопировано', 'Nusxalandi'],
  tHidden: ['Row hidden', 'Строка скрыта', 'Qator yashirildi'],
  tCancelled: ['Cancelled', 'Отменено', 'Bekor qilindi'],
  aiBusy: [
    'The model is overloaded and did not answer after three attempts.',
    'Модель перегружена и не ответила после трёх попыток.',
    "Model band — uch marta urinildi, javob bo'lmadi.",
  ],
  aiOffline: [
    'The model could not be reached after three attempts.',
    'До модели не удалось достучаться за три попытки.',
    "Modelga uch urinishda ham ulanib bo'lmadi.",
  ],
  aiSlow: [
    'The model stopped responding part-way.',
    'Модель перестала отвечать на середине.',
    "Model javob berishni yarmida to'xtatdi.",
  ],
  /* "Continue", not "Retry": the lookups already run are kept, and only the
     round that failed is asked again. */
  cResume: ['Continue', 'Продолжить', 'Davom ettirish'],
  tStockSent: [
    'Stock update sent · POST /v2/fbs/sku/stocks',
    'Остатки отправлены · POST /v2/fbs/sku/stocks',
    "Qoldiq yuborildi · POST /v2/fbs/sku/stocks",
  ],
  tPriceSent: [
    'Price sent · POST /v1/product/{shopId}/sendPriceData',
    'Цена отправлена · POST /v1/product/{shopId}/sendPriceData',
    'Narx yuborildi · POST /v1/product/{shopId}/sendPriceData',
  ],
  tOrdCancelled: ['Order cancelled', 'Заказ отменён', 'Buyurtma bekor qilindi'],
  tIdentSaved: ['Identifiers bound', 'Идентификаторы привязаны', 'Identifikatorlar biriktirildi'],
  tInvCreated: ['Invoice created', 'Накладная создана', 'Nakladnoy yaratildi'],
  tInvCancelled: ['Invoice cancelled', 'Накладная отменена', 'Nakladnoy bekor qilindi'],
  tContentUpd: ['Invoice content updated', 'Состав накладной обновлён', 'Tarkib yangilandi'],
  tSlotUpd: ['Point and slot updated', 'Пункт и слот обновлены', 'Punkt va slot yangilandi'],
  tPdfReady: ['PDF downloaded', 'PDF скачан', 'PDF yuklab olindi'],
  tDelivering: ['DBS order handed to delivery', 'DBS-заказ передан в доставку', 'DBS buyurtma yetkazishga berildi'],
  tCompleted: ['DBS handover confirmed', 'Выдача DBS подтверждена', 'DBS topshirish tasdiqlandi'],
  tRefundCreated: ['Refund created', 'Возврат создан', 'Qaytarish yaratildi'],
  tSyncFailed: [
    'Sync failed — {n} source(s) did not load',
    'Синхронизация не удалась — источников без данных: {n}',
    "Sinxronizatsiya muvaffaqiyatsiz — {n} manba yuklanmadi",
  ],
  tSyncDone: ['Sync complete · {rows} rows', 'Синхронизация завершена · строк: {rows}', 'Sinxronizatsiya tugadi · {rows} qator'],
  tSnapTrimmed: [
    'Saved offline · {n} source(s) trimmed to fit storage',
    'Сохранено офлайн · источников урезано: {n}',
    "Oflayn saqlandi · {n} manba joy yetmagani uchun qisqartirildi",
  ],
  tSnapUnsaved: [
    'Could not save offline — the next launch will start empty',
    'Не удалось сохранить офлайн — следующий запуск начнётся с нуля',
    "Oflayn saqlanmadi — keyingi ochilishda ma'lumot bo'lmaydi",
  ],
  undoL: ['Undo', 'Отменить', 'Qaytarish'],
  retryL: ['Retry', 'Повторить', 'Qayta'],

  /* — confirmations — */
  cfConfirmT: ['Confirm {n} orders?', 'Подтвердить {n} заказов?', '{n} buyurtma tasdiqlansinmi?'],
  cfConfirmB: [
    'One POST /v1/fbs/order/{orderId}/confirm per order. The SLA clock stops when Uzum answers.',
    'По одному POST /v1/fbs/order/{orderId}/confirm на заказ. SLA останавливается после ответа Uzum.',
    "Har buyurtma uchun bitta POST /v1/fbs/order/{orderId}/confirm. Uzum javob bergach SLA to'xtaydi.",
  ],
  cfCancelOrdT: ['Cancel this order?', 'Отменить заказ?', 'Buyurtma bekor qilinsinmi?'],
  cfCancelOrdB: [
    'Cancellation is sent to Uzum with the reason you picked and cannot be undone from here.',
    'Отмена уйдёт в Uzum с выбранной причиной и не отменяется отсюда.',
    "Bekor qilish tanlangan sabab bilan Uzumga yuboriladi va bu yerdan qaytarilmaydi.",
  ],
  cfInvCancelT: ['Cancel this invoice?', 'Отменить накладную?', 'Nakladnoy bekor qilinsinmi?'],
  cfInvCancelB: [
    'POST /v1/fbs/invoice/{invoiceId}/cancel. Orders in it return to their previous status.',
    'POST /v1/fbs/invoice/{invoiceId}/cancel. Заказы вернутся в прежний статус.',
    "POST /v1/fbs/invoice/{invoiceId}/cancel. Buyurtmalar avvalgi holatiga qaytadi.",
  ],
  cfRefundT: ['Create a refund for this DBS order?', 'Создать возврат по DBS-заказу?', 'DBS qaytarish yaratilsinmi?'],
  cfRefundB: [
    'POST /v1/dbs/order/{orderId}/refund. The order moves to RETURNED.',
    'POST /v1/dbs/order/{orderId}/refund. Заказ перейдёт в RETURNED.',
    "POST /v1/dbs/order/{orderId}/refund. Buyurtma RETURNED holatiga o'tadi.",
  ],
  cfDeliverT: ['Hand this order to delivery?', 'Передать заказ в доставку?', 'Buyurtma yetkazishga berilsinmi?'],
  cfDeliverB: [
    'POST /v1/dbs/order/{orderId}/delivering. The buyer is notified that it is on the way.',
    'POST /v1/dbs/order/{orderId}/delivering. Покупатель получит уведомление.',
    "POST /v1/dbs/order/{orderId}/delivering. Xaridorga xabar boradi.",
  ],
  cfHideT: ['Hide this row?', 'Скрыть строку?', 'Qatorni yashirish?'],
  cfHideB: [
    'It disappears from this table only. Reset the view to bring it back.',
    'Строка скроется только в этой таблице. Сбросьте вид, чтобы вернуть.',
    "Faqat bu jadvaldan yashiriladi. Ko'rinishni tiklab qaytarish mumkin.",
  ],

  /* — insights & chat — */
  aiInsights: ['AI insights', 'ИИ-инсайты', 'AI tahlillari'],
  evidenceL: ['Evidence', 'Доказательства', 'Dalillar'],
  sevCritical: ['Critical', 'Критично', 'Muhim'],
  sevHigh: ['High', 'Высокий', 'Yuqori'],
  sevWatch: ['Watch', 'Наблюдать', 'Kuzatuv'],
  sevIdea: ['Idea', 'Идея', "G'oya"],
  catMargin: ['Margin', 'Маржа', 'Marja'],
  catInventory: ['Inventory', 'Склад', 'Ombor'],
  catOperations: ['Operations', 'Операции', 'Operatsiyalar'],
  catAnomaly: ['Anomaly', 'Аномалия', 'Anomaliya'],
  catOpportunity: ['Opportunity', 'Возможность', 'Imkoniyat'],
  apply: ['Apply', 'Применить', "Qo'llash"],
  askWhy: ['Ask why', 'Почему?', 'Nega?'],
  dismissL: ['Dismiss', 'Отклонить', 'Rad etish'],
  tDismissed: ['Insight dismissed', 'Инсайт отклонён', 'Tahlil rad etildi'],
  explainQ: [
    'Where is sellerProfit going this month?',
    'Куда уходит sellerProfit в этом месяце?',
    "Bu oy sellerProfit qayerga ketmoqda?",
  ],
  qStock: [
    'Why is quantityAvailable zero on so many SKU?',
    'Почему у стольких SKU нулевой остаток?',
    "Nega shuncha SKU da quantityAvailable nol?",
  ],
  qOps: [
    'What is holding up order confirmation?',
    'Что задерживает подтверждение заказов?',
    'Buyurtma tasdig‘ini nima ushlab turibdi?',
  ],
  copilotEmpty: [
    'Ask about margin, stock, payouts or any SKU — every answer traces back to a seller API endpoint.',
    'Спросите о марже, остатках, выплатах или любом SKU — каждый ответ ссылается на эндпоинт API.',
    "Marja, qoldiq, to'lov yoki istalgan SKU haqida so'rang — har bir javob API endpointiga bog'lanadi.",
  ],
  copilotPh: ['Ask about your data…', 'Спросите о ваших данных…', "Ma'lumotingiz haqida so'rang…"],
  copilotSend: ['Send', 'Отправить', 'Yuborish'],
  copilotClear: ['Clear thread', 'Очистить', 'Tozalash'],
  copilotThinking: ['Reading the API…', 'Читаю API…', 'API o‘qilmoqda…'],

  /* — connection — */
  offlineL: ['Offline', 'Офлайн', 'Oflayn'],
  connChecking: ['Checking connection…', 'Проверка подключения…', 'Ulanish tekshirilmoqda…'],
  connNone: ['No token', 'Токен не задан', 'Token yo’q'],
  shopsCount: ['{n} shop(s)', 'магазинов: {n}', "{n} ta do'kon"],
  syncCancel: ['Cancel sync', 'Отменить синхронизацию', 'Sinxronizatsiyani bekor qilish'],
  syncSources: ['{done} of {total} sources', 'Источников: {done} из {total}', '{total} dan {done} manba'],
  emptyNotifs: ['Nothing has happened yet', 'Событий пока нет', "Hozircha hech nima bo'lmadi"],
  noInsights: [
    'Nothing stands out in the current window',
    'В текущем периоде отклонений нет',
    "Joriy davrda e'tiborga loyiq narsa yo'q",
  ],
  openRows: ['Show the rows', 'Показать строки', "Qatorlarni ko'rish"],

  /* — mobile chrome — */
  menuL: ['Menu', 'Меню', 'Menyu'],
  moreL: ['More', 'Ещё', 'Yana'],
  navSection: ['Sections', 'Разделы', "Bo'limlar"],
  scopeSection: ['Scope', 'Область', 'Qamrov'],
  toolsSection: ['Tools', 'Инструменты', 'Asboblar'],
  storeL: ['Store', 'Магазин', "Do'kon"],
  rangeL: ['Period', 'Период', 'Davr'],
  filtersL: ['Filters', 'Фильтры', 'Filtrlar'],
  sortL: ['Sort', 'Сортировка', 'Saralash'],
  detailsL: ['Details', 'Подробнее', 'Batafsil'],
  pageOf: ['Page {n} of {total}', 'Стр. {n} из {total}', '{total} dan {n}-sahifa'],

  /* — insights: rail chrome — */
  insAll: ['All', 'Все', 'Barchasi'],
  insImportant: ['Important', 'Важное', 'Muhim'],
  grProfit: ['Profit', 'Прибыль', 'Foyda'],
  grStockOps: ['Stock and operations', 'Склад и операции', 'Zaxira va operatsiya'],
  grAnomaly: ['Anomalies', 'Аномалии', 'Anomaliyalar'],
  insNoMatch: [
    'Nothing in this filter',
    'В этом фильтре ничего нет',
    "Bu filtrda hech nima yo'q",
  ],
  insSignal: ['Signal', 'Сигнал', 'Signal'],
  aiPending: ['The model is reading the window…', 'Модель читает период…', 'Model davrni o‘qimoqda…'],
  aiWrote: ['Written by the model', 'Написано моделью', 'Model tomonidan yozilgan'],
  recAction: ['Recommended action', 'Рекомендуемое действие', 'Tavsiya etilgan amal'],

  /* — insights: actions and risk — */
  iaPrice: ['Change price', 'Изменить цену', "Narxni o'zgartirish"],
  iaStock: ['Update stock', 'Обновить остаток', 'Qoldiqni yangilash'],
  iaConfirm: ['Confirm orders', 'Подтвердить заказы', 'Buyurtmalarni tasdiqlash'],
  iaRange: ['Change the period', 'Сменить период', "Davrni o'zgartirish"],
  iaCancelOrder: ['Cancel the order', 'Отменить заказ', 'Buyurtmani bekor qilish'],
  iaDeliver: ['Send for delivery', 'Передать в доставку', 'Yetkazishga uzatish'],
  iaComplete: ['Confirm handover', 'Подтвердить вручение', 'Topshirilganini tasdiqlash'],
  iaRefund: ['Register a refund', 'Оформить возврат', 'Qaytarishni rasmiylashtirish'],
  iaCancelInvoice: ['Cancel the shipment', 'Отменить накладную', 'Nakladnoyni bekor qilish'],
  iaLabel: ['Download the label', 'Скачать этикетку', 'Yorliqni yuklab olish'],
  iaBarcodes: ['Download barcodes', 'Скачать штрих-коды', 'Shtrix-kodlarni yuklash'],
  iaSupplyAct: ['Download the supply act', 'Скачать акт поставки', 'Yetkazish aktini yuklash'],
  iaAcceptAct: [
    'Download the acceptance act',
    'Скачать акт приёмки',
    'Qabul aktini yuklash',
  ],
  riskMid: ['medium risk', 'средний риск', "o'rta xavf"],
  riskHigh: ['high risk', 'высокий риск', 'yuqori xavf'],
  insConfirmT: ['Apply this action?', 'Применить действие?', "Amalni qo'llaysizmi?"],
  insConfirmB: [
    'This sends a write request to Uzum with the values shown above. It cannot be undone from here.',
    'Будет отправлен запрос на изменение в Uzum с показанными значениями. Отменить отсюда нельзя.',
    "Yuqoridagi qiymatlar bilan Uzum'ga o'zgartirish so'rovi yuboriladi. Bu yerdan bekor qilib bo'lmaydi.",
  ],

  /* — insights: rule wording — */
  insZeroT: [
    '{n} of {total} SKU have quantityAvailable = 0',
    'У {n} из {total} SKU quantityAvailable = 0',
    '{total} SKU dan {n} tasida quantityAvailable = 0',
  ],
  insZeroB: [
    'Most of the catalogue cannot be bought right now. The loss here is unsold demand rather than storage cost — a card that is live but empty still spends its ranking.',
    'Большую часть каталога сейчас нельзя купить. Потеря здесь — непроданный спрос, а не стоимость хранения: активная, но пустая карточка всё равно расходует свой ранг.',
    "Katalogning ko'p qismini hozir sotib bo'lmaydi. Bu yerdagi yo'qotish — saqlash xarajati emas, sotilmagan talab: faol, lekin bo'sh kartochka reytingini baribir sarflaydi.",
  ],
  insNegT: [
    '{n} SKU report negative stock',
    '{n} SKU показывают отрицательный остаток',
    '{n} SKU manfiy qoldiq ko‘rsatmoqda',
  ],
  insNegB: [
    'Reserved units exceed what the warehouse has registered. Nothing on these SKUs can be sold and the open reservations will cancel on their own.',
    'Зарезервированных единиц больше, чем зарегистрировано на складе. По этим SKU ничего не продать, а открытые резервы отменятся сами.',
    "Rezervlangan birliklar ombor ro'yxatidan oshib ketgan. Bu SKU'lar bo'yicha hech nima sotilmaydi va ochiq rezervlar o'z-o'zidan bekor bo'ladi.",
  ],
  insCancelT: [
    '{pct} of order items were cancelled',
    '{pct} позиций заказов отменено',
    'Buyurtma qatorlarining {pct} qismi bekor qilingan',
  ],
  insCancelB: [
    'Cancelled items return commission and sellerProfit as zero, but the delivery fee is still charged and only partly refunded. The gap between what sold and what shipped is where the money goes.',
    'По отменённым позициям commission и sellerProfit приходят нулевыми, но доставка всё равно списывается и возвращается лишь частично. Деньги уходят в разрыв между проданным и отгруженным.',
    "Bekor qilingan qatorlarda commission va sellerProfit nol bo'lib keladi, lekin yetkazib berish haqi baribir yechiladi va faqat qisman qaytariladi. Pul sotilgan va jo'natilgan o'rtasidagi farqqa ketadi.",
  ],
  insTakeT: [
    'Marketplace fees take {pct} of revenue',
    'Комиссии маркетплейса забирают {pct} выручки',
    'Marketplace to‘lovlari tushumning {pct} qismini oladi',
  ],
  insTakeB: [
    'Commission and delivery are deducted before sellerProfit, so this share is gone before your own purchase price is counted. Price and discount depth are the only levers on it.',
    'Комиссия и доставка вычитаются до sellerProfit, поэтому эта доля уходит ещё до учёта вашей закупки. Влиять на неё можно только ценой и глубиной скидки.',
    "Komissiya va yetkazib berish sellerProfit'dan oldin ushlab qolinadi, ya'ni bu ulush sizning tannarxingiz hisobga olinmasidan burun ketadi. Unga faqat narx va chegirma chuqurligi ta'sir qiladi.",
  ],
  insLossT: [
    'The period is running at a loss after expenses',
    'Период убыточен после расходов',
    'Davr xarajatlardan keyin zarar bilan yakunlanmoqda',
  ],
  insThinT: [
    'Net margin is {pct} after expenses',
    'Чистая маржа после расходов — {pct}',
    'Xarajatlardan keyin sof marja {pct}',
  ],
  insMarginB: [
    'sellerProfit looks healthier than the account is: your purchase price and the marketing and storage rows of the expense ledger still have to come out of it.',
    'sellerProfit выглядит лучше, чем состояние счёта: из него ещё предстоит вычесть закупку, а также строки рекламы и хранения из книги расходов.',
    "sellerProfit hisobning haqiqiy holatidan yaxshiroq ko'rinadi: undan tannarx hamda xarajat daftaridagi reklama va saqlash qatorlari hali chiqarilishi kerak.",
  ],
  insExpenseT: [
    '{source} costs {pct} of revenue',
    '{source} стоит {pct} выручки',
    '{source} tushumning {pct} qismini oladi',
  ],
  insExpenseB: [
    'This is charged on top of the marketplace fee and is not inside sellerProfit, so it lands directly on net profit.',
    'Это списывается сверх комиссии маркетплейса и не входит в sellerProfit, поэтому ложится прямо на чистую прибыль.',
    "Bu marketplace komissiyasi ustiga yechiladi va sellerProfit ichida emas, shuning uchun to'g'ridan-to'g'ri sof foydaga tushadi.",
  ],
  insReturnT: [
    '{n} product(s) return above {pct}',
    'У {n} товар(ов) возврат выше {pct}',
    '{n} ta mahsulotda qaytarish {pct} dan yuqori',
  ],
  insReturnB: [
    'A returned unit costs the delivery both ways and comes back to the warehouse as stock you have already paid to store. The card, not the price, is usually the cause.',
    'Возврат оплачивает доставку в обе стороны и возвращается на склад как товар, за хранение которого вы уже платите. Причина обычно в карточке, а не в цене.',
    "Qaytarilgan birlik yetkazib berishni ikki tomonlama to'laydi va omborga siz allaqachon saqlash haqini to'layotgan tovar bo'lib qaytadi. Sabab odatda narxda emas, kartochkada.",
  ],
  insSupplyT: [
    '{n} units never reached the warehouse',
    '{n} единиц так и не дошли до склада',
    '{n} birlik omborga yetib bormadi',
  ],
  insSupplyB: [
    'These supply invoices were accepted for fewer units than were declared. The difference is stock you have paid for and cannot sell.',
    'Эти поставочные накладные приняты на меньшее число единиц, чем заявлено. Разница — товар, за который заплачено и который нельзя продать.',
    "Bu yetkazib berish hujjatlari e'lon qilinganidan kamroq birlik uchun qabul qilingan. Farq — siz to'lagan, lekin sotolmaydigan tovar.",
  ],

  /* — insights: evidence labels — */
  evRevenue: ['Revenue (Σ sellPrice)', 'Выручка (Σ sellPrice)', 'Tushum (Σ sellPrice)'],
  evCost: ['Purchase price', 'Закупочная цена', 'Tannarx'],
  evCommission: ['Commission', 'Комиссия', 'Komissiya'],
  evLogistics: ['Logistics charged', 'Списано за логистику', 'Logistika uchun yechilgan'],
  evSellerProfit: ['Seller profit', 'Прибыль продавца', 'Sotuvchi foydasi'],
  evNetProfit: ['Net profit', 'Чистая прибыль', 'Sof foyda'],
  evExpenseOther: [
    'Expenses excluding logistics',
    'Расходы без логистики',
    'Logistikasiz xarajatlar',
  ],
  evCancelled: ['Cancelled order items', 'Отменённые позиции', 'Bekor qilingan qatorlar'],
  evLive: ['Live order items', 'Активные позиции', 'Faol qatorlar'],
  evZeroSku: ['SKU at zero available', 'SKU с нулевым остатком', 'Nol qoldiqli SKU'],
  evShare: ['Share of the catalogue', 'Доля каталога', 'Katalogdagi ulush'],
  evRunOut: ['Products in RUN_OUT', 'Товары в RUN_OUT', 'RUN_OUT holatidagi mahsulotlar'],
  evReturnRate: ['Return rate', 'Доля возвратов', 'Qaytarish ulushi'],
  evMissingUnits: ['Units missing', 'Недостающие единицы', 'Yetishmayotgan birliklar'],
  evShortInvoices: ['Short invoices', 'Неполные накладные', "To'liqsiz hujjatlar"],

  /* — insights: table columns — */
  colSku: ['SKU', 'SKU', 'SKU'],
  colAvailable: ['Available', 'Доступно', 'Mavjud'],
  colProduct: ['Product', 'Товар', 'Mahsulot'],
  colInvoice: ['Invoice', 'Накладная', 'Hujjat'],
  colAccepted: ['Accepted / declared', 'Принято / заявлено', "Qabul / e'lon"],

  /* — copilot: answers — */
  ctxLabel: ['Context', 'Контекст', 'Kontekst'],
  deepMode: ['Deep reasoning', 'Глубокий анализ', 'Chuqur tahlil'],
  exportPdf: ['PDF', 'PDF', 'PDF'],
  srcCount: ['{n} sources · {s}s', 'источников: {n} · {s}с', '{n} manba · {s}s'],
  selectAll: ['Select all', 'Выбрать все', 'Hammasini tanlash'],
  confirmRows: [
    '{n} of {m} will be sent',
    'Будет отправлено: {n} из {m}',
    '{m} tadan {n} tasi yuboriladi',
  ],
  cSku: ['SKU', 'SKU', 'SKU'],
  cOrder: ['Order', 'Заказ', 'Buyurtma'],

  /* — pinned answers — */
  pinAnswer: ['Pin to dashboard', 'Закрепить на панели', "Panelga qadash"],
  pinned: ['Pinned', 'Закреплено', 'Qadaldi'],
  unpin: ['Remove from dashboard', 'Убрать с панели', 'Paneldan olib tashlash'],
  pinLoading: ['Re-reading the figures…', 'Пересчитываю цифры…', 'Raqamlar qayta o‘qilmoqda…'],
  pinStale: [
    'Some figures could not be re-read for this period',
    'Часть цифр не удалось пересчитать за этот период',
    "Ba'zi raqamlar bu davr uchun qayta o'qilmadi",
  ],

  /* — standing rules — */
  iaAlert: ['Set the rule', 'Создать правило', 'Qoida qo‘yish'],
  iaAlertOff: ['Remove the rule', 'Удалить правило', 'Qoidani olib tashlash'],
  alSet: [
    'Rule set: {kind} ({t})',
    'Правило создано: {kind} ({t})',
    'Qoida qo‘yildi: {kind} ({t})',
  ],
  alCleared: ['{n} rule(s) removed', 'Удалено правил: {n}', '{n} ta qoida o‘chirildi'],
  alTitle: ['Standing rules', 'Постоянные правила', 'Doimiy qoidalar'],
  alEmpty: [
    'No rules yet. Ask the Copilot to watch something for you — “tell me when a SKU runs out”.',
    'Правил пока нет. Попросите Copilot следить: «сообщи, когда SKU закончится».',
    "Hozircha qoida yo'q. Copilot'dan so'rang: «SKU tugasa ayt».",
  ],
  alNeverFired: ['not fired yet', 'ещё не срабатывало', 'hali ishlamagan'],
  alLastFired: ['last fired {when}', 'сработало {when}', 'oxirgi marta {when}'],
  alStockEmpty: [
    '{n} SKU(s) are out of stock',
    'SKU без остатка: {n}',
    "{n} ta SKU qoldiqsiz qoldi",
  ],
  alStockBelow: [
    '{n} SKU(s) are below {t} units',
    'SKU ниже {t} шт.: {n}',
    "{n} ta SKU qoldig'i {t} donadan kam",
  ],
  alOrderDeadline: [
    '{n} order(s) must be confirmed within {h}h',
    'Заказов подтвердить за {h}ч: {n}',
    '{n} ta buyurtma {h} soat ichida tasdiqlanishi kerak',
  ],
  alMarginBelow: [
    'Net margin has fallen below {t}%',
    'Чистая маржа упала ниже {t}%',
    'Sof marja {t}% dan pastga tushdi',
  ],
  alCancelAbove: [
    'Cancellation rate is above {t}%',
    'Доля отмен выше {t}%',
    'Bekor qilish ulushi {t}% dan oshdi',
  ],

  lookups: ['{n} lookups', 'запросов: {n}', "{n} ta so'rov"],
  toolTrace: ['Read', 'Прочитано', "O'qildi"],
  droppedBlocks: [
    '{n} line(s) could not be drawn',
    'Не отрисовано строк: {n}',
    '{n} ta qator chizilmadi',
  ],
} as const satisfies Record<string, readonly [string, string, string]>;

export type TranslationKey = keyof typeof TUPLES;

const LANG_INDEX: Record<Language, 0 | 1 | 2> = { en: 0, ru: 1, uz: 2 };

export function translate(key: TranslationKey, lang: Language): string {
  return TUPLES[key][LANG_INDEX[lang]];
}

/** Substitutes `{name}` placeholders — the design's only interpolation form. */
export function interpolate(text: string, vars: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
