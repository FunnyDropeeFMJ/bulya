const S = window.settings;
const $ = id => document.getElementById(id);
const providers = $('providers'), baseUrl = $('baseUrl'), key = $('key'), keyHint = $('keyHint'), keyBox = $('keyBox'),
  model = $('model'), models = $('models'), result = $('result');
let state, presets, current;

const show = (cls, text) => { result.className = 'result ' + cls; result.textContent = text; };

function choose(p, keepValues = false) {
  current = p;
  const pr = presets[p];
  if (!keepValues) { baseUrl.value = pr.baseUrl || ''; model.value = pr.model || ''; key.value = ''; }
  keyBox.style.display = pr.noKey ? 'none' : '';
  key.placeholder = state.hasKey && state.cfg && state.cfg.provider === p ? 'Ключ сохранён — оставь пустым, чтобы не менять' : 'Вставь ключ';
  keyHint.innerHTML = '';
  if (pr.keyUrl) {
    const a = document.createElement('a'); a.href = '#'; a.textContent = pr.noKey ? 'Скачать Ollama' : 'Где взять ключ';
    a.onclick = e => { e.preventDefault(); S.openUrl(pr.keyUrl); };
    keyHint.appendChild(a);
  }
  show('', '');
}

function collect() { return { cfg: { provider: current, baseUrl: baseUrl.value.trim(), model: model.value.trim() }, key: key.value.trim() }; }

(async () => {
  state = await S.get(); presets = state.presets;
  for (const [id, p] of Object.entries(presets)) {
    const l = document.createElement('label'); l.className = 'prov';
    l.innerHTML = `<input type="radio" name="p" value="${id}"><b></b><span></span>`;
    l.querySelector('b').textContent = p.title; l.querySelector('span').textContent = p.note;
    l.querySelector('input').onchange = () => choose(id);
    providers.appendChild(l);
  }
  const p = state.cfg ? state.cfg.provider : 'gemini';
  providers.querySelector(`input[value="${p}"]`).checked = true;
  choose(p, false);
  if (state.cfg) { baseUrl.value = state.cfg.baseUrl; model.value = state.cfg.model; }
  if (state.imported) show('ok', 'Перенёс настройки твоего сервера из .env. Можно проверить и сохранить.');
})();

$('loadModels').onclick = async () => {
  const { cfg, key: k } = collect();
  if (!cfg.baseUrl) return show('bad', 'Сначала укажи адрес сервера.');
  show('', 'Спрашиваю у сервера список моделей…');
  const r = await S.models(cfg.baseUrl, k, cfg.provider);
  if (!r.ok) return show('bad', 'Не получилось: ' + r.error);
  models.innerHTML = ''; r.models.forEach(m => { const o = document.createElement('option'); o.value = m; models.appendChild(o); });
  show('ok', `Нашёл моделей: ${r.models.length}. Начни печатать название в поле «Модель» — появятся подсказки.`);
};

$('test').onclick = async () => {
  const { cfg, key: k } = collect();
  if (!cfg.baseUrl || !cfg.model) return show('bad', 'Нужны адрес сервера и модель.');
  $('test').disabled = true; show('', 'Проверяю — Буля нюхает сервер…');
  const r = await S.test(cfg, k);
  $('test').disabled = false;
  if (!r.ok) return show('bad', `Не работает: ${r.error}${r.status === 401 || r.status === 403 ? ' — проверь ключ.' : ''}`);
  if (!r.tools) return show('warn', `Отвечает (${(r.ms / 1000).toFixed(1)} с), но не вызывает инструменты. Разговаривать сможет, а открывать программы и делать документы — нет. Лучше выбрать другую модель.`);
  show('ok', `Работает: отвечает за ${(r.ms / 1000).toFixed(1)} с, умения вызывает. Можно сохранять.`);
};

$('save').onclick = async () => {
  const { cfg, key: k } = collect();
  if (!cfg.baseUrl || !cfg.model) return show('bad', 'Нужны адрес сервера и модель.');
  const r = await S.save(cfg, k);
  if (!r.ok) return show('bad', 'Не сохранилось: ' + r.error);
  window.close();
};
$('offline').onclick = () => window.close();
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
