// Actual Electron renderer/preload smoke test, isolated from user data and network.
const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = path.resolve(__dirname, '..');
const output = path.join(base, '.test-runs', 'native');
fs.mkdirSync(path.join(output, 'user-data'), { recursive: true });
app.setPath('userData', path.join(output, 'user-data'));
app.disableHardwareAcceleration();
const errors = [], windows = [], sent = [];
const watchdog = setTimeout(() => { console.error('Native smoke timed out'); app.exit(1); }, 30000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(window, expression) {
  for (let i = 0; i < 80; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await delay(50);
  }
  throw new Error('Renderer condition timed out');
}
async function open(file, preload, width = 600, height = 860) {
  const window = new BrowserWindow({
    width, height, show: false,
    ...(file === 'index.html' ? { frame: false, transparent: true } : {}),
    webPreferences: { preload: path.join(base, preload), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  windows.push(window);
  window.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  window.webContents.on('preload-error', (_event, _file, error) => errors.push(String(error)));
  window.webContents.on('render-process-gone', (_event, details) => errors.push('Renderer gone: ' + details.reason));
  await window.loadFile(path.join(base, file));
  return window;
}

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
    const { PRESETS } = require('../brain');
    ['hot-zones', 'notice-action', 'open-settings', 'move-by', 'dragging', 'pet-menu', 'relayout', 'layout-done', 'open-link']
      .forEach(channel => ipcMain.on(channel, () => {}));
    ipcMain.handle('send', (_event, text) => { sent.push(text); return { mood: 'happy', text: 'Гав! Проверка окна прошла.' }; });
    ipcMain.handle('stroll-step', () => 0);
    ipcMain.handle('sprite', (_event, name) => {
      assert.match(name, /^[a-z0-9_]{1,30}$/);
      return 'data:image/png;base64,' + fs.readFileSync(path.join(base, 'assets', name + '.png')).toString('base64');
    });
    ipcMain.handle('brain:get', () => ({ cfg: null, hasKey: false, presets: PRESETS }));
    ipcMain.handle('brain:test', () => ({ ok: true, tools: true, ms: 1 }));
    ipcMain.handle('brain:models', () => ({ ok: true, models: ['test-model'] }));
    ipcMain.handle('brain:save', () => ({ ok: true }));
    ipcMain.handle('skin:get', () => ({ key: 'classic' }));
    ipcMain.handle('skin:save', () => true);

    const pet = await open('index.html', 'preload.js', 460, 640);
    await waitFor(pet, 'document.getElementById("img").naturalWidth > 0 && !!window.bulya');
    await pet.webContents.executeJavaScript('setOpen(true); document.getElementById("input").value = "Привет"; document.getElementById("dock").requestSubmit();');
    await waitFor(pet, 'document.getElementById("stack").textContent.includes("Проверка окна прошла")');
    assert.deepEqual(sent, ['Привет']);
    await pet.webContents.executeJavaScript('setOpen(true)');
    await delay(200);
    await waitFor(pet, 'document.getElementById("img").complete && document.getElementById("img").naturalWidth > 0');
    const petState = await pet.webContents.executeJavaScript('({ src: document.getElementById("img").getAttribute("src"), width: document.getElementById("img").naturalWidth, open: document.body.classList.contains("open") })');
    fs.writeFileSync(path.join(output, 'pet.png'), (await pet.webContents.capturePage()).toPNG());

    // Exercise the actual renderer clock through its normal IPC messages.
    pet.webContents.send('chat-event', { type: 'behavior', mode: 'playful' });
    await waitFor(pet, 'activityMode === "playful"');
    await pet.webContents.executeJavaScript('setOpen(false); setState("idle")');
    pet.webContents.send('chat-event', { type: 'system-state', idleSeconds: 90, visible: true });
    await delay(1100);
    assert.equal(await pet.webContents.executeJavaScript('sleepPending || state === "sleep"'), false);
    pet.webContents.send('chat-event', { type: 'system-state', idleSeconds: 300, visible: true });
    await waitFor(pet, 'sleepPending');
    pet.webContents.send('chat-event', { type: 'system-state', idleSeconds: 0, visible: true });
    await waitFor(pet, '!sleepPending && state !== "sleep"');
    pet.webContents.send('chat-event', { type: 'sleep' });
    pet.webContents.send('chat-event', { type: 'system-state', idleSeconds: 0, visible: true });
    await delay(1100);
    assert.equal(await pet.webContents.executeJavaScript('systemSleeping && sleepPending'), true);
    pet.webContents.send('chat-event', { type: 'wake' });
    await waitFor(pet, '!systemSleeping && !sleepPending');
    await pet.webContents.executeJavaScript('runSequence([{ name: "glance_left" }, { name: "lie", hold: 6500 }]);');
    pet.webContents.send('chat-event', { type: 'open-chat', draft: 'Напомни через 10 минут ' });
    await waitFor(pet, 'document.getElementById("input").value === "Напомни через 10 минут "');
    await delay(1500);
    assert.notEqual(await pet.webContents.executeJavaScript('state'), 'lie', 'Opening chat interrupts the remaining autonomous sequence');
    assert.deepEqual(sent, ['Привет'], 'Drafting a reminder must not send a request');
    pet.webContents.send('chat-event', { type: 'help' });
    await waitFor(pet, 'document.getElementById("stack").textContent.includes("Попробуй:")');

    const { buildMenu } = require('../menus');
    const menuActions = new Proxy({}, { get: (_target, key) => key === 'skinMenu' ? () => ({ label: 'Окрас', submenu: [] })
      : key === 'memoryMenu' ? () => ({ label: 'Память', submenu: [] }) : () => {} });
    const nativeMenu = Menu.buildFromTemplate(buildMenu({ mode: 'normal', visible: true, chatty: true, events: true, stretch: true }, menuActions));
    assert.ok(nativeMenu.items.find(item => item.label === 'Эмоции').submenu.items.length > 5);
    const behavior = nativeMenu.items.find(item => item.label === 'Поведение');
    assert.equal(behavior.submenu.items[0].submenu.items.filter(item => item.checked).length, 1);

    const settings = await open('settings.html', 'settings_preload.js');
    await waitFor(settings, 'document.querySelectorAll("input[name=p]").length > 0');
    await settings.webContents.executeJavaScript('document.getElementById("test").click()');
    await waitFor(settings, 'document.getElementById("result").classList.contains("ok")');
    fs.writeFileSync(path.join(output, 'settings.png'), (await settings.webContents.capturePage()).toPNG());

    const skin = await open('skin.html', 'skin_preload.js', 440, 560);
    await waitFor(skin, '!!window.skin && document.querySelectorAll("button").length > 0');
    assert.deepEqual(errors, []);
    const report = { passed: true, electron: process.versions.electron, checks: ['pet image', 'preload bridge', 'chat submit and reply', 'system idle sleep and wake', 'screen lock and resume', 'sequence interruption', 'reminder draft without sending', 'local help', 'native menu and mode radios', 'settings and provider test UI', 'skin window'], petState, isolated: true };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    exitCode = 1;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: false, error: String(error), errors }, null, 2));
    console.error(error.stack);
  } finally {
    clearTimeout(watchdog);
    windows.forEach(window => { if (!window.isDestroyed()) window.destroy(); });
  }
  app.exit(exitCode);
});
