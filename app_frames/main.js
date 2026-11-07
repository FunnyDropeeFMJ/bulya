// Буля — главный процесс: окно поверх всех, трей, связь с моделью и инструментами
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog, powerMonitor } = require('electron');
const path = require('path');
const { Chat } = require('./llm');
const { Memory } = require('./memory');
const { Secrets } = require('./privacy');
const { Watchers } = require('./events');
const { Brain } = require('./brain');
const { MODES } = require('./behavior');
const { buildMenu } = require('./menus');
const { bulyaDir } = require('./skills/_util');

const W = 460, H = 640;
let win, tray, chat, memory, secrets, watchers, brain, settingsWin;
let hotZones = [], through = true;
let rebuildTray = () => {}, skinWin;
let lastProactiveAt = 0;
const send = (ev) => { if (win && !win.isDestroyed()) win.webContents.send('chat-event', ev); };

// прозрачное окно без серых прямоугольников: на части видеокарт Windows GPU-композитинг рисует полупрозрачные слои серой подложкой
app.disableHardwareAcceleration();
app.setAppUserModelId('Bulya.Helper');          // чтобы уведомления Windows подписывались «Буля», а не «electron»
// Сохраняем каталог памяти ранних версий при смене отображаемого имени приложения.
app.setPath('userData', path.join(app.getPath('appData'), 'bulya-helper-frames'));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
// второй запуск — просто показываем уже работающего Булю
app.on('second-instance', () => { if (win && !win.isDestroyed()) { win.show(); send({ type: 'play', name: 'wave' }); } });
let dragging = false;

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: W, height: H,
    x: wa.x + wa.width - W - 10, y: wa.y + wa.height - H,
    frame: false, transparent: true, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', () => {
    const s = memory && memory.d.настройки.окрас; if (s && s.key !== 'classic') send({ type: 'skin', ...s });
    send({ type: 'layout', h: layout.h, v: layout.v });
    send({ type: 'behavior', mode: activityMode() });
  });

  // ссылки из чата открываем в обычном браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());

  // глобальная позиция курсора: Буля следит за мышкой, а окно «ловит» мышь только над Булей,
  // облачками и полем ввода. Работает и когда хозяин тащит файл из Проводника.
  let tick = 0;
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint(), b = win.getBounds();
    const x = p.x - b.x, y = p.y - b.y;
    const hit = dragging || hotZones.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (hit === through) { through = !hit; win.setIgnoreMouseEvents(through, { forward: true }); }
    if (++tick % 3 === 0) win.webContents.send('cursor', { x, y });
  }, 40);

  // память и сейф — в служебной папке приложения (%AppData%), а не в Документах:
  // так умения Були (чтение файлов) до них не дотянутся
  memory = new Memory(path.join(app.getPath('userData'), 'memory'));
  restorePetPos();
  if (memory.loadError) setTimeout(() => send({ type: 'notice', anim: 'scared', ttl: 30000,
    text: 'Гав! Файл моей памяти был повреждён — я начал с чистого листа, а старый файл сохранил рядом (' + memory.loadError + '). Его можно открыть и поправить.' }), 4000);
  if (memory.vaultBroken) setTimeout(() => send({ type: 'notice', anim: 'scared', ttl: 30000,
    text: 'Сейф не открылся (возможно, сменилась учётная запись Windows). Я сохранил копию старого сейфа рядом и ничего в нём не стёр.' }), 9000);
  secrets = new Secrets(memory);
  // «мозг»: какая нейросеть и с каким ключом. Старый .env рядом с программой переносится один раз.
  brain = new Brain(path.join(app.getPath('userData'), 'brain'), path.join(__dirname, '..', '.env'));
  chat = new Chat({ brain, win, memory, secrets, onEvent: send });
  if (!brain.ready) setTimeout(() => {
    send({ type: 'notice', text: 'Гав! Я пока без мозга — подключи мне нейросеть, и я стану умнее. А простые команды («открой Телеграм», «пауза») понимаю и так.', anim: 'curious', actions: [{ label: 'Подключить нейросеть', settings: true }], ttl: 30000 });
    openSettings();
  }, 2500);

  // реакции на события компьютера и режим дня
  watchers = new Watchers({ send, memory, chat, win });
  watchers.start();
  // Только время бездействия Windows, без чтения текста клавиатуры или экрана.
  const systemState = () => {
    if (win && !win.isDestroyed()) send({ type: 'system-state', idleSeconds: powerMonitor.getSystemIdleTime(), visible: win.isVisible() });
  };
  systemState();
  const activityTimer = setInterval(systemState, 2000);
  win.once('closed', () => clearInterval(activityTimer));

  // дневник: через 4 минуты тишины после разговора Буля записывает интересное в память
  setInterval(async () => {
    if (chat.turnsSinceDiary >= 3 && Date.now() - chat.lastUserAt > 4 * 60000 && !chat.busy) {
      const saved = await chat.diary();
      if (saved && saved.length) send({ type: 'diary', count: saved.length });
    }
  }, 60000);

  // приветствие после разлуки
  setTimeout(async () => {
    const gap = memory.absenceHours();
    if (gap == null || gap > 8) {
      const r = await chat.proactive('greeting');
      if (r) { lastProactiveAt = Date.now(); send({ type: 'proactive', ...r }); }
    }
  }, 6000);

  // редкие реплики «сам по себе»: хозяин за компьютером, давно не писал, не чаще раза в 45 минут и 6 раз в день
  setInterval(async () => {
    try {
      if (!memory.chatty || chat.busy || !win.isVisible()) return;
      if (powerMonitor.getSystemIdleTime() > 120) return;                 // хозяин отошёл
      if (Date.now() - lastProactiveAt < 45 * 60000) return;
      if (Date.now() - chat.lastUserAt < 15 * 60000) return;
      if (!memory.proactiveAllowed(6) || Math.random() > 0.5) return;
      const r = await chat.proactive('idle');
      if (r) { lastProactiveAt = Date.now(); memory.proactiveDone(); send({ type: 'proactive', ...r }); }
    } catch { }
  }, 10 * 60000);
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 600, height: 860, minWidth: 460, minHeight: 600, title: 'Мозг Були', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'assets', 'idle.png'),
    webPreferences: { preload: path.join(__dirname, 'settings_preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.webContents.on('will-navigate', e => e.preventDefault());
}
// Сохранённый ключ используется только для того же провайдера и адреса.
const keyFor = (provider, baseUrl, key) => key || brain.keyFor(provider, baseUrl);
ipcMain.handle('brain:get', () => brain.publicState());
ipcMain.handle('brain:models', async (_e, baseUrl, key, provider) => {
  try { return { ok: true, models: await Brain.listModels(baseUrl, keyFor(provider, baseUrl, key)) }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('brain:test', async (_e, cfg, key) => {
  try { return await Brain.test(cfg.baseUrl, keyFor(cfg.provider, cfg.baseUrl, key), cfg.model); } catch (e) { return { ok: false, error: e.name === 'TimeoutError' ? 'сервер долго не отвечает' : e.message }; }
});
ipcMain.handle('brain:save', async (_e, cfg, key) => {
  try {
    brain.save(cfg, key ? key : undefined);
    send({ type: 'notice', text: brain.ready ? `Подключил мозг: ${brain.title} 🧠 Гав!` : 'Сохранил, но для работы не хватает ключа или модели.', anim: brain.ready ? 'happy' : 'sad', ttl: 9000 });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.on('open-settings', () => openSettings());

// ── окрас ─────────────────────────────────────────
const SKINS = [['classic', 'Классика (как Буля)'], ['fawn', 'Палевый'], ['blue', 'Голубой'], ['cream', 'Кремовый'], ['chocolate', 'Шоколадный'], ['space', 'Космос']];
const currentSkin = () => memory.d.настройки.окрас || { key: 'classic' };
function setSkin(s) {
  memory.d.настройки.окрас = s; memory.save();
  send({ type: 'skin', ...s, announce: true });
  rebuildTray();
}
function skinMenu() {
  const cur = currentSkin().key;
  return { label: 'Окрас', submenu: [
    ...SKINS.map(([key, title]) => ({ label: title, type: 'radio', checked: cur === key, click: () => setSkin({ key }) })),
    { type: 'separator' },
    { label: cur === 'custom' ? 'Свой цвет (выбран)…' : 'Свой цвет…', click: openSkinPicker }
  ] };
}
function openSkinPicker() {
  if (skinWin && !skinWin.isDestroyed()) { skinWin.focus(); return; }
  skinWin = new BrowserWindow({ width: 440, height: 560, resizable: false, title: 'Окрас Були', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'assets', 'idle.png'),
    webPreferences: { preload: path.join(__dirname, 'skin_preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  skinWin.setMenu(null); skinWin.loadFile(path.join(__dirname, 'skin.html'));
  skinWin.once('ready-to-show', () => skinWin.show());
  skinWin.webContents.on('will-navigate', e => e.preventDefault());
}
const HEX = /^#[0-9a-f]{6}$/i;
ipcMain.handle('skin:get', () => currentSkin());
ipcMain.handle('skin:save', (_e, s) => {
  if (s && s.key === 'custom' && HEX.test(s.dark) && HEX.test(s.light)) setSkin({ key: 'custom', dark: s.dark, light: s.light });
  else if (s && SKINS.some(([k]) => k === s.key)) setSkin({ key: s.key });
  return true;
});
// картинки кадров — данными, чтобы окно могло их перекрашивать
ipcMain.handle('sprite', (_e, name) => {
  if (!/^[a-z0-9_]{1,30}$/.test(String(name))) return null;
  try { return 'data:image/png;base64,' + require('fs').readFileSync(path.join(__dirname, 'assets', name + '.png')).toString('base64'); } catch { return null; }
});

function memoryMenu() {
  return { label: 'Память', submenu: [
    { label: 'Открыть, что Буля помнит (можно править)', click: () => shell.openPath(memory.file) },
    { label: 'Забыть разговор', click: () => { chat.reset(); send({ type: 'reset' }); } },
    { type: 'separator' },
    { label: 'Забыть всё о хозяине…', click: async () => {
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Забыть всё', 'Отмена'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'Буля', message: 'Стереть всю память Були?', detail: 'Профиль, моменты и табу будут удалены. Сейф останется.' });
      if (r.response === 0) { memory.wipe(); chat.reset(); send({ type: 'reset' }); }
    } }
  ] };
}

function activityMode() {
  const mode = memory && memory.d.настройки.активность;
  return Object.hasOwn(MODES, mode) ? mode : 'normal';
}
function openChat(draft) {
  win.show(); win.focus(); send({ type: 'open-chat', draft });
}
function petMenuTemplate() {
  return buildMenu({ mode: activityMode(), visible: win.isVisible(), chatty: memory.chatty,
    events: memory.d.настройки.события !== false, stretch: memory.d.настройки.размяться !== false }, {
    openChat, settings: openSettings, skinMenu, memoryMenu, resetPosition,
    play: (name, interaction) => { win.show(); send({ type: 'play', name, interaction }); },
    stroll: () => { win.show(); send({ type: 'stroll' }); },
    help: () => { openChat(); send({ type: 'help' }); },
    documents: () => shell.openPath(bulyaDir()),
    setMode: mode => {
      if (!Object.hasOwn(MODES, mode)) return;
      memory.d.настройки.активность = mode; memory.save(); send({ type: 'behavior', mode }); rebuildTray();
    },
    setFlag: (key, value) => {
      if (key === 'chatty') memory.chatty = value;
      else {
        const setting = { events: 'события', stretch: 'размяться' }[key];
        if (!setting) return;
        memory.d.настройки[setting] = value; memory.save();
      }
      rebuildTray();
    },
    toggleVisible: () => { if (win.isVisible()) win.hide(); else win.show(); },
    quit: () => app.quit()
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'idle.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Буля');
  rebuildTray = () => tray.setContextMenu(Menu.buildFromTemplate(petMenuTemplate()));
  win.on('show', rebuildTray); win.on('hide', rebuildTray);
  rebuildTray();
  tray.on('click', () => win.isVisible() ? win.hide() : win.show());
}

function resetPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  applyLayout({ h: 'right', v: 'bottom' }, { x: wa.x + wa.width - 18 - PET, y: wa.y + wa.height - 4 - PET });
  savePetPos();
}

/* ── раскладка: где в окне сидит Буля, а где облачка и поле ввода ──
   Буля у нижнего края экрана — разговор над ним; у верхнего — под ним.
   У правого края — облачка слева от него; у левого — справа. Сам Буля при этом не сдвигается ни на пиксель. */
const PET = 170;
let layout = { h: 'right', v: 'bottom' }, layoutTimer = null, pendingPos = null;
const petOff = (l = layout) => ({ x: l.h === 'right' ? W - 8 - PET : 8, y: l.v === 'bottom' ? H - 4 - PET : 4 });
function petRect() { const [x, y] = win.getPosition(), o = petOff(); return { x: x + o.x, y: y + o.y, w: PET, h: PET }; }
const waAt = (r) => screen.getDisplayNearestPoint({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) }).workArea;
function wantedLayout(r = petRect()) {
  const wa = waAt(r), NEED = 300;   // примерно столько места нужно разговору
  const left = r.x - wa.x, right = wa.x + wa.width - (r.x + r.w), up = r.y - wa.y, down = wa.y + wa.height - (r.y + r.h);
  // небольшая «липкость»: не переключаемся туда-сюда у самой границы
  const h = layout.h === 'right' ? (left >= NEED - 40 || left >= right ? 'right' : 'left') : (right >= NEED - 40 || right >= left ? 'left' : 'right');
  const v = layout.v === 'bottom' ? (up >= NEED - 40 || up >= down ? 'bottom' : 'top') : (down >= NEED - 40 || down >= up ? 'top' : 'bottom');
  return { h, v };
}
// переставить окно так, чтобы Буля (petScreen) остался на месте, и сообщить окну новую раскладку.
// ВАЖНО: win.setOpacity() у прозрачного окна на Windows «замораживает» картинку — не используем.
// Вместо этого окно на миг прячет своё содержимое, перестраивается, и только потом мы его двигаем.
function applyLayout(l, petScreen = petRect()) {
  const changed = l.h !== layout.h || l.v !== layout.v;
  layout = l;
  const o = petOff();
  const pos = [Math.round(petScreen.x - o.x), Math.round(petScreen.y - o.y)];
  clearTimeout(layoutTimer);
  if (!changed) { win.setPosition(...pos); send({ type: 'layout', h: l.h, v: l.v }); return; }
  pendingPos = pos;
  send({ type: 'layout', h: l.h, v: l.v, prep: true });
  layoutTimer = setTimeout(finishLayout, 400);      // на случай, если окно не ответило
}
function finishLayout() {
  clearTimeout(layoutTimer);
  if (!pendingPos || !win || win.isDestroyed()) return;
  win.setPosition(...pendingPos); pendingPos = null;
  send({ type: 'layout-shown' });
}
function relayout() {
  if (!win || win.isDestroyed() || dragging) return;
  const l = wantedLayout();
  if (l.h !== layout.h || l.v !== layout.v) applyLayout(l);
}
function savePetPos() {
  if (!memory || !win) return;
  const r = petRect(); memory.d.настройки.позиция = { x: r.x, y: r.y }; memory.save();
}
// после перезапуска Буля сидит там, где его оставили (если тот монитор ещё подключён)
function restorePetPos() {
  const p = memory && memory.d.настройки.позиция;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  const r = { x: p.x, y: p.y, w: PET, h: PET };
  const wa = waAt(r);
  if (r.x + r.w < wa.x + 40 || r.x > wa.x + wa.width - 40 || r.y + r.h < wa.y + 40 || r.y > wa.y + wa.height - 40) return;
  layout = { h: 'right', v: 'bottom' };
  const l = wantedLayout(r); layout = l;
  const o = petOff();
  win.setPosition(Math.round(r.x - o.x), Math.round(r.y - o.y));
}
ipcMain.on('layout-done', () => finishLayout());
ipcMain.on('relayout', () => relayout());

ipcMain.on('hot-zones', (_e, rects) => { if (Array.isArray(rects)) hotZones = rects.slice(0, 80); });
ipcMain.on('notice-action', (_e, id) => watchers && watchers.runAction(String(id)));
// окно двигаем так, чтобы сам Буля не уезжал за экран (окно вокруг него может и выступать)
function clampPos(x, y) {
  const o = petOff();
  const r = { x: x + o.x, y: y + o.y, w: PET, h: PET }, wa = waAt(r);
  const px = Math.max(wa.x - 10, Math.min(wa.x + wa.width - PET + 10, r.x));
  const py = Math.max(wa.y - 6, Math.min(wa.y + wa.height - PET + 6, r.y));
  return [Math.round(px - o.x), Math.round(py - o.y)];
}
ipcMain.on('move-by', (_e, d) => {
  if (!win || win.isDestroyed() || !d) return;
  const [x, y] = win.getPosition();
  win.setPosition(...clampPos(x + (+d.dx || 0), y + (+d.dy || 0)));
});
// шаг прогулки: возвращает, на сколько реально сдвинулись (0 — упёрлись в край)
ipcMain.handle('stroll-step', (_e, dx) => {
  if (!win || win.isDestroyed()) return 0;
  const [x, y] = win.getPosition();
  const [nx] = clampPos(x + Math.max(-6, Math.min(6, +dx || 0)), y);
  if (nx === x) return 0;
  win.setPosition(nx, y);
  return nx - x;
});
ipcMain.on('dragging', (_e, on) => {
  dragging = !!on;
  if (!dragging) { savePetPos(); relayout(); }      // отпустили — запомнили место и, если надо, развернули разговор
});
ipcMain.on('pet-menu', () => {
  if (!win || win.isDestroyed()) return;
  Menu.buildFromTemplate(petMenuTemplate()).popup({ window: win });
});
ipcMain.on('open-link', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.handle('send', async (_e, text, paths) => {
  const files = Array.isArray(paths) ? paths.filter(p => typeof p === 'string').slice(0, 5) : [];
  if (brain.ready && files.some(p => /\.(png|jpe?g|webp|gif|bmp)$/i.test(p))) {
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Отправить', 'Отмена'], defaultId: 1, cancelId: 1, noLink: true,
      title: 'Отправить картинку нейросети?',
      message: 'Картинка будет передана выбранному серверу модели.',
      detail: 'Буля не скрывает текст, лица и другие личные данные внутри изображения. Проверь, что на картинке нет лишнего.'
    });
    if (r.response !== 0) return { mood: 'talk', text: 'Картинку не отправил.' };
  }
  return chat.send(String(text || '').slice(0, 4000), files);
});

if (gotLock) app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', () => { if (!win || win.isDestroyed()) app.quit(); });
