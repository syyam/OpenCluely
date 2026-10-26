// LIVE prompt eval — the "Optimized solution" button. Run on demand:
//   node scripts/eval-optimized.js <label> [--runs=N] [--only=O1,O2] [--real] [--fresh]
// First answers are generated once through the normal chat path and cached
// in <tmp>/opencluely-optimized-first.json (--fresh regenerates them), so
// before/after runs optimize the exact same solutions.
// By default Optimized runs on the lite models (500/day) instead of
// gemini-3.6-flash (20/day); --real uses the configured reasoning chain.
//
// Reported per answer: code lines vs the first solution, NEW: markers,
// functions/hooks/classes added, concepts that weren't in the first solution
// (cache, retry, abort, reducer…), and whether it said "already optimal".
const env = require('../test/helpers/env');
const fs = require('fs');
const os = require('os');
const path = require('path');

const realEnv = require('dotenv').parse(fs.readFileSync(path.join(env.ROOT, '.env')));
process.env.GEMINI_API_KEY = realEnv.GEMINI_API_KEY || '';
const saved = path.join(process.env.APPDATA || '', 'opencluely', 'resume-profiles', 'frontend.txt');
if (fs.existsSync(saved)) env.writeResume('frontend', fs.readFileSync(saved, 'utf8'));

const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');
const config = env.req('src/core/config');
llm.initializeClient();

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || 'run';
const RUNS = Number((args.find(a => a.startsWith('--runs=')) || '--runs=3').slice(7));
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!args.includes('--real')) {
  config.set('llm.gemini.reasoning.models', ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  config.set('llm.gemini.reasoning.firstChunkTimeoutMs', 15000);
}
const GAP_MS = 4500;

const QUESTIONS = [
  { id: 'O1', name: 'DSA: two sum', q: 'Given an array nums and a target, return the indices of the two numbers that add up to target.' },
  { id: 'O2', name: 'DSA: first unique character', q: 'Find the index of the first non-repeating character in a string.' },
  { id: 'O3', name: 'Vue: debounced search', q: 'Implement a debounced search input in Vue 3 that calls fetchResults(query).' },
  { id: 'O4', name: 'React: fetch users list', q: 'Build a React component that fetches and displays a list of users from /api/users.' },
  { id: 'O5', name: 'JS: get(obj, path)', q: 'Implement a function get(obj, path) that reads a nested property by a dot path like "a.b.c".' },
];

const codeOf = (r) => (r.match(/```(?!text)[^\n]*\n([\s\S]*?)```/g) || []).map(b => b.replace(/^```[^\n]*\n|```$/g, '')).join('\n');
const lines = (c) => c.split('\n').filter(l => l.trim()).length;
const defs = (c) => (c.match(/\bfunction\s+\w+|\bconst\s+\w+\s*=\s*(async\s*)?\(|\bclass\s+\w+|\buse[A-Z]\w*\s*=|\bfunction\s+use[A-Z]/g) || []).length;
const CONCEPTS = {
  cache: /\bcache|memo(ize|ization)|new Map\(\)/i, retry: /\bretr(y|ies)/i, abort: /AbortController|signal/,
  reducer: /useReducer|reducer/, customHook: /function use[A-Z]|const use[A-Z]/, class: /\bclass\s+\w+/,
  typesExtra: /\binterface\s+\w+|\btype\s+\w+\s*=/, generics: /<T\b|<K\b/, loadingError: /\bloading\b|\berror\b/i,
};
const conceptsIn = (c) => Object.keys(CONCEPTS).filter(k => CONCEPTS[k].test(c));

async function firstAnswers() {
  const file = path.join(os.tmpdir(), 'opencluely-optimized-first.json');
  if (!args.includes('--fresh') && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const q of QUESTIONS) {
    session.clear();
    session.setActiveSkill('frontend');
    const r = await llm.processTextWithSkillStream(q.q, 'frontend', [], 'typescript', null, null);
    out[q.id] = r.response;
    console.log(`first answer ${q.id}: ${lines(codeOf(r.response))} code lines`);
    await new Promise(res => setTimeout(res, GAP_MS));
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return out;
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY in .env');
  const first = await firstAnswers();
  const out = {};
  for (const q of QUESTIONS.filter(x => !ONLY.length || ONLY.includes(x.id))) {
    const record = { kind: 'chat', question: q.q, answer: first[q.id], skill: 'frontend', programmingLanguage: 'typescript', framework: 'auto' };
    const base = codeOf(first[q.id]);
    const baseConcepts = conceptsIn(base);
    out[q.id] = { name: q.name, firstLines: lines(base), runs: [] };
    for (let i = 0; i < RUNS; i++) {
      let r = '';
      try { r = (await llm.processExpansionStream(record, null, 'optimized')).response; } catch (e) { r = `ERROR: ${e.message}`; }
      const code = codeOf(r);
      const added = conceptsIn(code).filter(c => !baseConcepts.includes(c));
      const run = {
        lines: lines(code), ratio: +(lines(code) / Math.max(1, lines(base))).toFixed(2),
        newMarkers: (r.match(/\bNEW:/g) || []).length, defsAdded: defs(code) - defs(base),
        added, alreadyOptimal: /already (optimal|the (optimal|best)|good)|is optimal/i.test(r.slice(0, 600)),
        chars: r.length, response: r,
      };
      out[q.id].runs.push(run);
      console.log(`${q.id} #${i + 1} ${q.name}: ${run.lines} lines (x${run.ratio}), NEW:${run.newMarkers}, +defs ${run.defsAdded}, added [${added.join(', ')}]${run.alreadyOptimal ? ', says already optimal' : ''}`);
      await new Promise(res => setTimeout(res, GAP_MS));
    }
  }
  const file = path.join(os.tmpdir(), `opencluely-optimized-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  const avg = (xs) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
  console.log('\nSummary');
  console.table(Object.entries(out).map(([id, v]) => ({
    id, question: v.name, 'first lines': v.firstLines, 'optimized lines': avg(v.runs.map(r => r.lines)),
    'size x': avg(v.runs.map(r => r.ratio)), 'NEW: marks': avg(v.runs.map(r => r.newMarkers)),
    '+functions': avg(v.runs.map(r => r.defsAdded)), 'concepts added': avg(v.runs.map(r => r.added.length)),
    'says optimal': v.runs.filter(r => r.alreadyOptimal).length, 'avg chars': avg(v.runs.map(r => r.chars)),
  })));
  console.log('Saved', file);
  process.exit(0);
})();
