// Буля без нейросети: понимает простые команды сам, прямо на компьютере.
// Работает, когда нейросеть не подключена или сервер не отвечает.
const { runTool, getSkill } = require('./tools');

const pick = a => a[Math.floor(Math.random() * a.length)];
const low = s => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
const NUM = { одну: 1, одна: 1, один: 1, две: 2, два: 2, три: 3, четыре: 4, пять: 5, десять: 10, пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50 };

// «через 10 минут», «через полчаса», «через час», «через 2 часа»
function parseDelay(t) {
  if (/через\s+полчаса/.test(t)) return 30;
  if (/через\s+час(?!а|ов)/.test(t)) return 60;
  const m = t.match(/через\s+(\d+|[а-я]+)\s*(мин|минут|минуты|м\b|час|часа|часов|ч\b)/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? +m[1] : NUM[m[1]];
  if (!n) return null;
  return /^ч|час/.test(m[2]) ? n * 60 : n;
}

const FOLDER_WORDS = [[/загрузк/, 'downloads'], [/документ/, 'documents'], [/рабоч[а-яёa-z0-9_]* стол/, 'desktop'], [/(изображ|картинк|фото)/, 'pictures'], [/музык/, 'music'], [/видео/, 'videos'], [/(папк[а-яёa-z0-9_]* бул|бул[а-яёa-z0-9_]* папк)/, 'bulya']];

// Каждое правило: test(текст) -> вызовы умений [{name, args}] + как ответить по результатам
const RULES = [
  { test: t => /^(привет|здравств|хай|ку\b|добр[а-яёa-z0-9_]+ (утро|день|вечер))/.test(t), say: () => pick(['Привет! Гав! 🐾', 'О, привет! Я тут.', 'Гав-гав! Рад тебя видеть!']), mood: 'happy' },
  { test: t => /(спасибо|благодар|молодец|умница|хороший)/.test(t), say: () => pick(['Гав! Всегда пожалуйста 🐾', 'Рад стараться!', 'Виляю хвостом!']), mood: 'love' },
  { test: t => /(как дела|как ты|что делаешь)/.test(t), say: () => pick(['Сторожу твой рабочий стол. Всё спокойно!', 'Отлично! Только без нейросети я немного глупенький.']), mood: 'happy' },

  // музыка и звук
  { test: t => /^(пауза|поставь на паузу|стоп|останови( музыку| видео)?|продолжи?( музыку| видео)?|play|плей)$/.test(t), calls: () => [{ name: 'media_control', args: { action: 'play_pause' } }], say: () => 'Нажал паузу/продолжить ⏯' },
  { test: t => /^(следующ[а-яё]*( трек| песн[а-яё]*| видео)?|дальше|переключи( трек| песню)?|скип|next)$/.test(t), calls: () => [{ name: 'media_control', args: { action: 'next' } }], say: () => 'Следующий трек ⏭' },
  { test: t => /^(предыдущ[а-яё]*( трек| песн[а-яё]*| видео)?|назад трек|верни трек)$/.test(t), calls: () => [{ name: 'media_control', args: { action: 'previous' } }], say: () => 'Предыдущий ⏮' },
  { test: t => /^(поставь |сделай )?громкость\s*(на\s*)?\d+\s*%?$/.test(t), calls: t => [{ name: 'media_control', args: { action: 'set_volume', percent: +t.match(/(\d+)/)[1] } }], say: (t, r) => `Громкость ${r[0].volume_percent ?? ''}% 🔊` },
  { test: t => /^(без звука|выключи звук|замолчи|mute)$/.test(t), calls: () => [{ name: 'media_control', args: { action: 'mute' } }], say: () => 'Звук выключен/включён 🔇' },
  { test: t => /^(сделай )?(громче|погромче|прибавь( звук)?)$/.test(t), calls: () => [{ name: 'media_control', args: { action: 'volume_up', steps: 5 } }], say: () => 'Сделал погромче 🔊' },
  { test: t => /^(сделай )?(тише|потише|убавь( звук)?)$/.test(t), calls: () => [{ name: 'media_control', args: { action: 'volume_down', steps: 5 } }], say: () => 'Сделал потише 🔉' },

  // YouTube
  { test: t => /(ютуб|youtube)/.test(t) && /(включи|поставь|найди|хочу|покажи)\s+\S/.test(t),
    calls: t => [{ name: 'youtube', args: { query: t.replace(/(на|в)?\s*(ютуб[а-яёa-z0-9_]*|youtube)/g, '').replace(/^(включи|поставь|найди|хочу посмотреть|хочу|покажи)\s*/, '').trim() } }],
    say: (t, r) => r[0].playing ? `Включил «${r[0].playing.title}» 🎬` : 'Открыл YouTube с результатами поиска' },
  { test: t => /^(включи|поставь)\s+(музык|песн|трек)/.test(t),
    calls: t => [{ name: 'youtube', args: { query: t.replace(/^(включи|поставь)\s+/, '') } }],
    say: (t, r) => r[0].playing ? `Включил «${r[0].playing.title}» 🎵` : 'Открыл поиск на YouTube' },
  { test: t => /^(открой|зайди на)\s+(ютуб|youtube)\s*$/.test(t), calls: () => [{ name: 'open_url', args: { url: 'https://www.youtube.com/' } }], say: () => 'Открыл YouTube ▶' },

  // напоминания и заметки
  { test: t => /напомни/.test(t) && parseDelay(t) != null,
    calls: t => [{ name: 'set_reminder', args: { minutes: parseDelay(t), text: (t.replace(/напомни( мне)?/, '').replace(/через\s+(\S+\s*)?(полчаса|час[а-яёa-z0-9_]*|мин[а-яёa-z0-9_]*|м\b|ч\b)/, '').replace(/^[\s,:—-]*(?:(?:про|о|об|что)\s+)?/, '').trim() || 'Ты просил напомнить') } }],
    say: (t, r) => `Напомню в ${r[0].at} ⏰`, mood: 'love' },
  { test: t => /^(запиши|запомни|заметка)[\s:,—-]+\S/.test(t), calls: t => [{ name: 'save_note', args: { text: t.replace(/^(запиши|запомни|заметка)[\s:,—-]+/, '') } }], say: () => 'Записал в блокнотик 📝' },
  { test: t => /(мои заметки|что я (просил|записывал)|покажи заметки)/.test(t), calls: () => [{ name: 'read_notes', args: {} }],
    say: (t, r) => r[0].notes && r[0].notes.length ? 'Последние заметки:\n' + r[0].notes.slice(-8).join('\n') : 'Заметок пока нет.' },

  // экран, компьютер
  { test: t => /(скриншот|сфоткай экран|снимок экрана|скрин\b)/.test(t), calls: () => [{ name: 'screenshot', args: { open: true } }], say: () => 'Сфоткал! Лежит в Документы\\Буля\\Скриншоты 📸', mood: 'happy' },
  { test: t => /^(заблокируй( экран| компьютер| комп)?|закрой на замок)$/.test(t), calls: () => [{ name: 'lock_screen', args: {} }], say: () => 'Закрыл на замок 🔒' },
  { test: t => /(тормоз|состояни[а-яёa-z0-9_]* (компа|компьютер|пк)|сколько памяти|загрузк[а-яёa-z0-9_]* процессор|что с компом)/.test(t), calls: () => [{ name: 'system_info', args: {} }],
    say: (t, [r]) => `Процессор: ${r.cpu_percent}%. Память: свободно ${r.ram_free_gb} из ${r.ram_total_gb} ГБ.\n` +
      (r.disks || []).map(d => `Диск ${d.Name}: свободно ${d.FreeGB} ГБ`).join('\n') +
      (r.heaviest_programs && r.heaviest_programs[0] ? `\nБольше всех ест: ${r.heaviest_programs.slice(0, 3).map(p => `${p.Name} (${p.MemoryMB} МБ)`).join(', ')}` : '') },
  { test: t => /погод/.test(t), calls: t => { const m = t.match(/(?:в|во)\s+([а-яa-z-]+(?:\s+[а-яa-z-]+)?)\s*\??$/); return [{ name: 'weather', args: { city: m ? m[1] : 'Москва' } }]; },
    say: (t, [r]) => `${r.city[0].toUpperCase() + r.city.slice(1)}: сейчас ${r.now.temp_c > 0 ? '+' : ''}${r.now.temp_c}°, ощущается как ${r.now.feels_like_c > 0 ? '+' : ''}${r.now.feels_like_c}°, ${String(r.now.description).toLowerCase()}.\nСегодня от ${r.days[0].min_c}° до ${r.days[0].max_c}°.` },

  // папки, файлы, программы, сайты
  { test: t => /^(открой|покажи)\s+(папку\s+)?/.test(t) && FOLDER_WORDS.some(([re]) => re.test(t)) && !/(найди|файл)/.test(t),
    calls: t => [{ name: 'open_folder', args: { folder: FOLDER_WORDS.find(([re]) => re.test(t))[1] } }], say: () => 'Открыл папку 📂' },
  { test: t => /^(найди|где)\s+(файл[а-яёa-z0-9_]*\s+)?\S/.test(t),
    calls: t => [{ name: 'find_files', args: { query: t.replace(/^(найди|где)\s+(мой\s+|мои\s+)?(файл[а-яёa-z0-9_]*\s+)?/, '').replace(/^(про|с названием)\s+/, '').trim() } }],
    say: (t, [r]) => r.found ? `Нашёл ${r.found}:\n` + r.items.slice(0, 6).map(i => `• ${i.name} — ${i.path}`).join('\n') : 'Ничего не нашёл 🐾' },
  { test: t => /^(открой|зайди на)\s+(сайт\s+)?([a-z0-9-]+\.)+[a-z]{2,}/.test(t),
    calls: t => { let u = t.match(/((?:[a-z0-9-]+\.)+[a-z]{2,}\S*)/)[1]; if (!/^https?:/.test(u)) u = 'https://' + u; return [{ name: 'open_url', args: { url: u } }]; }, say: () => 'Открыл сайт 🌐' },
  { test: t => /^(открой|запусти|включи)\s+\S/.test(t),
    calls: t => [{ name: 'launch_program', args: { name: t.replace(/^(открой|запусти|включи)\s+(программу\s+)?/, '').trim() } }],
    say: (t, [r]) => r.ok ? `Запустил ${r.started} 🚀` : null }
];

const HELP = 'Без нейросети я понимаю простые команды: «открой Телеграм», «включи на ютубе лофи», «пауза», «громче», «громкость 30», «напомни через 10 минут про чай», «скриншот», «погода в Казани», «найди файл договор», «открой загрузки», «запиши: купить корм», «почему тормозит комп».';

// Возвращает { text, mood, ran } или null, если команда не распознана.
// strict — режим «сервер не ответил»: только короткие сообщения, которые начинаются с явной команды
const COMMAND_START = /^(открой|запусти|включи|поставь|пауза|стоп|останови|продолжи?|дальше|следующ|предыдущ|переключи|громче|погромче|тише|потише|прибавь|убавь|громкость|без звука|выключи звук|напомни|запиши|заметка|мои заметки|покажи|скриншот|заблокируй|погода|найди|где файл|сделай громче|сделай тише)/;
async function handle(text, ctx, { strict = false } = {}) {
  const t = low(text).replace(/^буля[,\s]+/, '').replace(/[.!]+$/, '');
  if (strict && (t.length > 80 || !COMMAND_START.test(t))) return null;
  if (/^(помощь|что ты умеешь|команды|help)\??$/.test(t)) return { text: HELP, mood: 'talk' };
  for (const rule of RULES) {
    if (!rule.test(t)) continue;
    const calls = rule.calls ? rule.calls(t) : [];
    const results = [];
    for (const c of calls) {
      const sk = getSkill(c.name) || {};
      ctx.onEvent({ type: 'tool', name: c.name, label: sk.label, anim: sk.anim });
      let r;
      try { r = await runTool(c.name, c.args, ctx); } catch (e) { r = { ok: false, error: e.message }; }
      ctx.onEvent({ type: 'tool_done', name: c.name, ok: !!(r && r.ok), doneAnim: sk.doneAnim });
      results.push(r || {});
      if (!r || !r.ok) return { text: 'Не вышло: ' + ((r && r.error) || 'что-то пошло не так') + ' 🐾', mood: 'sad', ran: true };
    }
    const said = rule.say ? rule.say(t, results) : null;
    if (said == null) continue;           // правило не подошло по результату — пробуем дальше
    return { text: said, mood: rule.mood || (calls.length ? 'happy' : 'talk'), ran: calls.length > 0 };
  }
  return null;
}

module.exports = { handle, HELP, parseDelay };
