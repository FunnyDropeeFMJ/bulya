// Программы: запуск любой установленной по названию, список, закрытие (с разрешения)
const { spawn, execFile } = require('child_process');
const { ps, norm } = require('./_util');

// русские прозвища популярных программ
const ALIASES = {
  'телеграм': 'telegram', 'телега': 'telegram', 'хром': 'chrome', 'гугл хром': 'chrome', 'ворд': 'word', 'эксель': 'excel',
  'пауэрпоинт': 'powerpoint', 'стим': 'steam', 'дискорд': 'discord', 'спотифай': 'spotify', 'яндекс браузер': 'yandex',
  'яндекс': 'yandex', 'файрфокс': 'firefox', 'эдж': 'edge', 'проводник': 'file explorer', 'пейнт': 'paint',
  'блокнот': 'notepad', 'калькулятор': 'calculator', 'ватсап': 'whatsapp', 'вотсап': 'whatsapp', 'зум': 'zoom',
  'вскод': 'visual studio code', 'vs code': 'visual studio code', 'фотошоп': 'photoshop', 'обс': 'obs', 'вк': 'vk',
  'диспетчер задач': 'task manager', 'ножницы': 'snipping tool', 'камера': 'camera', 'почта': 'mail', 'терминал': 'terminal'
};
const PROTECTED = ['system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost', 'dwm', 'explorer',
  'fontdrvhost', 'sihost', 'ctfmon', 'runtimebroker', 'searchhost', 'startmenuexperiencehost', 'msmpeng', 'electron'];

let cache = null, cacheAt = 0;
async function startApps() {
  if (cache && Date.now() - cacheAt < 10 * 60000) return cache;
  const out = await ps('Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress', 30000);
  let list = []; try { list = JSON.parse(out); } catch { }
  if (!Array.isArray(list)) list = [list];
  cache = list.filter(a => a && a.Name && a.AppID && !/uninstall|удален|удалить|readme|help|справк/i.test(a.Name));
  cacheAt = Date.now();
  return cache;
}

function score(name, q) {
  const n = norm(name);
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.split(/[\s\-_.]+/).includes(q)) return 70;
  if (n.includes(q)) return 50;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every(w => n.includes(w))) return 40;
  return 0;
}

async function findApp(query) {
  let q = norm(query);
  if (q.length < 2) return [];          // пустое имя не должно запускать «первую попавшуюся» программу
  if (ALIASES[q]) q = ALIASES[q];
  const apps = await startApps();
  const ranked = apps.map(a => ({ a, s: Math.max(score(a.Name, q), score(a.Name, norm(query))) })).filter(x => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.Name.length - y.a.Name.length);
  return ranked.map(x => x.a);
}

module.exports = [
  {
    name: 'launch_program', label: 'Запускаю программу', anim: 'work', doneAnim: 'wag',
    description: 'Запустить любую установленную программу по названию (как в меню Пуск): Telegram, Chrome, Word, Steam, Блокнот, Калькулятор и т.д.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'название программы' } }, required: ['name'] },
    async run({ name }) {
      if (!name || norm(name).length < 2) return { ok: false, error: 'Не понял, какую программу запустить' };
      const found = await findApp(name);
      if (!found.length) return { ok: false, error: `Не нашёл программу «${name}» в меню Пуск` };
      const app = found[0];
      spawn('explorer.exe', ['shell:AppsFolder\\' + app.AppID], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, started: app.Name, other_matches: found.slice(1, 4).map(a => a.Name) };
    }
  },
  {
    name: 'list_programs', label: 'Смотрю, что установлено', anim: 'search',
    description: 'Показать установленные программы (из меню Пуск), можно с фильтром по названию.',
    parameters: { type: 'object', properties: { filter: { type: 'string' } } },
    async run({ filter }) {
      const apps = filter ? await findApp(filter) : await startApps();
      return { ok: true, total: apps.length, programs: apps.slice(0, 80).map(a => a.Name) };
    }
  },
  {
    name: 'close_app', label: 'Спрашиваю разрешения закрыть программу', anim: 'guilty',
    description: 'Закрыть зависшую или тяжёлую программу по имени процесса (например chrome). Хозяин увидит окно подтверждения.',
    parameters: { type: 'object', properties: { process_name: { type: 'string' } }, required: ['process_name'] },
    confirm: ({ process_name }) => ({ message: `Закрыть программу «${String(process_name).replace(/\.exe$/i, '')}»?`, detail: 'Несохранённые данные в ней могут пропасть.' }),
    async run({ process_name }) {
      const base = String(process_name || '').trim().replace(/\.exe$/i, '');
      if (!/^[\w .()-]{1,60}$/.test(base)) return { ok: false, error: 'Странное имя процесса' };
      if (PROTECTED.includes(base.toLowerCase())) return { ok: false, error: 'Это системный процесс, его закрывать нельзя' };
      return await new Promise(res => execFile('taskkill.exe', ['/IM', base + '.exe'], { windowsHide: true },
        (err, out, errOut) => res(err ? { ok: false, error: (errOut || err.message).trim() } : { ok: true, result: out.trim() })));
    }
  }
];
