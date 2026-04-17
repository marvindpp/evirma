// server.js — Max Evirma Club Backend
// Запуск: npm install && node import.js && npm start

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const path    = require('path');
const { getDb } = require('./db.js');

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const BOT_TOKEN  = process.env.BOT_TOKEN  || '7918341254:AAETVIIfFW53Amdcnoa1sIRjn8YJxxSkHpw';
const KIN_TOKEN  = process.env.KIN_TOKEN  || '3be9b86c-6fdd-4264-8ecd-a77cca747f71';
const SUB_URL    = 'https://evirmaclub.ru/webhook/status_sub';
const SES_SECRET = process.env.SESSION_SECRET || 'evirma-secret-' + crypto.randomBytes(8).toString('hex');
const DEV_MODE   = process.env.NODE_ENV !== 'production';

// Telegram ID администраторов платформы
const ADMIN_IDS = new Set([
  '313596616',   // Даулет (разработчик)
  '7385674488',  // Даулет (основной аккаунт)
  // 'OLGA_ID',  // Ольга — добавить после получения ID
]); // dev: не проверять подпись Telegram

const app = express();
const db  = getDb();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── TELEGRAM AUTH ─────────────────────────────────────────────────────────────
function verifyTgAuth(data) {
  if (DEV_MODE) return true; // пропускаем проверку в режиме разработки
  const { hash, ...fields } = data;
  if (!hash) return false;
  const checkStr = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret   = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const hmac     = crypto.createHmac('sha256', secret).update(checkStr).digest('hex');
  if (hmac !== hash) return false;
  if (Date.now() / 1000 - parseInt(fields.auth_date, 10) > 86400) return false;
  return true;
}

// ─── SESSIONS (JWT-like, без зависимостей) ─────────────────────────────────────
const MAX_DEVICES = 2; // максимум устройств

function getSessions(telegramId) {
  const user = db.prepare('SELECT active_token FROM users WHERE telegram_id = ?').get(String(telegramId));
  let sessions = [];
  try { sessions = JSON.parse(user?.active_token || '[]'); } catch { sessions = []; }
  if (!Array.isArray(sessions)) sessions = [];
  return sessions;
}

// Декодирует токен БЕЗ проверки срока (для детектирования re-login с того же устройства)
// Подпись всё равно проверяется — подделать нельзя
function decodeTokenUnsafe(token) {
  if (!token) return null;
  const [b64, sig] = (token || '').split('.');
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac('sha256', SES_SECRET).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try { return JSON.parse(Buffer.from(b64, 'base64url').toString()); } catch { return null; }
}

function createSession(telegramId, role = 'student', replaceToken = null) {
  const tokenId = crypto.randomBytes(16).toString('hex');
  const payload = JSON.stringify({ telegram_id: String(telegramId), role, token_id: tokenId, exp: Date.now() + 90 * 86400_000 });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig  = crypto.createHmac('sha256', SES_SECRET).update(b64).digest('base64url');
  const token = `${b64}.${sig}`;

  let sessions = getSessions(telegramId);

  // Re-login с уже зарегистрированного устройства — обновляем именно этот слот
  if (replaceToken) {
    const idx = sessions.findIndex(s => s.token === replaceToken);
    if (idx !== -1) {
      sessions[idx] = { token, added: sessions[idx].added, refreshed: Date.now() };
      db.prepare('UPDATE users SET active_token = ? WHERE telegram_id = ?').run(JSON.stringify(sessions), String(telegramId));
      return token;
    }
  }

  // Новое устройство — только если есть свободный слот
  if (sessions.length < MAX_DEVICES) {
    sessions.push({ token, added: Date.now() });
    db.prepare('UPDATE users SET active_token = ? WHERE telegram_id = ?').run(JSON.stringify(sessions), String(telegramId));
    return token;
  }

  // Все слоты заняты — нельзя добавить
  return null;
}

function verifySession(token) {
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac('sha256', SES_SECRET).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (p.exp < Date.now()) return null;
    // Проверяем что токен есть в списке зарегистрированных устройств
    const user = db.prepare('SELECT active_token FROM users WHERE telegram_id = ?').get(String(p.telegram_id));
    let sessions = [];
    try { sessions = JSON.parse(user?.active_token || '[]'); } catch { sessions = []; }
    if (!Array.isArray(sessions)) return null;
    if (!sessions.some(s => s.token === token)) return null;
    return p;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const token   = req.headers.authorization?.replace('Bearer ', '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function checkSubscription(telegramId) {
  try {
    const r   = await fetch(`${SUB_URL}?telegram_id=${telegramId}`, { signal: AbortSignal.timeout(5000) });
    const sub = await r.json();
    return { active: !!sub.result, message: sub.message_result || null };
  } catch {
    // Если вебхук недоступен — пропускаем, не блокируем пользователя
    console.warn('⚠️  checkSubscription failed for', telegramId, '— пропускаем');
    return { active: true, message: null };
  }
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now(), dev: DEV_MODE }));

// ── AUTH ──
app.post('/api/auth/telegram', async (req, res) => {
  const data = req.body;

  if (!verifyTgAuth(data)) {
    return res.status(401).json({ error: 'invalid_telegram_signature' });
  }

  const telegramId = String(data.id || data.telegram_id || 'dev-user');

  // Проверяем подписку (в dev-режиме и для администраторов пропускаем)
  let sub = { active: true, message: 'Dev режим' };
  if (!DEV_MODE && !ADMIN_IDS.has(String(telegramId))) {
    sub = await checkSubscription(telegramId);
    if (!sub.active) {
      return res.status(403).json({
        error: 'no_subscription',
        message: 'Подписка не активна. Продлите в боте @evirmaclub_bot'
      });
    }
  }

  // Upsert пользователя в БД
  const isAdmin = ADMIN_IDS.has(String(telegramId));
  const existing = db.prepare('SELECT id, role, active_token FROM users WHERE telegram_id = ?').get(telegramId);
  if (!existing) {
    db.prepare(`INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, role) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(telegramId, data.first_name || 'Пользователь', data.last_name || '', data.username || '', data.photo_url || '', isAdmin ? 'admin' : 'student');
  } else {
    db.prepare(`UPDATE users SET last_seen = datetime('now'), first_name = ?, username = ?, photo_url = ?, role = ? WHERE telegram_id = ?`)
      .run(data.first_name || '', data.username || '', data.photo_url || '', isAdmin ? 'admin' : (existing.role || 'student'), telegramId);
  }

  // Определяем, это re-login с уже зарегистрированного устройства или новое устройство
  // Клиент отправляет свой текущий токен в Authorization header
  const sentToken = req.headers.authorization?.replace('Bearer ', '') || null;
  const decodedSent = decodeTokenUnsafe(sentToken);
  const isReLogin = !!(
    decodedSent &&
    String(decodedSent.telegram_id) === String(telegramId) &&
    getSessions(telegramId).some(s => s.token === sentToken)
  );

  // Проверка лимита устройств (кроме админов и re-login)
  if (!isAdmin && !isReLogin) {
    const sessions = getSessions(telegramId);
    if (sessions.length >= MAX_DEVICES) {
      return res.status(403).json({
        error: 'device_limit',
        message: `Достигнут лимит устройств (${MAX_DEVICES}). Для входа с нового устройства обратитесь в поддержку — администратор сбросит все входы.`,
        devices_count: sessions.length,
        max_devices: MAX_DEVICES
      });
    }
  }

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  const session = createSession(telegramId, user.role, isReLogin ? sentToken : null);

  // На случай race condition (одновременные запросы заполнили слоты)
  if (!session && !isAdmin) {
    const sessions = getSessions(telegramId);
    return res.status(403).json({
      error: 'device_limit',
      message: `Достигнут лимит устройств (${MAX_DEVICES}). Для входа с нового устройства обратитесь в поддержку — администратор сбросит все входы.`,
      devices_count: sessions.length,
      max_devices: MAX_DEVICES
    });
  }

  // Автодобавление в базу учеников если его там нет
  const inStudents = db.prepare('SELECT id FROM students WHERE telegram_id = ?').get(telegramId);
  if (!inStudents && sub.active) {
    db.prepare(`INSERT INTO students (telegram_id, telegram_user, first_name, last_name, full_name, can_share, sub_active)
      VALUES (?, ?, ?, ?, ?, 0, 1)`)
      .run(telegramId, data.username || '', data.first_name || '', data.last_name || '',
           ((data.first_name || '') + ' ' + (data.last_name || '')).trim() || data.username || 'Участник');
  } else if (inStudents) {
    // Обновляем статус подписки
    db.prepare('UPDATE students SET sub_active = ?, telegram_user = COALESCE(NULLIF(?,\'\'), telegram_user), first_name = COALESCE(NULLIF(?,\'\'), first_name) WHERE telegram_id = ?')
      .run(sub.active ? 1 : 0, data.username||'', data.first_name||'', telegramId);
  }

  res.json({
    ok: true,
    session,
    user: {
      telegram_id: telegramId,
      first_name:  data.first_name,
      last_name:   data.last_name,
      username:    data.username,
      photo_url:   data.photo_url,
      role:        user.role,
      subscription: sub
    }
  });
});

// ── ME ──
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.user.telegram_id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  res.json({ user });
});

app.get('/api/me/subscription', requireAuth, async (req, res) => {
  if (DEV_MODE) return res.json({ active: true, message: 'Dev режим — подписка активна' });
  const sub = await checkSubscription(req.user.telegram_id);
  res.json(sub);
});

// ── МОДУЛИ ──
app.get('/api/modules', requireAuth, (req, res) => {
  const modules = db.prepare('SELECT * FROM modules ORDER BY sort_order').all();
  // Добавляем счётчик уроков к каждому разделу
  const counts = db.prepare('SELECT module_id, COUNT(*) as cnt FROM lessons GROUP BY module_id').all();
  const countMap = Object.fromEntries(counts.map(c => [c.module_id, c.cnt]));
  const withCounts = modules.map(m => ({ ...m, lesson_count: countMap[m.id] || 0 }));
  res.json({ modules: withCounts });
});

// ── УРОКИ ──
app.get('/api/lessons', requireAuth, (req, res) => {
  const { module_id, search } = req.query;
  let sql = 'SELECT l.*, lp.watched, lp.watched_at FROM lessons l LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = (SELECT id FROM users WHERE telegram_id = ?) WHERE 1=1';
  const params = [req.user.telegram_id];

  if (module_id) { sql += ' AND l.module_id = ?'; params.push(module_id); }
  if (search)    { sql += ' AND l.title LIKE ?';   params.push(`%${search}%`); }
  sql += ' ORDER BY l.module_id, l.sort_order';

  const lessons = db.prepare(sql).all(...params);
  res.json({ lessons, total: lessons.length });
});

// Отметить урок как просмотренный
app.post('/api/lessons/:id/watched', requireAuth, (req, res) => {
  const userId = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(req.user.telegram_id)?.id;
  if (!userId) return res.status(404).json({ error: 'user_not_found' });

  const { watched = true } = req.body;
  db.prepare(`
    INSERT INTO lesson_progress (user_id, lesson_id, watched, watched_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, lesson_id) DO UPDATE SET watched = ?, watched_at = datetime('now')
  `).run(userId, req.params.id, watched ? 1 : 0, watched ? 1 : 0);

  const stats = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(watched) as watched_count
    FROM lessons l
    LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = ?
  `).get(userId);

  res.json({ ok: true, lesson_id: req.params.id, watched, progress: stats });
});

// Прогресс пользователя
app.get('/api/me/progress', requireAuth, (req, res) => {
  const userId = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(req.user.telegram_id)?.id;
  if (!userId) return res.json({ watched: 0, total: 0, percent: 0 });

  const total   = db.prepare('SELECT COUNT(*) as cnt FROM lessons').get().cnt;
  const watched = db.prepare('SELECT COUNT(*) as cnt FROM lesson_progress WHERE user_id = ? AND watched = 1').get(userId).cnt;
  const byModule = db.prepare(`
    SELECT m.id, m.title, m.icon,
           COUNT(l.id) as total,
           SUM(CASE WHEN lp.watched = 1 THEN 1 ELSE 0 END) as watched
    FROM modules m
    LEFT JOIN lessons l ON l.module_id = m.id
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
    GROUP BY m.id
    ORDER BY m.sort_order
  `).all(userId);

  res.json({ watched, total, percent: total ? Math.round((watched / total) * 100) : 0, by_module: byModule });
});

// ── СЧЁТЧИКИ ДЛЯ САЙДБАРА ──
app.get('/api/counts', requireAuth, (req, res) => {
  // Участники = только те кто реально зарегался на сайте (есть в users)
  const students    = db.prepare("SELECT COUNT(*) as cnt FROM users").get().cnt;
  const contractors = db.prepare("SELECT COUNT(*) as cnt FROM contractors").get().cnt;
  const lessons     = db.prepare("SELECT COUNT(*) as cnt FROM lessons").get().cnt;
  res.json({ students, contractors, lessons });
});

// ── УЧЕНИКИ ──
// Показываем ТОЛЬКО тех, кто реально зарегался на сайте (INNER JOIN с users)
// can_share управляет видимостью контактов в попапе, а не самой карточкой
app.get('/api/students', requireAuth, (req, res) => {
  const { city, niche, revenue, search, page = 1, limit = 24 } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (city)    { where += ' AND s.city = ?';              params.push(city); }
  if (niche)   { where += ' AND s.niche LIKE ?';          params.push(`%${niche}%`); }
  if (revenue) { where += ' AND s.revenue LIKE ?';        params.push(`%${revenue}%`); }
  if (search)  {
    where += ' AND (s.full_name LIKE ? OR s.telegram_user LIKE ? OR s.niche LIKE ? OR s.goal LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const base = `FROM students s INNER JOIN users u ON u.telegram_id = s.telegram_id ${where}`;
  const total = db.prepare(`SELECT COUNT(*) as cnt ${base}`).get(...params).cnt;

  const limitN  = parseInt(limit);
  const offset  = (parseInt(page) - 1) * limitN;
  const students = db.prepare(
    `SELECT s.*, u.photo_url ${base} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limitN, offset);

  res.json({ students, total, page: parseInt(page), pages: Math.ceil(total / limitN) });
});

// Фильтры (уникальные города, ниши) — только реально зарегавшиеся
app.get('/api/students/filters', requireAuth, (req, res) => {
  const cities = db.prepare(`
    SELECT s.city, COUNT(*) as cnt FROM students s
    INNER JOIN users u ON u.telegram_id = s.telegram_id
    WHERE s.city IS NOT NULL AND s.city != ''
    GROUP BY s.city ORDER BY cnt DESC
  `).all();
  const niches = db.prepare(`
    SELECT s.niche, COUNT(*) as cnt FROM students s
    INNER JOIN users u ON u.telegram_id = s.telegram_id
    WHERE s.niche IS NOT NULL AND s.niche != ''
    GROUP BY s.niche ORDER BY cnt DESC
  `).all();
  res.json({ cities, niches });
});

// ── ПОДРЯДЧИКИ ──
app.get('/api/contractors', requireAuth, (req, res) => {
  const { category } = req.query;
  const userId = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(req.user.telegram_id)?.id;
  let sql = `
    SELECT c.*,
      (SELECT ROUND(AVG(cr.rating), 1) FROM contractor_ratings cr WHERE cr.contractor_id = c.id) as avg_rating,
      (SELECT COUNT(*) FROM contractor_ratings cr WHERE cr.contractor_id = c.id) as rating_count,
      (SELECT cr.rating FROM contractor_ratings cr WHERE cr.contractor_id = c.id AND cr.user_id = ?) as my_rating
    FROM contractors c WHERE 1=1
  `;
  const params = [userId || 0];
  if (category) { sql += ' AND c.category = ?'; params.push(category); }
  sql += ' ORDER BY c.sort_order';
  const contractors = db.prepare(sql).all(...params);
  const categories  = db.prepare('SELECT category, COUNT(*) as cnt FROM contractors GROUP BY category ORDER BY cnt DESC').all();
  res.json({ contractors, categories });
});

// Оценить подрядчика (1-5 звёзд) — 1 оценка на пользователя, можно менять
app.post('/api/contractors/:id/rate', requireAuth, (req, res) => {
  try {
    const userId = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(req.user.telegram_id)?.id;
    if (!userId) return res.status(404).json({ error: 'user_not_found' });
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ error: 'invalid_rating' });
    // UPSERT: каждый пользователь может иметь только 1 оценку на подрядчика (меняется при повторном клике)
    db.prepare(`
      INSERT INTO contractor_ratings (user_id, contractor_id, rating)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, contractor_id) DO UPDATE SET rating = excluded.rating, created_at = datetime('now')
    `).run(userId, req.params.id, rating);
    const avg = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as cnt FROM contractor_ratings WHERE contractor_id = ?').get(req.params.id);
    res.json({ ok: true, avg_rating: Math.round((avg.avg || 0) * 10) / 10, rating_count: avg.cnt });
  } catch (e) {
    console.error('❌ /rate error:', e.message);
    res.status(500).json({ error: 'server_error', detail: e.message });
  }
});

app.get('/api/me/profile-data', requireAuth, (req, res) => {
  const s = db.prepare('SELECT city, niche, revenue, goal, strengths, email, phone, can_share, full_name FROM students WHERE telegram_id = ?').get(req.user.telegram_id);
  res.json({ data: s || null });
});

app.patch('/api/me/profile-data', requireAuth, (req, res) => {
  const { full_name, city, niche, revenue, goal, strengths, email, phone, can_share } = req.body;
  const existing = db.prepare('SELECT id FROM students WHERE telegram_id = ?').get(req.user.telegram_id);
  if (existing) {
    db.prepare(`UPDATE students SET
      full_name  = COALESCE(?, full_name),
      city       = COALESCE(?, city),
      niche      = COALESCE(?, niche),
      revenue    = COALESCE(?, revenue),
      goal       = COALESCE(?, goal),
      strengths  = COALESCE(?, strengths),
      email      = COALESCE(?, email),
      phone      = COALESCE(?, phone),
      can_share  = ?
      WHERE telegram_id = ?`
    ).run(full_name||null, city||null, niche||null, revenue||null, goal||null, strengths||null, email||null, phone||null, can_share?1:0, req.user.telegram_id);
  }
  res.json({ ok: true });
});


app.get('/api/me/employees', requireAuth, (req, res) => {
  const owner = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(req.user.telegram_id);
  if (!owner) return res.json({ employees: [], slots: 5 });
  const employees = db.prepare('SELECT * FROM employees WHERE owner_id = ?').all(owner.id);
  res.json({ employees, slots: 5, used: employees.length });
});

app.post('/api/me/employees', requireAuth, (req, res) => {
  const owner = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(req.user.telegram_id);
  if (!owner) return res.status(404).json({ error: 'user_not_found' });

  const count = db.prepare('SELECT COUNT(*) as cnt FROM employees WHERE owner_id = ?').get(owner.id).cnt;
  if (count >= 5) return res.status(400).json({ error: 'employee_limit_reached', max: 5 });

  const { telegram_id, first_name } = req.body;
  db.prepare('INSERT INTO employees (owner_id, telegram_id, first_name) VALUES (?, ?, ?)').run(owner.id, telegram_id, first_name);
  res.json({ ok: true });
});

app.delete('/api/me/employees/:id', requireAuth, (req, res) => {
  const owner = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(req.user.telegram_id);
  db.prepare('DELETE FROM employees WHERE id = ? AND owner_id = ?').run(req.params.id, owner?.id);
  res.json({ ok: true });
});

// ── ADMIN: сброс анкеты (для тестирования онбординга) ──
app.post('/api/admin/reset-profile', requireAuth, requireAdmin, (req, res) => {
  const { telegram_id } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id_required' });
  db.prepare(`UPDATE students SET city=NULL, niche=NULL, revenue=NULL, goal=NULL, strengths=NULL, can_share=0 WHERE telegram_id=?`).run(String(telegram_id));
  res.json({ ok: true, message: 'Анкета сброшена. При следующем входе покажется онбординг.' });
});

// ── ADMIN: сброс устройств пользователя ──
app.post('/api/admin/reset-devices', requireAuth, requireAdmin, (req, res) => {
  const { telegram_id } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id_required' });
  db.prepare("UPDATE users SET active_token = '[]' WHERE telegram_id = ?").run(String(telegram_id));
  res.json({ ok: true, message: 'Устройства сброшены. Пользователь может войти заново.' });
});

// ── ADMIN: инфо об устройствах пользователя ──
app.get('/api/admin/devices/:telegram_id', requireAuth, requireAdmin, (req, res) => {
  const sessions = getSessions(req.params.telegram_id);
  res.json({
    devices_count: sessions.length,
    max_devices: MAX_DEVICES,
    sessions: sessions.map((s, i) => ({
      slot: i + 1,
      added: new Date(s.added).toLocaleString('ru-RU'),
      refreshed: s.refreshed ? new Date(s.refreshed).toLocaleString('ru-RU') : null
    }))
  });
});

// ── ADMIN: список администраторов ──
app.get('/api/admin/list-admins', requireAuth, requireAdmin, (req, res) => {
  const admins = db.prepare("SELECT telegram_id, first_name, username, photo_url, created_at FROM users WHERE role = 'admin' ORDER BY created_at").all();
  res.json({ admins });
});

// ── ADMIN: убрать права администратора ──
app.post('/api/admin/revoke-admin', requireAuth, requireAdmin, (req, res) => {
  const { telegram_id } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id_required' });
  if (String(telegram_id) === String(req.user.telegram_id)) return res.status(400).json({ error: 'cannot_revoke_self' });
  db.prepare("UPDATE users SET role = 'student' WHERE telegram_id = ?").run(String(telegram_id));
  res.json({ ok: true });
});

// ── ADMIN: выдать права администратора ──
app.post('/api/admin/grant-admin', requireAuth, requireAdmin, (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'identifier_required' });

  // Ищем по telegram_id или username
  const clean = identifier.replace('@', '').trim();
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ? OR username = ?').get(clean, clean);

  if (!user) return res.status(404).json({ error: 'user_not_found', message: 'Пользователь не найден. Он должен сначала войти на сайт.' });

  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  res.json({ ok: true, telegram_id: user.telegram_id, username: user.username });
});

// ── ADMIN: управление уроками ──

// Добавить урок
app.post('/api/admin/lessons', requireAuth, requireAdmin, (req, res) => {
  const { kinescopeId, title, module_id, description, duration, date, files } = req.body;
  if (!kinescopeId || !title || !module_id) return res.status(400).json({ error: 'missing_fields' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM lessons').get()?.m || 0;
  const r = db.prepare(`
    INSERT INTO lessons (kinescope_id, title, module_id, description, duration, lesson_date, files, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(kinescopeId, title, module_id, description || '', duration || '—', date || '', JSON.stringify(files || []), maxOrder + 1);
  res.json({ ok: true, id: r.lastInsertRowid });
});

// Обновить урок
app.patch('/api/admin/lessons/:id', requireAuth, requireAdmin, (req, res) => {
  const { title, module_id, description, files } = req.body;
  const updates = [];
  const params  = [];
  if (title !== undefined)       { updates.push('title = ?');       params.push(title); }
  if (module_id !== undefined)   { updates.push('module_id = ?');   params.push(module_id); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (files !== undefined)       { updates.push('files = ?');       params.push(JSON.stringify(files)); }
  if (!updates.length) return res.status(400).json({ error: 'nothing_to_update' });
  params.push(req.params.id);
  db.prepare(`UPDATE lessons SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// Переместить несколько уроков в другой раздел (bulk)
app.patch('/api/admin/lessons/bulk-move', requireAuth, requireAdmin, (req, res) => {
  const { lesson_ids, module_id } = req.body;
  if (!Array.isArray(lesson_ids) || !module_id) return res.status(400).json({ error: 'invalid_params' });
  const stmt = db.prepare('UPDATE lessons SET module_id = ? WHERE id = ?');
  for (const id of lesson_ids) stmt.run(module_id, id);
  res.json({ ok: true, updated: lesson_ids.length });
});

// ── ADMIN: управление подрядчиками ──
app.post('/api/admin/contractors', requireAuth, requireAdmin, (req, res) => {
  const { name, category, description, contact, website, promo_code } = req.body;
  const r = db.prepare('INSERT INTO contractors (name, category, description, contact, website, promo_code) VALUES (?, ?, ?, ?, ?, ?)').run(name, category, description || '', contact || '', website || '', promo_code || '');
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.patch('/api/admin/contractors/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, category, description, contact, website, promo_code } = req.body;
  db.prepare('UPDATE contractors SET name=?, category=?, description=?, contact=?, website=?, promo_code=? WHERE id=?').run(name, category, description, contact, website || '', promo_code, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/contractors/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM contractors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// SPA fallback — все остальные роуты отдают index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Max Evirma Club API запущен на :${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
  console.log(`   Режим:   ${DEV_MODE ? 'DEV (Telegram auth не проверяется)' : 'PRODUCTION'}`);
  console.log(`   Dev-вход: POST /api/auth/telegram { "id": "ваш_telegram_id" }\n`);

  // Миграции — добавляем новые колонки если их нет
  try {
    const cols = db.prepare("PRAGMA table_info(lessons)").all().map(c => c.name);
    if (!cols.includes('files'))        db.prepare("ALTER TABLE lessons ADD COLUMN files TEXT DEFAULT '[]'").run();
    if (!cols.includes('lesson_date'))  db.prepare("ALTER TABLE lessons ADD COLUMN lesson_date TEXT DEFAULT ''").run();
    if (!cols.includes('kinescope_id')) db.prepare("ALTER TABLE lessons ADD COLUMN kinescope_id TEXT DEFAULT ''").run();
    console.log('✅ Миграции БД применены');
  } catch(e) {
    console.log('⚠️  Ошибка миграции:', e.message);
  }

  // Миграция: 6 мини-курсов вместо одного раздела
  try {
    const existingMods = db.prepare("SELECT slug FROM modules").all().map(m => m.slug);
    const COURSE_MODULES = [
      { slug: 'kurs-obelenie',  title: 'Обеление с нуля',                                  icon: '🛡', sort_order: 8  },
      { slug: 'kurs-trendy',    title: 'Анализ трендов: как найти Лабубу?',                 icon: '📈', sort_order: 9  },
      { slug: 'kurs-foto',      title: 'Фотоворонка от первого взгляда до покупки',          icon: '📸', sort_order: 10 },
      { slug: 'kurs-neuro',     title: 'Новогодний нейроконтент',                            icon: '✨', sort_order: 11 },
      { slug: 'kurs-godplan',   title: 'Сценарий годового планирования товарного бизнеса',   icon: '📅', sort_order: 12 },
      { slug: 'kurs-strategiya',title: 'Стратегия продвижения карточки товара',              icon: '⚡', sort_order: 13 },
    ];
    for (const mod of COURSE_MODULES) {
      if (!existingMods.includes(mod.slug)) {
        db.prepare("INSERT INTO modules (slug, title, icon, sort_order) VALUES (?, ?, ?, ?)").run(mod.slug, mod.title, mod.icon, mod.sort_order);
        console.log(`✅ Добавлен модуль: ${mod.title}`);
      }
    }

    // Переназначение уроков по kinescope ID
    const getModId = (slug) => db.prepare("SELECT id FROM modules WHERE slug = ?").get(slug)?.id;
    const LESSON_MOVES = [
      // Обеление с нуля
      { id: 'adf1abc5-1837-4ddb-bc15-a11516ef78c5', slug: 'kurs-obelenie',   title: 'Урок 1. Обеляем селлеров' },
      { id: '2e7f0e9b-92d5-4a0b-8857-b18d33955856', slug: 'kurs-obelenie',   title: 'Урок 2. Основные пути обеления' },
      { id: '4787affd-1af1-49a2-8152-9bd49a6149b5', slug: 'kurs-obelenie',   title: 'Урок 3. Финансовая модель' },
      { id: '55ea9d60-b6e6-4300-a83a-cf23f3c33062', slug: 'kurs-obelenie',   title: 'Урок 4. Про сертификацию для ВЭД' },
      { id: '074f6d44-2c6f-43b0-917d-a3f6f6abdbb7', slug: 'kurs-obelenie',   title: 'Урок 5. Как начать возить в белую' },
      // Анализ трендов
      { id: '140c4422-c5d1-4b7b-8448-7d592e297557', slug: 'kurs-trendy',     title: 'Оракул запросов' },
      { id: '69f5b05a-e629-4c08-a79d-ce35e3a95682', slug: 'kurs-trendy',     title: 'МпСтатс' },
      { id: 'cb88393a-e69e-47e7-a23c-806e014b140a', slug: 'kurs-trendy',     title: 'Джем' },
      { id: '745faba6-b317-4af6-982f-6846640cfecc', slug: 'kurs-trendy',     title: 'Google Trends' },
      { id: 'b13a6c87-383c-425a-85c0-7946a0db4cee', slug: 'kurs-trendy',     title: 'ТикТок тренды' },
      // Фотоворонка
      { id: '8b402144-c6ee-45ac-b946-e38c209b8405', slug: 'kurs-foto',       title: 'Урок 1. Первое впечатление' },
      { id: 'aedac1ae-e64f-4b66-9501-599db21418c6', slug: 'kurs-foto',       title: 'Урок 2. Главное фото' },
      { id: 'cfd8c3a4-5131-46fa-a161-cced106c8c51', slug: 'kurs-foto',       title: 'Урок 3. Инфографика' },
      { id: '9e5c9665-5f0d-4025-bc66-9fbdc190be6f', slug: 'kurs-foto',       title: 'Урок 4. Продающий контент' },
      { id: 'abd8d023-942a-4956-a118-2f3429372b97', slug: 'kurs-foto',       title: 'Урок 5. Видеообложка' },
      // Новогодний нейроконтент
      { id: '31d39cd8-3dd4-4ddb-9553-2f904ff06415', slug: 'kurs-neuro',      title: 'Урок 1. Создание изображений' },
      { id: '304a29c1-b5f5-4b29-b001-e899cc811790', slug: 'kurs-neuro',      title: 'Урок 2. Видео с Sora' },
      { id: 'cb09f056-8126-48eb-9f13-e93980c59732', slug: 'kurs-neuro',      title: 'Урок 3. Veo-3' },
      // Годовое планирование
      { id: '5c40c5c1-9e99-4bea-a048-74d3903ee2b7', slug: 'kurs-godplan',    title: 'Урок 1. Итоги года' },
      { id: '3a5bce3a-01d1-40b2-a1ff-63f4a62b6b0d', slug: 'kurs-godplan',    title: 'Урок 2. Анализ ниши' },
      { id: '8d2b2c1d-976b-48d2-ba6f-55d30d2fda29', slug: 'kurs-godplan',    title: 'Урок 3. Цели и метрики' },
      { id: '2d4afc2f-5022-417c-a29d-a02b75855a11', slug: 'kurs-godplan',    title: 'Урок 4. Финансовый план' },
      { id: '52725fac-8b44-4c2f-81b5-9902f16775b8', slug: 'kurs-godplan',    title: 'Урок 5. Маркетинг план' },
      { id: 'a14e2a35-4c16-443f-a3ce-f3219024a7bc', slug: 'kurs-godplan',    title: 'Урок 6. Итоговый план' },
      // Стратегия продвижения
      { id: '86c55ebe-86d4-4ddd-9b9e-a6691b0f050e', slug: 'kurs-strategiya', title: 'Урок 1. Сбор ключевых фраз' },
      { id: '1d652df0-1a29-4ee3-97e9-feab7df4d5dc', slug: 'kurs-strategiya', title: 'Урок 2. Релевантность' },
      { id: '9632bf4e-7de0-4dbb-b4af-e0ea9962b8f2', slug: 'kurs-strategiya', title: 'Урок 3. Оптимизация РК' },
      { id: '66d589d6-8a1b-4b47-b4f6-6f02350f9062', slug: 'kurs-strategiya', title: 'Урок 4. Факторы ранжирования' },
      { id: '8ace80dd-54ee-4f42-8a21-bfcbdf5f7f50', slug: 'kurs-strategiya', title: 'Урок 5. Обзор плагина Evirma' },
      { id: '3cdff16f-148d-414c-80c9-5f38ed8c7b75', slug: 'kurs-strategiya', title: 'Урок 6. Настройка и оптимизация РК' },
      { id: '8c8adbe7-c65f-4d6a-968e-5e593b42f3b5', slug: 'kurs-strategiya', title: 'Как правильно запускать новинку. Часть 2' },
      { id: 'c1b945f3-6647-4748-a2e8-bb1510d28d31', slug: 'kurs-strategiya', title: 'Как правильно запустить новинку на Wildberries. Часть 2' },
    ];
    for (const move of LESSON_MOVES) {
      const modId = getModId(move.slug);
      if (modId) {
        db.prepare("UPDATE lessons SET module_id = ?, title = ? WHERE id = ?").run(modId, move.title, move.id);
      }
    }
    // Исправляем плохие названия уроков
    const NAME_FIXES = [
      { id: '7621ac59-81cb-4cb4-9403-3aa8b29b84b7', title: 'Эфир от 24.03.2026' },
      { id: 'e4c33317-abd7-4501-a8e1-756c2256c712', title: 'Эфир от 16.03.2026' },
      { id: 'ad7a405a-46e5-4337-a7ba-662d0e8f301b', title: 'Офлайн форум по продвижению Max Evirma' },
      { id: 'ff15a865-e554-4121-91d4-f49a566108b7', title: 'Эфир от 03.12.2025' },
      { id: 'a098e6aa-195e-47fb-a610-51fb61010108', title: 'Эфир от 23.10.2025' },
      { id: 'ccb5689f-e3de-4e88-9161-4519de3be0f2', title: 'Разбор от 19.02.2026' },
      { id: 'e46497a5-fbaa-4fcb-9e1e-2edaf7df729e', title: 'Таблица: анализ рекламы по точкам входа' },
    ];
    for (const fix of NAME_FIXES) {
      db.prepare("UPDATE lessons SET title = ? WHERE id = ?").run(fix.title, fix.id);
    }
    console.log('✅ Мини-курсы сгруппированы');
  } catch(e) {
    console.log('⚠️  Ошибка миграции курсов:', e.message);
  }

  // Авто-импорт при первом запуске если база пустая
  try {
    const lessonCount = db.prepare('SELECT COUNT(*) as cnt FROM lessons').get().cnt;
    if (lessonCount === 0) {
      console.log('📦 База пустая — запускаю импорт...');
      require('./import.js');
    } else {
      console.log(`✅ База: ${lessonCount} уроков, импорт не нужен`);
    }
  } catch(e) {
    console.log('⚠️  Ошибка авто-импорта:', e.message);
  }

  // Авто-сид подрядчиков: запускаем если нет MPSTATS с правильным промокодом
  try {
    const mpstats = db.prepare("SELECT id FROM contractors WHERE name='MPSTATS' AND promo_code='maxevirmaclub'").get();
    const cntRow  = db.prepare('SELECT COUNT(*) as cnt FROM contractors').get();
    if (!mpstats) {
      console.log(`📦 Подрядчиков в БД: ${cntRow.cnt} — запускаю сид...`);
      const SEED = [
        { name:'Wildcrm', category:'Финансовый учет', contact:'https://t.me/wildcrm_bot?start=ref_871e22ee2db69c697853e4c2066bb090', website:'https://t.me/wildcrm_bot?start=ref_871e22ee2db69c697853e4c2066bb090', promo_code:'Max Evirma', description:'Облачный сервис для оцифровки бизнеса на Wildberries.\n\nЧтобы получить бонусные баллы:\n1. Зарегистрируйтесь по реферальной ссылке\n2. Напишите в поддержку "Max Evirma"\n\n400 бонусных баллов + 3 пробных дня на весь функционал.', sort_order:1 },
        { name:'SoykaSoft', category:'Финансовый учет', contact:'https://clck.ru/3PFhkj', website:'https://clck.ru/3PFhkj', promo_code:'EVIRMA', description:'Для участников Max Evirma Club:\n• 5% доп. скидка на все тарифы\n• 2 часа работы финаналитика бесплатно\n\nТариф 3 мес — скидка 15%, 6 мес — 20%, 9 мес — 25%.\n\nSoykaSoft: реальная прибыль и маржинальность по каждому товару, управление кэшфлоу, точки роста на основе цифр.', sort_order:2 },
        { name:'Александра К', category:'Дизайнер', contact:'89163132868 | @AlexandraL2sha', website:'@AlexandraL2sha', promo_code:'', description:'Честно погрузилась в тематику и быстро предложила визуальное решение для наших карточек на WB.', sort_order:3 },
        { name:'Педантекс', category:'Фулфилмент', contact:'@Trubetzkoi12', website:'https://moscow.ff-pedantex.ru/?utm_source=yab', promo_code:'EVIRMACLUB', description:'Особые условия для участников:\n* 1-й месяц — скидка 20%\n* 2-й месяц — скидка 15%\n\nСклад 300 м², Курьяновская набережная. Интеграция с WB, Ozon. Полный комплекс: хранение, упаковка, доставка.', sort_order:4 },
        { name:'Сертификат Профэкспресс', category:'Честный знак и сертификация', contact:'+79010835507 — Василий | @certprof', website:'https://certprofexp.ru', promo_code:'CERTPROF26', description:'Скидка 10% на первое оформление.\n\nСертификаты | Декларации | СГР | Маркировка ЧЗ | Регистрация ТЗ.\nС 2020 г., 100+ сертификаций, опыт со сложными видами документов.', sort_order:5 },
        { name:'Олег Петров, ООО Фактори', category:'Производства', contact:'89057110280 | Factorypd@yandex.ru | @Olegvpetrov', website:'@Olegvpetrov', promo_code:'Evirma', description:'Пошив одежды (атлас, искусственный шёлк). Большой цех, работа в белую, ЧЗ, разработка лекал.\n\nБесплатный подбор тканей для участников Закрытого канала.', sort_order:6 },
        { name:'Самовыкупы «ТКМ»', category:'Выкупы', contact:'@tkmarketplaces', website:'https://t.me/tkm_manager', promo_code:'TKM_EVIRMA', description:'Самовыкупы для WB и OZON.\n— 25 городов, 5000 живых аккаунтов\n— Только вручную, без ботов\n— Сами забирают товар, есть ФФ\n— Работа по договору, фотоотзывы', sort_order:7 },
        { name:'Lemro', category:'Логистика', contact:'@Lemro_info', website:'https://t.me/lemro_moskow', promo_code:'Артем', description:'Фулфилмент и логистика. Низкие цены, много направлений, быстрая отгрузка. Руководитель с опытом из крупнейшего ФФ.', sort_order:8 },
        { name:'BDA Logistics', category:'Логистика', contact:'+7 985 623-07-99', website:'https://t.me/BDA_Logistic', promo_code:'Artem72', description:'Карго из Китая. Без косяков, отсрочка платежа, оплата на фабрику за вас. Хороший курс обмена. Оплата: наличка или USDT.', sort_order:9 },
        { name:'Kurochka', category:'Съёмки и контент', contact:'+79859199343 — Дмитрий', website:'https://kurochka.moscow/', promo_code:'', description:'Видео, фото, пакеты «под ключ». Киношники с опытом работы с маркетплейсами. Есть классные кейсы, на объёме — скидка.', sort_order:10 },
        { name:'trendHero', category:'Аналитика, оцифровка', contact:'@Adam_trendHero', website:'https://trendhero.io/ru/', promo_code:'MaxHero', description:'Скидка 20% для новых клиентов по промокоду.\n\n110+ млн аккаунтов Instagram. Проверка аудитории, поиск блогеров, выявление ботов, отслеживание упоминаний брендов.', sort_order:11 },
        { name:'CTR.box', category:'Съёмки и контент', contact:'@ctrbox_manager', website:'https://www.instagram.com/ctr.box/', promo_code:'CTR', description:'Скидка 15% по промокоду (кроме аренды студии).\n\nКонтент под ключ за 2 недели, исходники за 24 ч. 250+ CTR-тестов, видео/фото, инфографика, нейросети.', sort_order:12 },
        { name:'Карго — ЮВА и Фулфилмент', category:'Логистика', contact:'@shurban87', website:'https://t.me/kargo_voz', promo_code:'maxEvirma', description:'Забор груза с ЮВА и фулфилмент.\n\n20% скидка на первый заказ карго и ФБО. Работаем без праздников и выходных.', sort_order:13 },
        { name:'The View Studio', category:'Съёмки и контент', contact:'@theviewstudio', website:'https://theviewstudio.ru/', promo_code:'MAX', description:'Скидка 7% на сборные и индивидуальные съёмки. Белый фон, интерьер, стрит. Мобильный и основной контент.', sort_order:14 },
        { name:'MoneySellers', category:'Финансовый учет', contact:'https://clck.ru/3M2PDG', website:'https://clck.ru/3M2PDG', promo_code:'', description:'Система управления финансами.\n\nПри переходе по ссылке:\n1. Месяц в подарок после оплаченного периода\n2. Тест-доступ 7 дней\n3. Бесплатное обучение по финансам при покупке лицензии', sort_order:15 },
        { name:'MARPLA', category:'Аналитика, оцифровка', contact:'https://marpla.ru/', website:'https://marpla.ru/', promo_code:'Evirmamay', description:'Аналитика и продвижение товаров на WB. 7 дней полного доступа по промокоду.', sort_order:16 },
        { name:'SKEYLO', category:'Юрист', contact:'@skeylomanager', website:'https://t.me/skeylowb', promo_code:'EVIRMA', description:'Скидка 15% для участников Закрытого канала.\n\n3 года работы с маркетплейсами: WB, OZON, YM, Мегамаркет.\nОспаривание штрафов, поиск поставок, регистрация брендов, ответы на претензии.', sort_order:17 },
        { name:'WildBox', category:'Аналитика, оцифровка', contact:'https://wildbox.ru/', website:'https://wildbox.ru/', promo_code:'WILD10BOX', description:'Аналитика для Wildberries. Промокод WILD10BOX — скидка 10% на все тарифы.', sort_order:18 },
        { name:'Sellego', category:'Аналитика, оцифровка', contact:'https://t.me/sellego_bot', website:'https://sellego.com/', promo_code:'5EEQ3EXHB6', description:'SEO товаров и управление рекламой на WB. Скидка 20% на период подписки на Закрытый канал.', sort_order:19 },
        { name:'Splittest', category:'Аналитика, оцифровка', contact:'@managersplittest', website:'https://splittest.ru/', promo_code:'evirmaclub', description:'Сплит-тесты и опросы. Бонусные 1000 руб. на первый тест по промокоду.', sort_order:20 },
        { name:'Виолетта', category:'Специалист по блогерам', contact:'https://t.me/vinviniee', website:'https://t.me/vinviniee', promo_code:'', description:'Закупка рекламы у блогеров, преимущественно бартерные интеграции. Эксперт Закрытого канала Max Evirma.', sort_order:21 },
        { name:'MPSTATS', category:'Аналитика, оцифровка', contact:'https://mpstats.io/p/maxprowb', website:'https://mpstats.io/p/maxprowb', promo_code:'maxevirmaclub', description:'Скидка 20% на любой тариф по промокоду.\n\nДемо-доступ 14 дней для резидентов:\n1. Зарегистрируйтесь: https://mpsts.ru/u8-xQw\n2. Заполните форму: https://docs.google.com/forms/d/e/1FAIpQLSffLQeIlxJopGLeFm9K5no8W7yTUaAk5iFOJe3lUzsc6advUg/viewform\n\nДоступы ежедневно в 11:00 МСК (кроме сб/вс).', sort_order:22 },
        { name:'PRObayer', category:'Баеры', contact:'https://t.me/PRO_BAYER_MANAGER', website:'https://pro-bayer.ru/', promo_code:'EVIRMA', description:'Баеры: ТЯК, Садовод, Южные ворота, Дордой. Поиск товара и подбор поставщика по выгодным ценам.', sort_order:23 },
        { name:'FLG', category:'Логистика', contact:'https://flgchina.ru/', website:'https://flg-china.ru/?refLinkId=71918', promo_code:'', description:'Логистика из Китая. Поиск, оплата и доставка товаров. Бесплатная консультация по ссылке.', sort_order:24 },
        { name:'Мир', category:'Съёмки и контент', contact:'https://t.me/TMIRRU', website:'https://torogeldiev-ph.wfolio.pro/portfolio', promo_code:'', description:'Предметный фотограф. Предметная, портретная и студийная съёмка.', sort_order:25 },
        { name:'SKS.PRODUCTION', category:'Съёмки и контент', contact:'@sks_production', website:'https://t.me/sksprod', promo_code:'SKS', description:'Сборные съёмки в Москве. Съёмка бесплатной проходки.', sort_order:26 },
        { name:'Валерия', category:'Дизайнер', contact:'https://t.me/lieruag', website:'https://t.me/lieruag', promo_code:'', description:'Дизайнер инфографики для маркетплейсов.', sort_order:27 },
        { name:'Кристина', category:'Дизайнер', contact:'@kristik_mi', website:'https://t.me/kristik_mi', promo_code:'', description:'Дизайнер широкого профиля.', sort_order:28 },
        { name:'Omgbloggers', category:'Специалист по блогерам', contact:'https://t.me/pr_omgbloggers', website:'https://t.me/pr_omgbloggers', promo_code:'', description:'Агентство по работе с блогерами. Сотрудничество с брендами, актуальные стратегии продвижения. Контакт: Лолита.', sort_order:29 },
        { name:'Каролина Шаршун', category:'Юрист', contact:'@sharlikk', website:'https://t.me/sharlikk', promo_code:'', description:'Юридические консультации по вопросам маркетплейсов: быстро, качественно, просто.', sort_order:30 },
        { name:'FF Партнёры', category:'Фулфилмент', contact:'89951209994', website:'https://ffpartners.ru', promo_code:'EVIRMA', description:'Фулфилмент в Москве. Открыт с 2024, можно приехать на склад лично. Всегда открыты для гостей.', sort_order:31 },
        { name:'Вероника', category:'Финансовый учет', contact:'@trampompulya', website:'https://sigma.expert', promo_code:'', description:'Бухгалтерия на аутсорсе. Ведение от 2 000 до 5 000 руб/мес с полной отчётностью.', sort_order:32 },
        { name:'Тимурий', category:'Юрист', contact:'Юридическая фирма BKG', website:'https://www.bkglaw.ru', promo_code:'', description:'Юридические услуги для бизнеса. Выиграл дела 4 из 4 с большим перевесом.', sort_order:33 },
        { name:'Box-boss', category:'Фулфилмент', contact:'@boxboss_manager', website:'https://box-boss.ru', promo_code:'Evirma', description:'Фулфилмент в Москве. Бесплатное хранение 1 месяц, скидка на услуги и VIP-менеджер.', sort_order:34 },
        { name:'WildFlamingo', category:'Дизайнер', contact:'https://t.me/Wildflamingo', website:'https://wildflamingo.ru', promo_code:'EVIRMA', description:'Инфографика, SEO, Rich-контент для маркетплейсов. Скидка 10% на любые услуги.', sort_order:35 },
        { name:'Cloudmark.cc', category:'Честный знак и сертификация', contact:'Николай Чагин | https://t.me/Nikolaychagin', website:'https://cloudmark.cc', promo_code:'MAX100', description:'Честный знак и сертификация. 7 дней бесплатной работы по промокоду.', sort_order:36 },
        { name:'Даниил', category:'Честный знак и сертификация', contact:'https://t.me/Daniil_cert', website:'https://t.me/Daniil_cert', promo_code:'Evirma', description:'Сертификация и декларации соответствия. Специальные партнёрские цены с промокодом.', sort_order:37 },
        { name:'Ponches.me', category:'Выкупы', contact:'https://ponches.me/', website:'https://ponches.me/', promo_code:'Evirma', description:'Выкупы для OZON и WB от 180 руб. под ключ.\n\nБОНУС: 1 месяц в подарок если не используете весь лимит за 6 мес.', sort_order:38 },
        { name:'ПРОнайм', category:'HR', contact:'https://t.me/Coolcarolinehd — Каролина', website:'https://pro-pro-naim.com/', promo_code:'Маркетплейсы', description:'Поиск ассистентов и РОПов для России и Беларуси. Подбор до 100% трудоустройства.', sort_order:39 },
        { name:'Татьяна', category:'HR', contact:'https://t.me/tanya_recruitplace', website:'https://t.me/tanya_recruitplace', promo_code:'Evirma', description:'Подбор менеджеров маркетплейсов. Скидка 10% + бесплатная консультация с портретом кандидата и чек-листом.', sort_order:40 },
        { name:'Кадровое агентство PROHR', category:'HR', contact:'+7 985 350 8140 | @alinagalinichenko — Алина', website:'https://xn--80aalpbdkseiwkldq.xn--p1ai/', promo_code:'Evirma', description:'5 000 руб. скидка на первую вакансию + консультация.\n\nБесплатный аудит компании: подбор сотрудников для роста прибыли, анализ мотивации команды, помощь в управлении.', sort_order:41 },
        { name:'Стелла Литвиненко', category:'HR', contact:'https://t.me/LitStell', website:'https://t.me/hrwbst', promo_code:'Evirma', description:'Поиск сотрудников для маркетплейсов. Скидка 20%, консультация бесплатно.', sort_order:42 },
        { name:'Василий Пляцидевский', category:'HR', contact:'https://t.me/Vassiliuss', website:'https://t.me/getassistant', promo_code:'Evirma', description:'Найм ассистентов для маркетплейсов. Скидка 10% + доступ к обучению по управлению сотрудниками.', sort_order:43 },
      ];
      db.prepare('DELETE FROM contractor_ratings').run();
      db.prepare('DELETE FROM contractors').run();
      try { db.prepare("DELETE FROM sqlite_sequence WHERE name='contractors'").run(); } catch(e2) {}
      const ins = db.prepare('INSERT INTO contractors (name,category,description,contact,website,promo_code,sort_order) VALUES (?,?,?,?,?,?,?)');
      let seeded = 0;
      for (const c of SEED) {
        try { ins.run(c.name,c.category,c.description,c.contact,c.website,c.promo_code||'',c.sort_order); seeded++; } catch(e2) { console.log('⚠️ seed err:', c.name, e2.message); }
      }
      console.log(`✅ Подрядчики загружены: ${seeded}/${SEED.length}`);
    } else {
      console.log(`✅ Подрядчиков в БД: ${cntRow.cnt}`);
    }
  } catch(e) {
    console.log('⚠️  Ошибка сида подрядчиков:', e.message);
  }
});
