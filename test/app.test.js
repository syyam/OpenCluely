// main.js end-to-end under plain Node: fake Electron, fake speech service,
// fake Gemini network, real LLM service / session / prompts. Exercises the
// IPC handlers the renderers call and what gets broadcast back.
const env = require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const { installElectron, preload } = require('./helpers/electron-stub');
const fake = require('./helpers/fake-gemini');

const electron = installElectron(env.TMP);

// Speech service stand-in: main.js subscribes to its events.
const speech = Object.assign(new EventEmitter(), {
  provider: 'whisper',
  manual: false,
  setWhisperPromptProvider() {},
  isAvailable: () => true,
  getStatus: () => ({ isRecording: false }),
  isManualCaptureMode() { return this.manual; },
  startRecording() {}, stopRecording() {}, startMicListening() {}, stopMicListening() {},
  handleAudioChunkFromRenderer() {}, handleMicAudioChunkFromRenderer() {},
  initializeClient() {}, shutdown() {},
});
preload(path.join(env.ROOT, 'src/services/speech.service.js'), speech);

const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');
const config = env.req('src/core/config');
const modelHealth = env.req('src/core/model-health');
const windowManager = env.req('src/managers/window.manager');

// Record what main sends to the windows.
const sent = []; // { target, channel, data }
const shown = []; // showLLMResponse calls
const fakeWindow = (target) => ({ isDestroyed: () => false, webContents: { send: (channel, data) => sent.push({ target, channel, data }) } });
const windows = { chat: fakeWindow('chat'), llmResponse: fakeWindow('overlay') };
windowManager.broadcastToAllWindows = (channel, data) => sent.push({ target: 'all', channel, data });
windowManager.getWindow = (type) => windows[type] || null;
windowManager.showLLMResponse = (content, metadata) => shown.push({ content, metadata });
windowManager.showLLMLoading = () => {};
windowManager.hideLLMResponse = () => {};

env.req('main.js');
const invoke = electron.invoke;

const NORMAL = 'gemini-3.5-flash-lite';
const REASONING = 'gemini-3.6-flash';
const VUE = '### Solution — Search\n```vue\n<script setup lang="ts">\nimport { ref, watch } from \'vue\'\nconst q = ref(\'\')\nwatch(q, () => {}) // (1) watch\n</script>\n<template><input v-model="q" /></template>\n```';

async function waitFor(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = pred();
    if (v) return v;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('timed out waiting');
}
const on = (channel, target) => sent.filter(s => s.channel === channel && (!target || s.target === target));
const turns = () => session.getConversationHistory(50).filter(e => e.role !== 'system');

/** Ask a typed question; resolves with the final answer's metadata. */
async function ask(question, answer) {
  fake.script(NORMAL, fake.sse(answer));
  const before = shown.length;
  await invoke('send-chat-message', question);
  return (await waitFor(() => shown.length > before && shown[shown.length - 1])).metadata;
}

test.before(() => {
  fake.install(llm);
  llm.delay = async () => {};
  config.set('llm.gemini.maxRetries', 3);
});
test.after(() => fake.uninstall());
test.beforeEach(async () => {
  fake.reset();
  modelHealth.reset();
  sent.length = 0;
  shown.length = 0;
  speech.manual = false;
  await invoke('clear-session-memory');
  await invoke('save-settings', { resumeProfile: 'frontend', codingFramework: 'vue3' });
  sent.length = 0;
});

test('typed chat: start → chunks → final, recorded once in history, formats offered for Vue code', async () => {
  const meta = await ask('Debounced search in Vue', VUE);
  const start = on('transcription-llm-response-start')[0];
  assert.equal(start.data.messageId, meta.messageId);
  assert.ok(on('transcription-llm-response-chunk').length >= 1);
  assert.equal(on('transcription-llm-response')[0].data.messageId, meta.messageId);
  assert.deepEqual(turns().map(e => e.role), ['user', 'model']);
  assert.ok(meta.formats.some(f => f.id === 'vue-options-cdn'), 'Vue answer offers conversions');
});

test('voice: fragments within the pause window become ONE question', async () => {
  fake.script(NORMAL, fake.sse('One answer.'));
  speech.emit('transcription', 'How does the');
  speech.emit('transcription', 'virtual DOM work');
  speech.emit('transcription', 'in React?');
  await waitFor(() => shown.length === 1, 4000);
  const streamReqs = fake.requests.filter(r => r.kind === 'stream');
  assert.equal(streamReqs.length, 1);
  const lastTurn = streamReqs[0].body.contents[streamReqs[0].body.contents.length - 1].parts[0].text;
  assert.ok(lastTurn.startsWith('How does the virtual DOM work in React?'));
  assert.equal(on('transcription-received', 'chat').length, 3, 'each fragment shown live');
});

test('voice manual-capture mode sends immediately (no pause wait)', async () => {
  speech.manual = true;
  fake.script(NORMAL, fake.sse('Now.'));
  const t0 = Date.now();
  speech.emit('transcription', 'What is a closure?');
  await waitFor(() => shown.length === 1);
  assert.ok(Date.now() - t0 < 500);
});

test('request-more-details validation per mode', async () => {
  const plain = await ask('What is a closure?', 'A closure captures scope.');
  const code = await ask('Search in Vue', VUE);
  assert.deepEqual(invoke('request-more-details', 'nope', 'details'), { ok: false, reason: 'unavailable' });
  assert.deepEqual(invoke('request-more-details', plain.messageId, 'optimized'), { ok: false, reason: 'unavailable' }, 'no code → no Optimized');
  assert.deepEqual(invoke('request-more-details', plain.messageId, 'convert:react-jsx'), { ok: false, reason: 'unavailable' });
  assert.deepEqual(invoke('request-more-details', code.messageId, 'bogus'), { ok: false, reason: 'unavailable' });
  fake.script(REASONING, fake.sse('Deep review of the closure answer.'));
  assert.equal(invoke('request-more-details', plain.messageId, 'deep').ok, true, 'Deep works on non-code answers');
  assert.deepEqual(invoke('request-more-details', plain.messageId, 'deep'), { ok: false, reason: 'duplicate' });
  await waitFor(() => shown.some(s => s.metadata.expansionMode === 'deep'));
});

async function expand(parentId, mode, answer, model = mode === 'deep' || mode === 'optimized' ? REASONING : NORMAL) {
  fake.script(model, fake.sse(answer));
  const r = invoke('request-more-details', parentId, mode);
  assert.equal(r.ok, true, `${mode} refused: ${r.reason}`);
  return (await waitFor(() => shown.find(s => s.metadata.messageId === r.messageId))).metadata;
}

test('expansions never become history turns; only newer code is attached to the parent answer', async () => {
  const code = await ask('Search in Vue', VUE);
  const parentEvent = () => turns().find(e => e.role === 'model');

  await expand(code.messageId, 'details', 'More depth, no code.');
  await expand(code.messageId, 'deep', '### Solution — Search (reviewed)\n```vue\n<script setup>\n</script>\n```\nPossible improvements: none.');
  assert.equal(turns().length, 2, 'no turns added');
  assert.equal(parentEvent().latestCode, null, 'details / deep without Improved attach nothing');

  await expand(code.messageId, 'optimized', '### Optimized — Search\n```vue\n<script setup>\n// OPTIMIZED\n</script>\n```');
  assert.equal(turns().length, 2);
  assert.equal(parentEvent().latestCode.mode, 'optimized');
  assert.match(parentEvent().latestCode.code, /OPTIMIZED/);

  // The next follow-up is built on the optimized code…
  fake.script(NORMAL, fake.sse('Pagination added.'));
  await invoke('send-chat-message', 'now add pagination');
  await waitFor(() => fake.requests.filter(r => r.kind === 'stream').length && shown.some(s => s.content === 'Pagination added.'));
  const followUp = fake.requests.filter(r => r.kind === 'stream').pop().body.contents;
  assert.ok(followUp.some(c => c.role === 'model' && /Current version of this solution \(optimized\)/.test(c.parts[0].text)));
});

test('Deep reasoning with an Improved section attaches only the improved code', async () => {
  const code = await ask('Search in Vue', VUE);
  await expand(code.messageId, 'deep', '### Solution — Search (reviewed)\n```vue\nORIGINAL\n```\n### Improved — Cleanup\n```vue\nIMPROVED\n```');
  const lc = turns().find(e => e.role === 'model').latestCode;
  assert.equal(lc.mode, 'deep');
  assert.match(lc.code, /IMPROVED/);
  assert.doesNotMatch(lc.code, /ORIGINAL/);
});

test('converted answer: own record with its format pinned; its Deep/Optimized keep that format', async () => {
  const code = await ask('Search in Vue', VUE);
  const converted = await expand(code.messageId, 'convert:vue-options-cdn', '### Solution — Options API + CDN\n```html\n<div id="app"></div>\n<script>Vue.createApp({ data() { return {} } }).mount(\'#app\')</script>\n```');
  assert.equal(turns().find(e => e.role === 'model').latestCode.mode, 'convert:vue-options-cdn');
  await expand(converted.messageId, 'deep', 'Reviewed CDN page.');
  const deepReq = fake.requests.filter(r => r.model === REASONING).pop().body.contents;
  const ask2 = deepReq[deepReq.length - 1].parts[0].text;
  assert.match(ask2, /Options API \+ CDN format/);
  assert.match(deepReq[1].parts[0].text, /Vue\.createApp/, 'the converted code is what gets reviewed');
});

test('parallel: a new question while Deep reasoning streams → both complete, history stays normal', async () => {
  const first = await ask('What is a closure?', 'A closure captures scope.');
  fake.script(REASONING, { ...fake.sse('Slow ', 'deep ', 'review.'), delayMs: 40 });
  const r = invoke('request-more-details', first.messageId, 'deep');
  fake.script(NORMAL, fake.sse('Second answer.'));
  await invoke('send-chat-message', 'What is hoisting?');
  await waitFor(() => shown.some(s => s.content === 'Second answer.') && shown.some(s => s.metadata.messageId === r.messageId), 4000);
  assert.deepEqual(turns().map(e => e.content), ['What is a closure?', 'A closure captures scope.', 'What is hoisting?', 'Second answer.']);
  // The deep stream went to the overlay only, under its parent.
  const deepChunks = on('transcription-llm-response-chunk').filter(s => s.data.messageId === r.messageId);
  assert.ok(deepChunks.length && deepChunks.every(s => s.target === 'overlay'));
});

test('mid-answer break sends a reset to the same windows as the chunks', async () => {
  // typed chat → broadcast to all
  fake.script(NORMAL, { sse: [fake.textEvent('Half'), fake.errorEvent()] });
  fake.script('gemini-3.1-flash-lite', fake.sse('Whole.'));
  await invoke('send-chat-message', 'q');
  await waitFor(() => shown.some(s => s.content === 'Whole.'));
  assert.equal(on('transcription-llm-response-reset', 'all').length, 1);

  // voice → chat + overlay (response target "both")
  sent.length = 0;
  modelHealth.reset(); // each part checks routing from a fresh start (the break above sidelined that model)

  speech.manual = true;
  fake.script(NORMAL, { sse: [fake.textEvent('Half'), fake.errorEvent()] });
  fake.script('gemini-3.1-flash-lite', fake.sse('Whole voice.'));
  speech.emit('transcription', 'voice question');
  await waitFor(() => shown.some(s => s.content === 'Whole voice.'));
  assert.deepEqual(on('transcription-llm-response-reset').map(s => s.target).sort(), ['chat', 'overlay']);

  // expansion → overlay only
  sent.length = 0;
  modelHealth.reset(); // each part checks routing from a fresh start (the break above sidelined that model)

  const parent = shown.find(s => s.content === 'Whole.').metadata;
  fake.script(REASONING, { sse: [fake.textEvent('Half'), fake.errorEvent()] });
  fake.script(NORMAL, fake.sse('Whole review.'));
  const r = invoke('request-more-details', parent.messageId, 'deep');
  await waitFor(() => shown.some(s => s.metadata.messageId === r.messageId));
  assert.deepEqual(on('transcription-llm-response-reset').map(s => s.target), ['overlay']);
});

test('failed expansion → more-details-failed to the overlay, and the button can retry', async () => {
  const plain = await ask('What is a closure?', 'A closure captures scope.');
  const r = invoke('request-more-details', plain.messageId, 'deep'); // nothing scripted → every model 503
  await waitFor(() => on('more-details-failed', 'overlay').length);
  assert.equal(on('more-details-failed')[0].data.parentMessageId, plain.messageId);
  fake.script(REASONING, fake.sse('Second try.'));
  assert.equal(invoke('request-more-details', plain.messageId, 'deep').ok, true, 'retry allowed after failure');
  void r;
});

test('clear-session-memory empties history and tells every window', async () => {
  await ask('Q', 'A');
  sent.length = 0;
  await invoke('clear-session-memory');
  assert.equal(turns().length, 0);
  assert.equal(on('session-cleared', 'all').length, 1);
});

test('profile switch picks that profile\'s default language and resets an unsupported framework', async () => {
  await invoke('save-settings', { resumeProfile: 'android' });
  const s = await invoke('get-settings');
  assert.equal(s.codingLanguage, 'kotlin');
  assert.equal(s.codingFramework, 'auto', 'vue3 is not offered on Android');
  assert.ok(on('coding-language-changed').some(e => e.data.language === 'kotlin'));
  await invoke('save-settings', { resumeProfile: 'frontend' });
  assert.equal((await invoke('get-settings')).codingLanguage, 'typescript');
});
