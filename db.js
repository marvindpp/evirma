// db.js — SQLite база данных (встроенный node:sqlite, Node >= 22.5)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'evirma.db');
let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    -- Пользователи (авторизованные через Telegram)
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id  TEXT    UNIQUE NOT NULL,
      first_name   TEXT,
      last_name    TEXT,
      username     TEXT,
      photo_url    TEXT,
      role         TEXT    DEFAULT 'student',
      active_token TEXT,   -- текущий активный токен сессии
      created_at   TEXT    DEFAULT (datetime('now')),
      last_seen    TEXT    DEFAULT (datetime('now'))
    );

    -- Разделы базы знаний
    CREATE TABLE IF NOT EXISTS modules (
      id          INTEGER PRIMARY KEY,
      slug        TEXT    UNIQUE NOT NULL,
      title       TEXT    NOT NULL,
      icon        TEXT    DEFAULT '📁',
      sort_order  INTEGER DEFAULT 0
    );

    -- Уроки (видеоуроки из Kinescope)
    CREATE TABLE IF NOT EXISTS lessons (
      id              TEXT    PRIMARY KEY,   -- Kinescope UUID
      cms_id          TEXT    DEFAULT '',
      title           TEXT    NOT NULL,
      description     TEXT    DEFAULT '',
      content_html    TEXT    DEFAULT '',
      content_text    TEXT    DEFAULT '',
      module_id       INTEGER REFERENCES modules(id),
      duration        TEXT,
      duration_sec    INTEGER DEFAULT 0,
      embed_url       TEXT,
      video_url       TEXT    DEFAULT '',
      poster_url      TEXT,
      cover_url       TEXT    DEFAULT '',
      created_at      TEXT,
      published_at    TEXT    DEFAULT '',
      status          TEXT    DEFAULT 'published',
      views           INTEGER DEFAULT 0,
      sort_order      INTEGER DEFAULT 0
    );

    -- Прогресс просмотра уроков
    CREATE TABLE IF NOT EXISTS lesson_progress (
      user_id     INTEGER REFERENCES users(id),
      lesson_id   TEXT    REFERENCES lessons(id),
      watched     INTEGER DEFAULT 0,
      watched_at  TEXT,
      PRIMARY KEY (user_id, lesson_id)
    );

    -- База учеников (импорт из xlsx)
    CREATE TABLE IF NOT EXISTS students (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id     TEXT,
      telegram_user   TEXT,
      first_name      TEXT,
      last_name       TEXT,
      full_name       TEXT,
      city            TEXT,
      niche           TEXT,
      revenue         TEXT,
      goal            TEXT,
      strengths       TEXT,
      email           TEXT,
      phone           TEXT,
      can_share       INTEGER DEFAULT 1,
      sub_active      INTEGER DEFAULT 0,
      sub_end_date    TEXT
    );

    -- База подрядчиков
    CREATE TABLE IF NOT EXISTS contractors (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      category    TEXT,
      description TEXT,
      contact     TEXT,
      promo_code  TEXT,
      rating      REAL    DEFAULT 0,
      sort_order  INTEGER DEFAULT 0
    );

    -- Сотрудники (привязанные к ученику)
    CREATE TABLE IF NOT EXISTS employees (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id      INTEGER REFERENCES users(id),
      telegram_id   TEXT,
      first_name    TEXT,
      added_at      TEXT    DEFAULT (datetime('now'))
    );

    -- Заказы на подписку сотрудников
    CREATE TABLE IF NOT EXISTS employee_orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id   INTEGER REFERENCES users(id),  -- внутренний id владельца
      salebot_order_id TEXT   DEFAULT '',             -- id заказа от Salebot (приходит в webhook)
      period          TEXT    NOT NULL,               -- '1', '3', '6', '12'
      seats           INTEGER NOT NULL DEFAULT 1,     -- кол-во оплаченных мест
      sur_cost        INTEGER NOT NULL,               -- сумма в рублях
      status          TEXT    DEFAULT 'pending',      -- pending | paid | failed
      created_at      TEXT    DEFAULT (datetime('now')),
      paid_at         TEXT    DEFAULT NULL
    );

    -- Оценки подрядчиков от пользователей
    CREATE TABLE IF NOT EXISTS contractor_ratings (
      user_id        INTEGER REFERENCES users(id),
      contractor_id  INTEGER REFERENCES contractors(id),
      rating         INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      created_at     TEXT    DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, contractor_id)
    );
  `);

  // Миграции новых колонок
  const migrations = [
    "ALTER TABLE users ADD COLUMN active_token TEXT",
    "ALTER TABLE users ADD COLUMN paid_emp_slots INTEGER DEFAULT 0",
    "ALTER TABLE lessons ADD COLUMN cms_id TEXT DEFAULT ''",
    "ALTER TABLE lessons ADD COLUMN content_html TEXT DEFAULT ''",
    "ALTER TABLE lessons ADD COLUMN content_text TEXT DEFAULT ''",
    "ALTER TABLE lessons ADD COLUMN video_url TEXT DEFAULT ''",
    "ALTER TABLE lessons ADD COLUMN cover_url TEXT DEFAULT ''",
    "ALTER TABLE lessons ADD COLUMN published_at TEXT DEFAULT ''",
    "ALTER TABLE lessons ADD COLUMN status TEXT DEFAULT 'published'",
    "ALTER TABLE lessons ADD COLUMN views INTEGER DEFAULT 0",
    "ALTER TABLE lessons ADD COLUMN hidden INTEGER DEFAULT 0",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch(e) { /* already exists */ }
  }

  // Миграция: contractor_ratings (могла не создаться на старых БД)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS contractor_ratings (
      user_id        INTEGER,
      contractor_id  INTEGER,
      rating         INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      created_at     TEXT    DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, contractor_id)
    )`);
  } catch(e) { console.log('contractor_ratings migration:', e.message); }

  // Миграция: добавляем website в contractors
  try {
    db.exec("ALTER TABLE contractors ADD COLUMN website TEXT DEFAULT ''");
  } catch(e) { /* already exists */ }
}

module.exports = { getDb };