// Буля — жизнь на экране: дыхание, моргание, взгляд за курсором, сон, реакции, разговор облачками, приём файлов
const B = window.bulya;
const $ = (id) => document.getElementById(id);
const img = $('img'), body = $('body'), tilt = $('tilt'), pet = $('pet');
const stack = $('stack'), dock = $('dock'), input = $('input'), sendBtn = $('sendBtn'), files = $('files');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const life = new BulyaBehavior.Planner();
life.touch(Date.now());
let activityMode = 'normal', sleepPending = false, systemSleeping = false;
let systemState = { idleSeconds: 0, visible: true, at: Date.now() };

const SPR = {};
const sprite = (n) => { if (!SPR[n]) { SPR[n] = `assets/${n}.png`; new Image().src = SPR[n]; } return SPR[n]; };
['idle', 'blink'].forEach(sprite);

// покадровые анимации: [кадр, мс, {y: сдвиг вверх/вниз в px}]
//   loop     — повторять по кругу; loopFrom — с какого кадра повторять (вступление играет один раз)
//   state    — как называть состояние во время анимации (sleep — Буля спит)
const rep = (arr, n) => Array(n).fill(arr).flat();
const ANIMS = {
  // ── новые эмоции ──
  surprised: { frames: [['surprised1', 450], ['surprised2', 1100], ['surprised1', 600]] },
  scared:    { frames: [...rep([['scared1', 140], ['scared2', 160]], 3), ['scared2', 1200], ['scared1', 500]] },
  grumpy:    { frames: [['grumpy1', 1400], ['grumpy2', 1100], ['grumpy1', 900]] },
  bark:      { frames: [...rep([['bark1', 170], ['bark2', 150]], 3), ['bark2', 300]] },
  dizzy:     { frames: rep([['dizzy1', 240], ['dizzy2', 240]], 5) },
  nod:       { frames: [...rep([['nod1', 210], ['nod2', 230]], 2), ['idle', 150]] },
  shake:     { frames: [...rep([['shake1', 190], ['shake2', 190]], 2), ['idle', 150]] },
  proud:     { frames: [['proud1', 900], ['proud2', 1700]] },
  party:     { frames: rep([['party1', 260], ['party2', 260]], 6) },
  sneeze:    { frames: [['sneeze1', 650], ['sneeze2', 450], ['idle', 200]] },
  stretch:   { frames: [['stretch1', 1000], ['stretch2', 1200], ['stand', 300]] },
  treat:     { frames: [['treat1', 700], ...rep([['treat2', 260], ['treat1', 260]], 3), ['love2', 1400]] },
  ball:      { frames: [['ball1', 900], ['ball2', 700], ['jump1', 140], ['jump2', 260, { y: -26 }], ['jump1', 150], ['ball1', 900]] },
  beg:       { frames: rep([['beg1', 380], ['beg2', 380]], 3) },
  roll:      { frames: [['roll1', 350], ['roll2', 450], ['roll1', 350], ['roll2', 700], ['happy', 600]] },
  bored:     { frames: [['lie', 700], ['bored1', 1800], ['bored2', 2200], ['bored1', 1200]] },
  sleep:     { loop: true, loopFrom: 1, state: 'sleep', frames: [['lie', 800], ['sleep1', 1700], ['sleep2', 1700], ['sleep1', 1700], ['sleep2', 1700], ['dream', 3200]] },
  // ходьба: 4 шага из одной сгенерированной сетки (кадры выровнены по голове и линии лап)
  walk:      { loop: true, frames: [['walk1', 130], ['walk2', 130, { y: -2 }], ['walk3', 130], ['walk4', 130, { y: -2 }]] },
  alert:     { frames: [['alert1', 300], ['alert2', 900], ['alert1', 400]] },
  sign:      { frames: [['sign2', 350], ['sign1', 3600]] },
  // ── прежние ──
  wave:    { frames: [['wave1', 110], ['wave2', 170], ['wave3', 170], ['wave2', 170], ['wave3', 170], ['wave2', 170], ['wave3', 170], ['wave2', 150], ['wave1', 110]] },
  talk:    { loop: true, frames: [['talk1', 120], ['talk2', 130], ['talk3', 110], ['talk2', 120], ['talk1', 100], ['idle', 90]] },
  happy:   { frames: [['happy', 350], ['jump1', 140], ['jump2', 260, { y: -26 }], ['jump1', 150], ['happy', 1000]] },
  // хвост: тело неподвижно, двигается только хвостик
  wag:     { frames: [['tail_left', 220], ...rep([['tail_right', 150], ['tail_left', 150]], 6), ['tail_left', 300]] },
  curious: { frames: [['tilt_left', 1100], ['idle', 140], ['tilt_right', 1100]] },
  think:   { loop: true, frames: [['think1', 1300], ['think2', 1300]] },
  search:  { loop: true, frames: [['magnify1', 700], ['magnify2', 700]] },
  work:    { loop: true, frames: [['type1', 170], ['type2', 170]] },
  sad:     { frames: [['sad1', 900], ['sad2', 2600]] },
  guilty:  { frames: [['guilty1', 1200], ['guilty2', 1400], ['guilty1', 1100]] },
  love:    { frames: [['love1', 1200], ['love2', 2200]] },
  laugh:   { frames: [...rep([['laugh1', 220], ['laugh2', 220]], 4), ['laugh1', 500]] },
  scratch: { frames: [['scratch2', 120], ...rep([['scratch1', 95], ['scratch2', 95]], 6), ['scratch2', 300]] },
  yawn:    { frames: [['yawn1', 260], ['yawn2', 1100], ['yawn1', 260]] },
  glance_left:  { frames: [['look_left', 1300]] },
  glance_right: { frames: [['look_right', 1300]] },
  ear_left:  { frames: [['ear_left', 160], ['idle', 110], ['ear_left', 160]] },
  ear_right: { frames: [['ear_right', 160], ['idle', 110], ['ear_right', 160]] }
};
Object.values(ANIMS).forEach(a => a.frames.forEach(([f]) => sprite(f)));

let state = 'idle', stateTimer = null, extraTimer = null, lastActivity = Date.now(), busy = false, animToken = 0;

/* ── позы и анимации ───────────────────────────────── */
let SKIN = {}, curFrame = 'idle', skinToken = 0, facing = 1, signText = '';
const signEl = $('sign');
function show(name, y = 0, r = 0) {
  curFrame = name; img.src = SKIN[name] || sprite(name);
  const t = [];
  if (y) t.push(`translateY(${y}px)`);
  if (r) t.push(`rotate(${r}deg)`);
  if (facing < 0) t.push('scaleX(-1)');
  img.style.transform = t.join(' ');
  // надпись на табличке — только в кадре, где табличка ровная
  signEl.textContent = name === 'sign1' ? signText : '';
}

// окрас: перекрашиваем все кадры один раз и дальше показываем готовые
async function applySkin(pal) {
  const token = ++skinToken;
  if (!pal || !pal.dark) { const old = SKIN; SKIN = {}; Object.values(old).forEach(u => URL.revokeObjectURL(u)); img.src = sprite(curFrame); return; }
  const next = {};
  for (const n of Object.keys(SPR)) {
    if (token !== skinToken) { Object.values(next).forEach(u => URL.revokeObjectURL(u)); return; }
    const data = await B.spriteData(n); if (!data) continue;
    const im = new Image(); im.src = data; await im.decode();
    const c = BulyaSkins.recolor(im, pal);
    next[n] = URL.createObjectURL(await new Promise(res => c.toBlob(res, 'image/png')));
    await new Promise(res => setTimeout(res, 0));
  }
  const old = SKIN; SKIN = next; Object.values(old).forEach(u => URL.revokeObjectURL(u));
  img.src = SKIN[curFrame] || sprite(curFrame);
}
function play(name, then = 'idle', onDone = null) {
  const a = ANIMS[name]; if (!a) return setState(then);
  const token = ++animToken; clearTimeout(stateTimer); clearTimeout(extraTimer);
  if (name !== 'walk') stopStroll();
  state = a.state || 'anim:' + name; body.classList.toggle('sleeping', state === 'sleep');
  let i = 0;
  (function step() {
    if (token !== animToken) return;            // анимацию прервали другим действием
    if (i >= a.frames.length) {
      if (a.loop) i = a.loopFrom || 0;
      else return onDone ? onDone() : setState(busy ? 'think' : then);
    }
    const [f, ms, opt] = a.frames[i++]; show(f, opt && opt.y, opt && opt.r); stateTimer = setTimeout(step, ms);
  })();
}
function setState(s) {
  if (ANIMS[s]) return play(s);
  animToken++; clearTimeout(stateTimer); clearTimeout(extraTimer); stopStroll();
  state = s; show(s);
  body.classList.remove('sleeping');
}
// Один таймер анимации: любое явное действие отменяет оставшиеся шаги.
function runSequence(steps) {
  let i = 0;
  function next() {
    if (i >= steps.length) return setState('idle');
    const step = steps[i++];
    if (ANIMS[step.name]) return play(step.name, 'idle', next);
    setState(step.name);
    const token = animToken;
    stateTimer = setTimeout(() => { if (token === animToken) next(); }, step.hold);
  }
  next();
}
// табличка с короткой надписью (напоминания и т.п.)
function showSign(text, then = 'idle') {
  signText = String(text || '').trim().slice(0, 14);
  play('sign', then);
}

/* ── прогулка: Буля сам проходится по краю экрана ── */
let strollTimer = null;
function stopStroll() {
  if (!strollTimer) return;
  clearInterval(strollTimer); strollTimer = null;
  if (facing < 0) { facing = 1; show(curFrame); }
}
async function stroll(dist = 120 + Math.random() * 220) {
  if (busy || drag) return;
  let dir = Math.random() < 0.5 ? -1 : 1, left = Math.round(dist), turned = false;
  play('walk');
  facing = dir;     // кадры ходьбы смотрят вправо, влево — зеркалим
  let inFlight = false;
  strollTimer = setInterval(async () => {
    if (drag || busy) { stopStroll(); return setState('idle'); }
    if (inFlight) return;
    inFlight = true;
    let moved = 0;
    try { moved = await B.strollStep(3 * dir); } catch { } finally { inFlight = false; }
    if (!strollTimer) return;
    if (moved === 0) {                       // упёрся в край экрана — разворачиваемся один раз
      if (turned) { stopStroll(); B.relayout(); return play('sneeze'); }
      turned = true; dir = -dir; facing = dir; return;
    }
    left -= Math.abs(moved);
    if (left <= 0) { stopStroll(); B.relayout(); play(Math.random() < 0.5 ? 'stretch' : 'wag'); }
  }, 33);
}
// говорит, потом показывает эмоцию ответа
function talkThen(ms, mood) {
  play('talk'); const token = animToken;
  extraTimer = setTimeout(() => { if (token === animToken) setState(mood); }, ms);
}

function wake() {
  lastActivity = Date.now(); life.touch(lastActivity);
  const wasSleeping = sleepPending || state === 'sleep'; sleepPending = false;
  if (wasSleeping) { if (reduced) setState('idle'); else play('wag'); }
}
function goToSleep() {
  sleepPending = true;
  if (reduced) { setState('sleep1'); state = 'sleep'; body.classList.add('sleeping'); }
  else play('yawn', 'sleep');
}

// моргание
(function blink() {
  setTimeout(() => {
    if (!reduced && state === 'idle') { show('blink'); setTimeout(() => state === 'idle' && show('idle'), 140); }
    blink();
  }, 2500 + Math.random() * 3500);
})();

// мелкие «живые» реакции и сон
setInterval(() => {
  const now = Date.now();
  // Если связь с главным процессом прервалась, не делаем вывод, что хозяин ушёл.
  const idleSeconds = now - systemState.at < 6000 ? systemState.idleSeconds : 0;
  const action = life.next({ now, idleSeconds, mode: activityMode,
    open: document.body.classList.contains('open'), busy, dragging: !!drag,
    visible: systemState.visible, suspended: systemSleeping, reducedMotion: reduced,
    sleeping: state === 'sleep' || sleepPending, ready: state === 'idle' });
  if (!action) return;
  if (action.kind === 'wake') wake();
  else if (action.kind === 'sleep') goToSleep();
  else if (action.kind === 'walk') stroll(action.distance);
  else runSequence(action.steps);
}, 1000);

// взгляд за курсором (позиция приходит из главного процесса)
let lastCursor = null;
B.onCursor(p => {
  const r = pet.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  if (!systemSleeping && lastCursor && (Math.abs(p.x - lastCursor.x) + Math.abs(p.y - lastCursor.y)) > 3 && Math.hypot(p.x - cx, p.y - cy) < 300) wake();
  lastCursor = p;
  const dx = Math.max(-1, Math.min(1, (p.x - cx) / 700));
  tilt.style.transform = reduced || state === 'sleep' ? 'none' : `rotate(${(dx * 7).toFixed(2)}deg)`;
});

/* ── «живые зоны»: окно ловит мышь только над Булей, облачками и полем ввода ── */
let dragFiles = false;
function hotZones() {
  const rects = [];
  const add = (el, m = 4) => { const r = el.getBoundingClientRect(); if (r.width && r.height) rects.push({ x: r.left - m, y: r.top - m, w: r.width + 2 * m, h: r.height + 2 * m }); };
  add(pet, dragFiles ? 40 : 6);
  // только сами облачка и поле ввода — пустое место вокруг пропускает клики на рабочий стол
  const open = document.body.classList.contains('open');
  const s = stack.getBoundingClientRect();
  stack.querySelectorAll(open ? '.item' : '.item.fresh').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.bottom > s.top + 20 && r.top < s.bottom) add(el, 4);
  });
  if (open) add(dock, 6);
  return rects;
}
let zonesQueued = false;
function updateZones() {
  if (zonesQueued) return; zonesQueued = true;
  requestAnimationFrame(() => { zonesQueued = false; B.setHotZones(hotZones()); });
}
new MutationObserver(updateZones).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', updateZones);
setInterval(updateZones, 1000);

/* ── перетаскивание Були и клик ─────────────────── */
let drag = null;
pet.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  wake(); if (!busy) setState('idle');
  stopStroll();
  drag = { x: e.screenX, y: e.screenY, moved: 0 };
  B.setDragging(true);             // пока тащим — окно не становится «прозрачным» для мыши
});
function endDrag(asClick) {
  if (!drag) return;
  const moved = drag.moved; drag = null; pet.classList.remove('dragging');
  B.setDragging(false);
  if (asClick && moved <= 4) { wake(); toggleOpen(); }
  else if (moved > 2500) { wake(); play('dizzy'); }          // долго таскали — голова кружится
  else if (moved > 4 && state.startsWith('anim:') === false) play('wag');
}
window.addEventListener('mousemove', e => {
  if (!drag) return;
  if (e.buttons === 0) return endDrag(false);   // кнопку отпустили вне окна — «mouseup» потерялся
  const dx = e.screenX - drag.x, dy = e.screenY - drag.y;
  if (dx || dy) { drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.screenX; drag.y = e.screenY;
    if (drag.moved > 4) { pet.classList.add('dragging'); B.moveBy(dx, dy); } }
});
window.addEventListener('mouseup', () => endDrag(true));
window.addEventListener('blur', () => endDrag(false));
// ПКМ — то же меню, что и в трее.
pet.addEventListener('contextmenu', e => { e.preventDefault(); wake(); B.petMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('open')) setOpen(false); });

/* ── облачки ─────────────────────────────────────── */
const PAW = '<svg class="paw" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><ellipse cx="12" cy="16.2" rx="5.2" ry="4.4"/><ellipse cx="5.6" cy="10.4" rx="2.1" ry="2.7"/><ellipse cx="9.4" cy="6.4" rx="2.1" ry="2.8"/><ellipse cx="14.6" cy="6.4" rx="2.1" ry="2.8"/><ellipse cx="18.4" cy="10.4" rx="2.1" ry="2.7"/></g></svg>';
const pick = a => a[Math.floor(Math.random() * a.length)];

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function format(text) {
  return esc(text)
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s<)\]]+)/g, '<a data-href="$1">$1</a>');
}
/* ── раскладка: Буля внизу экрана — разговор над ним (новые облачка снизу, ближе к Буле);
   Буля вверху — разговор под ним (новые облачка сверху). Буля слева — облачка справа. ── */
let LAYOUT = { h: 'right', v: 'bottom' };
const petTop = () => LAYOUT.v === 'top';
function applyLayout(l) {
  if (l.prep) document.body.classList.add('relayout');     // спрятать на миг, пока окно переставляют
  const flipV = (l.v === 'top') !== petTop();
  LAYOUT = { h: l.h === 'left' ? 'left' : 'right', v: l.v === 'top' ? 'top' : 'bottom' };
  document.body.classList.toggle('pl', LAYOUT.h === 'left');
  document.body.classList.toggle('pt', LAYOUT.v === 'top');
  if (flipV) [...stack.children].reverse().forEach(el => stack.appendChild(el));   // новые — всегда ближе к Буле
  scrollDown(); updateZones();
  if (l.prep) requestAnimationFrame(() => requestAnimationFrame(() => B.layoutDone()));
}
function trim() { while (stack.children.length > 40) (petTop() ? stack.lastElementChild : stack.firstElementChild).remove(); }
function scrollDown() { stack.scrollTop = petTop() ? 0 : stack.scrollHeight; }

// свежие облачка видны и при закрытом чате, потом тают
function freshen(el, ms) {
  el.classList.add('fresh'); el.classList.remove('gone');
  clearTimeout(el._t);
  if (ms) el._t = setTimeout(() => { el.classList.add('gone'); setTimeout(() => { el.classList.remove('fresh', 'gone'); updateZones(); }, 380); }, ms);
}
function addItem(cls, html) {
  const el = document.createElement('div'); el.className = 'item ' + cls; el.innerHTML = html;
  if (petTop()) stack.prepend(el); else stack.appendChild(el);
  trim(); scrollDown(); return el;
}
const ttlFor = text => Math.max(8000, Math.min(25000, String(text).length * 70));

function dogSay(text, { chips = [], ttl, typewriter = true } = {}) {
  const el = addItem('say', '');
  const finish = () => {
    el.innerHTML = format(text);
    if (chips.length) {
      const row = document.createElement('div'); row.className = 'chips';
      chips.forEach(c => { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = c.label; b.onclick = () => c.onClick(b); row.appendChild(b); });
      el.appendChild(row);
    }
    scrollDown(); updateZones();
  };
  if (!typewriter || reduced) finish();
  else {
    let i = 0; const step = Math.max(2, Math.round(text.length / 120));
    const iv = setInterval(() => { i += step; el.textContent = text.slice(0, i); scrollDown(); if (i >= text.length) { clearInterval(iv); finish(); } }, 16);
  }
  freshen(el, ttl ?? ttlFor(text));
  return el;
}
function meSay(text, files = []) {
  const parts = [text, ...files.map(f => '📎 ' + f.name)].filter(Boolean).join('\n');
  return addItem('me', esc(parts));
}
function trail(label) {
  const el = addItem('trail active', `${PAW}<span class="lbl">${esc(label)}…</span><span class="res"></span>`);
  freshen(el);
  return {
    done(ok, res) {
      el.classList.remove('active'); el.classList.add(ok ? 'ok' : 'fail');
      el.querySelector('.lbl').textContent = label;
      el.querySelector('.res').textContent = res || (ok ? '✓' : 'не вышло');
      freshen(el, 6000);
    }
  };
}
function note(text, ms = 7000) { const el = addItem('trail', `${PAW}<span class="lbl">${esc(text)}</span>`); freshen(el, ms); return el; }

let typingEl = null;
function typing(on) {
  if (on && !typingEl) { typingEl = addItem('say', '<span class="dots"><i></i><i></i><i></i></span>'); freshen(typingEl); }
  if (!on && typingEl) { typingEl.remove(); typingEl = null; }
}
stack.addEventListener('scroll', updateZones, { passive: true });
stack.addEventListener('click', e => { const a = e.target.closest('a[data-href]'); if (a) B.openLink(a.dataset.href); });

/* ── открыт / закрыт ─────────────────────────────── */
let greeted = false;
// чат сам сворачивается, если 10 секунд им не пользуются (текст в поле и прикреплённые файлы не теряются)
const AUTO_CLOSE_MS = 10000;
let lastUse = Date.now();
const touchUse = () => { lastUse = Date.now(); };
const isOpen = () => document.body.classList.contains('open');
function setOpen(on) {
  document.body.classList.toggle('open', on); document.body.classList.toggle('closed', !on);
  touchUse();
  if (!on) input.blur();
  if (on) B.relayout();          // вдруг Булю перетащили к краю — разговор откроется туда, где есть место
  if (on) {
    input.focus(); scrollDown();
    if (!greeted) {
      greeted = true;
      dogSay('Гав! Я тут. Могу включить YouTube, открыть программу, найти файл, написать документ — или брось мне файл, разберусь 🐾', { ttl: 12000 });
      play('wave');
    } else play('wag');
  }
  updateZones();
}
const toggleOpen = () => setOpen(!isOpen());

// что считается «пользуется»: печатает, наводит мышь на чат, листает, жмёт кнопки, ждёт ответа
['input', 'keydown', 'focus'].forEach(ev => input.addEventListener(ev, touchUse));
[dock, stack].forEach(el => ['mousemove', 'mousedown', 'wheel'].forEach(ev => el.addEventListener(ev, touchUse, { passive: true })));
stack.addEventListener('scroll', touchUse, { passive: true });
const inside = (el, p, m = 6) => { const r = el.getBoundingClientRect(); return r.width && p.x >= r.left - m && p.x <= r.right + m && p.y >= r.top - m && p.y <= r.bottom + m; };
B.onCursor(p => {
  if (!isOpen()) return;
  if (inside(dock, p) || inside(pet, p) || [...stack.querySelectorAll('.item')].some(el => inside(el, p, 2))) touchUse();
});
setInterval(() => {
  if (!isOpen() || busy || drag || dragFiles) { if (busy) touchUse(); return; }
  if (Date.now() - lastUse > AUTO_CLOSE_MS) setOpen(false);
}, 1000);

/* ── файлы: брось на Булю ────────────────────────── */
let attached = [];
const KIND = n => /\.(png|jpe?g|webp|gif|bmp)$/i.test(n) ? 'image' : /\.pdf$/i.test(n) ? 'pdf' : /\.(docx|txt|md|rtf)$/i.test(n) ? 'text'
  : /\.(xlsx?|csv)$/i.test(n) ? 'table' : /\.(js|ts|py|json|html?|css|java|cs|cpp|c|go|rs|php|sql|xml|ya?ml|ini|log)$/i.test(n) ? 'code' : 'other';
const SUGGEST = {
  image: ['Что на фото?', 'Опиши подробно', 'Переведи текст с картинки'],
  pdf: ['Перескажи коротко', 'Что тут важного?', 'Сделай из этого Word'],
  text: ['Перескажи коротко', 'Исправь ошибки', 'Переведи на английский'],
  table: ['Что в таблице?', 'Посчитай итоги', 'Найди странное'],
  code: ['Что делает этот код?', 'Найди ошибки', 'Объясни попроще'],
  other: ['Что это за файл?']
};
function renderFiles() {
  files.innerHTML = '';
  attached.forEach((f, i) => {
    const d = document.createElement('div'); d.className = 'file';
    d.innerHTML = `<span>📎 ${esc(f.name)}</span><button type="button" title="Убрать" aria-label="Убрать ${esc(f.name)}">✕</button>`;
    d.querySelector('button').onclick = () => { attached.splice(i, 1); renderFiles(); };
    files.appendChild(d);
  });
  updateZones();
}
function hasFiles(e) { return [...(e.dataTransfer?.types || [])].includes('Files'); }
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); if (dragDepth++ === 0) { dragFiles = true; document.body.classList.add('dragover'); wake(); play('curious'); updateZones(); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; dragFiles = false; document.body.classList.remove('dragover'); updateZones(); } });
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; dragFiles = false; document.body.classList.remove('dragover');
  const list = [...(e.dataTransfer?.files || [])].slice(0, 5).map(f => ({ name: f.name, path: B.pathForFile(f) })).filter(f => f.path);
  if (!list.length) return;
  attached = [...attached, ...list].slice(0, 5); renderFiles();
  setOpen(true); play('happy');
  const kind = KIND(list[0].name);
  dogSay(list.length > 1 ? `Принёс ${list.length} файла! Что с ними сделать?` : `Принёс «${list[0].name}»! Что с ним сделать?`, {
    typewriter: false,
    chips: (SUGGEST[kind] || SUGGEST.other).map(label => ({ label, onClick: () => submit(label) }))
  });
});

/* ── отправка ───────────────────────────────────── */
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dock.requestSubmit(); } });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
dock.addEventListener('submit', e => { e.preventDefault(); submit(input.value.trim()); });

let currentTrail = null;
async function submit(text) {
  if (busy) return;
  const filesNow = attached.slice();
  if (!text && !filesNow.length) return;
  input.value = ''; input.style.height = 'auto';
  attached = []; renderFiles();
  meSay(text, filesNow); wake();
  busy = true; sendBtn.disabled = true; typing(true); play('think'); touchUse();
  let res;
  try { res = await B.send(text, filesNow.map(f => f.path)); }
  catch (e) { res = { mood: 'guilty', text: 'Ой, у меня что-то сломалось внутри: ' + (e && e.message || e) }; }
  finally { busy = false; sendBtn.disabled = false; typing(false); touchUse(); }
  if (!res || typeof res.text !== 'string') res = { mood: 'guilty', text: 'Гав? Я не понял, что произошло.' };
  dogSay(res.text, { chips: (res.actions || []).map(a => ({ label: a.label, onClick: () => a.settings && B.openSettings() })) });
  let mood = res.mood;
  if (/спасиб|благодар|молодец|умниц|хорош(ий|о)|люблю|лучш/i.test(text) && ['talk', 'happy'].includes(mood)) mood = Math.random() < 0.4 ? 'roll' : 'love';
  talkThen(Math.max(1200, Math.min(5000, res.text.length * 35)), MOODS[mood] || 'idle');
  if (systemSleeping) goToSleep();
}

/* ── события из «мозга» и от компьютера ──────────── */
// тег настроения из ответа нейросети -> анимация
const MOODS = { happy: 'happy', curious: 'curious', guilty: 'guilty', sad: 'sad', love: 'love', laugh: 'laugh', roll: 'roll',
  surprised: 'surprised', scared: 'scared', proud: 'proud', party: 'party', grumpy: 'grumpy', dizzy: 'dizzy', nod: 'nod', shake: 'shake' };
B.onChatEvent(ev => {
  if (ev.type === 'system-state') {
    if (systemState.visible && ev.visible === false && !busy) { sleepPending = false; setState('idle'); }
    systemState = { idleSeconds: Number.isFinite(ev.idleSeconds) ? ev.idleSeconds : 0, visible: ev.visible !== false, at: Date.now() };
  }
  else if (ev.type === 'behavior') {
    activityMode = Object.hasOwn(BulyaBehavior.MODES, ev.mode) ? ev.mode : 'normal';
    life.touch(Date.now());
  }
  else if (ev.type === 'open-chat') {
    wake(); setOpen(true);
    if (typeof ev.draft === 'string') {
      if (!input.value.trim()) input.value = ev.draft;
      else note('В поле уже есть текст — я его сохранил. Для напоминания начни с «Напомни через…».', 12000);
      input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  else if (ev.type === 'help') {
    wake(); setOpen(true);
    dogSay('Попробуй:\n• «Открой Телеграм»\n• «Напомни через 10 минут размяться»\n• «Создай список покупок в Word»\n• «Найди файл по названию»\nИли перетащи на меня документ. Для сложных просьб нужна нейросеть. Игры, эмоции и настройки — в меню по правой кнопке.', { ttl: 30000, typewriter: false });
  }
  else if (ev.type === 'wake') { systemSleeping = false; systemState.idleSeconds = 0; systemState.at = Date.now(); wake(); }
  else if (ev.type === 'thinking') play('think');
  else if (ev.type === 'tool') { typing(false); currentTrail = trail(ev.label || 'Работаю'); play(ANIMS[ev.anim] ? ev.anim : 'work'); }
  else if (ev.type === 'tool_done') {
    if (currentTrail) { currentTrail.done(ev.ok); currentTrail = null; }
    if (ev.ok && ev.doneAnim && ANIMS[ev.doneAnim]) play(ev.doneAnim); else if (!ev.ok) play('sad');
    if (busy) typing(true);
  }
  else if (ev.type === 'privacy') note(`🔒 Спрятал от сервера: ${ev.labels.join(', ')}`);
  else if (ev.type === 'attach') note(ev.text, 9000);
  else if (ev.type === 'diary') note(`Записал в дневник: ${ev.count}`, 5000);
  else if (ev.type === 'reset') { stack.innerHTML = ''; note('Разговор забыт', 3000); }
  else if (ev.type === 'reminder') { wake(); showSign('Напоминаю!', 'alert'); dogSay('⏰ ' + ev.text, { ttl: 30000 }); }
  else if (ev.type === 'stroll') { wake(); stroll(); }
  else if (ev.type === 'layout') applyLayout(ev);
  else if (ev.type === 'layout-shown') requestAnimationFrame(() => document.body.classList.remove('relayout'));
  else if (ev.type === 'proactive' || ev.type === 'notice') {
    if (busy) return;
    lastActivity = Date.now();
    const chips = (ev.actions || []).map(a => ({ label: a.label, onClick: (b) => { if (a.settings) return B.openSettings(); b.disabled = true; if (a.ask) { setOpen(true); submit(a.ask); } else B.noticeAction(a.id); } }));
    const go = () => {
      if (ev.anim && ANIMS[ev.anim]) play(ev.anim);
      else talkThen(Math.max(1200, Math.min(4000, ev.text.length * 35)), MOODS[ev.mood] || 'idle');
    };
    if (state === 'sleep' && ev.anim !== 'yawn') { play('wag'); setTimeout(go, 2300); } else go();
    dogSay(ev.text, { chips, ttl: ev.ttl || 14000 });
  }
  else if (ev.type === 'skin') {
    const pal = ev.key === 'custom' ? { dark: ev.dark, light: ev.light } : BulyaSkins.PRESETS[ev.key];
    applySkin(pal).then(() => { if (ev.announce) { wake(); play('happy'); dogSay(pick(['Новый окрас! Как я тебе? 🐾', 'Переоделся! Гав!', 'Ну как, красавчик?']), { ttl: 6000, typewriter: false }); } });
  }
  else if (ev.type === 'panting') { body.classList.toggle('panting', !!ev.on); }
  else if (ev.type === 'sleep') { systemSleeping = true; if (!busy) goToSleep(); }
  else if (ev.type === 'play') {
    wake();
    if (ev.interaction) life.interact(Date.now());
    if (ev.name === 'sign') showSign(ev.text || 'Гав!'); else play(ev.name);
    if (ANIMS[ev.name] && ANIMS[ev.name].loop && ev.name !== 'sleep') { const tok = animToken; extraTimer = setTimeout(() => { if (tok === animToken) setState('idle'); }, 4000); }
  }
});

/* ── интернет и батарея (видно прямо из окна) ────── */
let wasOffline = false;
window.addEventListener('offline', () => { wasOffline = true; wake(); play('scared'); dogSay('Интернет пропал… Без него я только тявкать могу.', { ttl: 12000 }); });
window.addEventListener('online', () => { if (!wasOffline) return; wasOffline = false; play('happy'); dogSay('Интернет вернулся! Гав!', { ttl: 6000 }); });
if (navigator.getBattery) navigator.getBattery().then(bat => {
  let warned = false;
  const check = () => {
    if (bat.charging) { warned = false; return; }
    if (bat.level <= 0.15 && !warned) { warned = true; wake(); play('sad'); dogSay(`Ноутбук голодный — ${Math.round(bat.level * 100)}%. Покорми его зарядкой!`, { ttl: 15000 }); }
  };
  bat.addEventListener('levelchange', check); bat.addEventListener('chargingchange', check); check();
}).catch(() => { });

play('wave');
dogSay('Гав! Я тут. Кликни по мне, если нужна помощь 🐾', { ttl: 6000, typewriter: false });
