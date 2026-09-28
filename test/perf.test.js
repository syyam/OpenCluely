// Speed budgets for the local work done on every question, before/after the
// network. Averages over many runs; limits are generous (several × the
// measured cost) so the check is about regressions, not machine noise.
const env = require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');

const { promptLoader } = env.req('prompt-loader');
const { matchKnowledge } = env.req('src/core/knowledge');
const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');

const RUNS = 50;
function avgMs(fn) {
  fn(); // warm caches (prompt files, knowledge index)
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < RUNS; i++) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6 / RUNS;
}

const results = {};
test.after(() => {
  console.log('\nLocal cost per question (avg of %d runs):', RUNS);
  for (const [name, ms] of Object.entries(results)) console.log(`  ${name.padEnd(34)} ${ms.toFixed(3)} ms`);
});

test.before(() => {
  session.clear();
  for (let i = 1; i <= 8; i++) {
    session.addUserInput(`Question ${i} about React state management and rendering`);
    session.addModelResponse('Answer '.repeat(200));
  }
});

test('system prompt build (profile + resume + blocks) < 5ms', () => {
  const ms = results['system prompt build'] = avgMs(() => promptLoader.getSkillPrompt('frontend', 'typescript', 'vue3'));
  assert.ok(ms < 5, `${ms.toFixed(2)}ms`);
});

test('knowledge match for a question < 5ms', () => {
  const ms = results['knowledge match'] = avgMs(() => matchKnowledge('Walk me through the architecture of Rakuten GORA', 'frontend', 'How did you manage state?'));
  assert.ok(ms < 5, `${ms.toFixed(2)}ms`);
});

test('full request build: chat / voice / Deep reasoning < 10ms each', () => {
  const rec = { kind: 'chat', question: 'Debounced search in Vue', answer: '```vue\n<script setup></script>\n```', skill: 'frontend', programmingLanguage: 'typescript', framework: 'vue3' };
  const chat = results['chat request build'] = avgMs(() => llm.buildGeminiRequest('How does reconciliation work?', 'frontend', [], 'typescript'));
  const voice = results['voice request build'] = avgMs(() => llm.buildIntelligentTranscriptionRequest('How does reconciliation work?', 'frontend', [], 'typescript'));
  const deep = results['deep reasoning request build'] = avgMs(() => llm.buildExpansionRequest(rec, 'deep'));
  for (const [name, ms] of [['chat', chat], ['voice', voice], ['deep', deep]]) assert.ok(ms < 10, `${name}: ${ms.toFixed(2)}ms`);
});

test('history → Gemini contents < 1ms', () => {
  const history = session.getConversationHistory(15);
  const ms = results['history contents'] = avgMs(() => llm._historyContents(history, 15));
  assert.ok(ms < 1, `${ms.toFixed(3)}ms`);
});
