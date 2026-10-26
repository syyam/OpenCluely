// LIVE prompt eval — misheard / unfamiliar words in chat requests.
// Run on demand: node scripts/eval-misheard.js [label] [--runs=N] [--only=A,B]
// Uses your real key (.env) and saved resumes, like test/live. Quota: about
// (scenarios × runs) lite-model requests (500/day free) — not before an interview.
//
// Replays scripted chat histories through the real chat request path
// (llm.service processTextWithSkillStream) and checks each answer:
//   - misheard/unknown words in coding requests → the real term or a
//     "CLARIFY:" question, never an invented API;
//   - a correction after a misread change drops what was built for it;
//   - genuine additions are built without being questioned;
//   - non-coding questions are answered directly, as before (no CLARIFY,
//     no fenced code).
// Results are saved to <tmp>/opencluely-eval-<label>.json for before/after.
const env = require('../test/helpers/env');
const fs = require('fs');
const os = require('os');
const path = require('path');

const realEnv = require('dotenv').parse(fs.readFileSync(path.join(env.ROOT, '.env')));
process.env.GEMINI_API_KEY = realEnv.GEMINI_API_KEY || '';
for (const id of ['frontend', 'android']) {
  const saved = path.join(process.env.APPDATA || '', 'opencluely', 'resume-profiles', `${id}.txt`);
  if (fs.existsSync(saved)) env.writeResume(id, fs.readFileSync(saved, 'utf8'));
}

// --baseline: blank the chat-only additions (the "did you mean" rule and the
// dictated-text hint) before llm.service reads them, to measure without them.
// It also puts back the two coding-rule sentences as they were before
// 2026-09-29, so --baseline is the prompt from before this work.
if (process.argv.includes('--baseline')) {
  const af = env.req('src/core/answer-format');
  af.CHAT_CLARIFY_NOTE = '';
  af.SPOKEN_NOTE = '';
  const current = af.getCodingAnswerBlock;
  af.getCodingAnswerBlock = (opts) => current(opts)
    .replace('build the simplest likely reading — never several guesses or a bigger library around it; a word that fits nothing in the context is a typo or mishearing, not a new feature to invent;',
      'build the simplest likely reading — the one thing it names — never several guesses or a bigger library around it;')
    .replace(/ If the follow-up corrects or clarifies the previous request[^]*?instead of keeping it\./, '');
}
const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');
llm.initializeClient();

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || 'run';
const RUNS = Number((args.find(a => a.startsWith('--runs=')) || '--runs=3').slice(7));
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const GAP_MS = 4500; // stay under the free-tier per-minute limit

// ── Scripted history ──
const TOBE_Q = 'Can you implement the JavaScript function that takesExpectX.toB function?';
const TOBE_A = `**Understanding**
I need to implement a minimal \`expect(actual)\` that returns an object with a \`toBe(expected)\` matcher, like Jest.

### Solution — expect with toBe
**Approach**
**Key idea:** \`expect\` returns an object whose methods close over \`actual\`.
1. \`expect\` takes the actual value and returns a matcher object.
2. \`toBe\` compares with \`Object.is\`, the same strict check Jest uses.
3. On a mismatch it throws an error describing both values.

\`\`\`typescript
function expect<T>(actual: T) {
  return { // (1) matcher object; its methods close over actual
    toBe(expected: T): void {
      if (!Object.is(actual, expected)) { // (2) strict identity like Jest
        throw new Error(\`Expected \${String(expected)} but received \${String(actual)}\`); // (3) fail with both values
      }
    },
  };
}
\`\`\`

**Implementation**
- (1) Returns the matcher object; \`toBe\` is a closure over \`actual\`.
- (2) \`Object.is\` treats \`NaN\` as equal to itself and \`+0\`/\`-0\` as different.
- (3) Throwing is how a test runner detects a failed assertion.

**Complexity** — O(1) per assertion.

**Why it works** — the closure keeps \`actual\` for every matcher call.

**Example flow**
\`\`\`text
expect(2).toBe(2) → Object.is(2, 2) true → passes
expect(2).toBe(3) → throws "Expected 3 but received 2"
\`\`\`

**Possible improvements**
- Include the matcher name in the error message so failures are easier to read.`;

const DOTNORD_Q = 'Can you add support from DotNord as well?';
const DOTNORD_A = `**Understanding**
I need to add a \`DotNord\` matcher or property to the assertion utility so tests can assert values against a DotNord color palette or configuration.

### Solution — Adding a DotNord check
**Approach**
**Key idea:** add a \`toBeDotNord\` matcher next to \`toBe\`.
1. Keep \`toBe\` as it is.
2. Add a set of DotNord palette colors.
3. Add \`toBeDotNord()\` that checks \`actual\` is one of them.

\`\`\`typescript
const DOT_NORD_PALETTE = new Set(['#2E3440', '#3B4252', '#88C0D0', '#BF616A']); // (1) CHANGED: DotNord palette

function expect<T>(actual: T) {
  return {
    toBe(expected: T): void {
      if (!Object.is(actual, expected)) {
        throw new Error(\`Expected \${String(expected)} but received \${String(actual)}\`);
      }
    },
    toBeDotNord(): void { // (2) CHANGED: new DotNord matcher
      if (!DOT_NORD_PALETTE.has(String(actual))) {
        throw new Error(\`Expected \${String(actual)} to be a DotNord color\`);
      }
    },
  };
}
\`\`\``;

const DEBOUNCE_Q = 'Implement a debounced search input in Vue 3 that calls fetchResults(query)';
const DEBOUNCE_A = `**Understanding**
A search input that calls \`fetchResults(query)\` only after typing pauses.

### Solution — watch + timer
\`\`\`vue
<script setup lang="ts">
import { ref, watch } from 'vue'
const query = ref('')
const results = ref<string[]>([])
watch(query, (q, _old, onCleanup) => {
  const t = setTimeout(async () => { results.value = await fetchResults(q) }, 300) // (1) wait for a pause
  onCleanup(() => clearTimeout(t)) // (2) a new keystroke cancels the pending call
})
</script>
<template><input v-model="query" /><li v-for="r in results" :key="r">{{ r }}</li></template>
\`\`\``;

const KOTLIN_Q = 'Write a Kotlin function that returns the users from the repository';
const KOTLIN_A = `**Understanding**
Return the users from \`UserRepository\`.

### Solution — suspend function
\`\`\`kotlin
suspend fun loadUsers(repo: UserRepository): List<User> {
    return repo.getUsers() // (1) one-shot read from the repository
}
\`\`\``;

const LIST_Q = 'Build a React component that renders a list of products from props';
const LIST_A = `**Understanding**
Render \`products\` from props as a list.

### Solution — map over props
\`\`\`tsx
type Product = { id: string; name: string }
export function ProductList({ products }: { products: Product[] }) {
  return <ul>{products.map(p => <li key={p.id}>{p.name}</li>)}</ul> // (1) one item per product
}
\`\`\``;

const code = (r) => (r.match(/```(?!text)[\s\S]*?```/g) || []).join('\n');
// Like main.js clarifyKind: an "**Understanding**" heading may come first.
const unheaded = (r) => r.trimStart().replace(/^\*\*Understanding\*\*[ \t]*\n\s*/i, '');
const asks = (r) => /^(\*\*)?CLARIFY:/i.test(unheaded(r));

// profile/lang: request context. history: [question, answer] pairs.
// check(response) → true (pass) / false (fail).
const S = [
  { id: 'A', name: 'misheard follow-up (DotNord for .not)', history: [[TOBE_Q, TOBE_A]], q: DOTNORD_Q, spoken: true,
    check: r => asks(r) || (!/dotnord/i.test(code(r)) && /\bnot\b/.test(code(r))) },
  { id: 'B', name: 'correction after the misread change', history: [[TOBE_Q, TOBE_A], [DOTNORD_Q, DOTNORD_A]], q: '.not',
    check: r => !asks(r) && !/dotnord/i.test(code(r)) && /\bnot\b/.test(code(r)) },
  { id: 'B2', name: 'explicit correction ("No, I meant .not")', history: [[TOBE_Q, TOBE_A], [DOTNORD_Q, DOTNORD_A]], q: 'No, I meant .not',
    check: r => !asks(r) && !/dotnord/i.test(code(r)) && /\bnot\b/.test(code(r)) },
  { id: 'C1', name: 'misheard: "a bort controller"', history: [[DEBOUNCE_Q, DEBOUNCE_A]], q: 'Can you add a bort controller too?', spoken: true,
    check: r => asks(r) || /AbortController/.test(code(r)) },
  { id: 'C2', name: 'misheard: "cold flaw" (Kotlin)', profile: 'android', lang: 'kotlin', history: [[KOTLIN_Q, KOTLIN_A]], q: 'Now make it a cold flaw', spoken: true,
    check: r => asks(r) || /\bFlow\b/.test(code(r)) },
  { id: 'C3', name: 'misheard: "pagan nation"', history: [[LIST_Q, LIST_A]], q: 'Add pagan nation to it', spoken: true,
    check: r => asks(r) || /page/i.test(code(r)) },
  { id: 'D1', name: 'genuine: toEqual', history: [[TOBE_Q, TOBE_A]], q: 'Add toEqual support as well',
    check: r => !asks(r) && /toEqual/.test(code(r)) },
  { id: 'D2', name: 'genuine: toMatchObject', history: [[TOBE_Q, TOBE_A]], q: 'Add a toMatchObject matcher',
    check: r => !asks(r) && /toMatchObject/.test(code(r)) },
  { id: 'D3', name: 'genuine: toBeCloseTo', history: [[TOBE_Q, TOBE_A]], q: 'Also support toBeCloseTo',
    check: r => !asks(r) && /toBeCloseTo/.test(code(r)) },
  { id: 'E', name: 'plain coding question', history: [], q: 'Implement debounce in TypeScript',
    check: r => !asks(r) && /debounce/.test(code(r)) },
  { id: 'F', name: 'nonsense term, no fit', history: [[TOBE_Q, TOBE_A]], q: 'Add support for Flembic mode', spoken: true,
    check: r => asks(r) || !/flembic/i.test(r) },
  { id: 'H1', name: 'ambiguous: "use memo" (several hooks fit)', history: [[LIST_Q, LIST_A]], q: 'Wrap the list in use memory', spoken: true,
    check: r => asks(r) || /useMemo|React\.memo/.test(code(r)) },
  { id: 'H2', name: 'ambiguous: "state flaw" (Kotlin)', profile: 'android', lang: 'kotlin', history: [[KOTLIN_Q, KOTLIN_A]], q: 'Expose it as a state flaw or shared flaw', spoken: true,
    check: r => asks(r) || /StateFlow|SharedFlow/.test(code(r)) },
  { id: 'G1', name: 'non-coding: closure', history: [], q: 'What is a closure?', nonCoding: true },
  { id: 'G2', name: 'non-coding: Vue reactivity', history: [], q: "Explain Vue's reactivity", nonCoding: true },
  { id: 'G3', name: 'non-coding: experience', history: [], q: 'Tell me about your experience with Next.js', nonCoding: true },
  { id: 'G4', name: 'non-coding garbled: virtual dumb', history: [], q: 'What is the virtual dumb in React?', nonCoding: true, spoken: true },
  { id: 'G5', name: 'non-coding garbled: use effect', history: [], q: 'How does use effect clean up work?', nonCoding: true, spoken: true },
  // 2026-10-02: answered with the single word "TypeScript" (1 output token).
  { id: 'G6', name: 'non-coding garbled: skill question', history: [], q: 'Are you good at the Alascript or Tidescripts?', nonCoding: true, spoken: true },
];
for (const s of S) if (s.nonCoding) s.check = r => !asks(r) && !code(r) && r.trim().length > 80;
// A question is one line of up to 3 backticked guesses (each one becomes a
// button in the chat window).
const guesses = (r) => (unheaded(r).trim().split('\n')[0].match(/`[^`]+`/g) || []);
const wellFormed = (r) => !asks(r) || (unheaded(r).trim().split('\n').length === 1 && guesses(r).length <= 3);

async function runOnce(s) {
  session.clear();
  session.setActiveSkill(s.profile || 'frontend');
  for (const [q, a] of s.history) {
    session.addUserInput(q, 'chat');
    session.addModelResponse(a, { skill: s.profile || 'frontend' });
  }
  const r = await llm.processTextWithSkillStream(s.q, s.profile || 'frontend', [], s.lang || 'typescript', null, null, { spoken: !!s.spoken });
  return r.response;
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY in .env');
  const out = {};
  for (const s of S.filter(x => !ONLY.length || ONLY.includes(x.id))) {
    out[s.id] = { name: s.name, runs: [] };
    for (let i = 0; i < RUNS; i++) {
      let response = '';
      try { response = await runOnce(s); } catch (e) { response = `ERROR: ${e.message}`; }
      const pass = !!s.check(response) && wellFormed(response);
      out[s.id].runs.push({ pass, asked: asks(response), chars: response.length, response });
      const head = response.replace(/\s+/g, ' ').slice(0, 150);
      console.log(`${pass ? 'PASS' : 'FAIL'} ${s.id} #${i + 1} ${s.name}\n     ${head}`);
      await new Promise(r => setTimeout(r, GAP_MS));
    }
  }
  const file = path.join(os.tmpdir(), `opencluely-eval-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('\nSummary');
  console.table(Object.entries(out).map(([id, v]) => ({
    id, scenario: v.name, pass: `${v.runs.filter(r => r.pass).length}/${v.runs.length}`,
    asked: v.runs.filter(r => r.asked).length, 'avg chars': Math.round(v.runs.reduce((n, r) => n + r.chars, 0) / v.runs.length),
  })));
  console.log('Saved', file);
  process.exit(0);
})();
