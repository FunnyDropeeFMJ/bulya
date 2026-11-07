const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Planner, MODES } = require('../behavior');
const { buildMenu } = require('../menus');
const fs = require('node:fs');
const path = require('node:path');

const context = { now: 100000, idleSeconds: 0, mode: 'normal' };
test('working at the PC keeps the pet awake even without chatting for hours', () => {
  const planner = new Planner(() => 0.9, 0);
  for (let now = 100000; now < 7200000; now += 60000) {
    const action = planner.next({ ...context, now, idleSeconds: 2 });
    assert.notEqual(action?.kind, 'sleep');
  }
  assert.equal(planner.next({ ...context, now: 8000000, idleSeconds: 300 }).kind, 'sleep');
});
test('five minutes idle are required for sleep; returning wakes immediately', () => {
  const planner = new Planner(() => 0.9, 0);
  assert.notEqual(planner.next({ ...context, idleSeconds: 90 })?.kind, 'sleep');
  assert.equal(planner.next({ ...context, idleSeconds: 300 }).kind, 'sleep');
  assert.equal(planner.next({ ...context, sleeping: true, idleSeconds: 300 }), null);
  assert.equal(planner.next({ ...context, sleeping: true, idleSeconds: 0 }).kind, 'wake');
  assert.equal(planner.next({ ...context, sleeping: true, idleSeconds: 0, suspended: true }), null);
});
test('tasks, dragging, hidden windows and screen lock have priority over autonomous behavior', () => {
  for (const gate of [{ busy: true }, { dragging: true }, { visible: false }, { suspended: true }]) {
    const planner = new Planner(() => 0, 0);
    assert.equal(planner.next({ ...context, ...gate }), null);
    assert.equal(planner.next({ ...context, idleSeconds: 600, ...gate }), null);
  }
  assert.equal(new Planner(() => 0, 0).next({ ...context, ready: false }), null);
});
test('reduced motion disables spontaneous actions without disabling sleep and wake', () => {
  const planner = new Planner(() => 0, 0);
  assert.equal(planner.next({ ...context, reducedMotion: true }), null);
  assert.equal(planner.next({ ...context, reducedMotion: true, idleSeconds: 300 }).kind, 'sleep');
  assert.equal(planner.next({ ...context, reducedMotion: true, sleeping: true }).kind, 'wake');
});
test('the same sequence cannot repeat among the previous two; all frames exist', () => {
  const planner = new Planner(() => 0.99, 0);
  const recent = [];
  const renderer = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  for (let i = 1; i < 40; i++) {
    const action = planner.next({ ...context, now: i * 100000 });
    assert.equal(action.kind, 'sequence');
    assert.ok(!recent.includes(action.id));
    recent.push(action.id); if (recent.length > 2) recent.shift();
    for (const step of action.steps) {
      if (step.hold) assert.ok(fs.existsSync(path.join(__dirname, '../assets', step.name + '.png')));
      else assert.match(renderer, new RegExp('\\b' + step.name + ':'));
    }
  }
});
test('open chat gets only small infrequent reactions, never a walk or sleep', () => {
  const planner = new Planner(() => 0, 0);
  const action = planner.next({ ...context, open: true, idleSeconds: 600 });
  assert.equal(action.kind, 'sequence');
  assert.ok(!action.steps.some(step => ['lie', 'stretch', 'scratch'].includes(step.name)));
  assert.equal(planner.next({ ...context, now: context.now + 34000, open: true }), null);
});
test('mode controls action frequency and walks have a cooldown', () => {
  const calm = new Planner(() => 0.5, 0), playful = new Planner(() => 0.5, 0);
  calm.next({ ...context, mode: 'calm' }); playful.next({ ...context, mode: 'playful' });
  assert.ok(calm.nextAt > playful.nextAt);
  const planner = new Planner(() => 0, 0);
  assert.equal(planner.next({ ...context, now: 60000, mode: 'playful' }).kind, 'walk');
  assert.notEqual(planner.next({ ...context, now: 80000, mode: 'playful' })?.kind, 'walk');
  assert.equal(planner.next({ ...context, now: 120000, mode: 'playful' }).kind, 'walk');
  assert.deepEqual(Object.keys(MODES), ['calm', 'normal', 'playful']);
});
test('interaction postpones autonomous actions and prevents an immediate walk', () => {
  const planner = new Planner(() => 0, 0);
  planner.interact(100000);
  assert.equal(planner.next({ ...context, now: 105000 }), null);
  assert.equal(planner.next({ ...context, now: 115000, mode: 'playful' }).kind, 'sequence');
});

function menuFixture(visible = true) {
  const calls = [];
  const actions = {};
  for (const key of ['openChat', 'play', 'help', 'documents', 'stroll', 'resetPosition', 'settings', 'toggleVisible', 'quit', 'setMode', 'setFlag']) {
    actions[key] = (...args) => calls.push([key, ...args]);
  }
  actions.skinMenu = () => ({ label: 'Окрас', submenu: [] });
  actions.memoryMenu = () => ({ label: 'Память', submenu: [] });
  const menu = buildMenu({ mode: 'normal', visible, chatty: true, events: true, stretch: true }, actions);
  const item = label => menu.find(entry => entry.label === label);
  return { menu, item, calls };
}
test('shared menu groups games, emotions and settings and switches show/hide label', () => {
  const { item } = menuFixture();
  assert.ok(item('Поговорить с Булей')); assert.ok(item('Погладить'));
  assert.ok(item('Поиграть').submenu.some(i => i.label === 'Кинуть мячик'));
  assert.ok(item('Эмоции').submenu.some(i => i.label === 'Радость'));
  assert.ok(!item('Кинуть мячик')); assert.ok(!item('Движения'));
  assert.ok(item('Спрятать Булю'));
  assert.ok(menuFixture(false).item('Показать Булю'));
});
test('menu callbacks preserve user intent: reminder drafts, petting and saved activity mode', () => {
  const { item, calls } = menuFixture();
  item('Погладить').click();
  item('Помощь').submenu.find(i => i.label.startsWith('Поставить')).click();
  const modes = item('Поведение').submenu.find(i => i.label === 'Активность').submenu;
  assert.equal(modes.filter(i => i.checked).length, 1);
  modes.find(i => i.label === 'Игривый').click();
  item('Поведение').submenu.find(i => i.label === 'Самостоятельные реплики').click({ checked: false });
  assert.deepEqual(calls, [['play', 'love', 'pet'], ['openChat', 'Напомни через 10 минут '], ['setMode', 'playful'], ['setFlag', 'chatty', false]]);
});
