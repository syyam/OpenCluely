// LIVE check against the real Gemini API — run on demand: npm run test:live
// Uses your real key (.env) and a copy of your saved frontend resume (so the
// prompt size and latency are realistic), but logs to a temp dir like the
// offline suite. Quota per run (free tier): ~2 requests on the normal model
// (500/day), ~2 on gemini-3.6-flash (20/day) — more if a model is overloaded
// and it falls back. Don't run it right before an interview.
const env = require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const realEnv = require('dotenv').parse(fs.readFileSync(path.join(env.ROOT, '.env')));
process.env.GEMINI_API_KEY = realEnv.GEMINI_API_KEY || '';
const savedResume = path.join(process.env.APPDATA || '', 'opencluely', 'resume-profiles', 'frontend.txt');
if (fs.existsSync(savedResume)) env.writeResume('frontend', fs.readFileSync(savedResume, 'utf8'));

const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');
llm.initializeClient();

const skip = !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your-api-key-here';
const rows = [];
const WARN_NORMAL_FIRST_MS = 8000;

async function measure(name, run, limits) {
  env.logs.length = 0;
  const t0 = Date.now();
  let firstMs = null;
  const r = await run(() => { if (firstMs === null) firstMs = Date.now() - t0; });
  const totalMs = Date.now() - t0;
  const finishes = env.findLogs(/^Gemini stream finished|hit maxOutputTokens|unusual finishReason/);
  const last = finishes[finishes.length - 1] || {};
  const failed = env.findLogs(/streaming attempt \d+ failed/);
  const attempts = failed.map(l => l.model);
  for (const l of failed) {
    const reason = /first-chunk timeout/.test(l.error) ? 'no response (first-chunk timeout)'
      : (String(l.error).match(/HTTP \d{3}[^:]*/) || [String(l.error).slice(0, 60)])[0];
    console.log(`  ${name}: ${l.model} failed after ${new Date(l.timestamp) - t0}ms — ${reason}`);
  }
  rows.push({ name, model: last.model || '(non-streamed)', firstMs, totalMs, finish: last.finishReason || '-', out: last.outputTokens, thoughts: last.thoughtsTokens || 0, prompt: last.promptTokens, fellBackFrom: attempts.join(' → ') });

  assert.ok(r.response && r.response.trim().length > 40, `${name}: empty/short answer`);
  assert.equal(r.metadata.usedFallback, false, `${name}: canned fallback reply`);
  if (last.finishReason) assert.equal(last.finishReason, 'STOP', `${name}: answer did not finish cleanly`);
  assert.ok(firstMs === null || firstMs < limits.firstMs, `${name}: first chunk ${firstMs}ms > ${limits.firstMs}ms`);
  return r;
}

test.before(() => session.clear());
test.after(() => {
  console.log('\nLive results');
  console.table(rows.map(r => ({
    check: r.name, model: r.model, 'first chunk': r.firstMs === null ? '-' : `${(r.firstMs / 1000).toFixed(1)}s`,
    total: `${(r.totalMs / 1000).toFixed(1)}s`, finish: r.finish, 'out/thought/prompt tokens': `${r.out}/${r.thoughts}/${r.prompt}`,
    'fell back from': r.fellBackFrom || '-',
  })));
  for (const r of rows) {
    if (/normal/.test(r.name) && r.firstMs > WARN_NORMAL_FIRST_MS) console.log(`⚠ ${r.name}: first chunk ${r.firstMs}ms is slow (> ${WARN_NORMAL_FIRST_MS}ms)`);
  }
});

const VUE_RECORD = {
  kind: 'chat', question: 'Implement a debounced search input in Vue 3 that calls fakeApi.search(query) and shows results.',
  answer: "### Solution — Debounced watcher\n```vue\n<script setup lang=\"ts\">\nimport { ref, watch } from 'vue'\nconst query = ref('')\nconst results = ref<string[]>([])\nlet t: ReturnType<typeof setTimeout> | undefined\nwatch(query, (q) => { // (1) react to input\n  clearTimeout(t) // (2) reset timer\n  t = setTimeout(async () => { results.value = await fakeApi.search(q) }, 300) // (3) debounce\n})\n</script>\n<template><input v-model=\"query\" /><ul><li v-for=\"r in results\" :key=\"r\">{{ r }}</li></ul></template>\n```",
  skill: 'frontend', programmingLanguage: 'typescript', framework: 'vue3',
};

test('normal answer (typed chat)', { skip }, async () => {
  await measure('normal: chat', (onFirst) => llm.processTextWithSkillStream('What is the difference between useMemo and useCallback?', 'frontend', [], 'typescript', onFirst), { firstMs: 30000 });
});

test('normal answer (voice transcript)', { skip }, async () => {
  await measure('normal: voice', (onFirst) => llm.processTranscriptionWithIntelligentResponseStream('how would you make a large list render fast in react', 'frontend', [], 'typescript', onFirst), { firstMs: 30000 });
});

test('Deep reasoning on a coding answer', { skip }, async () => {
  const r = await measure('deep reasoning: code', (onFirst) => llm.processExpansionStream(VUE_RECORD, onFirst, 'deep'), { firstMs: 60000 });
  assert.match(r.response, /###\s+Solution\b[^\n]*\(reviewed\)/, 'starts with the reviewed solution');
});

test('Optimized solution', { skip }, async () => {
  const r = await measure('optimized', (onFirst) => llm.processExpansionStream(VUE_RECORD, onFirst, 'optimized'), { firstMs: 60000 });
  assert.match(r.response, /###\s+Optimized\b/);
});
