// Which Gemini models to skip for now, and why. Gemini can't be asked how
// much quota is left, but its errors say exactly what went wrong, so a model
// that just failed in a way that will repeat is skipped for a while instead
// of being tried first on every question:
//   - daily quota used up (429, quotaId "…PerDay…") → until the free-tier reset
//     at midnight Pacific (the error's own "retry in 27s" is wrong for this);
//   - per-minute quota (other 429) → Google's retry delay, clamped;
//   - overloaded (503 / UNAVAILABLE / high demand, incl. mid-answer breaks);
//   - silent (no first chunk, or a stall mid-answer);
//   - retired (404 / "no longer available").
// A success clears the model. Network errors and bad requests (400) are not
// the model's fault and are never recorded. Only day-long entries are saved
// to disk, so a restart doesn't re-probe a model known to be out of quota.
//
// Overloaded/silent skips grow while a model keeps failing (2-3 → 5 → 10 →
// 20 → 30 min; reset by a success), so a long outage isn't re-tried every
// few minutes. Models handed to setProbeModels (the normal answer chain, see
// src/services/model-monitor.js) don't come back on their own when the skip
// ends: they stay skipped until a small background probe (or any request)
// succeeds, so a real question never has to find out whether it recovered.
const fs = require('fs');
const path = require('path');
const logger = require('./logger').createServiceLogger('MODEL-HEALTH');
const config = require('./config');

const DEFAULTS = {
  overloadCooldownMs: 2 * 60 * 1000,
  stallCooldownMs: 3 * 60 * 1000,
  minuteQuotaDefaultMs: 60 * 1000,
  minuteQuotaMinMs: 15 * 1000,
  minuteQuotaMaxMs: 2 * 60 * 1000,
  retiredCooldownMs: 24 * 60 * 60 * 1000,
  // Later steps for a model that keeps failing (overloaded/silent); the first
  // step is overloadCooldownMs / stallCooldownMs.
  escalationMs: [5 * 60 * 1000, 10 * 60 * 1000, 20 * 60 * 1000, 30 * 60 * 1000],
};
const PERSISTED = new Set(['daily-quota', 'retired']);

let now = () => Date.now();
let entries = null; // model → { until, reason }
const strikes = new Map(); // model → overloaded/silent failures since its last success
let probeModels = new Set(); // models whose expired skip waits for a probe
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (_) { /* a listener's problem, not ours */ }
  }
}

function settings() {
  return { ...DEFAULTS, ...(config.get('llm.gemini.modelHealth') || {}) };
}

function resolveStatePath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'model-health.json');
  } catch (_) {
    return path.join(process.cwd(), 'model-health.json');
  }
}

function load() {
  if (entries) return entries;
  entries = new Map();
  try {
    const saved = JSON.parse(fs.readFileSync(resolveStatePath(), 'utf8'));
    for (const [model, e] of Object.entries(saved || {})) {
      if (e && e.until > now() && PERSISTED.has(e.reason)) entries.set(model, e);
    }
  } catch (_) { /* no saved state yet */ }
  return entries;
}

function save() {
  const out = {};
  for (const [model, e] of entries) if (PERSISTED.has(e.reason) && e.until > now()) out[model] = e;
  try {
    fs.writeFileSync(resolveStatePath(), JSON.stringify(out, null, 2), 'utf8');
  } catch (err) {
    logger.warn('Could not save model health state', { error: err.message });
  }
}

/** Epoch ms of the next midnight in America/Los_Angeles (Gemini's daily reset). */
function nextPacificMidnight(from = now()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const wall = (t) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, Number(x.value)]));
    return p;
  };
  const p = wall(from);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(from / 1000) * 1000;
  let candidate = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0) - offset;
  // The offset can differ at the target when daylight saving changes that night.
  const h = wall(candidate).hour;
  if (h === 23) candidate += 60 * 60 * 1000;
  else if (h === 1) candidate -= 60 * 60 * 1000;
  return candidate;
}

function parseRetryDelayMs(message) {
  const m = String(message).match(/retry in ([\d.]+)s/i) || String(message).match(/"retryDelay":\s*"([\d.]+)s"/);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/** Skip length for the n-th consecutive overloaded/silent failure (0-based). */
function escalatedMs(firstMs, strike, s) {
  if (!strike) return firstMs;
  const steps = s.escalationMs || [];
  if (!steps.length) return firstMs;
  return Math.max(firstMs, steps[Math.min(strike, steps.length) - 1]);
}

/**
 * How long a failure should keep a model out of first place.
 * @param {number} strike - earlier overloaded/silent failures of this model
 *   since its last success; lengthens those two kinds of skip
 * @returns {{reason: string, until: number}|null} null = don't record
 */
function classify(error, strike = 0) {
  const msg = String((error && error.message) || error || '');
  const s = settings();
  const t = now();
  if (/\b429\b|RESOURCE_EXHAUSTED/.test(msg)) {
    if (/PerDay/i.test(msg)) return { reason: 'daily-quota', until: nextPacificMidnight(t) };
    const delay = parseRetryDelayMs(msg) || s.minuteQuotaDefaultMs;
    return { reason: 'minute-quota', until: t + Math.min(s.minuteQuotaMaxMs, Math.max(s.minuteQuotaMinMs, delay)) };
  }
  if (/\b404\b|NOT_FOUND|no longer available/.test(msg)) return { reason: 'retired', until: t + s.retiredCooldownMs };
  if (error && (error.firstChunkTimeout || (error.incompleteStream && /timeout/i.test(msg)))) {
    return { reason: 'silent', until: t + escalatedMs(s.stallCooldownMs, strike, s) };
  }
  if ((error && error.incompleteStream) || /\b503\b|UNAVAILABLE|high demand|overloaded/i.test(msg)) {
    return { reason: 'overloaded', until: t + escalatedMs(s.overloadCooldownMs, strike, s) };
  }
  return null;
}

/** Record a failed attempt on a model. */
function recordFailure(model, error) {
  if (!model || settings().enabled === false) return null;
  const strike = strikes.get(model) || 0;
  const verdict = classify(error, strike);
  if (!verdict) return null;
  if (verdict.reason === 'overloaded' || verdict.reason === 'silent') strikes.set(model, strike + 1);
  const map = load();
  const prev = map.get(model);
  // Never shorten a longer skip (e.g. a 503 while already out for the day).
  if (prev && prev.until > verdict.until) return prev;
  map.set(model, verdict);
  logger.info('Model will be skipped for now', { model, reason: verdict.reason, strike: strike + 1, until: new Date(verdict.until).toISOString() });
  if (PERSISTED.has(verdict.reason)) save();
  notify();
  return verdict;
}

/** A model answered: it's healthy again. */
function recordSuccess(model) {
  strikes.delete(model);
  const map = load();
  const prev = map.get(model);
  if (!prev) return;
  map.delete(model);
  logger.info('Model healthy again', { model, was: prev.reason });
  if (PERSISTED.has(prev.reason)) save();
  notify();
}

/**
 * The model's current skip entry, or null. A probe-managed model whose skip
 * has ended stays skipped ({..., awaitingProbe: true}) until a probe or a
 * request succeeds.
 */
function status(model) {
  const e = load().get(model);
  if (!e) return null;
  if (e.until <= now()) {
    if (probeModels.has(model)) return { ...e, awaitingProbe: true };
    entries.delete(model);
    return null;
  }
  return e;
}

/** Models (from the probe set) whose skip has ended and that should be probed now. */
function dueForProbe() {
  return [...probeModels].filter(m => {
    const e = status(m);
    return !!(e && e.awaitingProbe);
  });
}

/** Which models are probe-managed (the normal answer chain). */
function setProbeModels(models) {
  probeModels = new Set(models || []);
  notify();
}

/** Every current skip entry: [{model, reason, until, awaitingProbe, strike}]. */
function snapshot() {
  const out = [];
  for (const model of [...load().keys()]) {
    const e = status(model);
    if (e) out.push({ model, reason: e.reason, until: e.until, awaitingProbe: !!e.awaitingProbe, strike: strikes.get(model) || 0 });
  }
  return out;
}

/** Called after any skip is added or cleared. Returns an unsubscribe function. */
function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The models worth trying, in order: healthy ones first in their configured
 * order. Never empty — if every model is being skipped, all of them are
 * returned, the one that comes back soonest first, so a request is still made.
 */
function order(models) {
  if (settings().enabled === false) return [...models];
  const healthy = models.filter(m => !status(m));
  if (healthy.length) {
    const skipped = models.filter(m => status(m));
    if (skipped.length) {
      logger.info('Skipping models for now', { skipped: skipped.map(m => ({ model: m, ...status(m) })), using: healthy[0] });
    }
    return healthy;
  }
  return [...models].sort((a, b) => status(a).until - status(b).until);
}

/** Test hooks: clear everything (memory + saved file), and fake the clock. */
function reset() {
  entries = new Map();
  strikes.clear();
  probeModels = new Set();
  try { fs.rmSync(resolveStatePath(), { force: true }); } catch (_) { /* ignore */ }
}
function _setNow(fn) { now = fn || (() => Date.now()); }
function _reload() { entries = null; }

module.exports = {
  order, recordFailure, recordSuccess, status, classify, nextPacificMidnight,
  dueForProbe, setProbeModels, snapshot, onChange,
  reset, _setNow, _reload,
};
