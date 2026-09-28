const env = require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');

const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');
const config = env.req('src/core/config');

const sys = (req) => req.systemInstruction.parts[0].text;
const lastUser = (req) => req.contents[req.contents.length - 1].parts.map(p => p.text || '').join('');
const CODE_ANSWER = '### Solution — Debounce\n```vue\n<script setup lang="ts">\nconst t = 1 // (1) timer\n</script>\n```';

test.beforeEach(() => session.clear());

test('chat request: profile prompt as system instruction, question as last user turn, history before it', () => {
  session.addUserInput('Earlier question');
  session.addModelResponse('Earlier answer');
  const req = llm.buildGeminiRequest('What is a closure?', 'frontend', [], 'typescript');
  assert.ok(sys(req).includes('## Implementation language: TYPESCRIPT'));
  assert.ok(sys(req).includes(env.RESUME.frontend));
  assert.ok(!sys(req).includes('## Live Transcript Input'), 'voice note is voice-only');
  assert.deepEqual(req.contents.map(c => c.role), ['user', 'model', 'user']);
  assert.equal(req.contents[0].parts[0].text, 'Earlier question');
  assert.ok(lastUser(req).startsWith('What is a closure?'));
  assert.deepEqual(req.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(req.generationConfig.maxOutputTokens, 4096);
});

test('voice request adds the live-transcript note; comparison questions get the table note', () => {
  const req = llm.buildIntelligentTranscriptionRequest('useMemo vs useCallback', 'frontend', [], 'typescript');
  assert.ok(sys(req).includes('## Live Transcript Input'));
  assert.ok(lastUser(req).includes('comparison table'));
  assert.throws(() => llm.buildIntelligentTranscriptionRequest('   ', 'frontend', [], 'typescript'));
});

test('image request: instruction, ordered images with labels, typed text, base64 data', () => {
  const images = [{ buffer: Buffer.from('img-one'), mimeType: 'image/png' }, { buffer: Buffer.from('img-two'), mimeType: 'image/jpeg' }];
  const req = llm.buildImageRequest(images, 'frontend', 'typescript', { text: 'only the stub' });
  const parts = req.contents[req.contents.length - 1].parts;
  assert.match(parts[0].text, /These 2 screenshots/);
  assert.match(parts[0].text, /only the stub/);
  assert.equal(parts[1].text, 'Image 1 of 2:');
  assert.equal(parts[2].inlineData.data, Buffer.from('img-one').toString('base64'));
  assert.equal(parts[3].text, 'Image 2 of 2:');
  assert.equal(parts[4].inlineData.mimeType, 'image/jpeg');
  assert.throws(() => llm.buildImageRequest([], 'frontend', null));
});

test('expansion requests: note, ask and generation config per mode', () => {
  const rec = { kind: 'chat', question: 'Debounced search in Vue 3', answer: CODE_ANSWER, skill: 'frontend', programmingLanguage: 'typescript', framework: 'vue3' };
  const reasoning = config.get('llm.gemini.reasoning');

  const details = llm.buildExpansionRequest(rec, 'details');
  assert.ok(sys(details).includes('## More Details Request'));
  assert.equal(lastUser(details), 'More details, please.');
  assert.deepEqual(details.generationConfig.thinkingConfig, { thinkingBudget: 0 }, 'More details stays fast');

  const deep = llm.buildExpansionRequest(rec, 'deep');
  assert.ok(sys(deep).includes('## Deep Reasoning Request'));
  assert.match(lastUser(deep), /^Deep reasoning review of this answer, please\. Start with `### Solution — … \(reviewed\)`/);
  assert.deepEqual(deep.generationConfig.thinkingConfig, { thinkingLevel: reasoning.thinkingLevel });
  assert.equal(deep.generationConfig.maxOutputTokens, reasoning.maxOutputTokens);

  const deepTheory = llm.buildExpansionRequest({ ...rec, answer: 'React diffs a virtual tree.' }, 'deep');
  assert.equal(lastUser(deepTheory), 'Deep reasoning review of this answer, please.', 'no coding structure for theory answers');

  const opt = llm.buildExpansionRequest(rec, 'optimized');
  assert.ok(sys(opt).includes('## Optimized Solution Request'));
  assert.deepEqual(opt.generationConfig.thinkingConfig, { thinkingLevel: reasoning.thinkingLevel });

  const conv = llm.buildExpansionRequest(rec, 'convert:vue-options-cdn');
  assert.ok(sys(conv).includes('## Format Conversion Request'));
  assert.equal(conv.generationConfig.maxOutputTokens, 8192);
  assert.deepEqual(conv.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.throws(() => llm.buildExpansionRequest(rec, 'convert:nope'));

  // Focused on the one exchange: question → answer → ask, no other history.
  session.addUserInput('unrelated');
  session.addModelResponse('unrelated answer');
  assert.deepEqual(llm.buildExpansionRequest(rec, 'deep').contents.map(c => c.role), ['user', 'model', 'user']);
  // Uses the record's profile, not the current one.
  assert.ok(sys(llm.buildExpansionRequest({ ...rec, skill: 'android' }, 'details')).includes(env.RESUME.android));
});

test('converted record pins its format for later expansions', () => {
  const rec = { kind: 'chat', question: 'Debounced search in Vue 3', answer: CODE_ANSWER, skill: 'frontend', programmingLanguage: 'typescript', framework: 'vue3', format: 'vue-options-cdn' };
  for (const mode of ['deep', 'optimized', 'details']) {
    assert.match(lastUser(llm.buildExpansionRequest(rec, mode)), /Options API \+ CDN format .* keep that exact format/, mode);
  }
});

test('history: only the latest answer is replaced by its newer code; older answers stay normal', () => {
  session.addUserInput('Q1');
  const a1 = session.addModelResponse('A1 full answer');
  session.setLatestCode(a1, { mode: 'optimized', code: '```ts\nOPT\n```' });
  let h = llm._historyContents(session.getConversationHistory(10), 8);
  assert.match(h[1].parts[0].text, /^\[Current version of this solution \(optimized\)/);
  assert.ok(h[1].parts[0].text.includes('OPT'));

  session.addUserInput('Q2');
  session.addModelResponse('A2');
  h = llm._historyContents(session.getConversationHistory(10), 8);
  assert.equal(h[1].parts[0].text, 'A1 full answer', 'expansion code stops once a newer answer exists');

  session.setLatestCode(a1, { mode: 'convert:vue-options-cdn', code: 'x' });
  const conv = llm._latestCodeTurn({ mode: 'convert:vue-options-cdn', code: 'x' });
  assert.match(conv, /converted to Options API \+ CDN/);
  assert.match(llm._latestCodeTurn({ mode: 'deep', code: 'x' }), /deep-reasoning review/);
});

test('history window limits: voice 8 turns, chat 15', () => {
  for (let i = 1; i <= 10; i++) { session.addUserInput(`Q${i}`); session.addModelResponse(`A${i}`); }
  const voice = llm.buildIntelligentTranscriptionRequest('new', 'frontend', [], 'typescript');
  assert.equal(voice.contents.length, 8 + 1);
  const chat = llm.buildGeminiRequest('new', 'frontend', [], 'typescript');
  assert.ok(chat.contents.length <= 15 + 1);
  assert.equal(chat.contents[chat.contents.length - 2].parts[0].text, 'A10');
});

test('model lists and per-model thinking overrides', () => {
  llm.model = config.get('llm.gemini.model');
  assert.deepEqual(llm._modelsToTry(), [config.get('llm.gemini.model'), ...config.get('llm.gemini.fallbackModels')]);
  assert.deepEqual(llm._modelsToTry(['a', 'b', 'a']), ['a', 'b']);
  const base = { contents: [], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } };
  assert.deepEqual(llm._requestForModel(base, 'gemini-3.5-flash-lite').generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(llm._requestForModel(base, 'gemini-3.1-flash-lite'), base, 'no override → same request');
  const explicit = { contents: [], generationConfig: { thinkingConfig: { thinkingLevel: 'medium' } } };
  assert.equal(llm._requestForModel(explicit, 'gemini-3.5-flash-lite'), explicit, 'explicit level kept');
});

test('config: normal path and reasoning chain are what we tested live', () => {
  assert.equal(config.get('llm.gemini.model'), 'gemini-3.5-flash-lite');
  assert.deepEqual(config.get('llm.gemini.fallbackModels'), ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview']);
  const r = config.get('llm.gemini.reasoning');
  assert.deepEqual(r.models, ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  assert.equal(r.thinkingLevel, 'medium');
});

test('enforceProgrammingLanguage retags plain code, keeps framework/text tags and closing fences', () => {
  const input = ['```', 'a', '```', '```python', 'b', '```', '```vue', 'c', '```', '```text', 'd', '```', '~~~js', 'e', '~~~'].join('\n');
  const out = llm.enforceProgrammingLanguage(input, 'typescript').split('\n');
  assert.deepEqual(out.filter(l => l.startsWith('```')), ['```typescript', '```', '```typescript', '```', '```vue', '```', '```text', '```', '```typescript', '```']);
  assert.equal(llm.enforceProgrammingLanguage('no code', 'kotlin'), 'no code');
});
