// Fake Gemini network: replaces https.request (streaming + the alternative
// non-streaming HTTPS path) and the @google/genai SDK client, so no test can
// reach the real API. Responses are scripted per model and consumed in order;
// a model with nothing scripted answers 503 so a missing script is visible.
//
//   fake.install(llmService)
//   fake.script('gemini-3.5-flash-lite', fake.sse('Hello ', 'world.'))
//   ... call llmService ...
//   fake.requests  → [{ model, kind: 'stream'|'generate'|'sdk', body }]
const https = require('https');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const originalRequest = https.request;
let scripts = {};
const requests = [];

// ── SSE event builders ──
const textEvent = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const finishEvent = (text, finishReason = 'STOP', usage = {}) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, ...usage },
});
const errorEvent = (code = 503, message = 'This model is currently experiencing high demand.') =>
  ({ error: { code, message, status: code === 503 ? 'UNAVAILABLE' : 'ERROR' } });

/** A complete, well-formed stream: text pieces, the last one carrying finishReason STOP. */
function sse(...pieces) {
  const events = pieces.slice(0, -1).map(textEvent);
  events.push(finishEvent(pieces[pieces.length - 1] || ''));
  return { sse: events };
}

function script(model, ...responses) {
  (scripts[model] = scripts[model] || []).push(...responses);
}

function reset() {
  scripts = {};
  requests.length = 0;
}

function nextResponse(model) {
  const queue = scripts[model];
  return queue && queue.length ? queue.shift() : { status: 503, body: errorEvent(503, `no script for ${model}`) };
}

function fakeRequest(url, options, callback) {
  const href = String(url);
  const model = (href.match(/models\/([^:]+):/) || [])[1];
  const kind = href.includes(':streamGenerateContent') ? 'stream' : 'generate';
  const req = new EventEmitter();
  let body = '';
  let res = null;
  let timer = null;
  req.destroyed = false;
  req.write = (chunk) => { body += chunk; };
  req.destroy = () => {
    req.destroyed = true;
    if (timer) clearTimeout(timer);
    if (res && !res.destroyed) res.destroy();
  };
  const armIdleTimeout = () => {
    if (options && options.timeout) {
      timer = setTimeout(() => { if (!req.destroyed) req.emit('timeout'); }, options.timeout);
    }
  };
  req.end = () => setImmediate(() => {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (_) { /* not JSON */ }
    requests.push({ model, kind, body: parsed });
    const r = nextResponse(model);
    if (r.networkError) {
      req.emit('error', new Error(r.networkError));
      return;
    }
    if (r.stall) {
      armIdleTimeout(); // nothing ever arrives
      return;
    }
    res = new PassThrough();
    res.statusCode = r.status || 200;
    res.setEncoding('utf8');
    callback(res);
    if (res.statusCode !== 200) {
      res.end(JSON.stringify(r.body || {}));
      return;
    }
    if (kind === 'generate' || r.json) {
      res.end(JSON.stringify(r.json || { candidates: [{ content: { parts: [{ text: r.text || '' }] }, finishReason: 'STOP' }] }));
      return;
    }
    const events = r.sse || [];
    let i = 0;
    const writeNext = () => {
      if (req.destroyed || res.destroyed) return;
      if (i < events.length) {
        res.write('data: ' + JSON.stringify(events[i++]) + '\r\n\r\n');
        if (r.delayMs) setTimeout(writeNext, r.delayMs); else setImmediate(writeNext);
      } else if (r.stallAfter) {
        armIdleTimeout(); // streamed some text, then silence
      } else {
        res.end();
      }
    };
    // firstDelayMs: the model "thinks" this long before its first chunk.
    if (r.firstDelayMs) setTimeout(writeNext, r.firstDelayMs); else writeNext();
  });
  return req;
}

/** SDK path (llmService.executeRequest): scripted with kind 'sdk' responses: { text } or { error }. */
function fakeSdk(llmService) {
  llmService.client = {
    models: {
      generateContent: async ({ model, contents, config }) => {
        requests.push({ model, kind: 'sdk', body: { contents, config } });
        const r = nextResponse(model);
        if (r.status && r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
        if (r.error) throw new Error(r.error);
        const text = r.text || (r.sse ? r.sse.map(e => e.candidates ? e.candidates[0].content.parts[0].text : '').join('') : '');
        return { text, candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] };
      },
    },
  };
}

function install(llmService) {
  https.request = fakeRequest;
  if (llmService) {
    llmService.isInitialized = true;
    llmService.model = llmService.model || 'gemini-3.5-flash-lite';
    fakeSdk(llmService);
  }
}

function uninstall() {
  https.request = originalRequest;
}

module.exports = {
  install, uninstall, reset, script, requests,
  sse, textEvent, finishEvent, errorEvent,
  /** Models requested so far, in order. */
  models: (kind) => requests.filter(r => !kind || r.kind === kind).map(r => r.model),
};
