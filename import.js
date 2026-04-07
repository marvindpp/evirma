// import.js — Загружает все данные в SQLite базу
// Запуск: node import.js

const { getDb } = require('./db.js');
const path = require('path');
const fs = require('fs');

const db = getDb();

// ─── 1. РАЗДЕЛЫ И УРОКИ (из content.json) ────────────────────────────────────
console.log('📚 Импортирую разделы и уроки...');
const content = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/content.json'), 'utf8'));

const insertModule = db.prepare(`
  INSERT OR REPLACE INTO modules (id, slug, title, icon, sort_order)
  VALUES (?, ?, ?, ?, ?)
`);
for (const m of content.modules) {
  insertModule.run(m.id, m.slug, m.title, m.icon, m.order);
}
console.log(`  ✅ ${content.modules.length} разделов`);

const insertLesson = db.prepare(`
  INSERT OR REPLACE INTO lessons (id, title, module_id, duration, duration_sec, embed_url, poster_url, created_at, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const l of content.lessons) {
  insertLesson.run(l.id, l.title, l.module_id, l.duration, l.duration_sec, l.embed_url, l.poster || '', l.created_at, l.order_in_module);
}
console.log(`  ✅ ${content.lessons.length} уроков`);

// ─── 2. ПОДРЯДЧИКИ ────────────────────────────────────────────────────────────
console.log('💼 Импортирую подрядчиков...');
const contractorsFile = path.join(__dirname, 'data/contractors.json');
if (fs.existsSync(contractorsFile)) {
  const contractors = JSON.parse(fs.readFileSync(contractorsFile, 'utf8'));
  const insertContractor = db.prepare(`
    INSERT OR IGNORE INTO contractors (name, category, description, contact, promo_code, rating, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [i, c] of contractors.entries()) {
    insertContractor.run(c.name, c.category, c.description || '', c.contact || '', c.promo_code || '', c.rating || 0, i);
  }
  console.log(`  ✅ ${contractors.length} подрядчиков`);
} else {
  console.log('  ⚠️  data/contractors.json не найден — пропускаю');
}

// ─── 3. УЧЕНИКИ (из students.json — генерируется из xlsx) ────────────────────
console.log('👥 Импортирую учеников...');
const studentsFile = path.join(__dirname, 'data/students.json');
if (fs.existsSync(studentsFile)) {
  const students = JSON.parse(fs.readFileSync(studentsFile, 'utf8'));
  const insertStudent = db.prepare(`
    INSERT OR IGNORE INTO students 
    (telegram_id, telegram_user, first_name, last_name, full_name, city, niche, revenue, goal, strengths, email, phone, can_share, sub_active, sub_end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of students) {
    insertStudent.run(
      s.telegram_id || null,
      s.telegram_user || null,
      s.first_name || null,
      s.last_name || null,
      s.full_name || s.first_name || null,
      s.city || null,
      s.niche || null,
      s.revenue || null,
      s.goal || null,
      s.strengths || null,
      s.email || null,
      s.phone || null,
      s.can_share ? 1 : 0,
      s.sub_active ? 1 : 0,
      s.sub_end_date || null
    );
  }
  console.log(`  ✅ ${students.length} учеников`);
} else {
  console.log('  ⚠️  data/students.json не найден');
  console.log('  → Чтобы сгенерировать: node scripts/import-xlsx.js BASE_06_04.xlsx');
}

// ─── 4. ДЕФОЛТНЫЙ АДМИН ──────────────────────────────────────────────────────
const adminId = '313596616'; // замени на свой Telegram ID для продакшена
const existing = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(adminId);
if (!existing) {
  db.prepare(`INSERT INTO users (telegram_id, first_name, role) VALUES (?, 'Admin', 'admin')`).run(adminId);
  console.log(`👤 Создан дефолтный админ (telegram_id: ${adminId})`);
}

console.log('\n✅ Импорт завершён!');
console.log('   Запусти сервер: npm start');
