const env = require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const health = env.req('src/core/model-health');
const config = env.req('src/core/config');

// The exact 429 gemini-3.6-flash returned on 2026-09-28 (daily free quota used up).
const DAILY_429 = new Error('HTTP 429: {"error":{"code":429,"message":"You exceeded your current quota ... limit: 20, model: gemini-3.6-flash\\nPlease retry in 27.415368865s.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"20"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"27s"}]}}');
const MINUTE_429 = new Error('HTTP 429: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},{"retryDelay":"27s"}]}}');
const T = Date.UTC(2026, 8, 28, 8, 0, 0); // 2026-09-28 01:00 PDT
const MIN = 60 * 1000;
const at = (ms) => health._setNow(() => ms);
const statePath = () => path.join(env.TMP, 'model-health.json');

test.beforeEach(() => { at(T); health.reset(); });
test.after(() => health._setNow(null));

test('daily quota 429 → skipped until the next midnight Pacific (not the misleading "retry in 27s")', () => {
  const v = health.classify(DAILY_429);
  assert.equal(v.reason, 'daily-quota');
  assert.equal(v.until, Date.UTC(2026, 8, 29, 7, 0, 0), '2026-09-29 00:00 PDT = 16:00 JST');
});

test('per-minute 429 → Google\'s retry delay, clamped to 15s–2min', () => {
  assert.deepEqual(health.classify(MINUTE_429), { reason: 'minute-quota', until: T + 27000 });
  assert.equal(health.classify(new Error('HTTP 429 quota. Please retry in 1s.')).until, T + 15000, 'min 15s');
  assert.equal(health.classify(new Error('HTTP 429 quota. Please retry in 900s.')).until, T + 2 * MIN, 'max 2min');
  assert.equal(health.classify(new Error('HTTP 429 quota')).until, T + MIN, 'no delay given → 1min');
});

test('overloaded, silent, retired; network errors and bad requests are not the model\'s fault', () => {
  assert.equal(health.classify(new Error('HTTP 503: {"status":"UNAVAILABLE","message":"high demand"}')).reason, 'overloaded');
  const midStream = Object.assign(new Error('HTTP 503 (mid-stream, after 40 chars): high demand'), { incompleteStream: true });
  assert.deepEqual(health.classify(midStream), { reason: 'overloaded', until: T + 2 * MIN });
  const noFinish = Object.assign(new Error('HTTP 503 (incomplete stream: ended without finishReason after 10 chars)'), { incompleteStream: true });
  assert.equal(health.classify(noFinish).reason, 'overloaded');
  const silent = Object.assign(new Error('No response from m within 8s (first-chunk timeout)'), { firstChunkTimeout: true });
  assert.deepEqual(health.classify(silent), { reason: 'silent', until: T + 3 * MIN });
  const stalledMidAnswer = Object.assign(new Error('Streaming request timeout'), { incompleteStream: true });
  assert.equal(health.classify(stalledMidAnswer).reason, 'silent');
  assert.equal(health.classify(new Error('HTTP 404: model no longer available')).reason, 'retired');
  assert.equal(health.classify(new Error('Streaming request failed: ECONNRESET')), null);
  assert.equal(health.classify(new Error('HTTP 400: Thinking budget is not supported')), null);
  assert.equal(health.classify(new Error('HTTP 500: internal')), null);
});

test('next midnight Pacific across daylight-saving changes', () => {
  const cases = [
    [Date.UTC(2026, 8, 28, 6, 59, 59), Date.UTC(2026, 8, 28, 7, 0, 0), '23:59:59 PDT → 00:00 PDT'],
    [Date.UTC(2026, 9, 31, 12, 0, 0), Date.UTC(2026, 10, 1, 7, 0, 0), 'Oct 31 PDT → Nov 1 00:00 PDT (DST ends 02:00 that night)'],
    [Date.UTC(2026, 10, 1, 12, 0, 0), Date.UTC(2026, 10, 2, 8, 0, 0), 'Nov 1 PST → Nov 2 00:00 PST = 17:00 JST'],
    [Date.UTC(2027, 2, 13, 12, 0, 0), Date.UTC(2027, 2, 14, 8, 0, 0), 'Mar 13 PST → Mar 14 00:00 PST (DST starts 02:00)'],
    [Date.UTC(2027, 2, 14, 12, 0, 0), Date.UTC(2027, 2, 15, 7, 0, 0), 'Mar 14 PDT → Mar 15 00:00 PDT'],
  ];
  for (const [from, expected, label] of cases) {
    assert.equal(new Date(health.nextPacificMidnight(from)).toISOString(), new Date(expected).toISOString(), label);
  }
});

test('order: healthy models keep their order; skipped ones drop out; back once the skip expires', () => {
  const models = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  assert.deepEqual(health.order(models), models);
  health.recordFailure('gemini-3.6-flash', DAILY_429);
  assert.deepEqual(health.order(models), ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], '3.5-flash-lite becomes first');
  at(Date.UTC(2026, 8, 29, 7, 0, 1)); // just after the reset
  assert.deepEqual(health.order(models), models, '3.6-flash is back after midnight Pacific');
});

test('if every model is being skipped, all are still tried — soonest back first', () => {
  const silent = Object.assign(new Error('first-chunk timeout'), { firstChunkTimeout: true });
  health.recordFailure('a', DAILY_429);
  health.recordFailure('b', silent); // 3 min
  health.recordFailure('c', new Error('HTTP 503 UNAVAILABLE')); // 2 min
  assert.deepEqual(health.order(['a', 'b', 'c']), ['c', 'b', 'a']);
});

test('a success clears the model; a short failure never shortens a longer skip', () => {
  health.recordFailure('m', DAILY_429);
  health.recordFailure('m', new Error('HTTP 503 UNAVAILABLE'));
  assert.equal(health.status('m').reason, 'daily-quota');
  health.recordSuccess('m');
  assert.equal(health.status('m'), null);
  assert.equal(health.recordFailure('m', new Error('ECONNRESET')), null, 'unclassified errors are not recorded');
  assert.equal(health.status('m'), null);
});

test('day-long skips survive a restart; short ones and expired ones do not', () => {
  health.recordFailure('gemini-3.6-flash', DAILY_429);
  health.recordFailure('gemini-3.5-flash-lite', new Error('HTTP 503 UNAVAILABLE'));
  assert.ok(fs.existsSync(statePath()));
  health._reload(); // simulate app restart
  assert.equal(health.status('gemini-3.6-flash').reason, 'daily-quota');
  assert.equal(health.status('gemini-3.5-flash-lite'), null, 'overload cooldown is memory-only');
  at(Date.UTC(2026, 8, 29, 8, 0, 0)); // next day
  health._reload();
  assert.equal(health.status('gemini-3.6-flash'), null);
  health.recordSuccess('x'); // no-op, no crash
});

test('can be switched off in config', () => {
  config.set('llm.gemini.modelHealth', { enabled: false });
  try {
    assert.equal(health.recordFailure('m', DAILY_429), null);
    assert.deepEqual(health.order(['m', 'n']), ['m', 'n']);
  } finally {
    config.set('llm.gemini.modelHealth', undefined);
  }
});
