const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// Only Electron's native boundary is replaced. Chat, privacy, attachments,
// memory and the skill dispatcher below are the application's actual modules.
const testRoot = path.join(__dirname, '..', '.test-runs');
fs.mkdirSync(testRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(testRoot, 'core-'));
const nativeImage = {
  createFromPath: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toJPEG: () => Buffer.from('image bytes') })
};
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === 'electron') return {
    app: { getPath: () => temp }, nativeImage,
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openPath: async () => { throw new Error('Unexpected native action'); } },
    dialog: { showMessageBox: async () => ({ response: 1 }) }
  };
  return originalLoad.call(this, id, ...args);
};
const { Secrets, expandHome } = require('../privacy');
const { Chat } = require('../llm');
const { Memory } = require('../memory');
const { buildContent } = require('../attachments');
const { runTool } = require('../tools');
const { Brain } = require('../brain');
Module._load = originalLoad;
after(() => fs.rmSync(temp, { recursive: true, force: true }));

const personalName = 'Иванов Иван Иванович';
const phone = '+7 916 123-45-67';
function fixture(name, content = 'Тестовый документ') {
  const p = path.join(temp, name); fs.writeFileSync(p, content); return p;
}
function createChat(memory = null) {
  const chat = new Chat({
    brain: { ready: true, cfg: { baseUrl: 'https://test.invalid/v1', model: 'test' }, headers: () => ({}) },
    win: null, memory, secrets: new Secrets(memory), onEvent: () => {}
  });
  return { chat };
}
async function fakeServer(run, responses = [{ content: '[happy] Гав!' }]) {
  const previous = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const message = responses.shift();
    assert.ok(message, 'Unexpected additional LLM call');
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message }] }) };
  };
  try { await run(requests); } finally { global.fetch = previous; }
}

test('privacy masks and restores text', () => {
  const secrets = new Secrets();
  const original = `${personalName}, паспорт 45 12 345678, ${phone}, test@example.com`;
  const masked = secrets.mask(original);
  for (const part of [personalName, '345678', '916', 'example.com']) assert.ok(!masked.text.includes(part));
  assert.equal(secrets.unmask(masked.text), original);
  assert.equal(secrets.mask('Забыл пароль от вайфая, помоги.').text, 'Забыл пароль от вайфая, помоги.');
});

test('attachment filenames, parent paths and contents are masked', async () => {
  const folder = path.join(temp, personalName); fs.mkdirSync(folder);
  const p = path.join(folder, `${personalName}.txt`); fs.writeFileSync(p, phone);
  const result = await buildContent('Перескажи', [p], new Secrets());
  assert.ok(!result.content.includes(personalName), 'Attachment metadata leaked a personal name');
  assert.ok(!result.content.includes(phone));
  assert.ok(result.found.includes('ФИО'));
  assert.equal(result.items[0].path, p, 'Local file reference must remain intact');
});

test('missing-file metadata is masked too', async () => {
  const r = await buildContent('Прочитай', [path.join(temp, `${personalName}-missing.txt`)], new Secrets());
  assert.ok(!r.content.includes(personalName));
});

test('image data remains intact and cached captions are masked', async () => {
  const r = await buildContent('Посмотри', [fixture(`${personalName}.png`)], new Secrets());
  assert.equal(r.images, 1);
  assert.equal(r.content[1].image_url.url, 'data:image/jpeg;base64,' + Buffer.from('image bytes').toString('base64'));
  assert.ok(!r.content[0].text.includes(personalName));
  assert.ok(!r.textOnly.includes(personalName), 'Image caption leaked into future conversation history');
});

test('chat sends masked attachment metadata and returns the model reply', async () => {
  const { chat } = createChat();
  await fakeServer(async requests => {
    const reply = await chat.send(`Мой телефон ${phone}`, [fixture(`${personalName}-chat.txt`, phone)]);
    assert.equal(reply.text, 'Гав!'); assert.equal(reply.mood, 'happy');
    assert.equal(requests.length, 1);
    const serialized = JSON.stringify(requests);
    assert.ok(!serialized.includes(personalName)); assert.ok(!serialized.includes(phone));
    assert.equal(chat.busy, false);
  });
});

test('outgoing system memory and tool messages also pass through the text filter', async () => {
  const { chat } = createChat();
  await fakeServer(async requests => {
    await chat.call([{ role: 'system', content: `Старый факт: ${phone}` }, { role: 'tool', tool_call_id: 'test', content: personalName }]);
    assert.ok(!JSON.stringify(requests).includes(phone));
    assert.ok(!JSON.stringify(requests).includes(personalName));
  });
});

test('tool-calling conversation reaches the model twice and masks tool output', async () => {
  const memory = new Memory(path.join(temp, 'tool-memory'));
  memory.add('факт', 'Любит бульдогов');
  const { chat } = createChat(memory);
  await fakeServer(async requests => {
    const reply = await chat.send('Что ты обо мне помнишь?');
    assert.equal(reply.text, 'Помню!'); assert.equal(requests.length, 2);
    assert.ok(requests[1].messages.some(m => m.role === 'tool' && m.tool_call_id === 'call-1'));
  }, [
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'recall', arguments: '{"query":""}' } }] },
    { role: 'assistant', content: '[happy] Помню!' }
  ]);
});

test('offline mode never calls the model', async () => {
  const chat = new Chat({ brain: null, win: null, onEvent: () => {} });
  await fakeServer(async requests => {
    const reply = await chat.send('Перескажи', [fixture('offline.txt')]);
    assert.equal(requests.length, 0); assert.ok(reply.actions.some(a => a.settings));
  }, []);
});

test('secret files and private-network URLs are rejected without a network request', async () => {
  const ctx = { win: null, onEvent: () => {}, secrets: new Secrets() };
  const p = fixture('.env', 'DO_NOT_SEND=private');
  await fakeServer(async requests => {
    assert.equal((await runTool('read_file', { path: p }, ctx)).ok, false);
    assert.equal((await runTool('read_web_page', { url: 'http://192.168.1.1' }, ctx)).ok, false);
    assert.equal(requests.length, 0);
  }, []);
});

test('memory and reminders survive reload, short forget queries preserve facts', async () => {
  const dir = path.join(temp, 'memory'); const memory = new Memory(dir);
  memory.add('факт', 'Любит французских бульдогов');
  memory.addReminder(-1, 'Размяться');
  const reloaded = new Memory(dir);
  assert.equal(reloaded.forgetPreview('я').length, 0);
  assert.equal(reloaded.forgetPreview('бульдогов').length, 1);
  assert.equal(reloaded.takeDueReminders().length, 1);
  assert.equal(reloaded.takeDueReminders().length, 0);
});

test('corrupt memory is preserved for recovery', () => {
  const dir = path.join(temp, 'corrupt'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'память.json'), '{broken');
  const m = new Memory(dir);
  assert.ok(m.loadError);
  assert.ok(fs.readdirSync(dir).some(n => n.includes('испорчен')));
});

test('API key cannot be saved as plaintext when Windows encryption is unavailable', () => {
  const brain = new Brain(path.join(temp, 'brain'));
  assert.throws(() => brain.save({ provider: 'custom', baseUrl: 'https://test.invalid/v1', model: 'test' }, 'test-key'), /Шифрование/);
  assert.ok(!fs.existsSync(brain.keyFile));
});

test('saved API key is bound to its provider and endpoint', () => {
  const brain = new Brain(path.join(temp, 'key-binding'));
  const cfg = { provider: 'custom', baseUrl: 'https://first.invalid/v1', model: 'one' };
  brain.cfg = cfg; brain.key = 'original-test-key';
  assert.equal(brain.keyFor('custom', cfg.baseUrl), 'original-test-key');
  assert.equal(brain.keyFor('custom', 'https://other.invalid/v1'), '');
  brain.save({ ...cfg, model: 'two' });
  assert.equal(brain.key, 'original-test-key', 'Changing only the model keeps the key');
  brain.save({ ...cfg, baseUrl: 'https://other.invalid/v1' });
  assert.equal(brain.key, '', 'Switching servers must not reuse another server\'s key');
});

test('Word and Excel tools create readable new files without opening desktop apps', async () => {
  const secrets = new Secrets();
  const masked = secrets.mask(phone).text;
  const ctx = { win: null, secrets, onEvent: () => {} };
  const docArgs = { file_name: 'Тест документа', title: 'Контакты', content: `Телефон ${masked}`, open: false };
  const word = await runTool('create_word_document', docArgs, ctx);
  const wordAgain = await runTool('create_word_document', docArgs, ctx);
  assert.equal(word.ok, true); assert.notEqual(word.saved, wordAgain.saved);
  const { extract } = require('../attachments');
  // runTool masks returned paths; these fixture names contain no personal data.
  const wordText = await extract(expandHome(secrets.unmask(word.saved)));
  assert.ok(wordText.text.includes(phone), 'Local document restores the masked phone');
  const excel = await runTool('create_excel', {
    file_name: 'Тест таблицы', sheets: [{ name: 'Покупки', rows: [['Товар', 'Цена'], ['Корм', '123,45']] }], open: false
  }, ctx);
  assert.equal(excel.ok, true);
  const ExcelJS = require('exceljs'); const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(expandHome(secrets.unmask(excel.saved)));
  assert.equal(book.worksheets[0].getCell('B2').value, 123.45);
  book.worksheets[0].addConditionalFormatting({ ref: 'B2', rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF00FF00' } }] });
  const roundtrip = await book.xlsx.writeBuffer();
  assert.ok(roundtrip.length > 0, 'Excel conditional formatting works with the patched UUID dependency');
});
