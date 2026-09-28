const env = require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');

const cf = env.req('src/core/code-formats');
const framework = env.req('src/core/framework');
const { getComparisonNote } = env.req('src/core/answer-format');
const { getWhisperPrompt } = env.req('src/core/speech-vocab');

const fence = (tag, code) => '```' + tag + '\n' + code + '\n```';
const VUE_SFC = fence('vue', '<script setup lang="ts">\nimport { ref } from \'vue\'\nconst q = ref(\'\')\n</script>\n<template><li v-for="r in rs" :key="r">{{ r }}</li></template>');
const VUE_OPTIONS_CDN = fence('html', '<div id="app"></div>\n<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>\n<script>\nVue.createApp({ data() { return { q: \'\' } }, methods: {} }).mount(\'#app\')\n</script>');
const REACT_TSX = fence('tsx', 'import { useState } from \'react\'\nexport function S() { const [q, setQ] = useState<string>(\'\'); return <input className="x" /> }');
const REACT_JSX = fence('jsx', 'import { useState } from \'react\'\nexport function S() { const [q, setQ] = useState(\'\'); return <input className="x" /> }');

test('detectFormat reads the format from the answer code', () => {
  assert.deepEqual(cf.detectFormat(VUE_SFC, 'auto'), { family: 'vue3', current: 'vue-composition-sfc' });
  assert.deepEqual(cf.detectFormat(VUE_OPTIONS_CDN, 'auto'), { family: 'vue3', current: 'vue-options-cdn' });
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
  assert.ok(getComparisonNote('What is the difference between SSR and CSR?').includes('comparison table'));
  assert.equal(getComparisonNote('What is a closure?'), '');
});

test('whisper vocabulary: profile terms, framework terms last', () => {
  const p = getWhisperPrompt('frontend', 'vue3');
  assert.ok(p.includes('Zustand'));
  assert.ok(p.trim().endsWith('Pinia'), 'framework terms go last (whisper keeps the tail)');
  assert.ok(getWhisperPrompt('frontend', 'auto').includes('v-for'), 'web Auto keeps Vue terms');
  assert.ok(getWhisperPrompt('android', 'auto').includes('Kotlin'));
});
