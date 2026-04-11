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
    const r   = await fetch(`${SUB_URL}?telegram_id=${telegramId}`);
    const sub = await r.json();
    return { active: !!sub.result, message: sub.message_result || null };
  } catch {
    return { active: false, message: null };
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

  // Проверяем подписку (в dev-режиме пропускаем)
  let sub = { active: true, message: 'Dev режим' };
  if (!DEV_MODE) {
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

// ── УЧЕНИКИ ──
app.get('/api/students', requireAuth, (req, res) => {
  const { city, niche, revenue, search, page = 1, limit = 24 } = req.query;
  let sql = 'SELECT s.*, u.photo_url FROM students s LEFT JOIN users u ON u.telegram_id = s.telegram_id WHERE s.can_share = 1';
  const params = [];

  if (city)    { sql += ' AND s.city = ?';              params.push(city); }
  if (niche)   { sql += ' AND s.niche LIKE ?';          params.push(`%${niche}%`); }
  if (revenue) { sql += ' AND s.revenue LIKE ?';        params.push(`%${revenue}%`); }
  if (search)  {
    sql += ' AND (s.full_name LIKE ? OR s.telegram_user LIKE ? OR s.niche LIKE ? OR s.goal LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const countSql = 'SELECT COUNT(*) as cnt FROM students s WHERE s.can_share = 1' + sql.split('WHERE s.can_share = 1')[1].split(' LIMIT')[0];
  const total = db.prepare(countSql).get(...params).cnt;
  sql += ` LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const students = db.prepare(sql).all(...params);
  res.json({ students, total, page: parseInt(page), pages: Math.ceil(total / limit) });
});

// Фильтры (уникальные города, ниши)
app.get('/api/students/filters', requireAuth, (req, res) => {
  const cities  = db.prepare("SELECT city, COUNT(*) as cnt FROM students WHERE can_share=1 AND city IS NOT NULL AND city != '' GROUP BY city ORDER BY cnt DESC").all();
  const niches  = db.prepare("SELECT niche, COUNT(*) as cnt FROM students WHERE can_share=1 AND niche IS NOT NULL AND niche != '' GROUP BY niche ORDER BY cnt DESC").all();
  res.json({ cities, niches });
});

// ── ПОДРЯДЧИКИ ──
app.get('/api/contractors', requireAuth, (req, res) => {
  const { category } = req.query;
  let sql = 'SELECT * FROM contractors WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY sort_order';
  const contractors = db.prepare(sql).all(...params);
  const categories  = db.prepare('SELECT category, COUNT(*) as cnt FROM contractors GROUP BY category ORDER BY cnt DESC').all();
  res.json({ contractors, categories });
});

app.get('/api/me/profile-data', requireAuth, (req, res) => {
  const s = db.prepare('SELECT city, niche, revenue, goal, strengths, email, phone FROM students WHERE telegram_id = ?').get(req.user.telegram_id);
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
  const { name, category, description, contact, promo_code, rating } = req.body;
  const r = db.prepare('INSERT INTO contractors (name, category, description, contact, promo_code, rating) VALUES (?, ?, ?, ?, ?, ?)').run(name, category, description || '', contact || '', promo_code || '', rating || 0);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.patch('/api/admin/contractors/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, category, description, contact, promo_code, rating } = req.body;
  db.prepare('UPDATE contractors SET name=?, category=?, description=?, contact=?, promo_code=?, rating=? WHERE id=?').run(name, category, description, contact, promo_code, rating, req.params.id);
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
});
