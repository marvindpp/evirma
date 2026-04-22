// fetch-content.js — выгружает контент из CMS и обновляет data/content.json
// Запуск: node fetch-content.js
const fs   = require('fs');
const path = require('path');

const CMS_URL = 'https://app.maxevirmaclub.ru/api/cms/content?limit=1000';
const CMS_KEY = 'WGbdRlNDvtAbZFoCnOmFfPlKBboHqI0MwLqZOZMAqu8GoKxn5PUchvjmf83gpw4sGXkVyZQ1LykfVmzyep8XzVShzwMW5dOrTk4UsdgTHycZJ9Z0kuCogz188jZsGZym';

const SLUG_TO_MODULE = {
  'efiry-s-maksom':              1,
  'efiry-so-spikerami':          2,
  'razbory-topov':               3,
  'razbory-uchastnikov':         4,
  'razbory-reklamnyh-kabinetov': 5,
  'tablitsy':                    6,
  'mini-kursy':                  7,
};
const MODULE_TITLES = {
  1:'Эфиры с Максом', 2:'Эфиры со спикерами', 3:'Разборы ТОПов',
  4:'Разборы участников', 5:'Разборы РК', 6:'Таблицы', 7:'Мини-курсы',
};
const MODULE_ICONS = {
  1:'🔴', 2:'🎙️', 3:'🏆', 4:'👥', 5:'📊', 6:'📋', 7:'📚',
};

async function main() {
  console.log('Загружаю данные из CMS...');
  const resp = await fetch(CMS_URL, {
    headers: { 'x-cms-api-key': CMS_KEY }
  });
  if (!resp.ok) throw new Error('CMS API error: ' + resp.status);
  const data = await resp.json();
  const items = data.content || [];
  console.log('Получено уроков:', items.length);

  const modules = Object.entries(SLUG_TO_MODULE).map(([slug, id]) => ({
    id, slug, title: MODULE_TITLES[id], icon: MODULE_ICONS[id], order: id,
  })).sort((a, b) => a.id - b.id);

  const lessons = [];
  let skipped = 0;

  for (const item of items) {
    const catSlug = item.category?.slug || '';
    const moduleId = SLUG_TO_MODULE[catSlug];
    if (!moduleId) { skipped++; continue; }

    // Видео URL из блока video
    let videoUrl = '', embedUrl = '';
    for (const b of (item.blocks || [])) {
      if (b.type === 'video' && b.data?.videoUrl) {
        videoUrl = b.data.videoUrl;
        const m = videoUrl.match(/kinescope\.io\/([^/?]+)/);
        if (m) embedUrl = 'https://kinescope.io/embed/' + m[1];
        break;
      }
    }

    // Описание и таймкоды из блока rich_text
    let contentHtml = '', contentText = '';
    for (const b of (item.blocks || [])) {
      if (b.type === 'rich_text' && b.data?.html) {
        contentHtml = b.data.html;
        contentText = contentHtml.replace(/<[^>]+>/g, '');
        break;
      }
    }

    // ID урока = Kinescope ID
    let lessonId = '';
    if (videoUrl) {
      const m = videoUrl.match(/kinescope\.io\/([^/?]+)/);
      if (m) lessonId = m[1];
    }
    if (!lessonId) lessonId = item.id;

    const coverUrl = item.cover ? 'https://app.maxevirmaclub.ru' + item.cover : '';

    // Длительность в секундах
    const dur = item.duration || '00:00';
    const parts = dur.split(':').map(Number);
    const durSec = parts.length === 3
      ? parts[0]*3600 + parts[1]*60 + parts[2]
      : parts[0]*60 + (parts[1] || 0);

    lessons.push({
      id:           lessonId,
      cms_id:       item.id,
      title:        item.title || '',
      description:  item.description || '',
      content_html: contentHtml,
      content_text: contentText,
      module_id:    moduleId,
      duration:     dur,
      duration_sec: durSec,
      embed_url:    embedUrl,
      video_url:    videoUrl,
      poster:       coverUrl,
      cover_url:    coverUrl,
      created_at:   item.createdAt || '',
      published_at: item.publishedAt || '',
      status:       item.status || 'published',
      views:        item._count?.views || 0,
      order_in_module: item.sortOrder || 0,
    });
  }

  const withHtml  = lessons.filter(l => l.content_html).length;
  const withEmbed = lessons.filter(l => l.embed_url).length;
  console.log(`Уроков обработано: ${lessons.length} (пропущено: ${skipped})`);
  console.log(`С описанием/таймкодами: ${withHtml}`);
  console.log(`С видео: ${withEmbed}`);

  const outPath = path.join(__dirname, 'data', 'content.json');
  fs.writeFileSync(outPath, JSON.stringify({ modules, lessons }, null, 2), 'utf8');
  console.log('✅ Сохранено в data/content.json');
}

main().catch(e => { console.error('Ошибка:', e.message); process.exit(1); });
