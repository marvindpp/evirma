// import_contractors.js — импорт всех подрядчиков из Chatium
// Запуск: node import_contractors.js
'use strict';
const { getDb } = require('./db.js');
const db = getDb();

const contractors = [
  {
    name: 'Wildcrm',
    category: 'Финансовый учет',
    contact: 'https://t.me/wildcrm_bot?start=ref_871e22ee2db69c697853e4c2066bb090',
    website: 'https://t.me/wildcrm_bot?start=ref_871e22ee2db69c697853e4c2066bb090',
    promo_code: 'Max Evirma',
    description: 'Облачный сервис для оцифровки бизнеса на Wildberries.\n\nЧтобы получить бонусные баллы на счет:\n1. Зарегистрируйтесь по реферальной ссылке\n2. Напишите в поддержку "Max Evirma"\n\nПо ссылке Закрытого канала — 400 бонусных баллов на счет для оплаты сервиса.\nВсе новые пользователи получат 3 пробных дня на весь функционал.',
    sort_order: 1
  },
  {
    name: 'SoykaSoft',
    category: 'Финансовый учет',
    contact: 'https://clck.ru/3PFhkj',
    website: 'https://clck.ru/3PFhkj',
    promo_code: 'EVIRMA',
    description: 'Для участников Max Evirma Club:\n• 5% дополнительная скидка на все тарифы по промокоду\n• 2 часа работы финаналитика Soyka бесплатно (разбор ваших цифр и рекомендации)\n\nИтого:\nТариф на 3 месяца — скидка 15%\nТариф на 6 месяцев — скидка 20%\nТариф на 9 месяцев — скидка 25%\n\nSoykaSoft — помогает видеть реальную прибыль и маржинальность по каждому товару, управлять кэшфлоу и находить точки роста бизнеса на основе цифр.',
    sort_order: 2
  },
  {
    name: 'Александра К',
    category: 'Дизайнер',
    contact: '89163132868 | @AlexandraL2sha',
    website: '@AlexandraL2sha',
    promo_code: '',
    description: 'Честно погрузилась в тематику и быстро предложила визуальное решение для наших карточек на WB.',
    sort_order: 3
  },
  {
    name: 'Педантекс',
    category: 'Фулфилмент',
    contact: '@Trubetzkoi12',
    website: 'https://moscow.ff-pedantex.ru/?utm_source=yab',
    promo_code: 'EVIRMACLUB',
    description: 'Особые условия для участников:\n* Первый месяц работы — скидка 20%\n* Второй месяц работы — скидка 15%\n\n* Просторный склад 300 м² с современной системой управления\n* Удобное расположение на Курьяновской набережной\n* Интеграция с Wildberries, Ozon и другими площадками\n* Полный комплекс услуг — от хранения до доставки\n* Индивидуальный подход к каждому клиенту',
    sort_order: 4
  },
  {
    name: 'Сертификат Профэкспресс',
    category: 'Честный знак и сертификация',
    contact: '+79010835507 — Василий | @certprof',
    website: 'https://certprofexp.ru',
    promo_code: 'CERTPROF26',
    description: 'Скидка 10% на первое оформление документов.\n\nСертификаты | Декларации | СГР | Маркировка ЧЗ | Регистрация Торгового знака | Помощь в оформлении разрешительных документов.\n\n— С 2020 года в сертификации\n— Опыт с СГР, Регистрация ТУ, Сертификаты Утверждения Типа\n— Более 100 сертификаций\n— Опыт с одеждой, электронными кальянами, станками с ЧПУ',
    sort_order: 5
  },
  {
    name: 'Олег Петров, ООО Фактори',
    category: 'Производства',
    contact: '89057110280 | Factorypd@yandex.ru | @Olegvpetrov',
    website: '@Olegvpetrov',
    promo_code: 'Evirma',
    description: 'Пошив одежды. Специализируется на различных тканях, работает для 2 крупных брендов на WB (атлас/искусственный шёлк).\n\nБольшой цех, исполнение больших объёмов. Работа в белую по р/с. Работа с ЧЗ. Помогают в разработке лекал, есть экспериментальный цех.\n\n— Бесплатный подбор тканей для всех участников Закрытого канала',
    sort_order: 6
  },
  {
    name: 'Самовыкупы «ТКМ»',
    category: 'Выкупы',
    contact: '@tkmarketplaces',
    website: 'https://t.me/tkm_manager',
    promo_code: 'TKM_EVIRMA',
    description: 'Самовыкупы для Wildberries и OZON.\n\n— Выкупы на 25 городов России\n— 5000 живых аккаунтов со статичными ПВЗ\n— Выкупы вручную, никаких ботов\n— Сами забирают товар\n— Есть фулфилмент\n— Работа по договору\n— Удобный личный кабинет и своевременная отчетность\n— Фотоотзывы',
    sort_order: 7
  },
  {
    name: 'Lemro',
    category: 'Логистика',
    contact: '@Lemro_info',
    website: 'https://t.me/lemro_moskow',
    promo_code: 'Артем',
    description: 'Фулфилмент и логистика. Низкие цены, много направлений, быстрая отгрузка. Руководитель с опытом из одного из крупнейших ФФ. С ФФ работаешь с человеком, а не с конторой — очень комфортно.',
    sort_order: 8
  },
  {
    name: 'BDA Logistics',
    category: 'Логистика',
    contact: '+7 985 623-07-99',
    website: 'https://t.me/BDA_Logistic',
    promo_code: 'Artem72',
    description: 'Карго из Китая. Давно работаем, без косяков. Со временем сделали отсрочку за логистику, затем оплату на фабрику за вас. Хороший курс на обмен, тарифы на логистику. Оплата: наличка или USDT.',
    sort_order: 9
  },
  {
    name: 'Kurochka',
    category: 'Съёмки и контент',
    contact: '+79859199343 — Дмитрий',
    website: 'https://kurochka.moscow/',
    promo_code: '',
    description: 'Производство видео, фото, пакеты «под ключ». Киношники, работают с маркетплейсами. Лучше делать ТЗ, есть классные кейсы. На объёме сделают скидку.',
    sort_order: 10
  },
  {
    name: 'trendHero',
    category: 'Аналитика, оцифровка',
    contact: '@Adam_trendHero',
    website: 'https://trendhero.io/ru/',
    promo_code: 'MaxHero',
    description: 'Скидка 20% для всех новых клиентов по промокоду.\n\ntrendHero — аналитический сервис для Instagram с базой 110+ млн аккаунтов.\n\n• Проверка аудитории, вовлечённости и накруток\n• Поиск инфлюенсеров по нише, гео, ключевым словам\n• Выявление ботов и массфолловинга\n• Отслеживание упоминаний брендов',
    sort_order: 11
  },
  {
    name: 'CTR.box',
    category: 'Съёмки и контент',
    contact: '@ctrbox_manager',
    website: 'https://www.instagram.com/ctr.box/',
    promo_code: 'CTR',
    description: 'Скидка 15% по промокоду (кроме аренды фотостудии и моделей).\n\nКонтент для маркетплейсов под ключ за 2 недели, исходники — за 24 часа.\n250+ CTR-тестов, до 3 офферов в карточку, все форматы видео и фото, съёмки на невидимом манекене, инфографика, слайды с ИИ (5 нейросетей).',
    sort_order: 12
  },
  {
    name: 'Карго — ЮВА и Фулфилмент',
    category: 'Логистика',
    contact: '@shurban87',
    website: 'https://t.me/kargo_voz',
    promo_code: 'maxEvirma',
    description: 'Забор груза с ЮВА и фулфилмент.\n\n— 20% скидка на первый заказ карго\n— 20% скидка на первый заказ по ФБО или первый месяц по ФБС\n\nРаботаем стабильно без праздников и выходных в любую погоду.',
    sort_order: 13
  },
  {
    name: 'The View Studio',
    category: 'Съёмки и контент',
    contact: '@theviewstudio',
    website: 'https://theviewstudio.ru/',
    promo_code: 'MAX',
    description: 'Скидка 7% на сборные и индивидуальные съёмки. Мобильный контент и основной контент на камеру. Белый фон, интерьер, стрит-съёмки.',
    sort_order: 14
  },
  {
    name: 'MoneySellers',
    category: 'Финансовый учет',
    contact: 'https://clck.ru/3M2PDG',
    website: 'https://clck.ru/3M2PDG',
    promo_code: '',
    description: 'Система управления и контроля финансов для маркетплейсов.\n\nОсобые условия при переходе по ссылке:\n1. Месяц в подарок по окончании оплаченного периода\n2. Тестовый доступ на 7 дней\n3. Бесплатный доступ к обучению по финансам при покупке лицензии',
    sort_order: 15
  },
  {
    name: 'MARPLA',
    category: 'Аналитика, оцифровка',
    contact: 'https://marpla.ru/',
    website: 'https://marpla.ru/',
    promo_code: 'Evirmamay',
    description: 'Аналитика и продвижение товаров на WB.\n\n7 дней полного доступа к сервису Марпла по промокоду. Маркетинговые активности и аналитика для роста продаж.',
    sort_order: 16
  },
  {
    name: 'SKEYLO',
    category: 'Юрист',
    contact: '@skeylomanager',
    website: 'https://t.me/skeylowb',
    promo_code: 'EVIRMA',
    description: 'Скидка 15% на все юридические услуги для участников Закрытого канала.\n\nСтолкнулись с проблемой на WB, OZON, YM, Мегамаркет? Профессиональная команда юристов — 3 года в работе с маркетплейсами.\n\n— Оспаривание штрафов\n— Поиск потерянных поставок\n— Регистрация бренда и патентов\n— Ответы на претензии правообладателей',
    sort_order: 17
  },
  {
    name: 'WildBox',
    category: 'Аналитика, оцифровка',
    contact: 'https://wildbox.ru/',
    website: 'https://wildbox.ru/',
    promo_code: 'WILD10BOX',
    description: 'Аналитика для Wildberries. Промокод WILD10BOX даёт дополнительную скидку 10% на все тарифы.',
    sort_order: 18
  },
  {
    name: 'Sellego',
    category: 'Аналитика, оцифровка',
    contact: 'https://t.me/sellego_bot',
    website: 'https://sellego.com/',
    promo_code: '5EEQ3EXHB6',
    description: 'SEO товаров и управление рекламой на WB. Скидка 20% на период подписки на Закрытый канал Max Evirma по промокоду.',
    sort_order: 19
  },
  {
    name: 'Splittest',
    category: 'Аналитика, оцифровка',
    contact: '@managersplittest',
    website: 'https://splittest.ru/',
    promo_code: 'evirmaclub',
    description: 'Сплит-тесты и опросы для маркетплейсов. Бонусные 1000 рублей на первый тест по промокоду.',
    sort_order: 20
  },
  {
    name: 'Виолетта',
    category: 'Специалист по блогерам',
    contact: 'https://t.me/vinviniee',
    website: 'https://t.me/vinviniee',
    promo_code: '',
    description: 'Закупка рекламы у блогеров, преимущественно бартерные интеграции. Эксперт Закрытого канала Max Evirma.',
    sort_order: 21
  },
  {
    name: 'MPSTATS',
    category: 'Аналитика, оцифровка',
    contact: 'https://mpstats.io/p/maxprowb',
    website: 'https://mpstats.io/p/maxprowb',
    promo_code: 'maxevirmaclub',
    description: 'Промокод maxevirmaclub — скидка 20% на любой тариф.\n\nСпециальное предложение для резидентов: демо-доступ на 14 дней.\n\nКак получить:\n1. Зарегистрируйтесь по ссылке https://mpsts.ru/u8-xQw\n2. Заполните Google Форму: https://docs.google.com/forms/d/e/1FAIpQLSffLQeIlxJopGLeFm9K5no8W7yTUaAk5iFOJe3lUzsc6advUg/viewform\n\nДоступы предоставляются ежедневно в 11:00 МСК (кроме сб/вс).',
    sort_order: 22
  },
  {
    name: 'PRObayer',
    category: 'Баеры',
    contact: 'https://t.me/PRO_BAYER_MANAGER',
    website: 'https://pro-bayer.ru/',
    promo_code: 'EVIRMA',
    description: 'Баеры: ТЯК, Садовод, Южные ворота, Дордой. Широкий спектр услуг по поиску товара и подбору поставщика по выгодным ценам.',
    sort_order: 23
  },
  {
    name: 'FLG',
    category: 'Логистика',
    contact: 'https://flgchina.ru/',
    website: 'https://flg-china.ru/?refLinkId=71918',
    promo_code: '',
    description: 'Логистика из Китая. Поиск, оплата и доставка товаров. Бесплатная консультация по ссылке.',
    sort_order: 24
  },
  {
    name: 'Мир',
    category: 'Съёмки и контент',
    contact: 'https://t.me/TMIRRU',
    website: 'https://torogeldiev-ph.wfolio.pro/portfolio',
    promo_code: '',
    description: 'Предметный фотограф.\n\n— Предметная фотосъёмка товаров\n— Портретная фотосъёмка\n— Фотосъёмка в студии',
    sort_order: 25
  },
  {
    name: 'SKS.PRODUCTION',
    category: 'Съёмки и контент',
    contact: '@sks_production',
    website: 'https://t.me/sksprod',
    promo_code: 'SKS',
    description: 'Сборные съёмки в Москве. Съёмка бесплатной проходки.',
    sort_order: 26
  },
  {
    name: 'Валерия',
    category: 'Дизайнер',
    contact: 'https://t.me/lieruag',
    website: 'https://t.me/lieruag',
    promo_code: '',
    description: 'Дизайнер инфографики для маркетплейсов.',
    sort_order: 27
  },
  {
    name: 'Кристина',
    category: 'Дизайнер',
    contact: '@kristik_mi',
    website: 'https://t.me/kristik_mi',
    promo_code: '',
    description: 'Дизайнер широкого профиля.',
    sort_order: 28
  },
  {
    name: 'Omgbloggers',
    category: 'Специалист по блогерам',
    contact: 'https://t.me/pr_omgbloggers',
    website: 'https://t.me/pr_omgbloggers',
    promo_code: '',
    description: 'Агентство по работе с блогерами. Сотрудничество с брендами, актуальные стратегии продвижения. Контакт: Лолита.',
    sort_order: 29
  },
  {
    name: 'Каролина Шаршун',
    category: 'Юрист',
    contact: '@sharlikk',
    website: 'https://t.me/sharlikk',
    promo_code: '',
    description: 'Юридические консультации по вопросам маркетплейсов: быстро, качественно, просто.',
    sort_order: 30
  },
  {
    name: 'FF Партнёры',
    category: 'Фулфилмент',
    contact: '89951209994',
    website: 'https://ffpartners.ru',
    promo_code: 'EVIRMA',
    description: 'Фулфилмент в Москве. Селлер на ВБ с 2021 года, открыл ФФ в 2024. На склад можно приехать, посмотреть своими глазами, познакомиться лично.\n\nБесплатное посещение склада — всегда открыты.',
    sort_order: 31
  },
  {
    name: 'Вероника',
    category: 'Финансовый учет',
    contact: '@trampompulya',
    website: 'https://sigma.expert',
    promo_code: '',
    description: 'Бухгалтерия на аутсорсе. Ведение кабинета от 2 000 до 5 000 руб/мес с полной отчётностью и помощью в любых вопросах.',
    sort_order: 32
  },
  {
    name: 'Тимурий',
    category: 'Юрист',
    contact: 'Юридическая фирма BKG',
    website: 'https://www.bkglaw.ru',
    promo_code: '',
    description: 'Юридические услуги для бизнеса. Результат: выиграл дела 4 из 4 с большим перевесом.',
    sort_order: 33
  },
  {
    name: 'Box-boss',
    category: 'Фулфилмент',
    contact: '@boxboss_manager',
    website: 'https://box-boss.ru',
    promo_code: 'Evirma',
    description: 'Фулфилмент в Москве. Бесплатное хранение 1 месяц, скидка на услуги и VIP-менеджер.',
    sort_order: 34
  },
  {
    name: 'WildFlamingo',
    category: 'Дизайнер',
    contact: 'https://t.me/Wildflamingo',
    website: 'https://wildflamingo.ru',
    promo_code: 'EVIRMA',
    description: 'Инфографика, SEO, Rich-контент для маркетплейсов. Скидка 10% на любые услуги по промокоду.',
    sort_order: 35
  },
  {
    name: 'Cloudmark.cc',
    category: 'Честный знак и сертификация',
    contact: 'Николай Чагин | https://t.me/Nikolaychagin',
    website: 'https://cloudmark.cc',
    promo_code: 'MAX100',
    description: 'Честный знак и сертификация товаров. 7 дней бесплатной работы по промокоду.',
    sort_order: 36
  },
  {
    name: 'Даниил',
    category: 'Честный знак и сертификация',
    contact: 'https://t.me/Daniil_cert',
    website: 'https://t.me/Daniil_cert',
    promo_code: 'Evirma',
    description: 'Сертификация и декларации соответствия. При обращении с промокодом — специальные партнёрские цены.',
    sort_order: 37
  },
  {
    name: 'Ponches.me',
    category: 'Выкупы',
    contact: 'https://ponches.me/',
    website: 'https://ponches.me/',
    promo_code: 'Evirma',
    description: 'Выкупы для OZON и Wildberries. Стоимость выкупа под ключ от 180 руб.\n\nБОНУС: 1 месяц в подарок! Если не успеете использовать весь лимит за 6 месяцев — дополнительный месяц бесплатно, без доплат.',
    sort_order: 38
  },
  {
    name: 'ПРОнайм',
    category: 'HR',
    contact: 'https://t.me/Coolcarolinehd — Каролина',
    website: 'https://pro-pro-naim.com/',
    promo_code: 'Маркетплейсы',
    description: 'Поиск ассистентов и РОПов для России и Беларуси. Замена и подбор кандидата до 100% трудоустройства.',
    sort_order: 39
  },
  {
    name: 'Татьяна',
    category: 'HR',
    contact: 'https://t.me/tanya_recruitplace',
    website: 'https://t.me/tanya_recruitplace',
    promo_code: 'Evirma',
    description: 'Подбор менеджеров маркетплейсов. Скидка 10% и бесплатная консультация — составляется портрет кандидата + чек-лист с рекомендациями по внедрению нового сотрудника.',
    sort_order: 40
  },
  {
    name: 'Кадровое агентство PROHR',
    category: 'HR',
    contact: '+7 985 350 8140 | @alinagalinichenko — Алина',
    website: 'https://xn--80aalpbdkseiwkldq.xn--p1ai/',
    promo_code: 'Evirma',
    description: '5 000 рублей скидка на первую вакансию + консультация (составят портрет сотрудника под вас).\n\nБесплатный аудит компании:\n— Разберут, каких сотрудников нанять для роста прибыли\n— Проанализируют мотивацию текущих сотрудников\n— Помогут с качественным управлением командой',
    sort_order: 41
  },
  {
    name: 'Стелла Литвиненко',
    category: 'HR',
    contact: 'https://t.me/LitStell',
    website: 'https://t.me/hrwbst',
    promo_code: 'Evirma',
    description: 'Поиск сотрудников для маркетплейсов. Скидка 20%, консультация бесплатно.',
    sort_order: 42
  },
  {
    name: 'Василий Пляцидевский',
    category: 'HR',
    contact: 'https://t.me/Vassiliuss',
    website: 'https://t.me/getassistant',
    promo_code: 'Evirma',
    description: 'Найм ассистентов для маркетплейсов. Скидка 10% + доступ к обучению по управлению сотрудниками.',
    sort_order: 43
  },
];

console.log('🗑  Очищаем старые данные...');
db.prepare('DELETE FROM contractor_ratings').run();
db.prepare('DELETE FROM contractors').run();
try { db.prepare("DELETE FROM sqlite_sequence WHERE name='contractors'").run(); } catch(e) {}

console.log('📥 Импортируем', contractors.length, 'подрядчиков...');
const stmt = db.prepare(`
  INSERT INTO contractors (name, category, description, contact, website, promo_code, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let ok = 0;
for (const c of contractors) {
  try {
    stmt.run(c.name, c.category, c.description, c.contact, c.website, c.promo_code || '', c.sort_order);
    ok++;
  } catch (e) {
    console.error('  ❌', c.name, '—', e.message);
  }
}

console.log('✅ Импортировано:', ok, '/', contractors.length);
const total = db.prepare('SELECT COUNT(*) as cnt FROM contractors').get().cnt;
console.log('📊 Итого в БД:', total, 'подрядчиков');
