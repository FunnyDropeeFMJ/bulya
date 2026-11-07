// Память Були: профиль хозяина, моменты, табу для шуток, счётчики привычек, сейф.
// Хранится локально: %AppData%\bulya-helper-frames\memory\  (память.json — можно открыть и править руками;
// сейф.bin — зашифрован средствами Windows, расшифровать можно только под твоей учётной записью).
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

const today = () => new Date().toLocaleDateString('sv-SE');   // местная дата ГГГГ-ММ-ДД
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
// латиница и кириллица сравниваются одинаково: «Альмера» ~ «Almera»
const lat = s => norm(s).replace(/[а-я]/g, c => TR[c] ?? c).replace(/(.)\1+/g, '$1').replace(/[yj]/g, 'i').replace(/w/g, 'v').replace(/ph/g, 'f').replace(/x/g, 'ks');
const stems = s => lat(s).split(' ').filter(w => w.length >= 4).map(w => w.slice(0, 5));

const LIMITS = { профиль: 60, моменты: 300, табу: 50 };

class Memory {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'память.json');
    this.vaultFile = path.join(dir, 'сейф.bin');
    this.load();
    this.vaultData = this.loadVault();
  }

  /* ── файл памяти ─────────────────────────────── */
  load() {
    let d = {};
    if (fs.existsSync(this.file)) {
      try { d = JSON.parse(fs.readFileSync(this.file, 'utf-8').replace(/^\uFEFF/, '')); }
      catch (e) {
        // файл испорчен (например, при ручной правке) — НЕ затираем его, а откладываем в сторону
        const broken = this.file.replace(/\.json$/, '') + '.испорчен-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
        try { fs.copyFileSync(this.file, broken); } catch { }
        this.loadError = path.basename(broken);
        // если есть вчерашняя копия — берём её
        try { d = JSON.parse(fs.readFileSync(this.file + '.bak', 'utf-8')); this.loadError += ', восстановил из резервной копии'; } catch { d = {}; }
      }
    }
    this.d = {
      профиль: Array.isArray(d.профиль) ? d.профиль : [],
      моменты: Array.isArray(d.моменты) ? d.моменты : [],
      табу: Array.isArray(d.табу) ? d.табу : [],
      счётчики: d.счётчики && typeof d.счётчики === 'object' ? d.счётчики : {},
      знакомство: d.знакомство || today(),
      последний_визит: d.последний_визит || null,
      встреч: d.встреч || 0,
      настройки: { болтает_сам: true, ...(d.настройки || {}) },
      реплик_сам: d.реплик_сам || {},
      напоминания: Array.isArray(d.напоминания) ? d.напоминания : []
    };
    this.save();
  }
  save() {
    // раз в сутки — резервная копия рядом (память.json.bak)
    try {
      const bak = this.file + '.bak';
      if (!this.loadError && fs.existsSync(this.file) && (!fs.existsSync(bak) || Date.now() - fs.statSync(bak).mtimeMs > 86400000)) fs.copyFileSync(this.file, bak);
    } catch { }
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.d, null, 2), 'utf-8');
    fs.renameSync(tmp, this.file);
  }

  /* ── записи ──────────────────────────────────── */
  add(kind, text, source = 'чат') {
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (t.length < 3) return { ok: false, error: 'Пустая запись' };
    const list = kind === 'момент' ? 'моменты' : 'профиль';
    const n = norm(t);
    const dup = this.d[list].find(e => { const m = norm(e.текст); return m === n || (n.length > 12 && (m.includes(n) || n.includes(m))); });
    if (dup) return { ok: false, duplicate: dup.текст };
    const entry = { текст: t, когда: today(), тип: kind, откуда: source };
    this.d[list].push(entry);
    if (this.d[list].length > LIMITS[list]) this.d[list].splice(0, this.d[list].length - LIMITS[list]);
    this.save();
    return { ok: true, saved: entry };
  }
  // что подходит под «забудь …» (без удаления). Слишком короткий запрос не подходит ни к чему.
  forgetMatcher(query) {
    const q = lat(query); if (q.replace(/\s/g, '').length < 3) return () => false;
    const words = q.split(' ').filter(w => w.length >= 3).map(w => w.slice(0, Math.max(3, w.length - 2)));
    return e => { const n = lat(e.текст || e); return n.includes(q) || (words.length > 0 && words.every(w => n.includes(w))); };
  }
  forgetPreview(query) {
    const match = this.forgetMatcher(query);
    return ['профиль', 'моменты', 'табу'].flatMap(list => this.d[list].filter(match).map(e => e.текст || e));
  }
  forget(query) {
    const match = this.forgetMatcher(query);
    const removed = [];
    for (const list of ['профиль', 'моменты', 'табу']) {
      this.d[list] = this.d[list].filter(e => { if (match(e)) { removed.push(e.текст || e); return false; } return true; });
    }
    if (removed.length) this.save();
    return removed;
  }

  /* ── напоминания (переживают перезапуск и сон компьютера) ── */
  addReminder(minutes, text) {
    const at = Date.now() + minutes * 60000;
    const r = { id: Math.random().toString(36).slice(2), at: new Date(at).toISOString(), text: String(text || 'Напоминание').slice(0, 300) };
    this.d.напоминания.push(r); this.save();
    return r;
  }
  // забрать наступившие напоминания
  takeDueReminders(now = Date.now()) {
    const due = this.d.напоминания.filter(r => Date.parse(r.at) <= now);
    if (due.length) { this.d.напоминания = this.d.напоминания.filter(r => !due.includes(r)); this.save(); }
    return due;
  }
  search(query, limit = 10) {
    const qs = stems(query);
    const all = [...this.d.профиль, ...this.d.моменты];
    if (!qs.length) return all.slice(-limit);
    return all.map(e => ({ e, s: stems(e.текст).filter(x => qs.includes(x)).length })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.e);
  }
  addTaboo(topic) {
    const t = String(topic || '').trim().slice(0, 100);
    if (!t) return false;
    if (!this.d.табу.some(x => norm(x) === norm(t))) { this.d.табу.push(t); this.save(); }
    return true;
  }
  wipe() {
    Object.assign(this.d, { профиль: [], моменты: [], табу: [], счётчики: {}, реплик_сам: {} });
    this.save();
  }

  /* ── визиты, привычки ────────────────────────── */
  absenceHours() { return this.d.последний_визит ? (Date.now() - Date.parse(this.d.последний_визит)) / 3600000 : null; }
  touch() {
    const gap = this.absenceHours();
    if (gap == null || gap > 0.5) this.d.встреч += 1;
    this.d.последний_визит = new Date().toISOString();
    this.save();
    return gap;
  }
  countTool(name) {
    const day = today();
    const c = this.d.счётчики[day] = this.d.счётчики[day] || {};
    c[name] = (c[name] || 0) + 1;
    for (const k of Object.keys(this.d.счётчики)) if (Date.now() - Date.parse(k) > 7 * 86400000) delete this.d.счётчики[k];
    this.save();
  }
  proactiveAllowed(maxPerDay = 6) { return (this.d.реплик_сам[today()] || 0) < maxPerDay; }
  proactiveDone() {
    this.d.реплик_сам = { [today()]: (this.d.реплик_сам[today()] || 0) + 1 };
    this.save();
  }
  get chatty() { return !!this.d.настройки.болтает_сам; }
  set chatty(v) { this.d.настройки.болтает_сам = !!v; this.save(); }

  /* ── что положить в запрос к нейросети ───────── */
  promptBlock(userText = '') {
    const L = [];
    if (this.d.профиль.length) {
      L.push('Что ты знаешь о хозяине:');
      for (const e of this.d.профиль.slice(-40)) L.push(`- ${e.текст}`);
    } else L.push('Ты пока почти ничего не знаешь о хозяине — присматривайся и запоминай интересное.');

    const recent = this.d.моменты.slice(-3);
    const relevant = userText ? this.search(userText, 6).filter(e => e.тип === 'момент' && !recent.includes(e)) : [];
    const older = this.d.моменты.slice(0, -3);
    const random = older.length && Math.random() < 0.35 ? [older[Math.floor(Math.random() * older.length)]] : [];
    const moments = [...new Set([...relevant, ...random, ...recent])];
    if (moments.length) {
      L.push('', 'Моменты, которые ты помнишь (можно вспомнить к слову или беззлобно подколоть):');
      for (const e of moments) L.push(`- ${e.когда}: ${e.текст}`);
    }
    if (this.d.табу.length) L.push('', 'НИКОГДА не шути и не подкалывай про: ' + this.d.табу.join('; ') + '.');

    // состояние
    const now = new Date(), h = now.getHours();
    const part = h < 5 ? 'глубокая ночь' : h < 9 ? 'раннее утро' : h < 12 ? 'утро' : h < 17 ? 'день' : h < 22 ? 'вечер' : 'поздний вечер';
    const days = Math.max(1, Math.floor((Date.parse(today()) - Date.parse(this.d.знакомство)) / 86400000) + 1);
    L.push('', 'Твоё состояние сейчас:');
    L.push(`- Сейчас ${part} (${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}). Вы знакомы ${days} дн., это примерно ваша ${Math.max(1, this.d.встреч)}-я встреча.`);
    if (this._gap != null && this._gap > 24) L.push(`- Вы не виделись ${Math.round(this._gap / 24)} дн. — ты соскучился.`);
    else if (this._gap != null && this._gap > 6) L.push(`- Хозяина не было ${Math.round(this._gap)} ч.`);
    const c = this.d.счётчики[today()] || {};
    const habits = Object.entries(c).filter(([, n]) => n >= 3).map(([k, n]) => `${k} ×${n}`);
    if (habits.length) L.push(`- Сегодня хозяин уже просил: ${habits.join(', ')}.`);

    const vault = this.vaultNames();
    if (vault.length) L.push('', `В сейфе (на компьютере, сервер значения не видит): ${vault.join(', ')}. Чтобы вставить в документ, пиши метку [[сейф:имя]], например [[сейф:${vault[0]}]].`);
    return L.join('\n');
  }

  /* ── сейф ────────────────────────────────────── */
  loadVault() {
    if (!fs.existsSync(this.vaultFile)) return {};
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('нет шифрования');
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(this.vaultFile)));
    } catch {
      // сейф не открылся — откладываем копию, чтобы следующая запись не уничтожила старые данные
      this.vaultBroken = true;
      try { fs.copyFileSync(this.vaultFile, this.vaultFile.replace(/\.bin$/, '') + '.не-открылся-' + Date.now() + '.bin'); } catch { }
      return {};
    }
  }
  saveVault() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно — сейф не сохранить');
    fs.writeFileSync(this.vaultFile, safeStorage.encryptString(JSON.stringify(this.vaultData)));
  }
  vaultKey(name) { return norm(name).replace(/\s+/g, '_').slice(0, 30); }
  vaultSet(name, value) { const k = this.vaultKey(name); if (!k || !value) return null; this.vaultData[k] = String(value); this.saveVault(); return k; }
  vaultDel(name) { const k = this.vaultKey(name); if (!(k in this.vaultData)) return false; delete this.vaultData[k]; this.saveVault(); return true; }
  vaultNames() { return Object.keys(this.vaultData); }
  get(name) { return this.vaultData[this.vaultKey(name)]; }   // для Secrets: [[сейф:имя]]
}

module.exports = { Memory };
