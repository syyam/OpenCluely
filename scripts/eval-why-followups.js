// LIVE prompt eval — framework-first code, "Simpler:" hints and
// "why didn't you use X?" follow-ups (2026-10-01).
// Run on demand: node scripts/eval-why-followups.js [label] [--runs=N] [--only=A,C]
// Uses your real key (.env) and saved resumes. Quota: about 9 × runs requests
// on the normal chain (3.5-flash-lite first) — not before an interview.
//
// Checks:
//   A  Vue 1..N first answer uses the v-for range over a computed number,
//      keeps every section, and adds "Simpler:" only on a few points
//   B  a plain helper (debounce) — no regressions, little Simpler noise
//   C  "Why don't you use SafeCount?" (dictated) — a proposed name, not a
//      mishearing; words + changed lines, no full layout, an IMPLEMENT offer
//   D  "I meant when using v-for, why didn't you use i in SafeCount" — same
//   E  "Implement it: <offer>" — the full follow-up with CHANGED: markers
//   F  "Use a safeCount computed in the v-for" — direct change: full code, no offer
//   G  "Why didn't you use a watcher?" — explanation, no full code
//   H  "What is v-for?" — conceptual, unchanged: words, no offer
//   I  interviewer voice: "why didn't you use safe count in the v for"
// Results are saved to <tmp>/opencluely-why-<label>.json for before/after.
const env = require('../test/helpers/env');
const fs = require('fs');
const os = require('os');
const path = require('path');

const realEnv = require('dotenv').parse(fs.readFileSync(path.join(env.ROOT, '.env')));
process.env.GEMINI_API_KEY = realEnv.GEMINI_API_KEY || '';
for (const id of ['frontend']) {
  const saved = path.join(process.env.APPDATA || '', 'opencluely', 'resume-profiles', `${id}.txt`);
  if (fs.existsSync(saved)) env.writeResume(id, fs.readFileSync(saved, 'utf8'));
}
const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');
env.req('src/core/framework').setFramework('vue3', 'frontend');
llm.initializeClient();

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || 'run';
const RUNS = Number((args.find(a => a.startsWith('--runs=')) || '--runs=1').slice(7));
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const GAP_MS = 4500;

// The answer from the 2026-10-01 test (Array.from version), as history.
const VUE_Q = 'Implement in Vue Options API a component that takes an input number N and renders a list from 1 to N.';
const VUE_A = `**Understanding** — I need to implement a Vue Options API component that takes an input number and renders a list from 1 to N.

### Solution — Vue 3 Options API number-to-list renderer
**Approach**
**Key idea:** I keep N in \`data\` and derive the list in a computed property, so the template only loops over it.
1. I bind the input to \`n\` with \`v-model.number\` so it's a number.
2. A computed \`list\` turns N into the array 1..N.
3. I guard empty or invalid input and return an empty array, because otherwise the list would break.

\`\`\`html
<div id="app">
  <input type="number" v-model.number="n" min="1" placeholder="Enter N" />
  <ul>
    <li v-for="i in list" :key="i">{{ i }}</li> <!-- (1) loop over the computed array of integers from 1 to N -->
  </ul>
</div>
<script>
  const { createApp } = Vue; // (2) destructure createApp from the global Vue object
  createApp({
    data() {
      return { n: 5 }; // (3) initialize the input number state with a default value
    },
    computed: {
      list() {
        const val = Number(this.n); // (4) coerce the input value into a number
        if (!Number.isFinite(val) || val <= 0) return []; // (5) EXTRA: empty or invalid input — return empty array so the list clears
        const count = Math.min(Math.floor(val), 10); // (6) cap the maximum N at 10
        return Array.from({ length: count }, (_, index) => index + 1); // (7) generate an array of numbers from 1 to N
      }
    }
  }).mount('#app');
</script>
\`\`\`

**Implementation**
- (1) \`v-for\` renders one \`<li>\` per number in \`list\`.
- (2) Takes \`createApp\` from the global build.
- (3) \`n\` is reactive state.
- (4) Turns the input into a number.
- (5) Clears the list for empty or invalid input.
- (6) Caps the count.
- (7) Builds [1..count].

**Complexity** — one re-render per input change; O(N) list.`;

const WHY_Q = "Why don't you use SafeCount?";
const WHY_A = `- I put the guard and the array in one computed \`list\`, so the template just loops over ready data.
- A \`safeCount\` computed that returns only the clean number would be more Vue-like: \`v-for="i in safeCount"\` uses Vue's built-in 1..N range, so \`Array.from\` isn't needed.
\`\`\`html
<li v-for="i in safeCount" :key="i">{{ i }}</li>
\`\`\``;

const has = (re) => (r) => re.test(r);
const fullLayout = (r) => /###\s*Solution/i.test(r) || /\*\*Approach\*\*/.test(r);
const simplerCount = (r) => (r.match(/Simpler:/g) || []).length;
const misheard = (r) => /mishear|misheard|custom utility|isn't a (standard|built-in)|not a (standard|built-in|real)/i.test(r);

const S = [
  { id: 'A', name: 'Vue 1..N first answer', history: [], q: VUE_Q,
    check: (r) => /v-for="\s*\w+\s+in\s+\w+\s*"/.test(r) && !/Array\.from/.test(r) && /\*\*Implementation\*\*/.test(r) && /\*\*Approach\*\*/.test(r) },
  { id: 'B', name: 'debounce helper', history: [], q: 'Implement a debounce function.',
    check: (r) => /\*\*Approach\*\*/.test(r) && /\*\*Implementation\*\*/.test(r) },
  { id: 'C', name: 'why not SafeCount', history: [[VUE_Q, VUE_A]], q: WHY_Q, spoken: true,
    check: (r, m) => !fullLayout(r) && !misheard(r) && /safeCount/i.test(r) && !!m.implementOffer },
  { id: 'D', name: 'why not i in SafeCount', history: [[VUE_Q, VUE_A]], q: "I meant when using v-for, why didn't you use I in SafeCount", spoken: true,
    check: (r, m) => !fullLayout(r) && !misheard(r) && !!m.implementOffer },
  { id: 'E', name: 'Implement it (chip)', history: [[VUE_Q, VUE_A], [WHY_Q, WHY_A]], q: 'Implement it: use a safeCount computed in the v-for range',
    check: (r, m) => fullLayout(r) && /CHANGED:/.test(r) && /in\s+safeCount/.test(r) && !m.implementOffer },
  { id: 'F', name: 'direct change', history: [[VUE_Q, VUE_A]], q: 'Use a safeCount computed in the v-for instead of the list array.',
    check: (r, m) => fullLayout(r) && /in\s+safeCount/.test(r) && !m.implementOffer },
  { id: 'G', name: 'why not a watcher', history: [[VUE_Q, VUE_A]], q: "Why didn't you use a watcher instead of the computed?",
    check: (r) => !fullLayout(r) },
  { id: 'H', name: 'what is v-for', history: [[VUE_Q, VUE_A]], q: 'What is v-for in Vue?',
    check: (r, m) => !fullLayout(r) && !m.implementOffer },
  { id: 'I', name: 'interviewer: why not safe count', voice: true, history: [[VUE_Q, VUE_A]], q: "why didn't you use safe count in the v for",
    check: (r, m) => !fullLayout(r) && !misheard(r) && !/IMPLEMENT:/i.test(r) },
];

async function runOnce(s) {
  session.clear();
  session.setActiveSkill('frontend');
  for (const [q, a] of s.history) {
    session.addUserInput(q, 'chat');
    session.addModelResponse(a, { skill: 'frontend' });
  }
  const t0 = Date.now();
  let first = null;
  let streamed = '';
  const onDelta = (d) => { if (first === null) first = Date.now() - t0; streamed += d; };
  const r = s.voice
    ? await llm.processTranscriptionWithIntelligentResponseStream(s.q, 'frontend', [], 'typescript', onDelta, null)
    : await llm.processTextWithSkillStream(s.q, 'frontend', [], 'typescript', onDelta, null, { spoken: !!s.spoken });
  return { response: r.response, meta: r.metadata || {}, first, total: Date.now() - t0, streamedMarker: /IMPLEMENT:/i.test(streamed) };
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY in .env');
  const out = {};
  for (const s of S.filter(x => !ONLY.length || ONLY.includes(x.id))) {
    out[s.id] = { name: s.name, runs: [] };
    for (let i = 0; i < RUNS; i++) {
      let res;
      try { res = await runOnce(s); } catch (e) { res = { response: `ERROR: ${e.message}`, meta: {}, first: null, total: 0 }; }
      const pass = !!s.check(res.response, res.meta) && !res.streamedMarker;
      out[s.id].runs.push({ pass, chars: res.response.length, first: res.first, total: res.total,
        simpler: simplerCount(res.response), offer: res.meta.implementOffer || null, streamedMarker: res.streamedMarker, response: res.response });
      console.log(`${pass ? 'PASS' : 'FAIL'} ${s.id} #${i + 1} ${s.name} — first ${res.first}ms, ${res.response.length} chars, simpler ${simplerCount(res.response)}, offer ${JSON.stringify(res.meta.implementOffer || null)}\n     ${res.response.replace(/\s+/g, ' ').slice(0, 160)}`);
      await new Promise(r => setTimeout(r, GAP_MS));
    }
  }
  const file = path.join(os.tmpdir(), `opencluely-why-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('\nSummary');
  console.table(Object.entries(out).map(([id, v]) => ({
    id, scenario: v.name, pass: `${v.runs.filter(r => r.pass).length}/${v.runs.length}`,
    firstMs: Math.round(v.runs.reduce((a, r) => a + (r.first || 0), 0) / v.runs.length),
    chars: Math.round(v.runs.reduce((a, r) => a + r.chars, 0) / v.runs.length),
    simpler: v.runs.map(r => r.simpler).join(','),
  })));
  console.log(`Saved ${file}`);
})();
