// AI Response overlay (llm-response.html) in jsdom: buttons, expansion rows,
// streaming + reset, loading badge, solution section layout.
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay-dom');

const CODE = '### Solution — Sum\nAdd them.\n```ts\nconst sum = (a: number, b: number) => a + b // (1) add\n```\n**Complexity** O(1)';
let ov;

// Helpers mirroring what main.js sends.
const start = (messageId, extra = {}) => ov.emit('onTranscriptionLlmResponseStart', { messageId, skill: 'frontend', ...extra });
const chunk = (messageId, delta) => ov.emit('onTranscriptionLlmResponseChunk', { messageId, delta });
const reset = (messageId) => ov.emit('onTranscriptionLlmResponseReset', { messageId });
const display = (content, metadata) => ov.emit('onDisplayLlmResponse', { content, metadata: { skill: 'frontend', usedFallback: false, ...metadata } });
const labels = (id) => ov.buttons(id).map(b => b.textContent);

test.beforeEach(async () => { ov = await loadOverlay(); });
test.afterEach(() => {
  const errs = ov.errors.map(e => e.message);
  ov.close();
  assert.deepEqual(errs, [], 'overlay script errors');
});

test('plain answer: More details | Deep reasoning (no Optimized)', async () => {
  display('A closure captures scope.', { messageId: 'm1' });
  assert.deepEqual(labels('m1'), ['More details', 'Deep reasoning']);
});

test('code answer: More details | Deep reasoning | Optimized | one button per offered format', async () => {
  display(CODE, { messageId: 'm1', formats: [{ id: 'react-jsx', label: 'React JSX' }] });
  assert.deepEqual(labels('m1'), ['More details', 'Deep reasoning', 'Optimized solution', 'React JSX']);
});

test('fallback "could you repeat" reply gets no buttons', async () => {
  display('Could you repeat that?', { messageId: 'm1', usedFallback: true });
  assert.deepEqual(labels('m1'), []);
});

test('click → requestMoreDetails(id, mode), button loading + disabled, second click ignored', async () => {
  display('Answer.', { messageId: 'm1' });
  const deepBtn = ov.buttons('m1').find(b => b.dataset.mode === 'deep');
  deepBtn.click();
  deepBtn.click();
  await ov.wait(10);
  // The answer text rides along so main can rebuild an evicted record.
  assert.equal(JSON.stringify(ov.calls.filter(c => c[0] === 'requestMoreDetails')), JSON.stringify([['requestMoreDetails', 'm1', 'deep', { answer: 'Answer.' }]]));
  assert.equal(deepBtn.textContent, 'Reasoning deeply…');
  assert.equal(deepBtn.disabled, true);
  assert.equal(ov.buttons('m1').find(b => b.dataset.mode === 'details').disabled, false, 'other buttons stay usable');
});

test('expansion streams into its own row right under the parent, then becomes final; button shows done', async () => {
  display('First answer.', { messageId: 'm1' });
  display('Second answer.', { messageId: 'm2' });
  ov.buttons('m1').find(b => b.dataset.mode === 'deep').click();
  start('e1', { parentMessageId: 'm1', isExpansion: true, mode: 'deep' });
  chunk('e1', 'Partial deep ');
  await ov.wait(100);
  assert.deepEqual(ov.rows().map(r => r.dataset.messageId), ['m1', 'e1', 'm2'], 'inserted under its parent, not at the end');
  assert.match(ov.row('e1').textContent, /#1 · Deep reasoning/);
  assert.match(ov.row('e1').textContent, /Partial deep/);
  display('Full deep review.', { messageId: 'e1', parentMessageId: 'm1', isExpansion: true, expansionMode: 'deep' });
  assert.match(ov.row('e1').textContent, /Full deep review\./);
  assert.equal(ov.rows().filter(r => r.dataset.messageId === 'e1').length, 1, 'final replaces the live row');
  const btn = ov.buttons('m1').find(b => b.dataset.mode === 'deep');
  assert.equal(btn.textContent, 'Deep reasoning shown below ↓');
  assert.equal(btn.disabled, true);
  assert.deepEqual(labels('e1'), [], 'a deep result gets no buttons of its own');
});

test('several expansions stack under the parent in click order', async () => {
  display(CODE, { messageId: 'm1' });
  display('Next.', { messageId: 'm2' });
  start('e1', { parentMessageId: 'm1', mode: 'details' });
  start('e2', { parentMessageId: 'm1', mode: 'deep' });
  assert.deepEqual(ov.rows().map(r => r.dataset.messageId), ['m1', 'e1', 'e2', 'm2']);
});

test('converted solution gets More details | Deep reasoning | Optimized, and no format buttons', async () => {
  display(CODE, { messageId: 'm1', formats: [{ id: 'react-jsx', label: 'React JSX' }] });
  display(CODE, { messageId: 'c1', parentMessageId: 'm1', isExpansion: true, expansionMode: 'convert:react-jsx' });
  assert.deepEqual(labels('c1'), ['More details', 'Deep reasoning', 'Optimized solution']);
});

test('failed expansion → live row removed, button becomes Retry and works again', async () => {
  display('Answer.', { messageId: 'm1' });
  const btn = () => ov.buttons('m1').find(b => b.dataset.mode === 'deep');
  btn().click();
  start('e1', { parentMessageId: 'm1', mode: 'deep' });
  ov.emit('onMoreDetailsFailed', { parentMessageId: 'm1', messageId: 'e1', mode: 'deep', error: '503' });
  assert.equal(ov.row('e1'), null);
  assert.equal(btn().textContent, 'Retry deep reasoning');
  assert.equal(btn().disabled, false);
  btn().click();
  await ov.wait(10);
  assert.equal(ov.calls.filter(c => c[0] === 'requestMoreDetails').length, 2);
});

test('reset clears the partial text of a live answer; the retry streams into the same row', async () => {
  start('m1');
  chunk('m1', 'Half an ans');
  await ov.wait(100);
  assert.match(ov.row('m1').textContent, /Half an ans/);
  reset('m1');
  assert.doesNotMatch(ov.row('m1').textContent, /Half an ans/);
  chunk('m1', 'Complete answer.');
  await ov.wait(100);
  assert.match(ov.row('m1').textContent, /Complete answer\./);
  assert.doesNotMatch(ov.row('m1').textContent, /Half/);
  assert.equal(ov.rows().length, 1);
});

test('cancel (the request became a chat question): the empty row and the badge go, the previous answer stays and the next one keeps its number', async () => {
  display('First answer.', { messageId: 'm1' });
  ov.emit('onShowLoading');
  start('m2');
  assert.equal(ov.rows().length, 2);
  ov.emit('onTranscriptionLlmResponseCancel', { messageId: 'm2' });
  assert.equal(ov.rows().length, 1);
  assert.match(ov.row('m1').textContent, /First answer\./);
  assert.equal(ov.loadingVisible(), false);
  start('m3');
  assert.match(ov.row('m3').textContent, /#2/);
});

test('reset before a pending chunk flush drops that chunk too', async () => {
  start('m1');
  chunk('m1', 'unflushed half');
  reset('m1'); // before the ~70ms flush
  await ov.wait(100);
  assert.doesNotMatch(ov.row('m1').textContent, /unflushed/);
});

test('"Analyzing…" badge: a new answer hides it; an expansion starting or finishing does not', async () => {
  display('First.', { messageId: 'm1' });
  ov.emit('onShowLoading');
  assert.equal(ov.loadingVisible(), true);
  start('e1', { parentMessageId: 'm1', mode: 'deep' });
  assert.equal(ov.loadingVisible(), true, 'expansion start must not hide a pending question\'s badge');
  display('Deep.', { messageId: 'e1', parentMessageId: 'm1', isExpansion: true, expansionMode: 'deep' });
  assert.equal(ov.loadingVisible(), true, 'expansion final must not hide it either');
  start('m2');
  assert.equal(ov.loadingVisible(), false, 'the new answer streaming hides it');
});

test('solution sections: Solution / Improved / Optimized each get prose beside their own code', async () => {
  const answer = '### Solution — A (reviewed)\nWhy A.\n```ts\nconst a = 1\n```\n### Improved — B\nWhy B.\n```ts\nconst b = 2\n```';
  display(answer, { messageId: 'm1' });
  const sections = [...ov.row('m1').querySelectorAll('.solution-section')];
  assert.equal(sections.length, 2);
  assert.match(sections[0].querySelector('.solution-header').textContent, /Solution — A/);
  assert.match(sections[1].querySelector('.solution-header').textContent, /Improved — B/);
  assert.match(sections[0].querySelector('.entry-code').textContent, /const a = 1/);
  assert.match(sections[1].querySelector('.entry-code').textContent, /const b = 2/);
  assert.doesNotMatch(sections[0].textContent, /const b/);
  const { preamble, sections: split } = ov.window.splitSolutionSections('Intro\n## Optimized — C\nx\n```js\n### Solution — not a heading\n```');
  assert.equal(preamble.trim(), 'Intro');
  assert.equal(split.length, 1, 'headings inside code fences are ignored');
});

test('Implementation points render as separate bullets whatever marker the model used', async () => {
  const impl = (points) => `### Solution — Sum\n**Approach**\n1. I add them.\n\`\`\`ts\nconst s = a + b // (1) add\nreturn s // (2) return\n\`\`\`\n**Implementation**\n${points}\n**Complexity** O(1)`;
  const cases = {
    bare: '(1) `a + b` adds.\n(2) `return s` returns.',
    bold: '**(1)** `a + b` adds.\n**(2)** `return s` returns.',
    dashed: '- (1) `a + b` adds.\n- (2) `return s` returns.',
  };
  for (const [name, points] of Object.entries(cases)) {
    display(impl(points), { messageId: name });
    const items = [...ov.row(name).querySelectorAll('li')].map(li => li.textContent);
    assert.ok(items.some(t => /\(1\).*adds/.test(t)) && items.some(t => /\(2\).*returns/.test(t)), `${name}: ${JSON.stringify(items)}`);
    assert.ok(!items.some(t => /adds[\s\S]*returns/.test(t)), `${name}: points merged into one item`);
    // The number is the marker: no bullet dot in front of "(1)".
    const numbered = [...ov.row(name).querySelectorAll('li')].filter(li => /^\s*\(\d\)/.test(li.textContent));
    assert.ok(numbered.length >= 2 && numbered.every(li => li.classList.contains('numbered-point')), `${name}: numbered points keep a bullet`);
    assert.ok(numbered[0].parentElement.classList.contains('numbered-points'));
  }
  // A plain bullet next to numbered points keeps its dot.
  display(impl('- (1) `a + b` adds.\n- (2) `return s` returns.\n- Uses a const, so nothing is mutated.'), { messageId: 'mixed' });
  const plain = [...ov.row('mixed').querySelectorAll('li')].find(li => /Uses a const/.test(li.textContent));
  assert.ok(!plain.classList.contains('numbered-point'));
  // Lines inside code fences are never touched.
  assert.equal(ov.window.separateListsFromParagraphs('```\n(1) x\n```'), '```\n(1) x\n```');
});
