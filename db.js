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
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT    UNIQUE NOT NULL,
      first_name  TEXT,
      last_name   TEXT,
      username    TEXT,
      photo_url   TEXT,
      role        TEXT    DEFAULT 'student',  -- student | admin
      created_at  TEXT    DEFAULT (datetime('now')),
      last_seen   TEXT    DEFAULT (datetime('now'))
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
      title           TEXT    NOT NULL,
      description     TEXT    DEFAULT '',
      module_id       INTEGER REFERENCES modules(id),
      duration        TEXT,
      duration_sec    INTEGER DEFAULT 0,
      embed_url       TEXT,
      poster_url      TEXT,
      created_at      TEXT,
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
  `);
}

module.exports = { getDb };
