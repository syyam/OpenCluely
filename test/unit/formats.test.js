const env = require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');

const cf = env.req('src/core/code-formats');
const framework = env.req('src/core/framework');
const { getComparisonNote } = env.req('src/core/answer-format');
const { getWhisperPrompt, extractTerms } = env.req('src/core/speech-vocab');

const fence = (tag, code) => '```' + tag + '\n' + code + '\n```';
const VUE_SFC = fence('vue', '<script setup lang="ts">\nimport { ref } from \'vue\'\nconst q = ref(\'\')\n</script>\n<template><li v-for="r in rs" :key="r">{{ r }}</li></template>');
const VUE_OPTIONS_CDN = fence('html', '<div id="app"></div>\n<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>\n<script>\nVue.createApp({ data() { return { q: \'\' } }, methods: {} }).mount(\'#app\')\n</script>');
const REACT_TSX = fence('tsx', 'import { useState } from \'react\'\nexport function S() { const [q, setQ] = useState<string>(\'\'); return <input className="x" /> }');
const REACT_JSX = fence('jsx', 'import { useState } from \'react\'\nexport function S() { const [q, setQ] = useState(\'\'); return <input className="x" /> }');

test('detectFormat reads the format from the answer code', () => {
  assert.deepEqual(cf.detectFormat(VUE_SFC, 'auto'), { family: 'vue3', current: 'vue-composition-sfc' });
  assert.deepEqual(cf.detectFormat(VUE_OPTIONS_CDN, 'auto'), { family: 'vue3', current: 'vue-options-cdn' });
  const VUE_COMPOSITION_CDN = fence('html', `<div id="app"><li v-for="r in rs" :key="r">{{ r }}</li></div>
<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
<script>
Vue.createApp({ setup() { const rs = Vue.ref([]); return { rs } } }).mount('#app')
</script>`);
  assert.deepEqual(cf.detectFormat(VUE_COMPOSITION_CDN, 'vue3'), { family: 'vue3', current: 'vue-composition-cdn' });
  assert.deepEqual(cf.conversionOptions(VUE_COMPOSITION_CDN, 'vue3').map(o => o.id), ['vue-composition-sfc', 'vue-options-sfc', 'vue-options-cdn'], 'the default CDN page offers the SFC formats');
  const VUE2_CDN = fence('html', `<div id="app"><li v-for="n in m">{{ n }}</li></div>
<script src="https://unpkg.com/vue@2/dist/vue.js"></script>
<script>
new Vue({ el: '#app', data: { m: 3 } })
</script>`);
  assert.deepEqual(cf.detectFormat(VUE2_CDN, 'auto'), { family: 'vue2', current: 'vue2-options-cdn' });
  // The default in-page form (template + script for a page that already loads Vue) IS the CDN
  // format, so its own button is hidden and the others convert it.
  const VUE_SHORT = fence('html', `<div id="app"><input v-model="query" /></div>
<script>
const { createApp, ref, watch } = Vue
createApp({ setup() { const query = ref(''); return { query } } }).mount('#app')
</script>`);
  assert.deepEqual(cf.detectFormat(VUE_SHORT, 'vue3'), { family: 'vue3', current: 'vue-composition-cdn' });
  assert.deepEqual(cf.conversionOptions(VUE_SHORT, 'vue3').map(o => o.id), ['vue-composition-sfc', 'vue-options-sfc', 'vue-options-cdn']);
  const VUE2_SHORT = fence('html', `<div id="app"><li v-for="n in m">{{ n }}</li></div>
<script>
new Vue({ el: '#app', data() { return { m: 3 } } })
</script>`);
  assert.deepEqual(cf.detectFormat(VUE2_SHORT, 'auto'), { family: 'vue2', current: 'vue2-options-cdn' });
  assert.deepEqual(cf.conversionOptions(VUE2_SHORT, 'auto').map(o => o.id), ['vue2-options-sfc', 'vue2-composition-sfc']);
  assert.deepEqual(cf.detectFormat(REACT_TSX, 'auto'), { family: 'react', current: 'react-tsx' });
  assert.deepEqual(cf.detectFormat(REACT_JSX, 'auto'), { family: 'react', current: 'react-jsx' });
  assert.equal(cf.detectFormat(fence('ts', 'function twoSum(a: number[]) { return a }'), 'auto'), null, 'plain code: no conversions');
  assert.equal(cf.detectFormat('no code at all', 'auto'), null);
  assert.equal(cf.detectFormat(REACT_TSX, 'nextjs'), null, 'Next.js answers get no conversions');
});

test('conversionOptions never offers the current format and stays in the family', () => {
  const ids = cf.conversionOptions(VUE_SFC, 'vue3').map(o => o.id);
  assert.ok(!ids.includes('vue-composition-sfc'));
  assert.ok(ids.includes('vue-options-cdn'));
  assert.ok(ids.every(id => cf.getFormat(id).family === 'vue3'));
  assert.deepEqual(cf.conversionOptions('prose only', 'vue3'), []);
});

test('solutionCode keeps real code, drops prose and text diagrams; afterHeading selects a section', () => {
  const answer = 'Intro\n### Solution — A (reviewed)\n' + fence('vue', 'ORIGINAL') + '\n' + fence('text', 'trace') + '\n### Improved — B\n' + fence('vue', 'IMPROVED');
  assert.equal(cf.solutionCode(answer), fence('vue', 'ORIGINAL') + '\n\n' + fence('vue', 'IMPROVED'));
  assert.equal(cf.solutionCode(answer, { afterHeading: 'Improved' }), fence('vue', 'IMPROVED'));
  assert.equal(cf.solutionCode('no improved section\n' + fence('js', 'x'), { afterHeading: 'Improved' }), '');
  assert.equal(cf.solutionCode('just words'), '');
});

test('getConvertNote describes the target format and script language', () => {
  const note = cf.getConvertNote('vue-options-cdn', 'typescript');
  assert.ok(note.includes('## Format Conversion Request'));
  assert.ok(note.includes('Options API + CDN'));
  assert.ok(note.includes('plain JavaScript'), 'CDN pages run without a build step');
  assert.ok(note.includes('no page boilerplate'), 'Vue CDN conversions stay in the in-page form');
  assert.ok(!note.includes('full runnable page'));
  assert.ok(cf.getConvertNote('vue-composition-sfc', 'typescript').includes('no `<style>` block'), 'SFCs have no boilerplate either');
  assert.ok(cf.getConvertNote('react-cdn', 'javascript').includes('full runnable page'), 'React CDN is still a full page');
  assert.ok(note.includes('same Key idea and Approach steps (Approach is required'), 'conversions keep (or add) the Approach');
  assert.ok(cf.getConvertNote('react-class', 'javascript').includes('JavaScript'));
  assert.equal(cf.getConvertNote('nope'), '');
});

test('framework options per profile, fallback to Auto, effective language', () => {
  assert.equal(framework.getFrameworkOptions('frontend')[0].id, 'auto');
  assert.ok(framework.getFrameworkOptions('frontend').some(o => o.id === 'vue3'));
  assert.ok(!framework.getFrameworkOptions('android').some(o => o.id === 'vue3'));
  assert.equal(framework.setFramework('vue3', 'frontend'), 'vue3');
  assert.equal(framework.setFramework('vue3', 'android'), 'auto', 'not offered → Auto');
  assert.equal(framework.getFramework(), 'auto');
  assert.equal(framework.getEffectiveLanguage('rails', 'typescript'), 'ruby');
  assert.equal(framework.getEffectiveLanguage('react', 'javascript'), 'javascript');
  assert.equal(framework.getEffectiveLanguage('auto', 'kotlin'), 'kotlin');
  assert.equal(framework.offersWebFrameworks('frontend'), true);
  assert.equal(framework.offersWebFrameworks('android'), false);
});

test('comparison note only for comparison questions', () => {
  assert.ok(getComparisonNote('useMemo vs useCallback').includes('comparison table'));
  assert.ok(getComparisonNote('Arrow function versus regular function').includes('When to use which'));
  assert.ok(getComparisonNote('What is the difference between SSR and CSR?').includes('comparison table'));
  assert.equal(getComparisonNote('What is a closure?'), '');
  // A coding follow-up that says "compared" is not an X-vs-Y question.
  assert.equal(getComparisonNote('Now add toEqual so objects can be compared by value rather than reference.'), '');
  assert.ok(getComparisonNote('How does Vue compare to React?').includes('comparison table'));
  assert.ok(getComparisonNote('How is Pinia compared to Vuex?').includes('comparison table'));
});

test('whisper vocabulary: profile terms, framework terms last', () => {
  const p = getWhisperPrompt('frontend', 'vue3');
  assert.ok(p.includes('Zustand'));
  assert.ok(p.trim().endsWith('Pinia'), 'framework terms go last (whisper keeps the tail)');
  assert.ok(getWhisperPrompt('frontend', 'auto').includes('v-for'), 'web Auto keeps Vue terms');
  assert.ok(getWhisperPrompt('android', 'auto').includes('Kotlin'));
  for (const profile of ['android', 'frontend', 'fullstack']) {
    assert.ok(getWhisperPrompt(profile, 'auto').includes('Claude'), `${profile} hint names Claude (else heard as "cloud")`);
    // Speeqr was heard as "speaker"; project names must survive the ~224-token
    // tail Whisper keeps, even with a full set of answer terms.
    const full = getWhisperPrompt(profile, 'vue3', Array.from({ length: 20 }, (_, i) => 'answerTerm' + i));
    assert.ok(full.slice(-700).includes('Speeqr'), `${profile} hint keeps Speeqr in the tail`);
  }
});

test('whisper vocabulary: names from the latest answer go last; none → unchanged hint', () => {
  const answer = [
    'I use `expect` and `toBe` with `Object.is`; `v-for` renders it.',
    '```typescript',
    'function expect(actual: unknown) {',
    '  return {',
    '    toBe(expected: unknown) { // (1) compare with isSame',
    '      if (!Object.is(actual, expected)) throw new Error(`no`)',
    '      return true',
    '    },',
    '  }',
    '}',
    'const isEqual = (a, b) => a === b',
    '```',
  ].join('\n');
  const terms = extractTerms(answer);
  for (const t of ['expect', 'toBe', 'Object.is', 'v-for', 'isEqual']) assert.ok(terms.includes(t), t);
  for (const t of ['function', 'return', 'Error', 'if', 'isSame']) assert.ok(!terms.includes(t), `not ${t} (keyword/common/comment)`);
  assert.equal(new Set(terms).size, terms.length, 'no duplicates');
  assert.ok(extractTerms(Array.from({ length: 40 }, (_, i) => '`term' + i + '`').join(' ')).length <= 20, 'capped');
  const p = getWhisperPrompt('frontend', 'vue3', terms);
  assert.ok(p.endsWith(terms.join(', ')), 'conversation terms go last');
  assert.equal(getWhisperPrompt('frontend', 'vue3', []), getWhisperPrompt('frontend', 'vue3'));
  assert.deepEqual(extractTerms(''), []);
});

test('DSA framework: every profile, keeps the selected language, no conversions, DSA speech terms', () => {
  for (const p of ['android', 'frontend', 'fullstack']) {
    assert.equal(framework.getFrameworkOptions(p)[1].id, 'dsa', `${p}: DSA listed right after Auto`);
    assert.equal(framework.setFramework('dsa', p), 'dsa');
  }
  framework.setFramework('auto', 'frontend');
  for (const lang of ['kotlin', 'python', 'typescript', 'java', 'cpp']) assert.equal(framework.getEffectiveLanguage('dsa', lang), lang);
  const kotlin = fence('kotlin', 'class Solution { fun twoSum(nums: IntArray, target: Int): IntArray { return intArrayOf() } }');
  assert.deepEqual(cf.conversionOptions(kotlin, 'dsa'), []);
  assert.deepEqual(cf.conversionOptions(VUE_SFC, 'dsa'), [], 'no web conversions while DSA is selected');
  const w = getWhisperPrompt('frontend', 'dsa');
  assert.ok(w.includes('sliding window') && w.trim().endsWith('greedy'), 'DSA terms go last');
  assert.ok(!w.includes('v-for'), 'no Vue terms under DSA');
});

test('heardCodingQuestion: the answered term first, real alternatives only, none for long or repeated terms', () => {
  const { heardCodingQuestion, heardChoices } = env.req('src/core/answer-format');
  assert.equal(heardCodingQuestion('Flembic mode → Alembic mode | fluent mode'), 'Did you mean `Alembic mode` or `fluent mode`?');
  assert.equal(heardCodingQuestion('x dot be y → `.toBe(y)` | `.to(x).be(y)`, `.not`'), 'Did you mean `.toBe(y)`, `.to(x).be(y)` or `.not`?');
  assert.equal(heardCodingQuestion('a bort controller → AbortController'), null, 'one reading: build it');
  assert.equal(heardCodingQuestion('pagan nation → pagination | pagination'), null, 'a repeat is not an alternative');
  assert.equal(heardCodingQuestion('Next Take → Next.js App Router | Next.js'), null, 'a substring is not an alternative');
  assert.equal(heardCodingQuestion('Can you add dot to x → Can you add .not.toBe() to the expect function? | .to.be()'), null, 'a whole sentence is no button');
  assert.deepEqual(heardChoices('V4 → `v-for` | `v-if`'), { heard: 'V4', answered: 'v-for', alts: ['v-if'] });
});

test('splitImplementOffer: removes the IMPLEMENT line (plain or bold) and returns the change', () => {
  const { splitImplementOffer } = require('../../src/core/answer-format');
  assert.deepEqual(splitImplementOffer('- why\n- because\nIMPLEMENT: use `safeCount`'), { offer: 'use `safeCount`', body: '- why\n- because' });
  assert.deepEqual(splitImplementOffer('words\n\n**IMPLEMENT:** keep it\n'), { offer: 'keep it', body: 'words' });
  const plain = '**Implementation**\n- (1) Implement it later.';
  assert.deepEqual(splitImplementOffer(plain), { offer: null, body: plain });
});

test('createImplementFilter: streams everything else at once, drops the IMPLEMENT line even when split across chunks', () => {
  const { createImplementFilter } = require('../../src/core/answer-format');
  const run = (chunks) => {
    const got = [];
    const f = createImplementFilter((d) => got.push(d));
    chunks.forEach(c => f.push(c));
    const beforeFlush = got.join('');
    f.flush();
    return { beforeFlush, all: got.join('') };
  };
  const text = 'Some bullet\n**Implementation** here\nI think so\nIMPLEMENT: use `safeCount` in v-for';
  const chars = run(text.split(''));
  assert.equal(chars.all, 'Some bullet\n**Implementation** here\nI think so\n');
  assert.equal(run(['Hello wor', 'ld, no marker']).beforeFlush, 'Hello world, no marker', 'a line that can\'t be the marker is not held');
  assert.equal(run(['I', 'MPL']).all, 'IMPL', 'a held start that never became the marker is let out at the end');
  assert.equal(run(['x\n**IMPLEMENT:** a', ' b\nafter']).all, 'x\nafter');
});
