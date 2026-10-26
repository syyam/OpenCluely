// Escalating skips, probe-managed models and the background monitor
// (src/core/model-health.js + src/services/model-monitor.js). The monitor is
// driven with a fake LLM (scripted probe results) and a fake clock.
const env = require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');

const health = env.req('src/core/model-health');
const { ModelMonitor } = env.req('src/services/model-monitor');

const MIN = 60 * 1000;
const T = Date.UTC(2026, 8, 29, 3, 0, 0);
let t = T;
const OVERLOADED = new Error('HTTP 503 UNAVAILABLE high demand');
const SILENT = Object.assign(new Error('No response within 8s (first-chunk timeout)'), { firstChunkTimeout: true });
const CHAIN = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];

/** Fake LLM: probe results scripted per model ({ok} or an Error to record). */
function fakeLlm(script = {}) {
  const probes = [];
  return {
    probes,
    isInitialized: true,
    lastModel: null,
    _modelsToTry: () => [...CHAIN],
    async probeModel(model) {
      probes.push(model);
      const r = (script[model] || []).shift();
      if (!r || r === 'ok') { health.recordSuccess(model); return { ok: true, ms: 800 }; }
      if (r === 'offline') return { ok: false, error: 'ECONNRESET', recorded: false };
      health.recordFailure(model, r);
      return { ok: false, error: r.message, recorded: true };
    },
  };
}

function monitor(llm) {
  const m = new ModelMonitor(llm);
  m.now = () => t;
  health.setProbeModels(CHAIN);
  return m;
}

test.beforeEach(() => { t = T; health._setNow(() => t); health.reset(); });
test.after(() => health._setNow(null));

// ── model-health ──

test('overloaded/silent skips grow while a model keeps failing: 2 → 5 → 10 → 20 → 30 → 30 min', () => {
  const lengths = [];
  for (let i = 0; i < 6; i++) lengths.push((health.recordFailure('m', OVERLOADED).until - t) / MIN);
  assert.deepEqual(lengths, [2, 5, 10, 20, 30, 30]);
  assert.equal((health.recordFailure('s', SILENT).until - t) / MIN, 3, 'silent starts at 3 min');
  assert.equal((health.recordFailure('s', SILENT).until - t) / MIN, 5);
});

test('a success resets the ladder', () => {
  health.recordFailure('m', OVERLOADED);
  health.recordFailure('m', OVERLOADED);
  health.recordSuccess('m');
  assert.equal((health.recordFailure('m', OVERLOADED).until - t) / MIN, 2);
});

test('quota and retired skips are not escalated', () => {
  health.recordFailure('m', OVERLOADED);
  health.recordFailure('m', OVERLOADED);
  const minute = health.recordFailure('q', new Error('HTTP 429 quota. Please retry in 30s.'));
  assert.equal(minute.until - t, 30000);
});

test('probe-managed model stays skipped after its skip ends, until a success', () => {
  health.setProbeModels(['managed']);
  health.recordFailure('managed', OVERLOADED);
  health.recordFailure('plain', OVERLOADED);
  t += 2 * MIN + 1;
  assert.equal(health.status('plain'), null, 'unmanaged: back on its own (old behaviour)');
  assert.equal(health.status('managed').awaitingProbe, true);
  assert.deepEqual(health.dueForProbe(), ['managed']);
  assert.deepEqual(health.order(['managed', 'plain']), ['plain'], 'still skipped for real questions');
  health.recordSuccess('managed');
  assert.equal(health.status('managed'), null);
  assert.deepEqual(health.dueForProbe(), []);
});

test('everything skipped: the model waiting for a probe is tried first (never an empty list)', () => {
  health.setProbeModels(['a', 'b']);
  health.recordFailure('a', OVERLOADED);
  health.recordFailure('b', OVERLOADED);
  t += 2 * MIN + 1;
  health.recordFailure('b', OVERLOADED); // b failed again → skipped 5 more min
  assert.deepEqual(health.order(['a', 'b']), ['a', 'b']);
});

test('snapshot and change notifications', () => {
  const seen = [];
  const off = health.onChange(() => seen.push(health.snapshot().map(s => s.model)));
  health.recordFailure('m', OVERLOADED);
  health.recordSuccess('m');
  off();
  health.recordFailure('x', OVERLOADED);
  assert.deepEqual(seen, [['m'], []]);
});

// ── monitor ──

test('startup: probes the primary; stops at the first model that answers', async () => {
  const llm = fakeLlm({ 'gemini-3.5-flash-lite': [OVERLOADED] });
  const m = monitor(llm);
  assert.equal(await m.probeChain(), 'gemini-3.1-flash-lite');
  assert.deepEqual(llm.probes, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  const st = m.status();
  assert.equal(st.primary, 'gemini-3.5-flash-lite');
  assert.equal(st.next, 'gemini-3.1-flash-lite', 'questions go to the backup');
  assert.equal(st.skipped[0].reason, 'overloaded');
});

test('startup: a healthy primary is the only request', async () => {
  const llm = fakeLlm();
  const m = monitor(llm);
  await m.probeChain();
  assert.deepEqual(llm.probes, ['gemini-3.5-flash-lite']);
  assert.equal(m.status().next, 'gemini-3.5-flash-lite');
  assert.equal(m.status().primaryChecked.ok, true);
});

test('startup leaves a model that is out of quota for the day alone', async () => {
  health.recordFailure('gemini-3.5-flash-lite', new Error('HTTP 429 RESOURCE_EXHAUSTED quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
  const llm = fakeLlm();
  await monitor(llm).probeChain();
  assert.deepEqual(llm.probes, ['gemini-3.1-flash-lite']);
});

test('tick: nothing is probed while the skip runs; probed once it ends; back on success', async () => {
  const llm = fakeLlm({ 'gemini-3.5-flash-lite': [OVERLOADED, 'ok'] });
  const m = monitor(llm);
  await m.probeChain(); // 3.5 fails (2 min), 3.1 ok
  llm.probes.length = 0;
  t += MIN;
  await m.tick();
  assert.deepEqual(llm.probes, [], 'still inside the 2 min skip');
  t += MIN + 1;
  await m.tick();
  assert.deepEqual(llm.probes, ['gemini-3.5-flash-lite']);
  assert.equal(m.status().next, 'gemini-3.5-flash-lite', 'primary back');
});

test('tick: a failed probe escalates the skip (5 min next), so checks get rarer', async () => {
  const llm = fakeLlm({ 'gemini-3.5-flash-lite': [OVERLOADED, SILENT, 'ok'] });
  const m = monitor(llm);
  await m.probeChain();
  t += 2 * MIN + 1;
  await m.tick(); // probe fails → strike 2 → 5 min
  assert.equal((health.status('gemini-3.5-flash-lite').until - t) / MIN, 5);
  llm.probes.length = 0;
  t += 4 * MIN;
  await m.tick();
  assert.deepEqual(llm.probes, []);
  t += MIN + 1;
  await m.tick();
  assert.deepEqual(llm.probes, ['gemini-3.5-flash-lite']);
  assert.equal(health.status('gemini-3.5-flash-lite'), null);
});

test('tick: an offline probe is retried after a minute, not every tick', async () => {
  const llm = fakeLlm({ 'gemini-3.5-flash-lite': [OVERLOADED, 'offline', 'ok'] });
  const m = monitor(llm);
  await m.probeChain();
  t += 2 * MIN + 1;
  await m.tick(); // offline
  llm.probes.length = 0;
  t += 30 * 1000;
  await m.tick();
  assert.deepEqual(llm.probes, []);
  t += 31 * 1000;
  await m.tick();
  assert.deepEqual(llm.probes, ['gemini-3.5-flash-lite']);
});

test('"Try now" probes immediately, even inside the skip; status events fire', async () => {
  const llm = fakeLlm({ 'gemini-3.5-flash-lite': [OVERLOADED, 'ok'] });
  const m = monitor(llm);
  const events = [];
  m.on('status', s => events.push(s));
  await m.probeChain();
  const r = await m.probe('gemini-3.5-flash-lite');
  assert.equal(r.ok, true);
  assert.equal(m.status().next, 'gemini-3.5-flash-lite');
  assert.ok(events.some(s => s.probing.includes('gemini-3.5-flash-lite')), 'probing state shown');
});

test('no API key: nothing probed', async () => {
  const llm = fakeLlm();
  llm.isInitialized = false;
  const m = monitor(llm);
  assert.equal(await m.probeChain(), null);
  await m.tick();
  assert.deepEqual(llm.probes, []);
});

// ── reasoning chain (Deep reasoning / Optimized) ──

const R_PRIMARY = 'gemini-3.8-flash';
const R_BACKUP = 'gemini-3.6-flash';

function reasoningMonitor(llm) {
  const m = new ModelMonitor(llm);
  m.now = () => t;
  health.setProbeModels(m.allModels());
  return m;
}

test('startup: the reasoning primary is probed too, after the normal chain; lite models are not probed twice', async () => {
  const llm = fakeLlm();
  const m = reasoningMonitor(llm);
  const r = await m.probeStartup();
  assert.deepEqual(r, { normal: 'gemini-3.5-flash-lite', reasoning: R_PRIMARY });
  assert.deepEqual(llm.probes, ['gemini-3.5-flash-lite', R_PRIMARY]);
  assert.equal(m.status().reasoning.next, R_PRIMARY);
  assert.equal(m.status().reasoning.primaryChecked.ok, true);
});

test('startup: a busy reasoning primary is skipped before any Deep click; the next flash model is probed', async () => {
  const llm = fakeLlm({ [R_PRIMARY]: [OVERLOADED] });
  const m = reasoningMonitor(llm);
  const r = await m.probeStartup();
  assert.equal(r.reasoning, R_BACKUP);
  assert.deepEqual(llm.probes, ['gemini-3.5-flash-lite', R_PRIMARY, R_BACKUP]);
  const st = m.status().reasoning;
  assert.equal(st.next, R_BACKUP, 'Deep reasoning goes straight to the backup');
  assert.equal(st.skipped[0].model, R_PRIMARY);
});

test('startup: both flash reasoning models busy → the lite backup is reused without a second probe', async () => {
  const llm = fakeLlm({ [R_PRIMARY]: [OVERLOADED], [R_BACKUP]: [OVERLOADED] });
  const m = reasoningMonitor(llm);
  const r = await m.probeStartup();
  assert.equal(r.reasoning, 'gemini-3.5-flash-lite');
  assert.deepEqual(llm.probes, ['gemini-3.5-flash-lite', R_PRIMARY, R_BACKUP], '3.5-flash-lite already answered in the normal chain');
  assert.equal(m.status().reasoning.next, 'gemini-3.5-flash-lite');
});

test('reasoning primary stays skipped after its skip ends, until a background probe answers', async () => {
  const llm = fakeLlm({ [R_PRIMARY]: [OVERLOADED, SILENT, 'ok'] });
  const m = reasoningMonitor(llm);
  await m.probeStartup(); // 3.8 overloaded → 2 min
  t += 2 * MIN + 1;
  assert.equal(health.order(m.reasoningChain())[0], R_BACKUP, 'skip ended, but no probe yet: still skipped');
  llm.probes.length = 0;
  await m.tick(); // probe fails (silent) → 5 min
  assert.deepEqual(llm.probes, [R_PRIMARY]);
  assert.equal((health.status(R_PRIMARY).until - t) / MIN, 5, 'escalated like the normal chain');
  t += 5 * MIN + 1;
  await m.tick(); // ok
  assert.equal(m.status().reasoning.next, R_PRIMARY, 'back after a successful probe');
});
