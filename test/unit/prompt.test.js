const env = require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');

const { promptLoader } = env.req('prompt-loader');
const framework = env.req('src/core/framework');

const order = (prompt, markers) => markers.map(m => {
  const i = prompt.indexOf(m);
  assert.ok(i >= 0, `missing block: ${m}`);
  return i;
});

test('every profile loads and needs a programming language', () => {
  assert.deepEqual(promptLoader.getAvailableSkills().sort(), ['android', 'frontend', 'fullstack']);
  for (const p of ['android', 'frontend', 'fullstack']) assert.equal(promptLoader.requiresProgrammingLanguage(p), true);
  assert.equal(promptLoader.requiresProgrammingLanguage('nope'), false);
  assert.equal(promptLoader.getSkillPrompt('nope'), null);
});

test('blocks are appended in the documented order (web profile, framework selected)', () => {
  env.setJapanese(false);
  const p = promptLoader.getSkillPrompt('frontend', 'typescript', 'vue3');
  const idx = order(p, [
    '## Implementation language: TYPESCRIPT',
    '## Framework: Vue 3',
    '## Framework code format',
    '## Candidate Background',
    '## When code is needed',
    '## Identity',
    '## Response Language: English',
  ]);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'blocks out of order');
});

test('Auto framework adds no Framework block; android gets no web format block', () => {
  const auto = promptLoader.getSkillPrompt('frontend', 'typescript', framework.AUTO);
  assert.ok(!auto.includes('## Framework: '));
  assert.ok(auto.includes('## Framework code format'), 'web defaults apply under Auto too');
  const android = promptLoader.getSkillPrompt('android', 'kotlin', 'compose');
  assert.ok(android.includes('## Framework: Jetpack Compose'));
  assert.ok(!android.includes('## Framework code format'));
});

test('each profile gets only its own resume', () => {
  for (const [profile, marker] of Object.entries(env.RESUME)) {
    const p = promptLoader.getSkillPrompt(profile, 'typescript');
    assert.ok(p.includes(marker), `${profile} resume missing`);
    for (const [other, otherMarker] of Object.entries(env.RESUME)) {
      if (other !== profile) assert.ok(!p.includes(otherMarker), `${profile} got ${other}'s resume`);
    }
  }
});

test('no resume saved → no Candidate Background block', () => {
  env.writeResume('fullstack', '   ');
  try {
    assert.ok(!promptLoader.getSkillPrompt('fullstack', 'typescript').includes('## Candidate Background'));
  } finally {
    env.writeResume('fullstack', env.RESUME.fullstack);
  }
});

test('Japanese mode: romaji block + interview notes; off: English, no notes', () => {
  env.setJapanese(true);
  try {
    const jp = promptLoader.getSkillPrompt('frontend', 'typescript');
    assert.ok(jp.includes('## Response Language: Japanese (Romaji Only)'));
    assert.ok(jp.includes(env.NOTES));
    assert.ok(!jp.includes('## Response Language: English'));
  } finally {
    env.setJapanese(false);
  }
  const en = promptLoader.getSkillPrompt('frontend', 'typescript');
  assert.ok(en.includes('## Response Language: English'));
  assert.ok(!en.includes(env.NOTES), 'interview notes must only be sent in Japanese mode');
});

test('language injection per language', () => {
  const cases = { kotlin: ['KOTLIN', '```kotlin'], python: ['PYTHON', '```python'], javascript: ['JAVASCRIPT', '```javascript'], cpp: ['C++', '```cpp'] };
  for (const [lang, [title, fence]] of Object.entries(cases)) {
    const p = promptLoader.getSkillPrompt('fullstack', lang);
    assert.ok(p.includes(`## Implementation language: ${title}`), lang);
    assert.ok(p.includes(fence), lang);
  }
  assert.ok(!promptLoader.getSkillPrompt('fullstack', null).includes('## Implementation language'));
});
