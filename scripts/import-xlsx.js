// scripts/import-xlsx.js
// Конвертирует BASE_06_04.xlsx в data/students.json
// Запуск: node scripts/import-xlsx.js [путь_к_файлу.xlsx]
// Требует: npm install xlsx

const fs   = require('fs');
const path = require('path');

// Пытаемся загрузить xlsx
let XLSX;
try {
  XLSX = require('xlsx');
} catch {
  console.error('❌ Установи пакет: npm install xlsx');
  process.exit(1);
}

const xlsxPath = process.argv[2] || path.join(__dirname, '../BASE_06_04.xlsx');
if (!fs.existsSync(xlsxPath)) {
  console.error(`❌ Файл не найден: ${xlsxPath}`);
  console.error('   Запуск: node scripts/import-xlsx.js путь/к/BASE_06_04.xlsx');
  process.exit(1);
}

const workbook = XLSX.readFile(xlsxPath);
const sheet    = workbook.Sheets[workbook.SheetNames[0]];
const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '' });

console.log(`📊 Строк в файле: ${rows.length}`);

// Маппинг колонок xlsx → поля базы
// Подстраивай под реальные заголовки столбцов
function mapRow(row) {
  const keys = Object.keys(row);
  const get  = (...candidates) => {
    for (const c of candidates) {
      const k = keys.find(k => k.toLowerCase().includes(c.toLowerCase()));
      if (k && row[k] !== '') return String(row[k]).trim();
    }
    return null;
  };

  // Флаг "можно делиться контактом"
  const shareRaw = get('делиться', 'share', 'контакт');
  const canShare = !shareRaw || shareRaw.toLowerCase().includes('да') || shareRaw === '1' || shareRaw.toLowerCase() === 'yes';

  // Выручка → читаемый диапазон
  const revenueRaw = get('выручка', 'оборот', 'revenue');
  let revenue = revenueRaw;
  if (revenue) {
    const n = parseFloat(revenue.replace(/[^0-9.]/g, ''));
    if (!isNaN(n)) {
      if (n >= 200_000_000)     revenue = '200+ млн';
      else if (n >= 50_000_000) revenue = '50-200 млн';
      else if (n >= 10_000_000) revenue = '10-50 млн';
      else if (n > 0)           revenue = 'до 10 млн';
      else                      revenue = 'Новичок';
    }
  }

  const tgId   = get('tgid', 'telegram_id', 'tg id', 'id');
  const tgUser = get('username', 'tg ник', 'ник', 'login');
  const firstName = get('имя', 'first', 'name');
  const lastName  = get('фамилия', 'last');
  const fullName  = get('полное имя', 'фио') || [firstName, lastName].filter(Boolean).join(' ') || null;

  return {
    telegram_id:   tgId,
    telegram_user: tgUser?.replace('@', ''),
    first_name:    firstName,
    last_name:     lastName,
    full_name:     fullName,
    city:          get('город', 'city'),
    niche:         get('ниша', 'niche', 'категория'),
    revenue,
    goal:          get('цель', 'goal', 'запрос'),
    strengths:     get('сильные', 'навык', 'strength'),
    email:         get('email', 'почта', 'mail'),
    phone:         get('телефон', 'phone', 'номер'),
    can_share:     canShare,
    sub_active:    false,
    sub_end_date:  get('подписка до', 'sub_end', 'дата окончания')
  };
}

const students = rows.map(mapRow).filter(s => s.full_name || s.telegram_id || s.telegram_user);
const outPath  = path.join(__dirname, '../data/students.json');

fs.writeFileSync(outPath, JSON.stringify(students, null, 2));
console.log(`✅ Сохранено ${students.length} учеников в data/students.json`);
console.log(`   Из них с разрешением показывать: ${students.filter(s => s.can_share).length}`);
console.log('\n   Теперь запусти: node import.js');
