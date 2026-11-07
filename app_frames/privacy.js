// Защита личных данных. Работает ТОЛЬКО на компьютере хозяина, до отправки на сервер.
// Найденные данные заменяются метками вида [[телефон_1]]. Настоящие значения остаются здесь
// и подставляются обратно только в локальные действия (документ Word, буфер обмена, заметка).

function luhn(num) {
  const d = num.replace(/\D/g, ''); if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}

const os = require('os');

// Кириллица не считается «словом» для \b, поэтому границы слов задаём явно
const NL = '(?<![А-Яа-яЁёA-Za-z])', NR = '(?![А-Яа-яЁёA-Za-z])';
const CAP = '[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?';
const PATRON = '[А-ЯЁ][а-яё]+(?:ович|евич|ич|овна|евна|ична|инична)';
const digits = v => v.replace(/\D/g, '').length;

// порядок важен: сначала длинные и «точные» шаблоны
const PATTERNS = [
  // ключи и токены сервисов (API, GitHub, Slack, JWT, приватные ключи)
  { label: 'ключ', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { label: 'ключ', re: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}|\d{8,10}:[A-Za-z0-9_-]{35})\b/g },
  { label: 'ключ', re: /((?:api[_ -]?key|apikey|access[_ -]?token|token|токен|secret|секрет)\s*[:=]\s*["']?)([A-Za-z0-9_\-.\/+=]{12,})/gi, group: 2 },
  { label: 'пароль', re: /((?:парол[ьяюеи][а-яё]*|password|passwd|пин-?код[а-яё]*|\bpin\b|код доступа)(?:\s+от\s+[^\s:=—-]+)?\s*(?:[:=—-]|это|такой)\s*)([^\s,;]{3,})/gi, group: 2 },
  { label: 'пароль', re: /((?:парол[ьяюеи][а-яё]*|password|passwd|пин-?код[а-яё]*|\bpin\b|код доступа)(?:\s+от\s+[^\s:=—-]+)?\s+)((?=[^\s,;]*\d)[^\s,;]{4,})/gi, group: 2 },   // без двоеточия — только если похоже на пароль (есть цифра)
  { label: 'код', re: /((?:код[а-яё]*(?:\s+из\s+(?:смс|sms))?|смс|sms)\s*[:—-]?\s*)(\d{4,8})\b/gi, group: 2 },
  { label: 'карта', re: /\b(?:\d[ -]?){12,18}\d\b/g, check: v => luhn(v) || v.replace(/\D/g, '').length === 16 },
  { label: 'счёт', re: /\b\d{20}\b/g },
  { label: 'СНИЛС', re: /\b\d{3}[- ]?\d{3}[- ]?\d{3}[- ]\d{2}\b/g },
  { label: 'дата рождения', re: /((?:дат[аеуы] рождения|д\.\s?р\.|родил(?:ся|ась)|DOB|birth ?date)\s*[:—-]?\s*)(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/gi, group: 2 },
  // ФИО с отчеством: «Иванов Иван Иванович», «Иван Иванович Иванов», «Иван Иванович»
  { label: 'ФИО', re: new RegExp(`${NL}(?:${CAP}\\s+)?${CAP}\\s+${PATRON}(?:\\s+${CAP})?${NR}`, 'g') },
  // фамилия с инициалами: «Иванов И. И.», «И.И. Иванов»
  { label: 'ФИО', re: new RegExp(`${NL}${CAP}\\s+[А-ЯЁ]\\.\\s?[А-ЯЁ]\\.|${NL}[А-ЯЁ]\\.\\s?[А-ЯЁ]\\.\\s?${CAP}${NR}`, 'g') },
  { label: 'паспорт', re: /((?:паспорт[а-яё]*|серия)\s*(?:рф|серия)?\s*[:№]?\s*)(\d{2}\s?\d{2}\s?(?:№|номер)?\s?\d{6})(?!\d)/gi, group: 2 },
  { label: 'ИНН', re: /(ИНН\s*[:№]?\s*)(\d{12}|\d{10})\b/gi, group: 2 },
  { label: 'телефон', re: /(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g },
  { label: 'телефон', re: /\+(?!7)\d{1,3}[\s(.-]*\d{2,4}[\s).-]*\d{2,4}[\s.-]*\d{2,4}(?:[\s.-]*\d{2,4})?\b/g, check: v => digits(v) >= 9 && digits(v) <= 15 },
  // паспорт без слова «паспорт» — только в привычной записи с пробелами: «45 12 345678» или «4512 345678»
  { label: 'паспорт', re: /(?<![\d.,:-])\d{2}\s\d{2}\s№?\s?\d{6}(?![\d.,:-])|(?<![\d.,:-])\d{4}\s№?\s?\d{6}(?![\d.,:-])/g },
  { label: 'почта', re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  { label: 'адрес', re: /(?<![А-Яа-яЁёA-Za-z])(?:ул\.?|улиц[аеы]|пр-т|просп\.?|проспект[а-яё]*|пер\.?|переул[а-яё]*|ш\.|шоссе|бульвар[а-яё]*|б-р|наб\.?|набережн[а-яё]*|мкр\.?|микрорайон[а-яё]*)\s+[А-ЯЁA-Zа-яё0-9][\wА-Яа-яЁё.-]*(?:\s+[А-ЯЁа-яё][\wА-Яа-яЁё.-]*)?[,\s]+(?:д\.?|дом)?\s*\d+[а-яА-Я]?(?:[\s,/-]*(?:к\.?|корп\.?|стр\.?)\s*\d+)?(?:[,\s]*(?:кв\.?|квартир[а-яё]*)\s*\d+)?/gi },
  { label: 'адрес', re: /(?<![А-Яа-яЁёA-Za-z])(?:кв\.?|квартир[аеуы])\s*№?\s*\d+/gi }
];

const TOKEN = /\[\[([^\[\]]{1,40})\]\]/g;

// Папка пользователя (C:\Users\Имя) — в ней имя хозяина. Наружу уходит как %USERPROFILE%, обратно разворачивается.
const HOME = os.homedir();
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOME_RE = HOME && HOME.length > 3 ? new RegExp(escRe(HOME).replace(/\\\\/g, '[\\\\/]'), 'gi') : null;
const HOME_TOKEN = '%USERPROFILE%';
function hideHome(text) { return typeof text === 'string' && HOME_RE ? text.replace(HOME_RE, HOME_TOKEN) : text; }
function expandHome(text) { return typeof text === 'string' && text.includes(HOME_TOKEN) ? text.split(HOME_TOKEN).join(HOME) : text; }
function deep(obj, f) {
  if (typeof obj === 'string') return f(obj);
  if (Array.isArray(obj)) return obj.map(x => deep(x, f));
  if (obj && typeof obj === 'object') { const o = {}; for (const k of Object.keys(obj)) o[k] = deep(obj[k], f); return o; }
  return obj;
}

class Secrets {
  constructor(vault) {
    this.vault = vault;           // объект с методом get(name) — сейф
    this.byKey = new Map();       // телефон_1 -> +7 916 ...
    this.byValue = new Map();     // значение -> ключ (одно и то же значение — одна метка)
    this.count = {};
  }
  keyFor(label, value) {
    const v = value.trim();
    if (this.byValue.has(v)) return this.byValue.get(v);
    this.count[label] = (this.count[label] || 0) + 1;
    const key = `${label}_${this.count[label]}`;
    this.byKey.set(key, v); this.byValue.set(v, key);
    return key;
  }
  // текст -> { text: с метками, found: ['телефон', ...] }
  mask(text) {
    if (typeof text !== 'string' || !text) return { text, found: [] };
    const found = [];
    text = hideHome(text);
    // уже существующие метки не трогаем
    const parts = text.split(/(\[\[[^\[\]]{1,40}\]\])/);
    const out = parts.map(part => {
      if (/^\[\[[^\[\]]+\]\]$/.test(part)) return part;
      let s = part;
      for (const p of PATTERNS) {
        s = s.replace(p.re, (...m) => {
          const whole = m[0];
          const secret = p.group ? m[p.group] : whole;
          if (!secret || /^\[\[/.test(secret)) return whole;
          if (p.check && !p.check(secret)) return whole;
          const key = this.keyFor(p.label, secret);
          found.push(p.label);
          return p.group ? whole.slice(0, whole.length - secret.length) + `[[${key}]]` : `[[${key}]]`;
        });
      }
      return s;
    });
    return { text: out.join(''), found: [...new Set(found)] };
  }
  maskDeep(obj, found = []) {
    if (typeof obj === 'string') { const r = this.mask(obj); found.push(...r.found); return r.text; }
    if (Array.isArray(obj)) return obj.map(x => this.maskDeep(x, found));
    if (obj && typeof obj === 'object') { const o = {}; for (const k of Object.keys(obj)) o[k] = this.maskDeep(obj[k], found); return o; }
    return obj;
  }
  // метки -> настоящие значения (ТОЛЬКО для локальных действий)
  unmask(text) {
    if (typeof text !== 'string') return text;
    return text.replace(TOKEN, (whole, key) => {
      const k = key.trim();
      if (/^сейф:/i.test(k)) { const v = this.vault && this.vault.get(k.slice(5).trim()); return v != null ? v : whole; }
      return this.byKey.has(k) ? this.byKey.get(k) : whole;
    });
  }
  unmaskDeep(obj) {
    if (typeof obj === 'string') return this.unmask(obj);
    if (Array.isArray(obj)) return obj.map(x => this.unmaskDeep(x));
    if (obj && typeof obj === 'object') { const o = {}; for (const k of Object.keys(obj)) o[k] = this.unmaskDeep(obj[k]); return o; }
    return obj;
  }
  // для показа в чате: [[телефон_1]] -> 🔒телефон
  display(text) {
    return typeof text === 'string' ? text.replace(TOKEN, (_, key) => '🔒' + key.trim().replace(/^сейф:/i, '').replace(/_\d+$/, '')) : text;
  }
}

module.exports = { Secrets, PATTERNS, hideHome, expandHome, hideHomeDeep: o => deep(o, hideHome), expandHomeDeep: o => deep(o, expandHome), HOME_TOKEN };
