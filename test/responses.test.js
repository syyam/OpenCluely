// Full responses: every public LLM entry point end-to-end over the fake
// network — what comes back ({response, metadata}), what streamed, which
// model/config was sent, and what happens when things fail.
const env = require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./helpers/fake-gemini');

const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');
const config = env.req('src/core/config');
const modelHealth = env.req('src/core/model-health');
const responseLanguage = env.req('src/core/response-language');

const NORMAL = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
const REASONING = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const CODE = '### Solution — Sum\n```\nfun sum(a: Int, b: Int) = a + b // (1) add\n```';
const record = (over = {}) => ({ kind: 'chat', question: 'Sum two numbers', answer: CODE, skill: 'android', programmingLanguage: 'kotlin', framework: 'auto', ...over });
const failAll = (models, n = 3) => models.forEach(m => fake.script(m, ...Array(n).fill({ status: 503, body: fake.errorEvent() })));
const sent = (i = 0) => fake.requests[i];

test.before(() => {
  fake.install(llm);
  llm.delay = async () => {};
  config.set('llm.gemini.maxRetries', 3);
});
test.after(() => fake.uninstall());
test.beforeEach(() => { fake.reset(); session.clear(); env.logs.length = 0; modelHealth.reset(); });

test('typed chat: streamed answer, metadata, normal model + minimal thinking', async () => {
  fake.script(NORMAL[0], fake.sse('A closure ', 'captures scope.'));
  const deltas = [];
  const r = await llm.processTextWithSkillStream('What is a closure?', 'frontend', [], 'typescript', d => deltas.push(d));
  assert.equal(r.response, 'A closure captures scope.');
  assert.deepEqual(deltas, ['A closure ', 'captures scope.']);
  assert.equal(r.metadata.streamed, true);
  assert.equal(r.metadata.usedFallback, false);
  assert.equal(r.metadata.skill, 'frontend');
  assert.equal(sent().model, NORMAL[0]);
  assert.deepEqual(sent().body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' }, '3.5-flash-lite gets minimal');
  assert.equal(sent().body.generationConfig.maxOutputTokens, 4096);
  assert.ok(sent().body.systemInstruction.parts[0].text.includes(env.RESUME.frontend));
});

test('voice: transcript note sent; code fences retagged to the selected language', async () => {
  fake.script(NORMAL[0], fake.sse('Here:\n```\n', 'val x = 1\n```'));
  const r = await llm.processTranscriptionWithIntelligentResponseStream('write val x', 'android', [], 'kotlin', null);
  assert.ok(r.response.includes('```kotlin'), 'fence tagged with the selected language');
  assert.equal(r.metadata.isTranscriptionResponse, true);
  assert.ok(sent().body.systemInstruction.parts[0].text.includes('## Live Transcript Input'));
});

test('screenshot(s): one request with the images, metadata counts them', async () => {
  fake.script(NORMAL[0], fake.sse('Implement it like this.'));
  const images = [{ buffer: Buffer.from('a'), mimeType: 'image/png' }, { buffer: Buffer.from('b'), mimeType: 'image/png' }];
  const r = await llm.processImageWithSkillStream(images, 'frontend', 'typescript', null, { text: 'stub' });
  assert.equal(r.response, 'Implement it like this.');
  assert.equal(r.metadata.imageCount, 2);
  assert.equal(r.metadata.isImageAnalysis, true);
  const parts = sent().body.contents[sent().body.contents.length - 1].parts;
  assert.equal(parts.filter(p => p.inlineData).length, 2);
});

test('normal answer survives a mid-answer break: partial cleared, next model answers in full', async () => {
  fake.script(NORMAL[0], { sse: [fake.textEvent('Half an ans'), fake.errorEvent()] });
  fake.script(NORMAL[1], fake.sse('Full answer ', 'from the fallback.'));
  let shown = '';
  let resets = 0;
  const r = await llm.processTextWithSkillStream('q', 'frontend', [], 'typescript', d => { shown += d; }, () => { resets++; shown = ''; });
  assert.equal(r.response, 'Full answer from the fallback.');
  assert.equal(shown, r.response);
  assert.equal(resets, 1);
  assert.deepEqual(fake.models(), NORMAL.slice(0, 2));
});

test('streaming fails everywhere → non-streaming answer is used', async () => {
  NORMAL.forEach(m => fake.script(m, { sse: [fake.textEvent('half'), fake.errorEvent()] }));
  fake.script(NORMAL[2], { sse: [fake.textEvent('half'), fake.errorEvent()] }, { sse: [fake.textEvent('half'), fake.errorEvent()] });
  fake.script(NORMAL[0], { json: { candidates: [{ content: { parts: [{ text: 'Non-streamed answer.' }] }, finishReason: 'STOP' }] } });
  let resets = 0;
  const r = await llm.processTextWithSkillStream('q', 'frontend', [], 'typescript', () => {}, () => resets++);
  assert.equal(r.response, 'Non-streamed answer.');
  assert.ok(resets >= 1, 'partial text cleared before the non-streamed answer');
  assert.ok(fake.requests.some(q => q.kind === 'generate'));
});

test('total failure on a normal answer → canned "could you repeat" reply (English and Japanese)', async () => {
  failAll(NORMAL, 3);
  failAll(NORMAL, 3); // non-streaming pass too
  const r = await llm.processTranscriptionWithIntelligentResponseStream('q', 'frontend', [], 'typescript', null);
  assert.equal(r.metadata.usedFallback, true);
  assert.match(r.response, /repeat or rephrase/);
  env.setJapanese(true);
  try {
    assert.match(llm.generateIntelligentFallbackResponse('q', 'frontend').response, /Sumimasen/);
  } finally {
    env.setJapanese(false);
  }
  void responseLanguage;
});

for (const mode of ['deep', 'optimized']) {
  test(`${mode}: reasoning chain 3.6 → 3.5-lite → 3.1-lite with medium thinking and 8192 tokens`, async () => {
    fake.script(REASONING[0], { status: 503, body: fake.errorEvent() });
    fake.script(REASONING[1], fake.sse('### Solution — Sum (reviewed)\n```\nfun sum(a: Int, b: Int) = a + b\n```'));
    const r = await llm.processExpansionStream(record(), null, mode);
    assert.equal(r.metadata.isExpansion, true);
    assert.equal(r.metadata.expansionMode, mode);
    assert.ok(r.response.includes('```kotlin'), 'record language enforced');
    assert.deepEqual(fake.models(), REASONING.slice(0, 2));
    for (const q of fake.requests) {
      assert.deepEqual(q.body.generationConfig.thinkingConfig, { thinkingLevel: 'medium' }, q.model);
      assert.equal(q.body.generationConfig.maxOutputTokens, 8192);
    }
  });
}

test('details and convert stay on the normal model (fast path)', async () => {
  fake.script(NORMAL[0], fake.sse('More depth.'));
  await llm.processExpansionStream(record(), null, 'details');
  assert.equal(sent().model, NORMAL[0]);
  fake.reset();
  fake.script(NORMAL[0], fake.sse('```html\n<div id="app"></div>\n```'));
  const vue = record({ skill: 'frontend', programmingLanguage: 'typescript', framework: 'vue3', answer: '```vue\n<script setup>\n</script>\n```' });
  const r = await llm.processExpansionStream(vue, null, 'convert:vue-options-cdn');
  assert.equal(sent().model, NORMAL[0]);
  assert.ok(r.response.includes('```html'), 'html page tag kept');
});

test('expansion total failure throws (overlay shows Retry) instead of a canned reply', async () => {
  failAll(REASONING, 3);
  failAll(REASONING, 3);
  await assert.rejects(llm.processExpansionStream(record(), null, 'deep'));
});

test('expansion mid-answer break resets the overlay row before the retry', async () => {
  fake.script(REASONING[0], { sse: [fake.textEvent('Half a review'), fake.errorEvent()] });
  fake.script(REASONING[1], fake.sse('Whole review.'));
  let shown = '';
  const r = await llm.processExpansionStream(record(), d => { shown += d; }, 'deep', () => { shown = ''; });
  assert.equal(r.response, 'Whole review.');
  assert.equal(shown, 'Whole review.');
});

test('not initialized (no API key) → clear error on every entry point', async () => {
  llm.isInitialized = false;
  try {
    await assert.rejects(llm.processTextWithSkillStream('q', 'frontend'), /not initialized/);
    await assert.rejects(llm.processTranscriptionWithIntelligentResponseStream('q', 'frontend'), /not initialized/);
    await assert.rejects(llm.processExpansionStream(record(), null, 'deep'), /not initialized/);
  } finally {
    llm.isInitialized = true;
  }
});

test('today\'s case: 3.6-flash out of daily quota → the next Deep/Optimized go straight to 3.5-flash-lite (medium)', async () => {
  const daily = { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded … limit: 20, model: gemini-3.6-flash. Please retry in 27s.', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } } };
  fake.script(REASONING[0], daily);
  fake.script(REASONING[1], fake.sse('First deep review.'), fake.sse('Second deep review.'), fake.sse('Optimized version.'));
  await llm.processExpansionStream(record(), null, 'deep');
  await llm.processExpansionStream(record({ question: 'another' }), null, 'deep');
  await llm.processExpansionStream(record(), null, 'optimized');
  assert.deepEqual(fake.models(), [REASONING[0], REASONING[1], REASONING[1], REASONING[1]], '3.6 asked once, then skipped');
  for (const q of fake.requests.slice(1)) assert.deepEqual(q.body.generationConfig.thinkingConfig, { thinkingLevel: 'medium' });
  assert.equal(env.findLogs('Skipping models for now').length, 2);
});

test('normal answers are untouched while only the reasoning model is out', async () => {
  modelHealth.recordFailure(REASONING[0], new Error('HTTP 429 RESOURCE_EXHAUSTED GenerateRequestsPerDayPerProjectPerModel'));
  fake.script(NORMAL[0], fake.sse('Normal answer.'));
  const r = await llm.processTextWithSkillStream('q', 'frontend', [], 'typescript', null);
  assert.equal(r.response, 'Normal answer.');
  assert.deepEqual(fake.models(), [NORMAL[0]]);
});
