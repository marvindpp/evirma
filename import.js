// import.js
const { getDb } = require('./db.js');
const path = require('path');
const fs   = require('fs');

const db = getDb();

if (process.env.RESET_DB === '1') {
  console.log('🗑  Очищаю таблицы...');
  db.exec('DELETE FROM lesson_progress; DELETE FROM lessons; DELETE FROM modules; DELETE FROM students; DELETE FROM contractors; DELETE FROM employees;');
}

const contentPath = path.join(__dirname, 'data/content.json');
if (fs.existsSync(contentPath)) {
  const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
  const insM = db.prepare('INSERT OR REPLACE INTO modules (id, slug, title, icon, sort_order) VALUES (?, ?, ?, ?, ?)');
  for (const m of content.modules) insM.run(m.id, m.slug, m.title, m.icon, m.order);
  const insL = db.prepare('INSERT OR REPLACE INTO lessons (id, title, module_id, duration, duration_sec, embed_url, poster_url, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const l of content.lessons) insL.run(l.id, l.title, l.module_id, l.duration, l.duration_sec, l.embed_url, l.poster||'', l.created_at, l.order_in_module);
  console.log('✅ ' + content.modules.length + ' разделов, ' + content.lessons.length + ' уроков');
}

const cPath = path.join(__dirname, 'data/contractors.json');
if (fs.existsSync(cPath)) {
  const list = JSON.parse(fs.readFileSync(cPath, 'utf8'));
  const ins = db.prepare('INSERT OR IGNORE INTO contractors (name, category, description, contact, promo_code, rating, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [i, c] of list.entries()) ins.run(c.name, c.category, c.description||'', c.contact||'', c.promo_code||'', c.rating||0, i);
  console.log('✅ ' + list.length + ' подрядчиков');
}

const sPath = path.join(__dirname, 'data/students.json');
if (fs.existsSync(sPath)) {
  const list = JSON.parse(fs.readFileSync(sPath, 'utf8'));
  const ins = db.prepare('INSERT OR IGNORE INTO students (telegram_id, telegram_user, first_name, last_name, full_name, city, niche, revenue, goal, strengths, email, phone, can_share, sub_active, sub_end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const s of list) ins.run(s.telegram_id||null, s.telegram_user||null, s.first_name||null, s.last_name||null, s.full_name||null, s.city||null, s.niche||null, s.revenue||null, s.goal||null, s.strengths||null, s.email||null, s.phone||null, s.can_share?1:0, s.sub_active?1:0, s.sub_end_date||null);
  console.log('✅ ' + list.length + ' учеников');
}

// Администраторы платформы
const ADMINS = [
  { id: '313596616',  name: 'Marvin' },   // Даулет (разработчик)
  { id: '7385674488', name: 'Marvin2' },  // Даулет (основной аккаунт)
  // { id: 'OLGA_ID', name: 'Ольга' },   // Добавить когда узнаем ID Ольги (@byibylka)
];

for (const admin of ADMINS) {
  const existing = db.prepare('SELECT id, role FROM users WHERE telegram_id = ?').get(admin.id);
  if (!existing) {
    db.prepare("INSERT INTO users (telegram_id, first_name, role) VALUES (?, ?, 'admin')").run(admin.id, admin.name);
    console.log(`👤 Создан админ: ${admin.name} (${admin.id})`);
  } else if (existing.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE telegram_id = ?").run(admin.id);
    console.log(`👤 Обновлён до админа: ${admin.name} (${admin.id})`);
  }
}
console.log('✅ Импорт завершён!');
