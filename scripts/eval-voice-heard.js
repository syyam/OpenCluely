// LIVE prompt eval — interviewer (Meeting Audio) answers and the "Heard X →
// answered as Y" chat note. Run on demand:
//   node scripts/eval-voice-heard.js [label] [--runs=N] [--only=V1,V2]
// Uses your real key (.env) and saved resume, like test/live. About
// (scenarios × runs) lite-model requests (500/day free).
//
// Checks: a misheard term is noted ("heard"), a clean question never is, and
// the answer itself keeps its shape (words for concepts, code only for coding).
// Compare the answer length with a same-day run of the previous prompt —
// Gemini's answer length drifts during a day.
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
llm.initializeClient();

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || 'run';
const RUNS = Number((args.find(a => a.startsWith('--runs=')) || '--runs=3').slice(7));
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

const TOBE_Q = 'Can you implement the JavaScript function that takes expect x to be?';
const TOBE_A = "**Understanding**\nImplement `expect(actual).toBe(expected)`.\n\n### Solution — expect with toBe\n```typescript\nfunction expect<T>(actual: T) {\n  return {\n    toBe(expected: T) { // (1) strict identity like Jest\n      if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)} but received ${String(actual)}`)\n    },\n  }\n}\n```";

const hasCode = r => /```(?!text)/.test(r);

const LIST_Q = 'Build a React component that renders a list of products from props';
const LIST_A = "**Understanding**\nRender `products` from props as a list.\n\n### Solution — map over props\n```tsx\ntype Product = { id: string; name: string }\nexport function ProductList({ products }: { products: Product[] }) {\n  return <ul>{products.map(p => <li key={p.id}>{p.name}</li>)}</ul> // (1) one item per product\n}\n```";
const DEBOUNCE_Q = 'Write a debounced search input in React that calls the API';
const DEBOUNCE_A = "**Understanding**\nDebounce the input before calling `searchApi`.\n\n### Solution — useEffect + setTimeout\n```tsx\nexport function Search() {\n  const [q, setQ] = useState('')\n  useEffect(() => {\n    const t = setTimeout(() => searchApi(q), 300) // (1) wait for a pause\n    return () => clearTimeout(t) // (2) cancel on the next keystroke\n  }, [q])\n  return <input value={q} onChange={e => setQ(e.target.value)} />\n}\n```";
const S = [
  { id: 'V1', name: 'garbled concept: virtual dumb', q: 'What is the virtual dumb in React?', misheard: true, concept: true },
  { id: 'V2', name: 'garbled concept: V4 in Vue', q: 'Can you explain V4 in Vue and why it needs a key?', misheard: true, concept: true },
  { id: 'V3', name: 'garbled coding follow-up: DotNord', history: [[TOBE_Q, TOBE_A]], q: 'Can you add support for DotNord as well?', misheard: true },
  { id: 'V4', name: 'clean concept: closure', q: 'What is a closure?', concept: true },
  { id: 'V5', name: "clean concept: Vue's reactivity", q: "Explain Vue's reactivity", concept: true },
  { id: 'V6', name: 'clean experience: Next.js', q: 'Tell me about your experience with Next.js', concept: true },
  { id: 'V7', name: 'clean coding: reverse a linked list', q: 'Write a function that reverses a linked list' },
  // Coding requests (ask: 'yes' should ask in chat, 'no' must build, 'either'
  // is fine both ways as long as nothing is invented).
  { id: 'C1', name: 'coding, unclear: "dot to x dot be y"', history: [[TOBE_Q, TOBE_A]], q: 'Can you add dot to x dot be y to the expect function?', ask: 'either', meant: /\.to\(|toBe|to\(x\)/ },
  { id: 'C2', name: 'coding, no fit: Flembic mode', history: [[TOBE_Q, TOBE_A]], q: 'Add support for Flembic mode', ask: 'yes' },
  { id: 'C3', name: 'follow-up, garbled: pagan nation', history: [[LIST_Q, LIST_A]], q: 'Now add pagan nation to it', ask: 'either', meant: /paginat/i },
  { id: 'C4', name: 'follow-up, garbled but clear: a bort controller', history: [[DEBOUNCE_Q, DEBOUNCE_A]], q: 'Can you add a bort controller too?', ask: 'no', meant: /AbortController/ },
  { id: 'C5', name: 'follow-up, clean: add caching', history: [[DEBOUNCE_Q, DEBOUNCE_A]], q: 'Now add caching for repeated queries', ask: 'no' },
  { id: 'C6', name: 'coding, clean: debounce function', q: 'Write a debounce function in TypeScript', ask: 'no' },
  { id: 'V8', name: 'spoken dot: "a dot not" (Whisper keeps the words)', history: [[TOBE_Q, TOBE_A]], q: 'Can you add a dot not to the expect function?', meant: /\.not/ },
  // Noisy-call transcripts from eval-speech-terms.js --hard: the audio fits
  // more than one term, so the note should offer the meant one.
  { id: 'H1', name: 'ambiguous: UnMounted (meant onMounted)', q: 'What happened in UnMounted?', misheard: true, concept: true, fw: 'vue3', meant: /onMounted/ },
  { id: 'H2', name: 'ambiguous: Overgo X (meant Pinia over Vuex)', q: 'Why would you choose any Overgo X?', misheard: true, concept: true, fw: 'vue3', meant: /Pinia|Vuex/ },
  { id: 'H3', name: 'ambiguous: Yellow Refused (meant shallowRef)', q: 'What is Yellow Refused for?', misheard: true, concept: true, fw: 'vue3', meant: /shallowRef/ },
  { id: 'H4', name: 'ambiguous: Next Take in Blue (meant nextTick)', q: 'When would you use Next Take in Blue?', misheard: true, concept: true, fw: 'vue3', meant: /nextTick/ },
  // Vite said "veet" (2026-10-02: heard as "need", "v-it"). The W3/W4 controls
  // make sure the Vite example never pulls v-if / v-for or a plain "need" to Vite.
  { id: 'W1', name: 'garbled: need (meant Vite)', q: 'Why is need faster than Webpack in development?', misheard: true, concept: true, fw: 'vue3', meant: /Vite/ },
  { id: 'W2', name: 'garbled: v-it (meant Vite)', q: 'We moved the build from webpack to v-it. Why would you do that?', misheard: true, concept: true, fw: 'vue3', meant: /Vite/ },
  { id: 'W3', name: 'control: V if vs V show', q: 'What is the difference between V if and V show?', misheard: true, concept: true, fw: 'vue3', meant: /v-if/, not: /Vite/ },
  { id: 'W4', name: 'control: why do you need a key in V for', q: 'Why do you need a key in V for?', misheard: true, concept: true, fw: 'vue3', meant: /v-for/, not: /Vite/ },
];

async function runOnce(s) {
  env.req('src/core/framework').setFramework(s.fw || '', 'frontend');
  session.clear();
  session.setActiveSkill('frontend');
  for (const [q, a] of s.history || []) {
    session.addUserInput(q, 'speech');
    session.addModelResponse(a, { skill: 'frontend' });
  }
  let heardStreamed = null;
  let streamed = '';
  let firstMs = null;
  const t0 = Date.now();
  const r = await llm.processTranscriptionWithIntelligentResponseStream(
    s.q, 'frontend', [], 'typescript', (d) => { if (firstMs === null) firstMs = Date.now() - t0; streamed += d; }, () => { streamed = ''; },
    { onHeard: (note) => { heardStreamed = note; } });
  return { body: r.response, heard: (r.metadata && r.metadata.heard) || heardStreamed, clarify: (r.metadata && r.metadata.clarify) || null, streamed, firstMs };
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY in .env');
  const out = {};
  for (const s of S.filter(x => !ONLY.length || ONLY.includes(x.id))) {
    out[s.id] = { name: s.name, misheard: !!s.misheard, runs: [] };
    for (let i = 0; i < RUNS; i++) {
      let res;
      try { res = await runOnce(s); } catch (e) { res = { body: `ERROR: ${e.message}`, heard: null, streamed: '' }; }
      const leaked = /^\s*(\*\*)?HEARD:/i.test(res.body) || /^\s*(\*\*)?HEARD:/i.test(res.streamed);
      const asked = !!res.clarify;
      // Expected: concept and clean questions never ask.
      const askRule = s.ask || 'no';
      const askOk = askRule === 'either' || (askRule === 'yes') === asked;
      const shapeOk = asked || (s.concept ? !hasCode(res.body) : hasCode(res.body));
      // The meant term is in the answer or offered in the note.
      const all = `${res.heard || ''} ${res.clarify || ''} ${res.body}`;
      const offered = s.meant ? s.meant.test(all) && !(s.not && s.not.test(all)) : null;
      out[s.id].runs.push({ heard: res.heard, leaked, shapeOk, chars: res.body.length, firstMs: res.firstMs, offered, asked, askOk, clarify: res.clarify, body: res.body });
      console.log(`${s.id} #${i + 1} ${asked ? `ASKED ${JSON.stringify(res.clarify)} ` : ''}${askOk ? '' : 'ASK-WRONG '}heard=${JSON.stringify(res.heard)} shape=${shapeOk ? 'ok' : 'WRONG'}${leaked ? ' LEAKED-MARKER' : ''}\n     ${res.body.replace(/\s+/g, ' ').slice(0, 150)}`);
      await new Promise(r => setTimeout(r, 4500));
    }
  }
  const file = path.join(os.tmpdir(), `opencluely-voice-eval-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('\nSummary');
  console.table(Object.entries(out).map(([id, v]) => ({
    id, scenario: v.name, 'noted as heard': `${v.runs.filter(r => r.heard).length}/${v.runs.length}`,
    'expected note': v.misheard ? 'yes' : 'no', 'answer shape ok': `${v.runs.filter(r => r.shapeOk).length}/${v.runs.length}`,
    'marker leaked': v.runs.filter(r => r.leaked).length,
    'asked in chat': `${v.runs.filter(r => r.asked).length}/${v.runs.length}`,
    'ask ok': `${v.runs.filter(r => r.askOk).length}/${v.runs.length}`,
    'meant term offered': v.runs[0].offered === null ? '' : `${v.runs.filter(r => r.offered).length}/${v.runs.length}`,
    'avg chars': Math.round(v.runs.reduce((n, r) => n + r.chars, 0) / v.runs.length),
    'first chunk ms': (() => { const t = v.runs.filter(r => r.firstMs); return t.length ? Math.round(t.reduce((n, r) => n + r.firstMs, 0) / t.length) : ''; })(),
  })));
  console.log('Saved', file);
  process.exit(0);
})();
