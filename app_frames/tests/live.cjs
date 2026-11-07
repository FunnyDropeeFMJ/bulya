// Optional paid/network smoke test. Never imported by npm test or CI.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  let dir;
  let exitCode = 0;
  try {
    if (process.env.BULYA_LIVE_TEST !== '1') throw new Error('Set BULYA_LIVE_TEST=1 to explicitly enable a request to your provider.');
    const baseUrl = process.env.BULYA_TEST_BASE_URL;
    const model = process.env.BULYA_TEST_MODEL;
    const key = process.env.BULYA_TEST_API_KEY || '';
    if (!baseUrl || !model) throw new Error('BULYA_TEST_BASE_URL and BULYA_TEST_MODEL are required. No .env or saved app settings are used.');
    const { Brain } = require('../brain');
    const { Chat } = require('../llm');
    const { Memory } = require('../memory');
    const { Secrets } = require('../privacy');
    dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'bulya-live-'));
    const brain = new Brain(path.join(dir, 'brain'));
    brain.save({ provider: 'custom', baseUrl, model }, key);
    const connection = await Brain.test(baseUrl, key, model);
    if (!connection.ok || !connection.tools) throw new Error('Provider connection or tool support check failed.');
    const memory = new Memory(path.join(dir, 'memory'));
    const chat = new Chat({ brain, memory, secrets: new Secrets(memory), win: null, onEvent: () => {} });
    let count = 0;
    // Text-only test: no tools can act on the real desktop.
    const response = await chat.call([{ role: 'user', content: 'Ответь одним словом: гав.' }], { tools: false });
    if (!response.content) throw new Error('The provider returned no text.');
    count++;
    console.log(`Live check passed: connection, tool support, ${count} text response. No desktop actions executed.`);
  } catch (error) {
    // Do not print provider response bodies or headers: they may contain secrets.
    console.error('Live check failed:', error.message.startsWith('Set ') || error.message.startsWith('BULYA_') ? error.message : 'Check your provider settings, network and account limits.');
    exitCode = 1;
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  app.exit(exitCode);
});
