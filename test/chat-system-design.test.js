// Chat window (chat.html): System design toggle + pinned requirements card
// with "Build design" / "New design", driven by main's system-design-state.
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

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
    dom, calls, errors, $,
    state(st) { (listeners.onSystemDesignState || []).forEach(cb => cb({}, st)); },
  };
}

const req = (over = {}) => ({ confirmed: [], assuming: [], edge: [], out: [], next: [], ...over });
const state = (over = {}) => ({ on: true, stage: 'clarify', problem: '', requirements: req(), hasDesign: false, designs: 0, ...over });

let ui;
test.beforeEach(async () => { ui = await loadChat(); });
test.afterEach(() => {
  const errs = ui.errors.map(e => e.message);
  ui.dom.window.close();
  assert.deepEqual(errs, [], 'chat script errors');
});

test('the toggle lives in the top bar, not in chat; off hides the card, on shows the same round again', () => {
  assert.equal(ui.$('systemDesignBtn'), null);
  const round = { problem: 'Design X', requirements: req({ confirmed: ['FR: a'] }) };
  ui.state(state(round));
  assert.equal(ui.$('sdCard').hidden, false);
  ui.state(state({ ...round, on: false }));
  assert.equal(ui.$('sdCard').hidden, true);
  ui.state(state(round));
  assert.equal(ui.$('sdCard').hidden, false);
  assert.match(ui.$('sdCard').textContent, /FR: a/);
  assert.equal(ui.$('sdBuildBtn').disabled, false, 'Build design is back');
});

test('gathering: problem + requirement sections + Build design (no separate New design button)', () => {
  ui.state(state({
    problem: 'Design a golf booking system',
    requirements: req({ confirmed: ['FR: book a tee time'], assuming: ['NFR: ~1M users'], edge: ['same slot twice'], next: ['Web or mobile?'] }),
  }));
  const card = ui.$('sdCard');
  assert.equal(card.hidden, false);
  assert.match(card.textContent, /Gathering requirements — no drawing yet/);
  assert.match(card.textContent, /Design a golf booking system/);
  assert.match(card.textContent, /Confirmed.*FR: book a tee time/s);
  assert.match(card.textContent, /Assuming \(not confirmed yet\).*NFR: ~1M users/s);
  assert.match(card.textContent, /Edge cases.*same slot twice/s);
  assert.match(card.textContent, /Ask next.*Web or mobile\?/s);
  assert.ok(ui.$('sdBuildBtn'));
  assert.equal(ui.$('sdBuildBtn').disabled, false);
  assert.equal(ui.$('sdNewBtn'), null, 'the trash button already resets the round');
});

test('Build design is locked until the interviewer has given the problem', () => {
  ui.state(state());
  assert.equal(ui.$('sdBuildBtn').disabled, true);
  ui.$('sdBuildBtn').click();
  assert.equal(ui.calls.filter(c => c[0] === 'buildSystemDesign').length, 0);
  assert.match(ui.$('sdCard').textContent, /Build design unlocks then/);
  ui.state(state({ problem: 'Design a URL shortener', requirements: req({ assuming: ['FR: shorten'] }) }));
  assert.equal(ui.$('sdBuildBtn').disabled, false);
});

test('Build design: one call, shown in chat, button disabled until the state changes', () => {
  ui.state(state({ problem: 'Design X', requirements: req({ confirmed: ['FR: a'] }) }));
  ui.$('sdBuildBtn').click();
  ui.$('sdBuildBtn').click();
  assert.equal(ui.calls.filter(c => c[0] === 'buildSystemDesign').length, 1);
  assert.ok(ui.$('sdBuildBtn').disabled);
  assert.match(ui.$('chatMessages').textContent, /✅ Build design/);
  // main switches to 'built' → no Build button any more
  ui.state(state({ stage: 'built', requirements: req({ confirmed: ['FR: a'] }) }));
  assert.equal(ui.$('sdBuildBtn'), null);
  assert.match(ui.$('sdCard').textContent, /Building the design…/);
  ui.state(state({ stage: 'built', hasDesign: true, designs: 1, requirements: req({ confirmed: ['FR: a'] }) }));
  assert.match(ui.$('sdCard').textContent, /Design built — follow-ups update it/);
});

test('a failed build (back to gathering) makes Build design usable again', () => {
  ui.state(state({ problem: 'Design X' }));
  ui.$('sdBuildBtn').click();
  ui.state(state({ stage: 'built', problem: 'Design X' }));
  ui.state(state({ stage: 'clarify', problem: 'Design X' }));
  assert.equal(ui.$('sdBuildBtn').disabled, false);
});

test('sending chat messages does not disable Build design', () => {
  ui.state(state({ problem: 'Design X', requirements: req({ confirmed: ['FR: a'] }) }));
  ui.$('messageInput').value = 'hello';
  ui.$('sendButton').click();
  assert.equal(ui.$('sdBuildBtn').disabled, false);
});
