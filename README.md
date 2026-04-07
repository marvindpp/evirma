# Max Evirma Club — Backend

Express-сервер с SQLite базой. Авторизация через Telegram, прокси к Kinescope API, база учеников и подрядчиков.

## Требования
- Node.js **22.5+** (проверь: `node -v`)
- npm

## Быстрый старт

```bash
# 1. Установи зависимости (только express + cors)
npm install

# 2. Импортируй учеников из xlsx (нужен пакет xlsx)
npm install xlsx --no-save
node scripts/import-xlsx.js путь/к/BASE_06_04.xlsx

# 3. Загрузи все данные в базу
npm run import

# 4. Запусти сервер
npm start
# → http://localhost:3000/api/health
```

## DEV-режим (без Telegram)
По умолчанию запускается в DEV режиме — Telegram подпись не проверяется, подписка тоже.

Войти через API:
```bash
curl -X POST http://localhost:3000/api/auth/telegram \
  -H "Content-Type: application/json" \
  -d '{"id":"123456","first_name":"Test"}'
```

## Продакшен (VPS)
```bash
# Установи PM2
npm install -g pm2

# Запусти с переменными окружения
NODE_ENV=production \
BOT_TOKEN=7918341254:AAETVIIfFW53Amdcnoa1sIRjn8YJxxSkHpw \
KIN_TOKEN=3be9b86c-6fdd-4264-8ecd-a77cca747f71 \
SESSION_SECRET=придумай-длинный-секрет \
pm2 start server.js --name evirma

# Автостарт после перезагрузки
pm2 save && pm2 startup
```

## API Endpoints

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/health` | Проверка работоспособности |
| POST | `/api/auth/telegram` | Авторизация через Telegram Login Widget |
| GET | `/api/me` | Текущий пользователь |
| GET | `/api/me/subscription` | Статус подписки |
| GET | `/api/me/progress` | Прогресс просмотра уроков |
| GET | `/api/modules` | Разделы базы знаний |
| GET | `/api/lessons?module_id=1&search=` | Уроки (с фильтрацией) |
| POST | `/api/lessons/:id/watched` | Отметить урок просмотренным |
| GET | `/api/students?city=Москва&page=1` | База учеников |
| GET | `/api/students/filters` | Города и ниши для фильтров |
| GET | `/api/contractors?category=` | База подрядчиков |
| GET | `/api/me/employees` | Сотрудники текущего пользователя |
| POST | `/api/me/employees` | Добавить сотрудника |
| DELETE | `/api/me/employees/:id` | Удалить сотрудника |
| PATCH | `/api/admin/lessons/:id` | [Админ] Переименовать/переместить урок |
| PATCH | `/api/admin/lessons/bulk-move` | [Админ] Переместить пачку уроков |
| POST | `/api/admin/contractors` | [Админ] Добавить подрядчика |
| PATCH | `/api/admin/contractors/:id` | [Админ] Редактировать подрядчика |
| DELETE | `/api/admin/contractors/:id` | [Админ] Удалить подрядчика |

## Файловая структура
```
backend/
├── server.js          # Главный сервер
├── db.js              # SQLite схема
├── import.js          # Импорт данных в БД
├── package.json
├── data/
│   ├── content.json   # Видео + разделы (из Kinescope)
│   ├── students.json  # Ученики (генерируется из xlsx)
│   └── contractors.json # Подрядчики
├── scripts/
│   └── import-xlsx.js # Конвертер xlsx → json
└── public/            # Сюда кладёшь HTML файл
    └── index.html     # Фронтенд (HTML прототип)
```
