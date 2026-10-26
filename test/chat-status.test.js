// Model status line in the chat window (chat.html), driven by the
// 'model-status' events main.js broadcasts from src/services/model-monitor.js.
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let ui;

async function loadChat() {
  const listeners = {};
  const calls = [];
  const errors = [];
  const api = new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop.startsWith('on')) return (cb) => { (listeners[prop] = listeners[prop] || []).push(cb); };
      return (...args) => { calls.push([prop, ...args]); return Promise.resolve(); };
    },
  });
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = await JSDOM.fromFile(path.join(ROOT, 'chat.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.electronAPI = api;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
    },
  });
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') resolve();
    else dom.window.addEventListener('load', resolve);
  });
  const $ = (id) => dom.window.document.getElementById(id);
  return {
    dom, calls, errors,
    status(st) { (listeners.onModelStatus || []).forEach(cb => cb({}, st)); },
    emit(name, data) { (listeners[name] || []).forEach(cb => cb({}, data)); },
    $,
    text: () => $('modelStatusText').textContent,
    dot: () => $('modelDot').className,
    button: () => $('modelRetryBtn'),
  };
}

const CHAIN = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
const base = (over = {}) => ({ primary: CHAIN[0], chain: CHAIN, next: CHAIN[0], lastUsed: null, skipped: [], probing: [], primaryChecked: null, now: Date.now(), ...over });

test.before(async () => { ui = await loadChat(); });
test.after(() => ui.dom.window.close());

test('healthy primary: green dot, model name, no button', () => {
  ui.status(base({ primaryChecked: { ok: true, ms: 900 } }));
  assert.equal(ui.text(), '3.5-flash-lite');
  assert.match(ui.dot(), /\bok\b/);
  assert.equal(ui.button().hidden, true);
});

test('start-up check running: "Checking …"', () => {
  ui.status(base({ probing: [CHAIN[0]] }));
  assert.equal(ui.text(), 'Checking 3.5-flash-lite…');
  assert.match(ui.dot(), /\bwarn\b/);
});

test('primary overloaded: shows the backup in use, reason, countdown and a Try-now button', () => {
  const now = Date.now();
  ui.status(base({ next: CHAIN[1], now, skipped: [{ model: CHAIN[0], reason: 'overloaded', until: now + 5 * 60000, awaitingProbe: false, strike: 2 }] }));
  assert.equal(ui.text(), 'Using 3.1-flash-lite · 3.5-flash-lite overloaded, next check in 5m');
  assert.match(ui.dot(), /\bwarn\b/);
  assert.equal(ui.button().hidden, false);
  assert.equal(ui.button().textContent, 'Try 3.5-flash-lite now');
});

test('Try now → probe-model IPC for the primary; button disabled while it runs', () => {
  ui.calls.length = 0;
  ui.button().click();
  assert.deepEqual(ui.calls.filter(c => c[0] === 'probeModel'), [['probeModel', CHAIN[0]]]);
  assert.equal(ui.button().disabled, true);
});

test('skip ended, probe pending / running', () => {
  const now = Date.now();
  const skip = { model: CHAIN[0], reason: 'silent', until: now - 1000, awaitingProbe: true, strike: 1 };
  ui.status(base({ next: CHAIN[1], now, skipped: [skip] }));
  assert.equal(ui.text(), 'Using 3.1-flash-lite · 3.5-flash-lite not responding, checking soon');
  ui.status(base({ next: CHAIN[1], now, skipped: [skip], probing: [CHAIN[0]] }));
  assert.match(ui.text(), /checking now…$/);
  assert.equal(ui.button().textContent, 'Checking…');
});

test('back to healthy hides the button again; no script errors', () => {
  ui.status(base({ primaryChecked: { ok: true, ms: 700 }, lastUsed: CHAIN[0] }));
  assert.equal(ui.text(), '3.5-flash-lite');
  assert.equal(ui.button().hidden, true);
  assert.deepEqual(ui.errors.map(e => e.message), []);
});

test('Deep reasoning: nothing extra while its primary is healthy; its backup shown while 3.6-flash is skipped', () => {
  const now = Date.now();
  const R = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const reasoning = (over = {}) => ({ primary: R[0], chain: R, next: R[0], skipped: [], primaryChecked: { ok: true, ms: 2500 }, ...over });
  ui.status(base({ now, primaryChecked: { ok: true, ms: 700 }, reasoning: reasoning() }));
  assert.equal(ui.text(), '3.5-flash-lite');
  assert.match(ui.$('modelBar').title, /Deep reasoning: 3\.6-flash/);
  const skip = { model: R[0], reason: 'overloaded', until: now + 10 * 60000, awaitingProbe: false, strike: 3 };
  ui.status(base({ now, primaryChecked: { ok: true, ms: 700 }, reasoning: reasoning({ next: R[1], skipped: [skip] }) }));
  assert.equal(ui.text(), '3.5-flash-lite · Deep: using 3.5-flash-lite, 3.6-flash overloaded, next check in 10m');
  assert.deepEqual(ui.errors.map(e => e.message), []);
});

// ── Chat keeps questions and statuses; answers live in the response window ──
const messages = () => [...ui.dom.window.document.querySelectorAll('#chatMessages .message')];

test('a finished answer is a status line, not an answer bubble (once per answer)', () => {
  ui.$('chatMessages').innerHTML = '';
  const answer = { response: 'A closure captures scope.\n```js\nconst f = () => x\n```', messageId: 'chat-1' };
  ui.emit('onTranscriptionLlmResponse', answer);
  ui.emit('onTranscriptionLlmResponse', answer);
  ui.emit('onLlmResponse', { response: 'Screenshot answer' });
  assert.equal(ui.dom.window.document.querySelectorAll('.message.assistant, pre').length, 0, 'no answer text or code in chat');
  assert.deepEqual(messages().map(m => m.className), ['message system', 'message system']);
  assert.match(messages()[0].textContent, /Answered in response window/);
});

test('an answer error stops the spinner and shows the error', () => {
  ui.$('chatMessages').innerHTML = '';
  ui.emit('onTranscriptionReceived', { text: 'What is a closure?' }); // spinner follows a transcript
  return new Promise(r => setTimeout(r, 600)).then(() => {
    assert.ok(ui.$('thinking-indicator'), 'spinner shown');
    ui.emit('onLlmError', { error: 'quota' });
    assert.equal(ui.$('thinking-indicator'), null);
    assert.match(messages().pop().textContent, /Answer failed: quota/);
  });
});

test('My Microphone text is appended to the input box and not sent', () => {
  ui.calls.length = 0;
  const input = ui.$('messageInput');
  input.value = '';
  ui.emit('onMicTranscriptToInput', { text: 'Explain closures' });
  ui.emit('onMicTranscriptToInput', { text: 'with an example' });
  assert.equal(input.value, 'Explain closures with an example');
  assert.equal(ui.calls.filter(c => c[0] === 'sendChatMessage').length, 0);
  assert.deepEqual(ui.errors.map(e => e.message), []);
});

test('"Did you mean…?" shows as a chat bubble and changes the input hint until the next send', async () => {
  ui.$('chatMessages').innerHTML = '';
  const input = ui.$('messageInput');
  input.value = '';
  input.dispatchEvent(new ui.dom.window.Event('input')); // box cleared by the user
  const defaultHint = input.placeholder;
  ui.emit('onChatClarification', { text: 'Did you mean `.not`?' });
  const bubble = messages().pop();
  assert.equal(bubble.className, 'message clarify');
  assert.equal(bubble.querySelector('.suggestion-chip').textContent, '.not');
  assert.match(input.placeholder, /Reply yes/);
  input.value = 'yes';
  ui.calls.length = 0;
  ui.$('sendButton').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(JSON.stringify(ui.calls.filter(c => c[0] === 'sendChatMessage')), JSON.stringify([['sendChatMessage', 'yes', { spoken: false }]])); // jsdom objects are from another realm
  assert.equal(input.placeholder, defaultHint);
});

test('"Did you mean…?" guesses are buttons: a click sends that guess once, and the input box is left alone', async () => {
  ui.$('chatMessages').innerHTML = '';
  const input = ui.$('messageInput');
  input.value = 'half typed';
  ui.emit('onChatClarification', { text: 'Did you mean `useMemo`, `useCallback` or `React.memo`?' });
  const bubble = messages().pop();
  const chips = [...bubble.querySelectorAll('.suggestion-chip')];
  assert.deepEqual(chips.map(c => c.textContent), ['useMemo', 'useCallback', 'React.memo']);
  assert.match(bubble.textContent, /Did you mean useMemo, useCallback or React\.memo\?/);

  ui.calls.length = 0;
  chips[1].click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(JSON.stringify(ui.calls.filter(c => c[0] === 'sendChatMessage')), JSON.stringify([['sendChatMessage', 'useCallback', { spoken: false }]]));
  assert.equal(messages().pop().textContent.includes('useCallback'), true, 'shown as the user message');
  assert.equal(input.value, 'half typed');
  assert.ok(!/Reply yes/.test(input.placeholder));
  assert.ok(chips.every(c => c.disabled), 'spent after one reply');
  assert.ok(chips[1].classList.contains('chosen'));

  ui.calls.length = 0;
  chips[0].click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(ui.calls.filter(c => c[0] === 'sendChatMessage').length, 0);
  input.value = '';
});

test('an interviewer "Did you mean" is labelled, and a newer interviewer question spends its buttons', () => {
  ui.$('chatMessages').innerHTML = '';
  ui.emit('onChatClarification', { text: 'Did you mean `pagination`?', source: 'voice' });
  const bubble = messages().pop();
  assert.match(bubble.textContent, /🤔 Interviewer: Did you mean pagination\?/);
  const chip = bubble.querySelector('.suggestion-chip');
  assert.equal(chip.disabled, false);
  ui.emit('onChatClarificationExpired', {});
  assert.equal(chip.disabled, true);
  assert.ok(!/Reply yes/.test(ui.$('messageInput').placeholder));
});

test('a guess without backticks is still one button; a typed reply spends the buttons', async () => {
  ui.$('chatMessages').innerHTML = '';
  ui.emit('onChatClarification', { text: 'Did you mean pagination?' });
  const chips = [...messages().pop().querySelectorAll('.suggestion-chip')];
  assert.deepEqual(chips.map(c => c.textContent), ['pagination']);
  ui.$('messageInput').value = 'no, infinite scroll';
  ui.$('sendButton').click();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(chips[0].disabled);
});

test('"Heard" notes stay plain text, not buttons', () => {
  ui.$('chatMessages').innerHTML = '';
  ui.emit('onVoiceHeardNote', { text: '"use memo" → `useMemo`' });
  const bubble = messages().pop();
  assert.equal(bubble.querySelectorAll('.suggestion-chip').length, 0);
  assert.equal(bubble.querySelector('code').textContent, 'useMemo');
});

test('a heard note with other guesses shows "Meant instead" buttons that re-ask with that term', async () => {
  ui.$('chatMessages').innerHTML = '';
  ui.emit('onVoiceHeardNote', { text: 'Next Take in Blue → Next.js | nextTick, Next.js page, `Nuxt`' });
  const note = messages().pop();
  assert.equal(note.querySelector('.message-text').textContent, '🎧 Heard "Next Take in Blue" → answered as Next.js');
  const chips = [...note.querySelectorAll('.heard-alternatives .suggestion-chip')];
  assert.deepEqual(chips.map(c => c.textContent), ['nextTick', 'Nuxt'], 'repeats of the answered term are dropped');
  ui.calls.length = 0;
  chips[0].click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(JSON.stringify(ui.calls.filter(c => c[0] === 'sendChatMessage')), JSON.stringify([['sendChatMessage', 'I meant nextTick, not Next.js', { spoken: false }]]));
  assert.ok(chips.every(c => c.disabled));
});

test('a heard note without other guesses has no buttons', () => {
  ui.$('chatMessages').innerHTML = '';
  ui.emit('onVoiceHeardNote', { text: 'V4 in Vue → v-for' });
  assert.equal(messages().pop().querySelectorAll('.suggestion-chip').length, 0);
});

test('only text filled by My Microphone is sent as spoken; clearing the box resets it', async () => {
  const input = ui.$('messageInput');
  const send = async () => { ui.calls.length = 0; ui.$('sendButton').click(); await new Promise(r => setTimeout(r, 0)); return JSON.parse(JSON.stringify(ui.calls.find(c => c[0] === 'sendChatMessage'))); }; // jsdom realm → plain

  ui.emit('onMicTranscriptToInput', { text: 'add pagan nation' });
  assert.deepEqual(await send(), ['sendChatMessage', 'add pagan nation', { spoken: true }]);

  input.value = 'typed by hand';
  assert.deepEqual(await send(), ['sendChatMessage', 'typed by hand', { spoken: false }]);

  ui.emit('onMicTranscriptToInput', { text: 'dictated' });
  input.value = '';
  input.dispatchEvent(new ui.dom.window.Event('input'));
  input.value = 'retyped';
  assert.deepEqual(await send(), ['sendChatMessage', 'retyped', { spoken: false }]);
  assert.deepEqual(ui.errors.map(e => e.message), []);
});

test('"Heard X → answered as Y" note for an interviewer answer from a guess', () => {
  ui.$('chatMessages').innerHTML = '';
  ui.emit('onVoiceHeardNote', { text: 'DotNord → `.not`' });
  const note = messages().pop();
  assert.equal(note.className, 'message heard');
  assert.equal(note.querySelector('.message-text').textContent, '🎧 Heard "DotNord" → answered as .not');
  assert.equal(note.querySelector('code').textContent, '.not');
  assert.deepEqual(ui.errors.map(e => e.message), []);
});

test('an offered code change shows "Implement this"; a click sends it as a normal follow-up', async () => {
  ui.$('chatMessages').innerHTML = '';
  ui.emit('onChatImplementOffer', { text: 'loop with `v-for="i in safeCount"`' });
  const note = messages().pop();
  assert.equal(note.className, 'message offer');
  assert.match(note.querySelector('.message-text').textContent, /^💡 Could change: loop with v-for="i in safeCount"/);
  const chip = note.querySelector('.suggestion-chip');
  assert.equal(chip.textContent, 'Implement this');
  ui.calls.length = 0;
  chip.click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(JSON.stringify(ui.calls.filter(c => c[0] === 'sendChatMessage')),
    JSON.stringify([['sendChatMessage', 'Implement it: loop with `v-for="i in safeCount"`', { spoken: false }]]));
  assert.ok(chip.disabled, 'spent after the click');
  assert.deepEqual(ui.errors.map(e => e.message), []);
});
