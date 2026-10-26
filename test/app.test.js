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
const REASONING = 'gemini-3.8-flash';
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

test('clear while an answer is still streaming: that answer is shown but not saved to history', async () => {
  fake.script(NORMAL, { ...fake.sse('Part one, ', 'part two.'), delayMs: 60 });
  await invoke('send-chat-message', 'Question asked before the clear');
  await waitFor(() => on('transcription-llm-response-chunk').length >= 1);
  await invoke('clear-session-memory');
  await waitFor(() => shown.length === 1);
  assert.equal(turns().length, 0, 'the in-flight pair did not come back after the clear');

  // The next question is sent with no history, and is saved normally.
  fake.reset();
  await ask('Fresh question', 'Fresh answer.');
  const contents = fake.requests.find(r => r.kind === 'stream').body.contents;
  assert.ok(!JSON.stringify(contents).includes('Question asked before the clear'));
  assert.deepEqual(turns().map(e => e.content), ['Fresh question', 'Fresh answer.']);
});

test('clear drops voice fragments that were heard but not sent yet', async () => {
  speech.emit('transcription', 'half a question from before');
  await invoke('clear-session-memory');
  await new Promise(r => setTimeout(r, 1000)); // past the 800 ms pause window
  assert.equal(fake.requests.length, 0, 'nothing was sent to Gemini');
  assert.equal(shown.length, 0);
});

const lastUserText = (req) => { const c = req.body.contents; return c[c.length - 1].parts.map(p => p.text || '').join(''); };

test('"Did you mean…?" goes to the chat window only; the reply is sent with it and answered normally', async () => {
  fake.script(NORMAL, fake.sse('CLAR', 'IFY: Did you mean `.not`?'));
  await invoke('send-chat-message', 'Can you add support from DotNord as well?');
  const question = await waitFor(() => on('chat-clarification', 'chat')[0]);
  assert.equal(question.data.text, 'Did you mean `.not`?');
  assert.equal(on('transcription-llm-response-start').length, 0, 'response window not opened');
  assert.equal(on('transcription-llm-response-chunk').length, 0);
  assert.equal(on('transcription-llm-response').length, 0);
  assert.equal(shown.length, 0);
  assert.equal(turns().length, 0, 'the question is not saved to history');

  fake.reset();
  const meta = await ask('yes', 'Answer with .not');
  const text = lastUserText(fake.requests.find(r => r.kind === 'stream'));
  assert.ok(text.startsWith('yes\n\n[This answers your question "Did you mean `.not`?" about my previous message: "Can you add support from DotNord as well?"'));
  assert.ok(meta.messageId);
  assert.equal(turns().length, 2, 'the resolved pair is saved');
  assert.ok(turns()[0].content.includes('DotNord') && turns()[0].content.startsWith('yes'));

  // Used once: the next message is sent as typed.
  fake.reset();
  await ask('Now add toEqual', 'Answer');
  assert.equal(lastUserText(fake.requests.find(r => r.kind === 'stream')).split('\n')[0], 'Now add toEqual');
});

test('a normal chat answer still opens the response window and streams in order', async () => {
  await ask('What is a closure?', 'A closure keeps its scope.');
  const seq = sent.filter(s => /^transcription-llm-response(-start|-chunk)?$/.test(s.channel)).map(s => s.channel);
  assert.equal(seq[0], 'transcription-llm-response-start');
  assert.ok(seq.includes('transcription-llm-response-chunk'));
  assert.equal(on('transcription-llm-response-chunk').map(s => s.data.delta).join(''), 'A closure keeps its scope.');
  assert.equal(on('chat-clarification').length, 0);
});

test('a "Did you mean…?" with several guesses is one question; a clicked guess is sent as its reply', async () => {
  fake.script(NORMAL, fake.sse('CLARIFY: Did you mean `useMemo`, `useCallback` or `React.memo`?'));
  await invoke('send-chat-message', 'wrap it in use memo hook');
  const question = await waitFor(() => on('chat-clarification', 'chat')[0]);
  assert.equal(question.data.text, 'Did you mean `useMemo`, `useCallback` or `React.memo`?');
  fake.reset();
  await ask('useCallback', 'Answer with useCallback');
  assert.ok(lastUserText(fake.requests.find(r => r.kind === 'stream')).startsWith('useCallback\n\n[This answers your question'));
});

test('a "Did you mean…?" under an "**Understanding**" heading is still a question, and a normal answer still streams', async () => {
  fake.script(NORMAL, fake.sse('**Under', 'standing**\n', 'CLARIFY: Did you mean `not`?'));
  await invoke('send-chat-message', 'add DotNord');
  const question = await waitFor(() => on('chat-clarification', 'chat')[0]);
  assert.equal(question.data.text, 'Did you mean `not`?');
  assert.equal(on('transcription-llm-response-start').length, 0, 'response window not opened');

  fake.reset();
  await invoke('clear-session-memory');
  fake.script(NORMAL, fake.sse('**Under', 'standing**\n', 'Add a not flag.'));
  await invoke('send-chat-message', 'Add .not');
  await waitFor(() => shown.length === 1);
  assert.equal(on('transcription-llm-response-chunk').map(s => s.data.delta).join(''), '**Understanding**\nAdd a not flag.');
});

test('the trash button drops a pending "Did you mean…?"', async () => {
  fake.script(NORMAL, fake.sse('CLARIFY: Did you mean `v-for`?'));
  await invoke('send-chat-message', 'add V4');
  await waitFor(() => on('chat-clarification').length === 1);
  await invoke('clear-session-memory');
  fake.reset();
  await ask('yes', 'Hello');
  assert.equal(lastUserText(fake.requests.find(r => r.kind === 'stream')), 'yes');
});

test('chat text dictated with My Microphone is sent with the speech hint', async () => {
  fake.script(NORMAL, fake.sse('ok answer'));
  await invoke('send-chat-message', 'add pagan nation', { spoken: true });
  await waitFor(() => shown.length === 1);
  assert.match(lastUserText(fake.requests.find(r => r.kind === 'stream')), /^add pagan nation\n\n\[Dictated with speech recognition/);
});

test('interviewer answer from a guess: the HEARD line goes to chat once, never into the answer or history', async () => {
  speech.manual = true;
  fake.script(NORMAL, fake.sse('HEA', 'RD: virtual dumb → virtual DOM\n', 'The virtual DOM is ', 'an in-memory tree.'));
  speech.emit('transcription', 'What is the virtual dumb in React?');
  await waitFor(() => shown.length === 1);
  assert.deepEqual(on('voice-heard-note', 'chat').map(s => s.data.text), ['virtual dumb → virtual DOM']);
  const streamed = on('transcription-llm-response-chunk', 'overlay').map(s => s.data.delta).join('');
  assert.equal(streamed, 'The virtual DOM is an in-memory tree.');
  assert.equal(shown[0].content, 'The virtual DOM is an in-memory tree.');
  assert.equal(on('transcription-llm-response', 'chat')[0].data.response, 'The virtual DOM is an in-memory tree.');
  assert.deepEqual(turns().map(e => e.content), ['What is the virtual dumb in React?', 'The virtual DOM is an in-memory tree.']);
});

test('a HEARD line with other guesses ("a → b | c, d") reaches chat whole and stays out of the answer', async () => {
  speech.manual = true;
  fake.script(NORMAL, fake.sse('HEARD: Overgo X → Vuex | Pinia, Redux\n', 'Vuex is the classic store.'));
  speech.emit('transcription', 'Why would you choose any Overgo X?');
  await waitFor(() => shown.length === 1);
  assert.deepEqual(on('voice-heard-note', 'chat').map(s => s.data.text), ['Overgo X → Vuex | Pinia, Redux']);
  assert.equal(shown[0].content, 'Vuex is the classic store.');
});

test('interviewer answer with no HEARD line streams exactly as before, no chat note', async () => {
  speech.manual = true;
  fake.script(NORMAL, fake.sse('H', 'ello! A closure keeps its scope.'));
  speech.emit('transcription', 'What is a closure?');
  await waitFor(() => shown.length === 1);
  assert.equal(on('voice-heard-note').length, 0);
  assert.equal(on('transcription-llm-response-chunk', 'overlay').map(s => s.data.delta).join(''), 'Hello! A closure keeps its scope.');
  assert.equal(shown[0].content, 'Hello! A closure keeps its scope.');
});

test('interviewer coding request with an unclear term: asked in chat, nothing streamed or saved; the button reply builds it', async () => {
  speech.manual = true;
  fake.script(NORMAL, fake.sse('CLAR', 'IFY: Did you mean `pagination`?'));
  speech.emit('transcription', 'Now add pagan nation to it');
  const question = await waitFor(() => on('chat-clarification', 'chat')[0]);
  assert.deepEqual(question.data, { text: 'Did you mean `pagination`?', source: 'voice' });
  const id = on('transcription-llm-response-start')[0].data.messageId;
  assert.equal(on('transcription-llm-response-chunk').length, 0, 'no question text in the answer window');
  assert.equal(on('transcription-llm-response').length, 0);
  assert.equal(shown.length, 0);
  assert.ok(on('transcription-llm-response-cancel').some(s => s.data.messageId === id), 'the empty answer row is dropped');
  assert.equal(on('voice-heard-note').length, 0);
  assert.equal(turns().length, 0, 'not saved to history');

  fake.reset();
  await ask('pagination', 'CHANGED: paginated list');
  const text = lastUserText(fake.requests.find(r => r.kind === 'stream'));
  assert.ok(text.startsWith('pagination\n\n[This answers your question "Did you mean `pagination`?" about the interviewer\'s request (a live speech transcript, so a word may be misheard): "Now add pagan nation to it". If it confirms, build that request'));
  assert.equal(turns().length, 2, 'the resolved pair is saved');
});

test('interviewer CLARIFY under an "**Understanding**" heading or after a HEARD line is still a question', async () => {
  speech.manual = true;
  fake.script(NORMAL, fake.sse('**Under', 'standing**\n', 'CLARIFY: Did you mean `toBe`?'));
  speech.emit('transcription', 'add dot to x dot be y');
  await waitFor(() => on('chat-clarification').length === 1);
  fake.script(NORMAL, fake.sse('HEARD: cash → cache\n', 'CLARIFY: Did you mean `cache`, `catch`?'));
  speech.emit('transcription', 'add cash to it');
  await waitFor(() => on('chat-clarification').length === 2);
  assert.equal(on('chat-clarification')[1].data.text, 'Did you mean `cache`, `catch`?');
  assert.equal(on('transcription-llm-response-chunk').length, 0);
  assert.equal(on('voice-heard-note').length, 0, 'the question replaces the note');
  assert.equal(shown.length, 0);
});

test('interviewer coding answer after a HEARD note with other readings: asked in chat instead of built', async () => {
  speech.manual = true;
  fake.script(NORMAL, fake.sse('HEARD: Flembic mode → Alembic mode | fluent mode\n', '**Understanding**\n', 'Add Alembic mode.\n```ts\nconst a = 1\n```'));
  speech.emit('transcription', 'Add support for Flembic mode');
  const question = await waitFor(() => on('chat-clarification', 'chat')[0]);
  assert.deepEqual(question.data, { text: 'Did you mean `Alembic mode` or `fluent mode`?', source: 'voice' });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(on('chat-clarification').length, 1, 'asked once');
  assert.equal(on('transcription-llm-response-chunk').length, 0, 'the guessed code is never shown');
  assert.equal(on('voice-heard-note').length, 0);
  assert.equal(shown.length, 0);
  assert.equal(turns().length, 0, 'not saved to history');
});

test('a HEARD note with other readings on a concept answer, or with none on a coding answer, still answers right away', async () => {
  speech.manual = true;
  const cases = [
    ['HEARD: V4 → v-for | v-if\n', 'v-for renders a list.'],
    ['HEARD: pagan nation → pagination | pagination\n', '**Understanding**\n', 'Add pagination.'],
    ['HEARD: a bort controller → AbortController\n', '**Understanding**\n', 'Abort the old request.'],
  ];
  for (const parts of cases) {
    sent.length = 0;
    shown.length = 0;
    fake.script(NORMAL, fake.sse(...parts));
    speech.emit('transcription', `question ${parts[0]}`);
    await waitFor(() => shown.length === 1);
    assert.equal(on('transcription-llm-response-chunk', 'overlay').map(s => s.data.delta).join(''), parts.slice(1).join(''), JSON.stringify(parts));
    assert.equal(on('chat-clarification').length, 0, JSON.stringify(parts));
    assert.equal(on('voice-heard-note').length, 1, JSON.stringify(parts));
  }
});

test('a new interviewer question replaces an unanswered interviewer "Did you mean"', async () => {
  speech.manual = true;
  fake.script(NORMAL, fake.sse('CLARIFY: Did you mean `pagination`?'));
  speech.emit('transcription', 'add pagan nation');
  await waitFor(() => on('chat-clarification').length === 1);
  fake.script(NORMAL, fake.sse('A closure keeps its scope.'));
  speech.emit('transcription', 'What is a closure?');
  await waitFor(() => shown.length === 1);
  assert.equal(on('chat-clarification-expired', 'chat').length, 1);
  fake.reset();
  await ask('Explain hoisting', 'Hoisting moves declarations.');
  assert.equal(lastUserText(fake.requests.find(r => r.kind === 'stream')), 'Explain hoisting', 'a later chat message is sent as typed');
});

test('normal interviewer answers are never held as a question: they stream in full', async () => {
  speech.manual = true;
  const cases = [
    ['Closures', ' keep their scope.'],
    ['C', 'LI tools help.'],
    ['CL', 'ARIFYING: the event loop runs tasks.'],
    ['**Under', 'standing**\n', 'Reverse it in place.'],
    ['**Understanding** reverse', ' it in place.'],
    ['HEARD: virtual dumb → virtual DOM\n', 'The virtual DOM is a tree.'],
  ];
  for (const parts of cases) {
    sent.length = 0;
    shown.length = 0;
    fake.script(NORMAL, fake.sse(...parts));
    speech.emit('transcription', `question ${parts[0]}`);
    await waitFor(() => shown.length === 1);
    const body = parts[0].startsWith('HEARD:') ? parts.slice(1).join('') : parts.join('');
    assert.equal(on('transcription-llm-response-chunk', 'overlay').map(s => s.data.delta).join(''), body, JSON.stringify(parts));
    assert.equal(on('chat-clarification').length, 0, JSON.stringify(parts));
  }
});

test('My Microphone goes to the chat input box, never to Gemini; meeting audio still answers', async () => {
  speech.emit('transcription', 'Can you explain closures?', { source: 'mic' });
  await new Promise(r => setTimeout(r, 1000));
  assert.deepEqual(on('mic-transcript-to-input', 'chat').map(s => s.data), [{ text: 'Can you explain closures?' }]);
  assert.equal(on('transcription-received').length, 0, 'not shown as a meeting transcript');
  assert.equal(fake.requests.length, 0, 'mic speech is not sent to Gemini');

  fake.script(NORMAL, fake.sse('Meeting answer.'));
  speech.emit('transcription', 'What is a closure?', { source: 'meeting' });
  await waitFor(() => shown.length === 1, 4000);
  assert.equal(on('mic-transcript-to-input').length, 1, 'meeting audio does not go to the input box');
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

test('expansion on an answer main no longer holds: rebuilt from the overlay\'s answer text + session question', async () => {
  await ask('What is a closure?', 'A closure captures scope.');
  assert.deepEqual(await invoke('request-more-details', 'evicted-id', 'deep'), { ok: false, reason: 'unavailable' }, 'no answer text → unavailable (old behaviour)');
  fake.reset();
  fake.script(REASONING, fake.sse('Deeper.'));
  const r = await invoke('request-more-details', 'evicted-id', 'deep', { answer: 'A closure captures scope.' });
  assert.equal(r.ok, true);
  await waitFor(() => shown.some(s => s.metadata.parentMessageId === 'evicted-id'));
  const body = fake.requests[0].body;
  assert.match(body.contents[0].parts[0].text, /What is a closure\?/, 'original question found in session memory');
  assert.equal(body.contents[1].parts[0].text, 'A closure captures scope.');
  assert.equal((await invoke('request-more-details', 'evicted-id', 'deep', { answer: 'A closure captures scope.' })).reason, 'duplicate');
});

test('expansion rebuild after the session was cleared: answer only, still works; convert allowed', async () => {
  await ask('Debounced search in Vue', VUE);
  await invoke('clear-session-memory');
  fake.reset();
  fake.script(NORMAL, fake.sse('Converted.'));
  const r = await invoke('request-more-details', 'gone-id', 'convert:vue-options-cdn', { answer: VUE });
  assert.equal(r.ok, true);
  await waitFor(() => shown.some(s => s.metadata.parentMessageId === 'gone-id'));
  assert.match(fake.requests[0].body.contents[0].parts[0].text, /question not available/);
});

test('More details on a correction ("I meant for speaker") sends the Speeqr notes: the record keeps the question before it', async () => {
  await ask('How was the back end linked with the frontend?', 'At Rakuten GORA the frontend talked to a BFF.');
  const meta = await ask('I meant for speaker.', 'Speeqr was built on a React Native architecture.');
  fake.reset();
  fake.script(NORMAL, fake.sse('Deeper.'));
  assert.equal((await invoke('request-more-details', meta.messageId, 'details')).ok, true);
  await waitFor(() => shown.some(s => s.metadata.parentMessageId === meta.messageId));
  assert.match(fake.requests[0].body.contents[0].parts[0].text, /talks to the backend \(React Native client\)/);
});

test('a reasoning answer ending in IMPLEMENT: — the line goes to chat as an offer, never into the answer or history', async () => {
  fake.script(NORMAL, fake.sse('- I kept the guard in one computed.\n- A `safeCount` computed is more Vue-like.\nIMPLE', 'MENT: loop with `v-for="i in safeCount"`'));
  await invoke('send-chat-message', "Why don't you use SafeCount?");
  await waitFor(() => shown.length === 1);
  const body = '- I kept the guard in one computed.\n- A `safeCount` computed is more Vue-like.';
  assert.equal(shown[0].content, body);
  assert.equal(on('transcription-llm-response-chunk').map(s => s.data.delta).join('').trim(), body);
  assert.deepEqual(on('chat-implement-offer', 'chat').map(s => s.data.text), ['loop with `v-for="i in safeCount"`']);
  assert.deepEqual(turns().map(e => e.content), ["Why don't you use SafeCount?", body]);
});

test('interviewer answer with an IMPLEMENT line: stripped from the overlay, offered in chat', async () => {
  speech.manual = true;
  fake.script(NORMAL, fake.sse('A watcher would add state; computed is derived.\n', '**IMPLEMENT:** keep the computed'));
  speech.emit('transcription', "Why didn't you use a watcher?");
  await waitFor(() => shown.length === 1);
  assert.equal(shown[0].content, 'A watcher would add state; computed is derived.');
  assert.equal(on('transcription-llm-response-chunk', 'overlay').map(s => s.data.delta).join('').trim(), 'A watcher would add state; computed is derived.');
  assert.deepEqual(on('chat-implement-offer', 'chat').map(s => s.data.text), ['keep the computed']);
});

test('answers without an IMPLEMENT line send no offer', async () => {
  fake.script(NORMAL, fake.sse('**Implementation**\n- (1) Implements it.'));
  await invoke('send-chat-message', 'What is v-for?');
  await waitFor(() => shown.length === 1);
  assert.equal(shown[0].content, '**Implementation**\n- (1) Implements it.');
  assert.equal(on('chat-implement-offer').length, 0);
});
