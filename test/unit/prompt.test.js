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
  assert.ok(en.includes("the way you'd say it to an interviewer across the table"), 'English answers are written to be read out');
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

test('coding answer format: Approach is required with a Key idea, comments on every logical step', () => {
  const p = promptLoader.getSkillPrompt('frontend', 'typescript', framework.AUTO);
  assert.ok(p.includes('**Approach** — REQUIRED in every coding answer'));
  assert.ok(p.includes('a Key idea alone is not an Approach'));
  assert.ok(p.includes('**Key idea:**'));
  assert.ok(p.includes('numbered comment on each logical step'));
});

test('Vue defaults to the short in-page form (template + createApp/new Vue script), no page boilerplate; SFC only when asked', () => {
  const block = framework.getFrameworkDefaultsBlock('frontend');
  assert.match(block, /Vue 3: the code as it goes inside an `index.html` that already loads Vue 3 from a CDN/);
  assert.match(block, /const \{ createApp, ref, computed, watch \} = Vue/);
  assert.match(block, /Vue 2 \(only when Vue 2 is selected or asked for\): the code as it goes inside an `index.html` that already loads Vue 2/);
  assert.match(block, /no page boilerplate \(no `<!DOCTYPE>`/);
  assert.match(block, /an SFC is only its `<template>` and `<script>` \(no `<style>` block/);
  assert.match(block, /complete runnable HTML page \(`<!DOCTYPE>`, `<head>`, the Vue `<script src>`\) only when the question asks for a full\/runnable page/);
  assert.doesNotMatch(block, /Vue 3: Composition API as one complete HTML page/, 'the full page is not the default');
  assert.match(block, /an SFC is written only when the question asks for one or the given code already is one/);
  assert.equal(framework.getFrameworkDefaultsBlock('android'), '');
});

test('coding answer format: extras are justified in Approach; Possible improvements is optional and mention-only', () => {
  const p = promptLoader.getSkillPrompt('frontend', 'typescript', framework.AUTO);
  assert.ok(p.includes('so I can mention it for extra points'));
  assert.ok(p.includes('**Possible improvements** — last: 1-2 bullets'));
  assert.ok(p.includes("Mention only — don't implement it"));
});

test('a selected framework is the default for coding questions that don\'t name it; plain code only for framework-free tasks', () => {
  const block = framework.getFrameworkBlock('vue3');
  assert.ok(block.includes('a coding question gets Vue 3 code even when it doesn\'t mention Vue 3 or calls the task a "function"'));
  assert.ok(block.includes('A standalone helper the question asks for by name'));
  const defaults = framework.getFrameworkDefaultsBlock('frontend');
  assert.ok(defaults.includes('the default for every coding question, whether or not the question names it'));
  assert.ok(!defaults.includes('A question that needs no framework (algorithms/DSA, utilities, plain logic)'), 'the old broad "utilities → plain" rule is gone');
});

test('DSA framework: its own block, no web-format block; framework blocks no longer carve out DSA', () => {
  const p = promptLoader.getSkillPrompt('frontend', 'python', 'dsa');
  assert.ok(p.includes('## Framework: DSA / LeetCode'));
  assert.ok(p.includes('the standard optimal approach an interviewer expects'));
  assert.ok(p.includes('is always `**Brute force:**'));
  assert.ok(p.includes('## Implementation language: PYTHON'), 'the selected language is kept');
  assert.ok(!p.includes('## Framework code format'), 'no React/Vue format rules with DSA');
  assert.ok(promptLoader.getSkillPrompt('android', 'kotlin', 'dsa').includes('## Framework: DSA / LeetCode'));
  const vue = framework.getFrameworkBlock('vue3');
  assert.ok(!/DSA|algorithm|two-sum/i.test(vue), 'the Vue block is only about Vue');
  assert.ok(vue.includes('A standalone helper the question asks for by name'));
  assert.ok(promptLoader.getSkillPrompt('frontend', 'typescript', 'vue3').includes('## Framework code format'), 'web frameworks keep their format block');
});

test('Node + Express + React: its own block encoding the repo structure; fullstack-only', () => {
  const block = framework.getFrameworkBlock('node-react');
  assert.ok(block.includes('## Framework: Node + Express + React (full-stack)'));
  for (const marker of ['frontend/', 'backend/', '/api', '5173', '3001', 'vite.config.js'])
    assert.ok(block.includes(marker), `node-react block missing: ${marker}`);
  assert.ok(!block.includes("using Node + Express + React's own idiomatic APIs and patterns"), 'not the generic template');

  // Offered under fullstack only.
  const has = (profile) => framework.getFrameworkOptions(profile).some(o => o.id === 'node-react' && o.label === 'Node + Express + React');
  assert.ok(has('fullstack'), 'fullstack dropdown lists it');
  assert.ok(!has('frontend'), 'frontend must not list it');
  assert.ok(!has('android'), 'android must not list it');

  // Reaches the fullstack prompt and still gets the React code-format block; absent elsewhere.
  const p = promptLoader.getSkillPrompt('fullstack', 'javascript', 'node-react');
  assert.ok(p.includes('## Framework: Node + Express + React (full-stack)'));
  assert.ok(p.includes('## Framework code format'), 'React/Vue format block still applies on fullstack');
  assert.ok(!promptLoader.getSkillPrompt('frontend', 'javascript', framework.AUTO).includes('## Framework: Node + Express + React'));
});

test('extras are allowed and marked EXTRA with the edge case; in-page Vue props are lowercase/kebab-case', () => {
  const p = promptLoader.getSkillPrompt('frontend', 'typescript', 'vue3');
  assert.ok(p.includes('Small extras that handle a real edge case of the asked-for code are welcome'));
  assert.ok(!p.includes('no unrequested mock data, backend code, extra state'), 'the old "no extra state/validation" ban is gone');
  assert.ok(p.includes("An extra's numbered comment starts with `EXTRA:`"));
  assert.ok(p.includes('a prop the question calls `M` is declared as `m`'));
});

test('progressive follow-ups: cheap guards only, smallest change, CHANGED markers, concepts named where they appear', () => {
  const p = promptLoader.getSkillPrompt('frontend', 'typescript', 'vue3');
  assert.ok(p.includes('but only cheap guards'));
  assert.ok(p.includes('is not built until the question asks for it'), 'next-follow-up behaviors wait until asked');
  assert.ok(p.includes('Make the smallest change that answers the follow-up'));
  assert.ok(p.includes("don't refactor working code into a new pattern"));
  assert.ok(p.includes("If the current code already handles what's asked, don't rewrite it"));
  assert.ok(p.includes("every new or changed line's comment starts with `CHANGED:`"));
  // Comments explain logic; concepts are named at their own line, no bold labels, no fixed cap.
  assert.ok(p.includes('as many as the code needs, no fixed number'));
  assert.ok(!p.includes('usually 4-8'));
  assert.ok(!p.includes('usually 3-6'), 'Approach steps have no upper limit');
  assert.ok(p.includes('as many as the solution needs — no upper limit'));
  assert.ok(p.includes('the reasoning, not the name of a language feature'));
  assert.ok(p.includes('No markdown inside code'));
  assert.ok(p.includes('explaining ITS OWN line'));
  assert.ok(p.includes('No bold labels at the start of points'));
  assert.ok(!p.includes('start the point with that concept in bold'));
  // Scope: unclear questions get the simplest reading; extras are guards, not new features.
  assert.ok(p.includes('When the question is unclear or garbled, build the simplest likely reading'));
  assert.ok(p.includes('never a new function, method or feature'));
  assert.ok(p.includes('misspelled or misheard API name'));
  // An unknown word is not a feature to build; a correction replaces the misread change.
  assert.ok(!p.includes('the one thing it names'), 'no longer pushes building whatever word was heard');
  assert.ok(p.includes('a word that fits nothing in the context is a typo or mishearing, not a new feature to invent'));
  assert.ok(p.includes('drop what was built for the misreading instead of keeping it'));
  assert.ok(p.includes('names the concept and says why it fits'));
  assert.ok(!p.includes("What they're testing"), 'no interviewer-testing line (saves tokens)');
});

test('Brute force layout line only where algorithm problems are expected; in-page Vue has no SFC syntax', () => {
  for (const f of ['dsa', 'auto']) assert.ok(promptLoader.getSkillPrompt('frontend', 'typescript', f).includes('**Brute force:**'), f);
  for (const f of ['vue3', 'react', 'vue2']) assert.ok(!promptLoader.getSkillPrompt('frontend', 'typescript', f).includes('**Brute force:**'), f);
  assert.ok(promptLoader.getSkillPrompt('frontend', 'typescript', 'vue3').includes('no SFC syntax (no `<template>` tag, no `export default`, no `import`)'));
});
