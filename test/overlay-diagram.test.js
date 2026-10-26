// ```mermaid diagrams in the AI Response overlay (system design mode):
// diagram box in the code column, Diagram | Code toggle, Copy, fallback to
// code when it can't be drawn, ordinary code blocks unchanged, and mermaid
// never loaded for normal answers. mermaid itself is stubbed (jsdom has no
// SVG layout); the real library is checked in the running app.
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay-dom');

const DIAGRAM = 'flowchart TD\n  W["(1) Web"] --> API["(2) API"]:::changed';
const DESIGN = `### High-level design\nThe main flow.\n\`\`\`mermaid\n${DIAGRAM}\n\`\`\`\n### Components\n- (1) Web — what: client`;
const CODE = '### Solution — Sum\nAdd them.\n```ts\nconst sum = (a: number, b: number) => a + b // (1) add\n```';

function mermaidStub(window, { fail = false } = {}) {
  const calls = { init: 0, parse: [], render: [] };
  window.mermaid = {
    initialize() { calls.init++; },
    async parse(src) { calls.parse.push(src); if (fail) throw new Error('Parse error on line 2'); return true; },
    async render(id, src) {
      calls.render.push(src);
      return { svg: `<svg id="${id}" viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg"><g class="node changed"><rect></rect></g></svg>` };
    },
  };
  return calls;
}

let ov;
const display = (content, metadata = {}) => ov.emit('onDisplayLlmResponse', { content, metadata: { skill: 'fullstack', usedFallback: false, messageId: 'm1', ...metadata } });
const $ = (sel) => ov.document.querySelector(sel);

test.afterEach(() => {
  const errs = ov.errors.map(e => e.message);
  ov.close();
  assert.deepEqual(errs, [], 'overlay script errors');
});

test('mermaid fence → diagram box (drawn SVG) in the code column; changed nodes get the highlight class', async () => {
  let calls;
  ov = await loadOverlay({ beforeParse: (w) => { calls = mermaidStub(w); } });
  display(DESIGN);
  await ov.wait(50);
  const block = $('.entry-code .diagram-block');
  assert.ok(block, 'diagram block in the code column');
  assert.ok(block.querySelector('.diagram-stage svg'), 'SVG drawn');
  assert.equal(block.querySelector('.diagram-status'), null, 'drawing status removed');
  assert.equal(calls.init, 1);
  assert.match(calls.render[0], /classDef changed /, 'highlight class added for :::changed');
  assert.equal(block.querySelector('.diagram-view').hidden, false);
  assert.equal(block.querySelector('.diagram-code').hidden, true);
  // A design answer has no Optimized / convert buttons.
  assert.deepEqual(ov.buttons('m1').map(b => b.textContent), ['More details', 'Deep reasoning']);
});

test('Diagram | Code toggle and Copy (always the Mermaid source)', async () => {
  ov = await loadOverlay({ beforeParse: (w) => mermaidStub(w) });
  display(DESIGN);
  await ov.wait(50);
  const block = $('.diagram-block');
  block.querySelector('[data-view="code"]').click();
  assert.equal(block.querySelector('.diagram-view').hidden, true);
  assert.equal(block.querySelector('.diagram-code').hidden, false);
  assert.equal(block.querySelector('.diagram-code code').textContent, DIAGRAM);
  block.querySelector('[data-view="diagram"]').click();
  assert.equal(block.querySelector('.diagram-view').hidden, false);
  block.querySelector('[data-act="copy"]').click();
  await ov.wait(10);
  const copy = ov.calls.find(c => c[0] === 'copyToClipboard');
  assert.equal(copy[1], DIAGRAM);
});

test('Expand toggles the large view; Esc closes it', async () => {
  ov = await loadOverlay({ beforeParse: (w) => mermaidStub(w) });
  display(DESIGN);
  await ov.wait(50);
  const block = $('.diagram-block');
  block.querySelector('[data-act="expand"]').click();
  assert.ok(block.classList.contains('expanded'));
  assert.equal(block.parentElement, ov.document.body, 'large view lives under <body> (no ancestor traps position: fixed)');
  const css = [...ov.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
  assert.match(css, /\.diagram-block\.expanded \{[^}]*inset: 40px 8px 8px 8px;[^}]*-webkit-app-region: no-drag;/, 'starts below the 32px drag-region header');
  ov.document.dispatchEvent(new ov.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(!block.classList.contains('expanded'));
  assert.ok(block.closest('.entry-code'), 'back in its code column');
});

test('a diagram that cannot be drawn opens on its code with a note; Copy still works', async () => {
  ov = await loadOverlay({ beforeParse: (w) => mermaidStub(w, { fail: true }) });
  display(DESIGN);
  await ov.wait(50);
  const block = $('.diagram-block');
  assert.equal(block.querySelector('.diagram-view').hidden, true);
  assert.equal(block.querySelector('.diagram-code').hidden, false);
  assert.equal(block.querySelector('.diagram-note').hidden, false);
  assert.ok(block.querySelector('[data-view="diagram"]').disabled);
  block.querySelector('[data-act="copy"]').click();
  await ov.wait(10);
  assert.equal(ov.calls.find(c => c[0] === 'copyToClipboard')[1], DIAGRAM);
});

test('unquoted numbered labels are repaired before giving up', async () => {
  let calls;
  ov = await loadOverlay({ beforeParse: (w) => {
    calls = mermaidStub(w);
    const parse = w.mermaid.parse;
    w.mermaid.parse = async (src) => { if (/\[\(\d\)/.test(src)) throw new Error('bad'); return parse(src); };
  } });
  display('```mermaid\nflowchart TD\n  API[(2) Booking API] --> DB[("(3) Postgres")]\n```');
  await ov.wait(50);
  assert.ok($('.diagram-stage svg'), 'drawn after repair');
  assert.match(calls.render[0], /API\["\(2\) Booking API"\]/);
  assert.match(calls.render[0], /DB\[\("\(3\) Postgres"\)\]/, 'database shape left alone');
});

test('normal answers: code blocks unchanged and mermaid never loaded', async () => {
  ov = await loadOverlay();
  display(CODE);
  await ov.wait(30);
  assert.ok($('.entry-code .code-block:not(.diagram-block) .copy-btn'), 'normal code block with its Copy button');
  assert.equal($('.diagram-block'), null);
  assert.equal(ov.document.querySelector('script[src*="mermaid"]'), null, 'mermaid not loaded');
  assert.equal(ov.window.mermaid, undefined);
  assert.deepEqual(ov.buttons('m1').map(b => b.textContent), ['More details', 'Deep reasoning', 'Optimized solution']);
});

test('two diagrams in one answer: two titled boxes; a sequence diagram gets no classDef', async () => {
  let calls;
  ov = await loadOverlay({ beforeParse: (w) => { calls = mermaidStub(w); } });
  display('### High-level architecture\n**How it works**\n1. Send.\n```mermaid\n---\ntitle: High-level architecture\n---\nflowchart TD\n  A["(1) App"] --> B["(2) API"]:::changed\n```\n### Key flow\n**How it works**\n1. Tap.\n```mermaid\n---\ntitle: Key flow\n---\nsequenceDiagram\n  autonumber\n  U->>VM: send\n  rect rgba(250, 204, 21, 0.15)\n  VM->>R: save\n  end\n```');
  await ov.wait(60);
  const titles = [...ov.document.querySelectorAll('.diagram-block .diagram-title')].map(t => t.textContent);
  assert.deepEqual(titles, ['HIGH-LEVEL ARCHITECTURE', 'KEY FLOW']);
  assert.equal(calls.render.length, 2);
  assert.match(calls.render[0], /classDef changed /);
  assert.doesNotMatch(calls.render[1], /classDef/);
  // each walkthrough sits beside its own diagram
  const rows = [...ov.document.querySelectorAll('.entry-body.has-code')];
  assert.equal(rows.length, 2);
  assert.match(rows[1].querySelector('.entry-text').textContent, /Tap\./);
});

test('repairs seen in live builds: a space before :::changed, and ; inside a sequence note', async () => {
  let calls;
  ov = await loadOverlay({ beforeParse: (w) => {
    calls = mermaidStub(w);
    const parse = w.mermaid.parse;
    w.mermaid.parse = async (src) => { if (/\s:::changed|died; app/.test(src)) throw new Error('Parse error'); return parse(src); };
  } });
  display('```mermaid\nflowchart TD\n  A["(1) App"] :::changed\n  A --> B :::changed\n```\n```mermaid\nsequenceDiagram\n  U->>S: tap send\n  Note over S,DB: process died; app killed\n```');
  await ov.wait(60);
  assert.equal(ov.document.querySelectorAll('.diagram-stage svg').length, 2, 'both drawn after repair');
  assert.match(calls.render[0], /A\["\(1\) App"\]:::changed/);
  assert.match(calls.render[0], /A --> B:::changed/);
  assert.match(calls.render[1], /Note over S,DB: process died, app killed/);
  assert.match(calls.render[1], /U->>S: tap send/, 'other lines untouched');
});
