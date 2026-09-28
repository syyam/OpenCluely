// Loads the real AI Response overlay (llm-response.html + its local scripts)
// in jsdom with a stub window.electronAPI. Tests fire the same IPC events
// main.js sends (emit('onDisplayLlmResponse', data), …) and inspect the DOM.
// Dev-only: jsdom is a devDependency and nothing here ships with the app.
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');

async function loadOverlay() {
  const listeners = {};
  const calls = [];
  const errors = [];
  let nextMoreDetails = () => Promise.resolve({ ok: true });

  const api = new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop.startsWith('on')) return (cb) => { (listeners[prop] = listeners[prop] || []).push(cb); };
      if (prop === 'requestMoreDetails') {
        return (...args) => { calls.push(['requestMoreDetails', ...args]); return nextMoreDetails(...args); };
      }
      return (...args) => { calls.push([prop, ...args]); return Promise.resolve(); };
    },
  });

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e));

  const dom = await JSDOM.fromFile(path.join(ROOT, 'llm-response.html'), {
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

  const { document } = dom.window;
  return {
    window: dom.window,
    document,
    calls,
    errors,
    /** Fire a renderer IPC event the way main.js sends it. */
    emit(name, data) {
      const cbs = listeners[name] || [];
      if (!cbs.length) throw new Error(`overlay never registered ${name}`);
      cbs.forEach(cb => cb({}, data));
    },
    /** What the next requestMoreDetails() call resolves with. */
    setMoreDetailsResult(fn) { nextMoreDetails = fn; },
    rows: () => [...document.querySelectorAll('#entries .response-entry')],
    row: (messageId) => document.querySelector(`#entries .response-entry[data-message-id="${messageId}"]`),
    buttons: (messageId) => [...document.querySelectorAll(`#entries .response-entry[data-message-id="${messageId}"] > .entry-footer .more-details-btn`)],
    loadingVisible() {
      const el = document.getElementById('loading');
      return !!el && !el.classList.contains('hidden') && el.style.display !== 'none';
    },
    wait: (ms = 100) => new Promise(r => setTimeout(r, ms)),
    close: () => dom.window.close(),
  };
}

module.exports = { loadOverlay };
