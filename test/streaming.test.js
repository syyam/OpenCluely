const env = require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./helpers/fake-gemini');

const llm = env.req('src/services/llm.service');
const config = env.req('src/core/config');
const modelHealth = env.req('src/core/model-health');

const REQ = { contents: [{ role: 'user', parts: [{ text: 'q' }] }], generationConfig: { maxOutputTokens: 4096 } };
const { textEvent: t, finishEvent, errorEvent } = fake;
const FAR = () => Date.now() + 60000;

test.before(() => {
  fake.install(llm);
  llm.delay = async () => {}; // no real backoff waits
  config.set('llm.gemini.maxRetries', 3);
});
test.after(() => fake.uninstall());
test.beforeEach(() => { fake.reset(); env.logs.length = 0; modelHealth.reset(); });

test('complete stream (STOP) resolves with the full text and logs how it finished', async () => {
  fake.script('m', fake.sse('Hello ', 'world.'));
  const pieces = [];
  assert.equal(await llm._streamRequestForModel(REQ, 'm', 'k', p => pieces.push(p)), 'Hello world.');
  assert.deepEqual(pieces, ['Hello ', 'world.']);
  const [log] = env.findLogs('Gemini stream finished');
  assert.equal(log.finishReason, 'STOP');
  assert.equal(log.maxOutputTokens, 4096);
});

test('MAX_TOKENS: text kept (a retry would hit the same limit) and a warning logged', async () => {
  fake.script('m', { sse: [t('Long '), finishEvent('answer cut', 'MAX_TOKENS')] });
  assert.equal(await llm._streamRequestForModel(REQ, 'm', 'k', null), 'Long answer cut');
  assert.equal(env.findLogs('hit maxOutputTokens').length, 1);
});

test('mid-stream error event after text → rejected as incomplete 503 (not a half answer)', async () => {
  fake.script('m', { sse: [t('Half '), t('an answer'), errorEvent(503)] });
  await assert.rejects(llm._streamRequestForModel(REQ, 'm', 'k', null),
    e => e.incompleteStream === true && /HTTP 503 \(mid-stream, after 14 chars\)/.test(e.message));
});

test('stream that closes without finishReason → rejected as incomplete', async () => {
  fake.script('m', { sse: [t('Half '), t('an answer')] });
  await assert.rejects(llm._streamRequestForModel(REQ, 'm', 'k', null),
    e => e.incompleteStream === true && /without finishReason/.test(e.message));
  assert.equal(env.findLogs('without a finishReason').length, 1);
});

test('non-200 → rejected with status and body', async () => {
  fake.script('m', { status: 429, body: errorEvent(429, 'quota') });
  await assert.rejects(llm._streamRequestForModel(REQ, 'm', 'k', null), /^Error: HTTP 429: .*quota/);
});

test('no data at all → first-chunk timeout; silence mid-answer → socket timeout, both incomplete-safe', async () => {
  fake.script('m', { stall: true });
  await assert.rejects(llm._streamRequestForModel(REQ, 'm', 'k', null, 50, 10000), e => e.firstChunkTimeout === true);
  fake.script('m', { sse: [t('Partial')], stallAfter: true });
  await assert.rejects(llm._streamRequestForModel(REQ, 'm', 'k', null, 0, 50), e => e.incompleteStream === true && /timeout/.test(e.message));
});

test('network error → rejected', async () => {
  fake.script('m', { networkError: 'ECONNRESET' });
  await assert.rejects(llm._streamRequestForModel(REQ, 'm', 'k', null), /Streaming request failed: ECONNRESET/);
});

test('a model that breaks mid-answer → shown text reset → straight to the next model', async () => {
  fake.script('A', { sse: [t('Half of A '), errorEvent()] });
  fake.script('B', fake.sse('Complete ', 'answer from B.'));
  let shown = '';
  let resets = 0;
  const out = await llm.executeStreamingRequest(REQ, d => { shown += d; }, FAR(), {
    models: ['A', 'B'], onReset: () => { resets++; shown = ''; },
  });
  assert.equal(out, 'Complete answer from B.');
  assert.equal(shown, 'Complete answer from B.', 'screen shows only the good answer');
  assert.equal(resets, 1);
  assert.deepEqual(fake.models(), ['A', 'B'], 'no same-model retry for an unavailable model');
});

test('unavailable/overloaded/retired models are skipped at once; the last model is retried', async () => {
  fake.script('A', { status: 503, body: errorEvent(503) });
  fake.script('B', { status: 404, body: errorEvent(404, 'no longer available') });
  fake.script('C', { status: 500, body: errorEvent(500, 'internal') }, fake.sse('ok'));
  assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B', 'C'] }), 'ok');
  assert.deepEqual(fake.models(), ['A', 'B', 'C', 'C']);
});

test('reset happens only when text was shown, and before giving up', async () => {
  fake.script('A', { status: 503, body: errorEvent() });
  fake.script('B', fake.sse('ok'));
  let resets = 0;
  await llm.executeStreamingRequest(REQ, () => {}, FAR(), { models: ['A', 'B'], onReset: () => resets++ });
  assert.equal(resets, 0, 'nothing was shown → nothing to clear');

  fake.reset();
  fake.script('A', { sse: [t('half'), errorEvent()] });
  fake.script('B', { sse: [t('half'), errorEvent()] }, { sse: [t('half'), errorEvent()] }, { sse: [t('half'), errorEvent()] });
  let shown = '';
  await assert.rejects(llm.executeStreamingRequest(REQ, d => { shown += d; }, FAR(), {
    models: ['A', 'B'], onReset: () => { resets++; shown = ''; },
  }));
  assert.equal(shown, '', 'no half answer left on screen after total failure');
});

test('backup models get the shorter first-chunk allowance; the primary keeps the long one', async () => {
  fake.script('A', { stall: true });
  fake.script('B', { stall: true });
  fake.script('C', fake.sse('answer'));
  const t0 = Date.now();
  const out = await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B', 'C'], firstChunkTimeoutMs: 300, backupFirstChunkTimeoutMs: 60 });
  const ms = Date.now() - t0;
  assert.equal(out, 'answer');
  assert.ok(ms >= 340 && ms < 700, `A waits 300ms, B only 60ms: took ${ms}ms`);
  const [a, b] = env.findLogs(/streaming attempt \d+ failed/).map(l => l.error);
  assert.match(a, /within 0s|within 300|first-chunk/);
  assert.match(b, /first-chunk/);
});

test('reasoning config: 20s for the primary, 10s for backups', () => {
  const r = config.get('llm.gemini.reasoning');
  assert.equal(r.firstChunkTimeoutMs, 20000);
  assert.equal(r.backupFirstChunkTimeoutMs, 10000);
});

test('time budget: no new attempt starts after the deadline', async () => {
  fake.script('A', { status: 500, body: errorEvent(500) }, fake.sse('too late'));
  await assert.rejects(llm.executeStreamingRequest(REQ, null, Date.now() - 1, { models: ['A'] }));
  assert.deepEqual(fake.models(), ['A']);
});

test('non-streaming fallback: HTTP error skips the SDK path, network error tries it', async () => {
  fake.script('gemini-3.5-flash-lite', { status: 503, body: errorEvent() });
  fake.script('gemini-3.1-flash-lite', { status: 503, body: errorEvent() });
  fake.script('gemini-3-flash-preview', { status: 503, body: errorEvent() });
  fake.script('gemini-3.1-flash-lite-preview', { status: 503, body: errorEvent() });
  await assert.rejects(llm._executeWithFallback(REQ, FAR()), /HTTP 503/);
  assert.ok(!fake.models().length || fake.requests.every(r => r.kind !== 'sdk'), 'SDK not tried after an HTTP error');

  fake.reset();
  fake.script('gemini-3.5-flash-lite', { networkError: 'ECONNRESET' }, { text: 'from sdk' });
  fake.script('gemini-3.1-flash-lite', { networkError: 'ECONNRESET' });
  fake.script('gemini-3-flash-preview', { networkError: 'ECONNRESET' });
  fake.script('gemini-3.1-flash-lite-preview', { networkError: 'ECONNRESET' });
  assert.equal(await llm._executeWithFallback(REQ, FAR()), 'from sdk');
  assert.ok(fake.requests.some(r => r.kind === 'sdk'));
});

// ── Model health: skip models known to fail right now ──
const DAILY_429 = { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota, retry in 27s', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } } };

test('a model out of daily quota is skipped on the next requests (not even tried)', async () => {
  fake.script('A', DAILY_429);
  fake.script('B', fake.sse('first'), fake.sse('second'));
  assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] }), 'first');
  assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] }), 'second');
  assert.deepEqual(fake.models(), ['A', 'B', 'B'], 'A asked once, then skipped');
  assert.equal(modelHealth.status('A').reason, 'daily-quota');
});

test('when the primary is skipped, the new first model gets the primary\'s first-chunk allowance', async () => {
  fake.script('A', DAILY_429);
  fake.script('B', fake.sse('x'));
  await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] }); // A now out for the day
  fake.reset();
  // B thinks 150ms before answering: fine with the primary's 300ms, fatal with the backup's 60ms.
  fake.script('B', { ...fake.sse('thought it through'), firstDelayMs: 150 });
  const out = await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'], firstChunkTimeoutMs: 300, backupFirstChunkTimeoutMs: 60 });
  assert.equal(out, 'thought it through');
  assert.deepEqual(fake.models(), ['B'], 'A skipped, B answered on the first try');
});

test('overloaded (503) → skipped for a while, then tried again after the cooldown', async () => {
  let t = Date.now();
  modelHealth._setNow(() => t);
  try {
    fake.script('A', { status: 503, body: errorEvent(503) });
    fake.script('B', fake.sse('b1'), fake.sse('b2'));
    await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] });
    await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] });
    assert.deepEqual(fake.models(), ['A', 'B', 'B']);
    t += 2 * 60 * 1000 + 1;
    fake.script('A', fake.sse('a is back'));
    assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] }), 'a is back');
    assert.equal(modelHealth.status('A'), null, 'success clears it');
  } finally {
    modelHealth._setNow(null);
  }
});

test('out of daily quota → back in first place after midnight Pacific, even across a restart', async () => {
  let t = Date.UTC(2026, 8, 28, 1, 0, 0); // 10:00 Japan time; reset is 07:00 UTC
  modelHealth._setNow(() => t);
  try {
    fake.script('A', DAILY_429);
    fake.script('B', fake.sse('b1'), fake.sse('b2'));
    await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] });
    t = Date.UTC(2026, 8, 28, 6, 59, 0); // one minute before the reset: still skipped
    await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] });
    assert.deepEqual(fake.models(), ['A', 'B', 'B']);
    modelHealth._reload(); // app restarted before the reset: still remembered
    assert.equal(modelHealth.status('A').reason, 'daily-quota');
    t = Date.UTC(2026, 8, 28, 7, 0, 1); // just after midnight Pacific
    modelHealth._reload(); // and restarted again after it
    fake.reset();
    fake.script('A', fake.sse('a is back'));
    assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] }), 'a is back');
    assert.deepEqual(fake.models(), ['A'], 'A asked first again, B not needed');
  } finally {
    modelHealth._setNow(null);
  }
});

test('a model that went silent is skipped next time, saving the wait', async () => {
  fake.script('A', { stall: true });
  fake.script('B', fake.sse('b1'), fake.sse('b2'));
  const t0 = Date.now();
  await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'], firstChunkTimeoutMs: 200 });
  const firstMs = Date.now() - t0;
  const t1 = Date.now();
  await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'], firstChunkTimeoutMs: 200 });
  const secondMs = Date.now() - t1;
  assert.ok(firstMs >= 200, `first request waited out the silent model (${firstMs}ms)`);
  assert.ok(secondMs < 100, `second request skipped it (${secondMs}ms)`);
  assert.deepEqual(fake.models(), ['A', 'B', 'B']);
});

test('all models being skipped still makes a request (soonest back first)', async () => {
  fake.script('A', DAILY_429);
  fake.script('B', { status: 503, body: errorEvent(503) }, { status: 503, body: errorEvent(503) }, { status: 503, body: errorEvent(503) });
  await assert.rejects(llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] }));
  fake.reset();
  fake.script('B', fake.sse('B answers first — it comes back sooner'));
  assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'] }), 'B answers first — it comes back sooner');
  assert.deepEqual(fake.models(), ['B']);
});

test('non-streaming paths skip and record too', async () => {
  fake.script('A', DAILY_429);
  fake.script('B', { json: { candidates: [{ content: { parts: [{ text: 'alt ok' }] }, finishReason: 'STOP' }] } }, { json: { candidates: [{ content: { parts: [{ text: 'alt ok 2' }] }, finishReason: 'STOP' }] } });
  assert.equal(await llm.executeAlternativeRequest(REQ, FAR(), { models: ['A', 'B'] }), 'alt ok');
  assert.equal(await llm.executeAlternativeRequest(REQ, FAR(), { models: ['A', 'B'] }), 'alt ok 2');
  assert.deepEqual(fake.models('generate'), ['A', 'B', 'B']);
});

// ── Hedged start: a slow first model no longer costs the full first-chunk wait ──
const HEDGE = { models: ['A', 'B', 'C'], hedgeAfterMs: 100, firstChunkTimeoutMs: 2000, backupFirstChunkTimeoutMs: 2000 };

test('hedge: a fast first model answers alone — the backup is never started', async () => {
  fake.script('A', fake.sse('from A'));
  assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), HEDGE), 'from A');
  await new Promise(r => setTimeout(r, 150)); // past the hedge delay
  assert.deepEqual(fake.models(), ['A']);
  assert.equal(llm.lastModel, 'A');
});

test('hedge: slow first model → backup starts after the hedge delay, wins, only its text is shown', async () => {
  fake.script('A', { ...fake.sse('late A'), firstDelayMs: 600 });
  fake.script('B', fake.sse('fast ', 'B'));
  let shown = '';
  const t0 = Date.now();
  const out = await llm.executeStreamingRequest(REQ, d => { shown += d; }, FAR(), HEDGE);
  const ms = Date.now() - t0;
  assert.equal(out, 'fast B');
  assert.equal(shown, 'fast B', 'nothing from the slow model reached the screen');
  assert.ok(ms >= 100 && ms < 500, `answered after the hedge delay, not A's 600ms (${ms}ms)`);
  assert.deepEqual(fake.models(), ['A', 'B']);
  assert.equal(modelHealth.status('A').reason, 'silent', 'the loser is skipped next time');
  assert.equal(llm.lastModel, 'B');
});

test('hedge: first model fails fast (503) → backup starts right away, no hedge wait', async () => {
  fake.script('A', { status: 503, body: errorEvent(503) });
  fake.script('B', fake.sse('B'));
  const t0 = Date.now();
  assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), { ...HEDGE, hedgeAfterMs: 1000 }), 'B');
  assert.ok(Date.now() - t0 < 500);
  assert.equal(modelHealth.status('A').reason, 'overloaded');
});

test('hedge: both racing models fail → the rest of the chain is tried', async () => {
  fake.script('A', { status: 503, body: errorEvent(503) });
  fake.script('B', { status: 503, body: errorEvent(503) });
  fake.script('C', fake.sse('C saves it'));
  assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), HEDGE), 'C saves it');
  assert.deepEqual(fake.models(), ['A', 'B', 'C']);
});

test('hedge: the winner breaks off mid-answer → shown text reset, next untried model answers', async () => {
  fake.script('A', { sse: [t('half'), errorEvent(503)] });
  fake.script('B', fake.sse('B complete'));
  let shown = '';
  let resets = 0;
  const out = await llm.executeStreamingRequest(REQ, d => { shown += d; }, FAR(), { ...HEDGE, onReset: () => { resets++; shown = ''; } });
  assert.equal(out, 'B complete');
  assert.equal(shown, 'B complete');
  assert.equal(resets, 1);
});

test('hedge: slow backup winner breaking off does not retry the aborted primary', async () => {
  fake.script('A', { ...fake.sse('late A'), firstDelayMs: 600 });
  fake.script('B', { sse: [t('half'), errorEvent(503)] });
  fake.script('C', fake.sse('C'));
  assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), HEDGE), 'C');
  assert.deepEqual(fake.models(), ['A', 'B', 'C']);
});

test('no hedging for an explicit model list unless asked (reasoning chain thinks before answering)', async () => {
  fake.script('A', { ...fake.sse('thinker'), firstDelayMs: 200 });
  assert.equal(await llm.executeStreamingRequest(REQ, null, FAR(), { models: ['A', 'B'], firstChunkTimeoutMs: 2000 }), 'thinker');
  assert.deepEqual(fake.models(), ['A']);
});

test('normal chain hedges by default (llm.gemini.hedgeAfterMs)', async () => {
  const prev = config.get('llm.gemini.hedgeAfterMs');
  config.set('llm.gemini.hedgeAfterMs', 100);
  try {
    fake.script('gemini-3.5-flash-lite', { ...fake.sse('late'), firstDelayMs: 600 });
    fake.script('gemini-3.1-flash-lite', fake.sse('backup'));
    assert.equal(await llm.executeStreamingRequest(REQ, null, FAR()), 'backup');
  } finally {
    config.set('llm.gemini.hedgeAfterMs', prev);
  }
});

test('normal chain outage (2026-09-29): primary out for the day + 3.1-flash-lite silent → 3-flash-preview leads, the preview is hedged in', async () => {
  const prev = config.get('llm.gemini.hedgeAfterMs');
  config.set('llm.gemini.hedgeAfterMs', 100);
  try {
    modelHealth.recordFailure('gemini-3.5-flash-lite', new Error('HTTP 429 RESOURCE_EXHAUSTED quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
    modelHealth.recordFailure('gemini-3.1-flash-lite', Object.assign(new Error('No response within 8s (first-chunk timeout)'), { firstChunkTimeout: true }));
    fake.script('gemini-3-flash-preview', fake.sse('from 3-flash-preview'));
    assert.equal(await llm.executeStreamingRequest(REQ, null, FAR()), 'from 3-flash-preview');
    assert.deepEqual(fake.models(), ['gemini-3-flash-preview'], 'skipped models not asked; 3-flash-preview first');

    fake.reset();
    fake.script('gemini-3-flash-preview', { ...fake.sse('late'), firstDelayMs: 600 });
    fake.script('gemini-3.1-flash-lite-preview', fake.sse('preview saves it'));
    assert.equal(await llm.executeStreamingRequest(REQ, null, FAR()), 'preview saves it');
    assert.deepEqual(fake.models(), ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']);
  } finally {
    config.set('llm.gemini.hedgeAfterMs', prev);
  }
});

// ── Probe ──
test('probe: tiny request, minimal thinking, success clears the skip', async () => {
  modelHealth.recordFailure('gemini-3.5-flash-lite', new Error('HTTP 503 UNAVAILABLE'));
  fake.script('gemini-3.5-flash-lite', fake.sse('Hi!'));
  const r = await llm.probeModel('gemini-3.5-flash-lite');
  assert.equal(r.ok, true);
  assert.equal(modelHealth.status('gemini-3.5-flash-lite'), null);
  const body = fake.requests[0].body;
  assert.equal(body.generationConfig.maxOutputTokens, 16);
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(body.systemInstruction, undefined, 'no prompt/resume sent');
});

test('probe: slow first chunk counts as a failure and is recorded', async () => {
  config.set('llm.gemini.probe', { firstChunkTimeoutMs: 50, timeoutMs: 2000 });
  try {
    fake.script('gemini-3.1-flash-lite', { stall: true });
    const r = await llm.probeModel('gemini-3.1-flash-lite');
    assert.equal(r.ok, false);
    assert.equal(r.recorded, true);
    assert.equal(modelHealth.status('gemini-3.1-flash-lite').reason, 'silent');
  } finally {
    config.set('llm.gemini.probe', { firstChunkTimeoutMs: 5000, timeoutMs: 10000, intervalMs: 10000, networkRetryMs: 60000 });
  }
});

test('probe: network error is not the model\'s fault (not recorded)', async () => {
  fake.script('gemini-3.1-flash-lite', { networkError: 'ENOTFOUND' });
  const r = await llm.probeModel('gemini-3.1-flash-lite');
  assert.deepEqual([r.ok, r.recorded], [false, false]);
  assert.equal(modelHealth.status('gemini-3.1-flash-lite'), null);
});
