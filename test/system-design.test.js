// System design round mode end to end through main.js (fake Electron, fake
// Gemini network): toggle, hidden REQ block, requirements card broadcasts,
// "Build design" on the reasoning chain, follow-ups carrying the diagram,
// and mode off leaving requests exactly as they were.
const env = require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const { installElectron, preload } = require('./helpers/electron-stub');
const fake = require('./helpers/fake-gemini');

const electron = installElectron(env.TMP);

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
const { promptLoader } = env.req('prompt-loader.js');

const sent = [];
const shown = [];
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

async function waitFor(pred, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = pred();
    if (v) return v;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('timed out waiting');
}
const on = (channel) => sent.filter(s => s.channel === channel);
const lastState = () => { const s = on('system-design-state'); return s.length ? s[s.length - 1].data : null; };
const turns = () => session.getConversationHistory(50).filter(e => e.role !== 'system');
const streamReqs = () => fake.requests.filter(r => r.kind === 'stream');
const lastReq = () => streamReqs()[streamReqs().length - 1].body;
const systemText = (body) => body.systemInstruction.parts[0].text;
const userTurn = (body) => body.contents[body.contents.length - 1].parts[0].text;

async function ask(question, model, ...pieces) {
  fake.script(model, fake.sse(...pieces));
  const before = shown.length;
  await invoke('send-chat-message', question);
  return waitFor(() => shown.length > before && shown[shown.length - 1]);
}

const STAGE1 = ['**Ask these:**\n1. Web or mobile?\n2. How many bookings per day?\n\n**Assuming:**\n- Web + mobile\n\nRE', 'Q:\n+ FR: book a tee time\n~ NFR: ~1M users\n! two players, same slot\n? Web or mobile?'];
const DESIGN = '### Requirements\n**Functional**\n- book a tee time\n### High-level design\n```mermaid\nflowchart TD\n  subgraph Clients\n    W["(1) Web app"]\n  end\n  W -->|"REST"| API["(2) Booking API"]\n  %% (2) why: stateless, scales out\n  API --> DB[("(3) Postgres")]\n```\nA booking goes app → API → Postgres.\n### Components\n- (1) Web app — what: Next.js\n- (2) Booking API — what: REST\n- (3) Postgres — what: bookings';

test.before(() => {
  fake.install(llm);
  llm.delay = async () => {};
  config.set('llm.gemini.maxRetries', 1);
});
test.after(() => fake.uninstall());
test.beforeEach(async () => {
  fake.reset();
  modelHealth.reset();
  await invoke('toggle-system-design', false);
  await invoke('clear-session-memory');
  await invoke('save-settings', { resumeProfile: 'fullstack' });
  sent.length = 0;
  shown.length = 0;
});

test('mode off (and after on → off): system prompt and user turn are exactly as without the feature', async () => {
  const before = promptLoader.getSkillPrompt('fullstack');
  assert.doesNotMatch(before, /System design round mode/);
  await invoke('toggle-system-design', true);
  assert.match(promptLoader.getSkillPrompt('fullstack'), /System design round mode \(ON\)/);
  await invoke('toggle-system-design', false);
  assert.equal(promptLoader.getSkillPrompt('fullstack'), before);

  const final = await ask('What is a closure?', NORMAL, 'A closure keeps its scope.\nREQ: is not special when off');
  assert.equal(final.content, 'A closure keeps its scope.\nREQ: is not special when off', 'no stripping when the mode is off');
  assert.equal(userTurn(lastReq()), 'What is a closure?');
  assert.doesNotMatch(systemText(lastReq()), /System design/);
});

test('gathering: REQ block never reaches the overlay or history; card is broadcast; stage-1 prompt + playbook sent', async () => {
  const st0 = await invoke('toggle-system-design', true);
  assert.equal(st0.on, true);
  assert.equal(st0.stage, 'clarify');
  const final = await ask('Design a golf course booking system', NORMAL, ...STAGE1);

  const streamed = on('transcription-llm-response-chunk').map(s => s.data.delta).join('');
  assert.doesNotMatch(streamed, /REQ|FR: book/, 'streamed text has no REQ block');
  assert.doesNotMatch(final.content, /REQ|FR: book/);
  assert.match(final.content, /\*\*Ask these:\*\*/);
  const model = turns().filter(e => e.role === 'model').pop();
  assert.doesNotMatch(model.content, /REQ:/, 'history keeps only the visible answer');

  const st = lastState();
  assert.equal(st.problem, 'Design a golf course booking system');
  assert.deepEqual(st.requirements.confirmed, ['FR: book a tee time']);
  assert.deepEqual(st.requirements.assuming, ['NFR: ~1M users']);
  assert.deepEqual(st.requirements.edge, ['two players, same slot']);

  const body = lastReq();
  assert.match(systemText(body), /Stage now: requirement gathering/);
  assert.match(systemText(body), /playbook: Fullstack/);
  assert.match(userTurn(body), /Requirements so far:\nnone yet/);

  // Next turn carries the card; "REQ: same" keeps it.
  await ask('What is the CAP theorem?', NORMAL, 'CAP says…\n\nREQ: same');
  assert.match(userTurn(lastReq()), /Requirements so far:\n\+ FR: book a tee time\n~ NFR: ~1M users/);
  assert.deepEqual(lastState().requirements.confirmed, ['FR: book a tee time']);
});

test('voice in gathering stage: REQ stripped from the stream and the answer, card updated', async () => {
  await invoke('toggle-system-design', true);
  fake.script(NORMAL, fake.sse('**Noted:** mobile only, 1M users.\n**Ask next:** peak hours?\n', 'REQ:\n+ NFR: mobile only\n+ NFR: 1M users'));
  speech.emit('transcription', "It's mobile only, about a million users.");
  await waitFor(() => shown.length === 1, 5000);
  const streamed = on('transcription-llm-response-chunk').map(s => s.data.delta).join('');
  assert.doesNotMatch(streamed, /REQ/);
  assert.doesNotMatch(shown[0].content, /REQ/);
  assert.deepEqual(lastState().requirements.confirmed, ['NFR: mobile only', 'NFR: 1M users']);
});

test('Build design: reasoning chain, design prompt, diagram kept for follow-ups on the normal chain', async () => {
  await invoke('toggle-system-design', true);
  await ask('Design a golf course booking system', NORMAL, ...STAGE1);

  fake.script(REASONING, fake.sse(DESIGN));
  const before = shown.length;
  const res = await invoke('build-system-design');
  assert.equal(res.success, true);
  await waitFor(() => shown.length > before);
  const req = streamReqs().filter(r => r.model === REASONING).pop();
  assert.ok(req, 'design request went to the reasoning model');
  assert.equal(req.body.generationConfig.thinkingConfig.thinkingLevel, 'medium');
  assert.match(systemText(req.body), /Stage now: design built/);
  assert.match(userTurn(req.body), /^Build the design now for: Design a golf course booking system/);
  assert.match(userTurn(req.body), /\+ FR: book a tee time/);
  const st = lastState();
  assert.equal(st.stage, 'built');
  assert.equal(st.hasDesign, true);
  assert.match(shown[shown.length - 1].content, /```mermaid/);

  // A follow-up runs on the normal chain and carries the current diagram.
  await ask('How do you prevent double booking?', NORMAL, 'A unique constraint.\n```mermaid\nflowchart TD\n  API --> L["(4) Redis lock"]:::changed\n```\n### Components\n- (4) NEW: Redis lock — what: hold');
  const follow = lastReq();
  assert.equal(streamReqs().pop().model, NORMAL);
  assert.match(userTurn(follow), /Current diagrams \(latest versions/);
  assert.equal(req.body.generationConfig.maxOutputTokens, 24576, 'build gets more output room than Deep reasoning');
  assert.match(userTurn(follow), /API\["\(2\) Booking API"\]/);
  assert.equal(lastState().designs, 2);
  assert.match(userTurn(lastReq()), /Components so far:/);
});

test('Build design before any problem statement is refused (nothing sent)', async () => {
  await invoke('toggle-system-design', true);
  const res = await invoke('build-system-design');
  assert.equal(res.success, false);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(fake.requests.length, 0, 'no request: the model would invent a problem');
  assert.equal(lastState().stage, 'clarify');
});

test('a failed build goes back to requirement gathering', async () => {
  await invoke('toggle-system-design', true);
  await ask('Design a URL shortener', NORMAL, '**Ask these:**\n1. Custom aliases?\n', 'REQ:\n~ FR: shorten URLs');
  // Nothing scripted for any model: every attempt 503s.
  await invoke('build-system-design');
  await waitFor(() => on('llm-error').length || (lastState() && lastState().stage === 'clarify' && on('system-design-state').length >= 3), 8000);
  await waitFor(() => lastState().stage === 'clarify', 8000);
  assert.deepEqual(lastState().requirements.assuming, ['FR: shorten URLs'], 'requirements kept');
});

test('switching the mode off and on keeps the round (requirements, problem, Build design)', async () => {
  await invoke('toggle-system-design', true);
  await ask('Design a URL shortener', NORMAL, '**Ask these:**\n1. Custom aliases?\n', 'REQ:\n~ FR: shorten URLs');
  await invoke('toggle-system-design', false);
  assert.equal(lastState().on, false);
  const off = await ask('What is a closure?', NORMAL, 'A closure keeps its scope.');
  assert.doesNotMatch(systemText(lastReq()), /System design/, 'paused: requests are normal');
  assert.equal(off.content, 'A closure keeps its scope.');
  const st = await invoke('toggle-system-design', true);
  assert.equal(st.problem, 'Design a URL shortener');
  assert.deepEqual(st.requirements.assuming, ['FR: shorten URLs']);
  fake.script(REASONING, fake.sse('### Summary\nShort links.'));
  const before = shown.length;
  assert.equal((await invoke('build-system-design')).success, true, 'Build design still works after the pause');
  await waitFor(() => shown.length > before);
  assert.equal(lastState().stage, 'built');
});

test('playbook follows the profile; clearing history resets the round but keeps the mode on', async () => {
  await invoke('save-settings', { resumeProfile: 'android' });
  await invoke('toggle-system-design', true);
  await ask('Design an offline-first notes app', NORMAL, '**Ask these:**\n1. Sync across devices?\n', 'REQ:\n~ FR: offline notes');
  assert.match(systemText(lastReq()), /playbook: Android/);
  assert.deepEqual(lastState().requirements.assuming, ['FR: offline notes']);
  await invoke('clear-session-memory');
  const st = lastState();
  assert.equal(st.on, true);
  assert.deepEqual(st.requirements.assuming, []);
  assert.equal(st.problem, '');
});
