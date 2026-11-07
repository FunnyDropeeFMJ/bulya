// Буля замечает, что происходит с компьютером и с хозяином, и реагирует сам.
// Всё работает локально, без нейросети (кроме приветствия после долгой разлуки).
const { app, powerMonitor, shell, Notification } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const hhmm = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const TEMP = /\.(crdownload|part|partial|tmp|download|opdownload)$|^~\$|^\.~/i;

const PHRASES = {
  download: ['Принёс! Скачался «%s» 🐾', 'Гав! В Загрузках новенькое: «%s»', 'Апорт! «%s» уже в Загрузках'],
  drive: ['Ой, новый диск %s — флешка? Дай понюхать!', 'Кто-то вставил %s. Обнюхать?', 'Гав! Появился диск %s'],
  cpu: ['Ух, жарко! Процессор пыхтит на %s%%. Глянуть, кто грузит?', 'Компьютер дышит, как я после прогулки — %s%% процессора. Разнюхать?'],
  battery: ['Отключили от розетки — переходим в экономный режим 🔋', 'Работаем от батарейки. Не забудь покормить ноутбук!'],
  back: ['С возвращением! Я скучал 🐾', 'О, ты вернулся! Гав!', 'Наконец-то! Я тут сторожил.'],
  night1: ['Уже %s… Может, спать? Я вот уже клюю носом.', '%s на часах. Даже бульдоги в это время спят.'],
  night2: ['%s! Серьёзно, пора спать. Я без тебя не лягу 😴', 'Глубокая ночь, %s. Завтра будешь как сонный бульдог.'],
  walk: ['Ты сидишь уже час. Пойдём гулять — хоть до кухни? 🐾', 'Час за компьютером! Разомни лапы, я подожду.', 'Пора размяться: потянись, попей воды — я засеку.'],
  newyear: ['С Новым годом! 🎉 Пусть всё работает, а я рядом!'],
  birthday: ['Сегодня ровно %s, как мы знакомы! Гав-гав! 🎂']
};

class Watchers {
  constructor({ send, memory, chat, win }) {
    Object.assign(this, { send, memory, chat, win });
    this.actions = new Map();          // id -> функция (кнопки в облачке)
    this.lastNoticeAt = 0;
    this.timers = [];
    this.seenDownloads = new Map();
    this.night = {};
    this.activeMin = 0;
    this.cpuHigh = 0; this.cpuWarnAt = 0;
    this.lockAt = null;
  }
  get on() { return this.memory.d.настройки.события !== false; }
  get walkOn() { return this.memory.d.настройки.размяться !== false; }

  notice(text, { anim, mood = 'happy', actions = [], ttl, force = false } = {}) {
    if (!this.on && !force) return;
    if (!force && Date.now() - this.lastNoticeAt < 90 * 1000) return;   // не тараторит
    if (this.chat.busy) return;
    this.lastNoticeAt = Date.now();
    const acts = actions.map(a => {
      if (a.ask) return { label: a.label, ask: a.ask };
      const id = Math.random().toString(36).slice(2);
      this.actions.set(id, a.run); return { label: a.label, id };
    });
    this.send({ type: 'notice', text, anim, mood, actions: acts, ttl });
  }
  runAction(id) { const f = this.actions.get(id); if (f) { this.actions.delete(id); try { f(); } catch { } } }

  start() {
    this.watchDownloads();
    this.every(5000, () => this.checkDrives());
    this.every(15000, () => this.checkReminders());
    setTimeout(() => this.checkReminders(true), 8000);   // пропущенные, пока Буля был выключен
    this.every(15000, () => this.checkCpu());
    this.every(60000, () => this.checkDay());
    powerMonitor.on('on-battery', () => this.notice(pick(PHRASES.battery), { anim: 'surprised' }));
    powerMonitor.on('lock-screen', () => { this.lockAt = Date.now(); this.send({ type: 'sleep' }); });
    powerMonitor.on('suspend', () => { this.lockAt = this.lockAt || Date.now(); this.send({ type: 'sleep' }); });
    const back = () => { this.send({ type: 'wake' }); this.welcomeBack(); this.checkReminders(); };
    powerMonitor.on('unlock-screen', back);
    powerMonitor.on('resume', back);
    this.listDrives().then(d => { this.drives = d; });
    setTimeout(() => this.checkHolidays(), 15000);
  }
  every(ms, f) { this.timers.push(setInterval(() => { try { const r = f(); if (r && r.catch) r.catch(() => { }); } catch { } }, ms)); }

  /* ── напоминания: хранятся в памяти, проверяются по часам (сон компьютера им не мешает) ── */
  checkReminders(missed = false) {
    for (const r of this.memory.takeDueReminders()) {
      const late = Date.now() - Date.parse(r.at) > 2 * 60000;
      const text = r.text + (late ? ` (должен был напомнить в ${new Date(r.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${missed ? ', пока меня не было' : ''})` : '');
      this.send({ type: 'reminder', text });
      try { if (Notification.isSupported()) new Notification({ title: 'Буля напоминает 🐾', body: text }).show(); } catch { }
    }
  }

  /* ── Загрузки: «принёс файл» ───────────────────── */
  watchDownloads() {
    const dir = app.getPath('downloads');
    try {
      fs.watch(dir, (ev, name) => {
        if (!name || TEMP.test(name)) return;
        const p = path.join(dir, name);
        clearTimeout(this.seenDownloads.get('t:' + name));
        // ждём, пока размер перестанет меняться
        this.seenDownloads.set('t:' + name, setTimeout(() => this.downloadSettled(p, name), 2500));
      });
    } catch { }
  }
  downloadSettled(p, name) {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (!st.isFile() || st.size === 0 || Date.now() - st.mtimeMs > 5 * 60000) return;
    const prev = this.seenDownloads.get(name);
    if (prev && Date.now() - prev < 10 * 60000) return;
    setTimeout(() => {
      let st2; try { st2 = fs.statSync(p); } catch { return; }
      if (st2.size !== st.size) return this.downloadSettled(p, name);
      this.seenDownloads.set(name, Date.now());
      this.notice(pick(PHRASES.download).replace('%s', name.length > 40 ? name.slice(0, 37) + '…' : name), {
        anim: 'alert', actions: [
          { label: 'Открыть', run: () => shell.openPath(p) },
          { label: 'Показать в папке', run: () => shell.showItemInFolder(p) }
        ]
      });
    }, 1500);
  }

  /* ── флешки и диски ─────────────────────────────── */
  // асинхронно: отвалившийся сетевой диск не должен замораживать Булю
  async listDrives() {
    if (process.platform !== 'win32') return new Set();
    const letters = []; for (let c = 68; c <= 90; c++) letters.push(String.fromCharCode(c) + ':\\');
    const ok = await Promise.all(letters.map(d => Promise.race([
      fs.promises.access(d).then(() => true, () => false),
      new Promise(r => setTimeout(() => r(this.drives ? this.drives.has(d) : false), 3000))   // не дождались — считаем, что ничего не поменялось
    ])));
    return new Set(letters.filter((_, i) => ok[i]));
  }
  async checkDrives() {
    if (this.drivesBusy || !this.drives) return;
    this.drivesBusy = true;
    try {
      const now = await this.listDrives();
      for (const d of now) if (!this.drives.has(d)) {
        this.notice(pick(PHRASES.drive).replace('%s', d.slice(0, 2)), { anim: 'alert', actions: [{ label: 'Открыть', run: () => shell.openPath(d) }] });
      }
      this.drives = now;
    } finally { this.drivesBusy = false; }
  }

  /* ── процессор: «пыхтит» ────────────────────────── */
  cpuSample() {
    const c = os.cpus().reduce((a, x) => { const t = Object.values(x.times).reduce((p, q) => p + q, 0); return { idle: a.idle + x.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
    const prev = this.cpuPrev; this.cpuPrev = c;
    if (!prev) return null;
    return Math.round(100 * (1 - (c.idle - prev.idle) / Math.max(1, c.total - prev.total)));
  }
  checkCpu() {
    const load = this.cpuSample(); if (load == null) return;
    if (load >= 90) this.cpuHigh++; else { if (this.cpuHigh >= 3) this.send({ type: 'panting', on: false }); this.cpuHigh = 0; }
    if (this.cpuHigh === 3) {
      this.send({ type: 'panting', on: true });
      if (Date.now() - this.cpuWarnAt > 30 * 60000) {
        this.cpuWarnAt = Date.now();
        this.notice(pick(PHRASES.cpu).replace('%s', load), { anim: 'dizzy', actions: [{ label: 'Глянуть', ask: 'Почему тормозит компьютер? Кто больше всего грузит?' }] });
      }
    }
  }

  /* ── хозяин вернулся ────────────────────────────── */
  async welcomeBack() {
    const away = this.lockAt ? (Date.now() - this.lockAt) / 60000 : 0;
    this.lockAt = null;
    this.activeMin = 0;
    if (away < 20 || !this.on) return;
    if (away > 4 * 60 && !this.chat.busy) {
      const r = await this.chat.proactive('greeting');
      if (r) return this.send({ type: 'proactive', ...r });
    }
    this.notice(pick(PHRASES.back), { anim: 'wag', force: true });
  }

  /* ── режим дня: ночь, «пойдём гулять», праздники ── */
  checkDay() {
    const idle = powerMonitor.getSystemIdleTime();
    const now = new Date(), h = now.getHours(), m = now.getMinutes();
    const nightKey = new Date(now.getTime() - 6 * 3600000).toDateString();   // «ночь» привязана к вечеру
    if (idle < 120) {
      if ((h === 0 && m >= 30) || (h >= 1 && h < 5)) {
        this.night[nightKey] = this.night[nightKey] || {};
        const n = this.night[nightKey];
        if (!n.first) { n.first = true; this.notice(pick(PHRASES.night1).replace('%s', hhmm()), { anim: 'yawn' }); }
        else if (!n.second && h >= 2) { n.second = true; this.notice(pick(PHRASES.night2).replace('%s', hhmm()), { anim: 'yawn' }); }
      }
    }
    // час непрерывной работы → зовёт размяться
    if (idle < 300) this.activeMin++; else this.activeMin = 0;
    if (this.walkOn && this.activeMin >= 60) {
      this.activeMin = 0;
      this.notice(pick(PHRASES.walk), { anim: 'stretch', actions: [{ label: 'Засеки 5 минут', ask: 'Поставь напоминание через 5 минут: возвращайся за компьютер после разминки' }] });
    }
    if (m === 0) this.checkHolidays();
  }
  checkHolidays() {
    const d = new Date(), key = d.toDateString();
    if (this.holidayShown === key) return;
    const md = (d.getMonth() + 1) * 100 + d.getDate();
    if (md === 1231 || md === 101) { this.holidayShown = key; return this.notice(pick(PHRASES.newyear), { anim: 'party', force: true }); }
    const met = new Date(this.memory.d.знакомство);
    const years = d.getFullYear() - met.getFullYear();
    if (years >= 1 && d.getMonth() === met.getMonth() && d.getDate() === met.getDate()) {
      this.holidayShown = key;
      const n10 = years % 10, n100 = years % 100;
      const word = n10 === 1 && n100 !== 11 ? 'год' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'года' : 'лет';
      this.notice(pick(PHRASES.birthday).replace('%s', years === 1 ? 'год' : years + ' ' + word), { anim: 'party', force: true });
    }
  }
}

module.exports = { Watchers };
