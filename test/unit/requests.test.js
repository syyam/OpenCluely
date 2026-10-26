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

test('"did you mean": the chat rule in chat, a coding-only rule for the interviewer, none for screenshots', () => {
  const chat = llm.buildGeminiRequest('Add support for X', 'frontend', [], 'typescript');
  assert.ok(sys(chat).includes('## Unclear word in a coding request (chat)'));
  assert.ok(sys(chat).includes('CLARIFY: Did you mean `<term>`, `<term>` or `<term>`?'));
  assert.ok(sys(chat).includes('Give 1 to 3 real terms'), 'several guesses, each one clickable in the chat');
  assert.ok(sys(chat).includes('never with CLARIFY'), 'non-coding questions are always answered');
  const voice = llm.buildIntelligentTranscriptionRequest('Add support for X', 'frontend', [], 'typescript');
  assert.ok(!sys(voice).includes('## Unclear word in a coding request (chat)'));
  assert.ok(sys(voice).includes('## Unclear word in a coding request (interviewer)\nOnly when the interviewer asks to write or change code'));
  assert.ok(sys(voice).includes('CLARIFY: Did you mean `<term>`, `<term>` or `<term>`?'));
  assert.ok(sys(voice).includes('Concept, experience and design questions are never questioned'));
  const image = llm.buildImageRequest([{ buffer: Buffer.from('x'), mimeType: 'image/png' }], 'frontend', 'typescript');
  assert.ok(!sys(image).includes('CLARIFY'));
});

test('interviewer (voice) prompt asks for a HEARD line only when a term was rebuilt; chat and screenshots do not', () => {
  const voice = llm.buildIntelligentTranscriptionRequest('What is the virtual dumb?', 'frontend', [], 'typescript');
  assert.ok(sys(voice).includes('make the very first line `HEARD: <words as transcribed> → <term you answered>`'));
  assert.ok(sys(voice).includes('end that line with ` | <term>, <term>` (at most 2)'), 'other guesses, each a button in chat');
  assert.ok(sys(voice).includes('Leave it off when only one reading fits'));
  assert.ok(sys(voice).includes('No such line when nothing was rebuilt'));
  assert.ok(sys(voice).includes('do not mention the mishearing in the answer'));
  const chat = llm.buildGeminiRequest('What is the virtual dumb?', 'frontend', [], 'typescript');
  assert.ok(!sys(chat).includes('HEARD:'));
});

test('dictated chat text gets the speech hint in its own user turn only', () => {
  session.addUserInput('Earlier question');
  session.addModelResponse('Earlier answer');
  const typed = llm.buildGeminiRequest('Add DotNord', 'frontend', [], 'typescript');
  const spoken = llm.buildGeminiRequest('Add DotNord', 'frontend', [], 'typescript', { spoken: true });
  assert.ok(!lastUser(typed).includes('speech recognition'));
  assert.ok(lastUser(spoken).startsWith('Add DotNord\n\n[Dictated with speech recognition'));
  assert.equal(sys(spoken), sys(typed), 'system prompt identical (cache prefix unchanged)');
  assert.deepEqual(spoken.contents.slice(0, -1), typed.contents.slice(0, -1), 'history identical');
});

test('voice request adds the live-transcript note; comparison questions get the table note', () => {
  const req = llm.buildIntelligentTranscriptionRequest('useMemo vs useCallback', 'frontend', [], 'typescript');
  assert.ok(sys(req).includes('## Live Transcript Input'));
  // Garbled code terms are rebuilt by a general rule, not a lookup list.
  assert.ok(sys(req).includes('rebuild the most likely real term'));
  assert.ok(sys(req).includes('Examples of the pattern, not a complete list'));
  assert.ok(sys(req).includes('A term that makes sense as spoken stays as it is'));
  assert.ok(!/toBe|expect\(/.test(sys(req).split('## Live Transcript Input')[1]), 'no hard-coded testing words in the voice note');
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

test('image instruction: silent analysis, what-does-it-output code gets the full format, other rules kept', () => {
  const text = llm.formatImageInstruction('frontend', 'typescript');
  assert.match(text, /decide silently \(never write this analysis out/);
  assert.match(text, /what-does-it-output question gets the full coding answer format \(never a prose paragraph\)/);
  assert.match(text, /Example flow listing every call → its exact output/);
  assert.match(text, /only when nothing is left to implement — what the shown code outputs/);
  assert.match(text, /Never answer with only a description of the screenshot/);
  assert.match(text, /a conceptual question gets a plain-language answer with no code block/);
  assert.match(text, /Do not add a code block just because this is a screenshot/);
});

test('expansion requests: note, ask and generation config per mode', () => {
  const rec = { kind: 'chat', question: 'Debounced search in Vue 3', answer: CODE_ANSWER, skill: 'frontend', programmingLanguage: 'typescript', framework: 'vue3' };
  const reasoning = config.get('llm.gemini.reasoning');

  const details = llm.buildExpansionRequest(rec, 'details');
  assert.ok(sys(details).includes('## More Details Request'));
  assert.equal(lastUser(details), 'More details, please.');
  assert.deepEqual(details.generationConfig.thinkingConfig, { thinkingBudget: 0 }, 'More details stays fast');

  // An architecture answer (text flow, no code) asks for a fresh flow per app;
  // a plain-text answer keeps the short ask.
  const arch = { ...rec, question: 'Walk me through GORA', answer: 'Summary.\n\n```text\nUser → Next.js shell → BFF\n```\n\n- More.' };
  assert.match(lastUser(llm.buildExpansionRequest(arch, 'details')), /^More details, please\. Include a ```text flow drawn fresh[^]*separate flow per app/);
  assert.equal(lastUser(llm.buildExpansionRequest({ ...rec, answer: 'Just words, no flow.' }, 'details')), 'More details, please.');

  const deep = llm.buildExpansionRequest(rec, 'deep');
  assert.ok(sys(deep).includes('## Deep Reasoning Request'));
  assert.match(lastUser(deep), /^Deep reasoning review of this answer, please\. Start with `### Solution — … \(reviewed\)`/);
  assert.deepEqual(deep.generationConfig.thinkingConfig, { thinkingLevel: reasoning.thinkingLevel });
  assert.equal(deep.generationConfig.maxOutputTokens, reasoning.maxOutputTokens);

  const deepTheory = llm.buildExpansionRequest({ ...rec, answer: 'React diffs a virtual tree.' }, 'deep');
  assert.equal(lastUser(deepTheory), 'Deep reasoning review of this answer, please.', 'no coding structure for theory answers');

  const opt = llm.buildExpansionRequest(rec, 'optimized');
  assert.ok(sys(opt).includes('## Optimized Solution Request'));
  // Proportionate: "already good" is checked first; few targeted changes; no feature checklist.
  const optNote = sys(opt).split('## Optimized Solution Request')[1];
  assert.ok(optNote.indexOf('First check whether it can be meaningfully improved') < optNote.indexOf('Otherwise make at most 3 changes'));
  assert.ok(optNote.includes('no new functions, hooks, classes or layers unless a fix needs one'));
  assert.ok(optNote.includes('Possible improvements are not a to-do list'));
  assert.ok(!/think it through more deeply|caching, better state management|race conditions and cleanup, error handling, maintainability/.test(optNote));
  assert.ok(optNote.includes('### Optimized — <short name>') && optNote.includes('NEW:'), 'answer format unchanged');
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
  assert.deepEqual(config.get('llm.gemini.fallbackModels'), ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']);
  const r = config.get('llm.gemini.reasoning');
  assert.deepEqual(r.models, ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  assert.equal(r.thinkingLevel, 'medium');
});

test('enforceProgrammingLanguage retags plain code, keeps framework/text tags and closing fences', () => {
  const input = ['```', 'a', '```', '```python', 'b', '```', '```vue', 'c', '```', '```text', 'd', '```', '~~~js', 'e', '~~~'].join('\n');
  const out = llm.enforceProgrammingLanguage(input, 'typescript').split('\n');
  assert.deepEqual(out.filter(l => l.startsWith('```')), ['```typescript', '```', '```typescript', '```', '```vue', '```', '```text', '```', '```typescript', '```']);
  assert.equal(llm.enforceProgrammingLanguage('no code', 'kotlin'), 'no code');
});

test('history: an answer whose question fell outside the window is dropped (odd window size)', () => {
  for (let i = 1; i <= 3; i++) {
    session.addUserInput(`Q${i}`);
    session.addModelResponse(`A${i}`);
  }
  const h = llm._historyContents(session.getConversationHistory(15), 5);
  assert.deepEqual(h.map(c => c.parts[0].text), ['Q2', 'A2', 'Q3', 'A3']);
  assert.equal(h[0].role, 'user');
});

test('project carry-over: a voice follow-up without the project name gets the notes of the project the last answer was about', () => {
  // 2026-10-01: "speaker" (Whisper for Speeqr) matched nothing, and the
  // follow-up was answered for GORA with no notes at all.
  session.addUserInput('Tell me about the architecture of this speaker app', 'speech');
  session.addModelResponse('### The speaker app (Speeqr) — Architecture\n\nSpeeqr is a calling app I built in React Native.');
  const req = llm.buildIntelligentTranscriptionRequest('How was the back end linked with the frontend?', 'frontend', [], 'typescript');
  assert.match(lastUser(req), /architecture and how the app talks to the backend \(React Native client\)/);
  assert.doesNotMatch(lastUser(req), /Rakuten GORA — frontend architecture overview/);
  assert.ok(sys(req).includes('Follow-ups stay on the project under discussion'));
});

test('expansion of a correction ("I meant for speaker") gets the same project notes as its answer', () => {
  const rec = {
    kind: 'chat', question: 'I meant for speaker.', skill: 'frontend', programmingLanguage: null, framework: 'auto',
    prevQuestion: 'How about the total architecture? How was the back end linked with the frontend?',
    answer: 'Speeqr was built on a React Native architecture with native modules for WebRTC.',
  };
  const req = llm.buildExpansionRequest(rec, 'details');
  assert.match(req.contents[0].parts[0].text, /talks to the backend \(React Native client\)/);
  // Without the previous question the answer alone still names the project.
  const noPrev = llm.buildExpansionRequest({ ...rec, prevQuestion: undefined, question: 'How was the backend linked with the frontend?' }, 'details');
  assert.match(noPrev.contents[0].parts[0].text, /talks to the backend \(React Native client\)/);
});
