// «Мозг» Були: какая нейросеть, где она живёт и с каким ключом.
// Настройки — %AppData%\<программа>\brain.json, ключ — отдельно и зашифрован Windows (brain.key).
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

// Готовые варианты. Модели можно поменять в настройках или загрузить список с сервера.
const PRESETS = {
  gemini:     { title: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash',
                keyUrl: 'https://aistudio.google.com/apikey', note: 'Ключ в Google AI Studio. Доступность и тарифы зависят от аккаунта и региона.' },
  openrouter: { title: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash',
                keyUrl: 'https://openrouter.ai/keys', note: 'Выбирай модель с поддержкой tools. Тарифы и обработка данных зависят от провайдера.' },
  openai:     { title: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini',
                keyUrl: 'https://platform.openai.com/api-keys', note: 'Платно, по количеству запросов.' },
  deepseek:   { title: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
                keyUrl: 'https://platform.deepseek.com/api_keys', note: 'Недорого. Картинки не видит.' },
  ollama:     { title: 'На этом компьютере (Ollama)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', noKey: true,
                keyUrl: 'https://ollama.com/download', note: 'Локальная модель без API-ключа. Требования к памяти и скорость зависят от модели; возможен запуск на CPU.' },
  custom:     { title: 'Свой сервер', baseUrl: '', model: '', note: 'Любой OpenAI-совместимый адрес: свой VPS, шлюз, LM Studio.' }
};
const normalizeUrl = value => String(value || '').trim().replace(/\/+$/, '');

class Brain {
  constructor(dir, envPath) {
    this.dir = dir; fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'brain.json');
    this.keyFile = path.join(dir, 'brain.key');
    this.cfg = null; this.key = '';
    this.load();
    if (!this.cfg && envPath) this.importEnv(envPath);
  }
  load() {
    try { this.cfg = JSON.parse(fs.readFileSync(this.file, 'utf-8')); } catch { this.cfg = null; }
    try { if (fs.existsSync(this.keyFile) && safeStorage.isEncryptionAvailable()) this.key = safeStorage.decryptString(fs.readFileSync(this.keyFile)); } catch { this.key = ''; }
  }
  // старый способ: .env рядом с программой — переносим один раз
  importEnv(envPath) {
    try {
      if (!fs.existsSync(envPath)) return;
      const env = {};
      for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0) env[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
      if (!env['base url']) return;
      this.save({ provider: 'custom', baseUrl: env['base url'], model: env['model_text'] || '', imageModel: env['model_pic'] || '' }, env['token'] || '');
      this.imported = true;
    } catch { }
  }
  save(cfg, key) {
    const c = {
      provider: PRESETS[cfg.provider] ? cfg.provider : 'custom',
      baseUrl: normalizeUrl(cfg.baseUrl),
      model: String(cfg.model || '').trim(),
      imageModel: String(cfg.imageModel || this.cfg?.imageModel || '').trim()
    };
    // Пустое поле сохраняет ключ только для того же провайдера И адреса сервера.
    // Иначе смена провайдера могла отправить прежний ключ новому получателю.
    if (key === undefined || key === null || key === '•••') {
      if (!this.cfg || this.cfg.provider !== c.provider || normalizeUrl(this.cfg.baseUrl) !== c.baseUrl) key = '';
    }
    if (key !== undefined && key !== null && key !== '•••') {
      if (key && !safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно — ключ не сохранить');
      if (key) fs.writeFileSync(this.keyFile, safeStorage.encryptString(String(key).trim()));
      else if (fs.existsSync(this.keyFile)) fs.unlinkSync(this.keyFile);
      this.key = String(key || '').trim();
    }
    fs.writeFileSync(this.file, JSON.stringify(c, null, 2), 'utf-8');
    this.cfg = c;
    return c;
  }
  keyFor(provider, baseUrl) {
    return this.cfg && this.cfg.provider === provider && normalizeUrl(this.cfg.baseUrl) === normalizeUrl(baseUrl) ? this.key : '';
  }
  get ready() { return !!(this.cfg && this.cfg.baseUrl && this.cfg.model && (this.key || PRESETS[this.cfg.provider]?.noKey || this.cfg.provider === 'custom')); }
  get title() { return this.cfg ? (PRESETS[this.cfg.provider]?.title || 'Свой сервер') + (this.cfg.model ? ' · ' + this.cfg.model : '') : 'не подключён'; }
  // для окна настроек: ключ не показываем, только факт, что он есть
  publicState() { return { cfg: this.cfg, hasKey: !!this.key, presets: PRESETS, imported: !!this.imported }; }

  headers(key = this.key) {
    const h = { 'Content-Type': 'application/json' };
    if (key) h.Authorization = 'Bearer ' + key;
    if (/openrouter\.ai/.test(this.cfg?.baseUrl || '')) { h['HTTP-Referer'] = 'https://bulya.local'; h['X-Title'] = 'Bulya'; }
    return h;
  }

  // список моделей с сервера (если он это умеет)
  static async listModels(baseUrl, key) {
    const r = await fetch(String(baseUrl).replace(/\/+$/, '') + '/models', { headers: key ? { Authorization: 'Bearer ' + key } : {}, signal: AbortSignal.timeout(15000) });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Сервер ответил ${r.status}: ${txt.slice(0, 200)}`);
    const j = JSON.parse(txt);
    const list = (j.data || j.models || []).map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
    return [...new Set(list)].sort();
  }

  // проверка: отвечает ли и умеет ли вызывать умения
  static async test(baseUrl, key, model) {
    const url = String(baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const h = { 'Content-Type': 'application/json' }; if (key) h.Authorization = 'Bearer ' + key;
    const t0 = Date.now();
    const r = await fetch(url, { method: 'POST', headers: h, signal: AbortSignal.timeout(60000), body: JSON.stringify({
      model, temperature: 0,
      messages: [{ role: 'user', content: 'Это проверка связи. Вызови инструмент ping с параметром word="гав".' }],
      tools: [{ type: 'function', function: { name: 'ping', description: 'Проверка связи', parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } } }]
    }) });
    const txt = await r.text();
    if (!r.ok) {
      let msg = txt.slice(0, 300);
      try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error)) || msg; } catch { }
      return { ok: false, status: r.status, error: String(msg) };
    }
    let j; try { j = JSON.parse(txt); } catch { return { ok: false, error: 'Сервер ответил не в формате OpenAI' }; }
    const m = j.choices && j.choices[0] && j.choices[0].message;
    if (!m) return { ok: false, error: 'Пустой ответ' };
    return { ok: true, tools: !!(m.tool_calls && m.tool_calls.length), ms: Date.now() - t0, model: j.model || model };
  }
}

module.exports = { Brain, PRESETS };
