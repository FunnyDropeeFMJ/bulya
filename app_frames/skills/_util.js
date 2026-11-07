// Общие помощники для умений Були
const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// PowerShell с UTF-8 выводом (иначе русские названия программ превращаются в «кракозябры»)
function ps(command, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' + command],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, out) => err ? reject(err) : resolve(out));
  });
}

function isPublicHttp(u) {
  let url; try { url = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  const h = url.hostname.toLowerCase();
  return !(h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
    /^\[(::1?|::ffff:.*|f[cd][0-9a-f]{2}:.*|fe[89ab][0-9a-f]:.*)\]$/.test(h) || !h.includes('.') && !h.startsWith('['));
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const strip = s => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// редиректы проверяем сами: публичная страница не должна увести запрос на роутер или локальный сервис
async function getText(url, timeout = 15000) {
  const signal = AbortSignal.timeout(timeout);
  for (let hop = 0; hop < 6; hop++) {
    if (!isPublicHttp(url)) throw new Error('Адрес ведёт во внутреннюю сеть — туда не хожу');
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru,en;q=0.8' }, redirect: 'manual', signal });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).href; continue; }
    return await r.text();
  }
  throw new Error('Слишком много перенаправлений');
}

// Папки пользователя, с которыми Буля может работать
const FOLDERS = { desktop: 'desktop', documents: 'documents', downloads: 'downloads', pictures: 'pictures', music: 'music', videos: 'videos' };
const userDirs = () => Object.values(FOLDERS).map(k => app.getPath(k));

// Файлы и папки, которые хозяин сам бросил на Булю, — к ним тоже можно
const dropped = new Set();
function allowDropped(p) { if (p) dropped.add(path.resolve(String(p)).toLowerCase()); }

// Путь разрешён, только если он внутри папок пользователя или его бросили на Булю
function inUserFolders(p) {
  if (!p) return false;
  const full = path.resolve(String(p)).toLowerCase();
  const under = d => full === d || full.startsWith(d + path.sep);
  return userDirs().some(d => under(path.resolve(d).toLowerCase())) || [...dropped].some(under);
}

// Папка для всего, что создаёт Буля: Документы\Буля
function bulyaDir(sub = '') {
  const d = path.join(app.getPath('documents'), 'Буля', sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const safeName = s => String(s || 'Документ').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'Документ';

// Никогда не перезаписываем: «Имя.docx», «Имя (2).docx», ...
function uniquePath(dir, name, ext) {
  let p = path.join(dir, name + ext), i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${name} (${i++})${ext}`);
  return p;
}

const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

module.exports = { allowDropped, ps, isPublicHttp, getText, decode, strip, FOLDERS, userDirs, inUserFolders, bulyaDir, safeName, uniquePath, norm, UA };
