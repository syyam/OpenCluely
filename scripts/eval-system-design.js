// LIVE eval — System design round mode (src/core/system-design.js).
// Run on demand: node scripts/eval-system-design.js [label] [--only=android,frontend,fullstack] [--steps=N]
// Uses your real key (.env) and saved resumes. Quota per profile: 5 requests
// on the normal chain (3.5-flash-lite first) + 1 "Build design" on the
// reasoning chain (3.8-flash first, 20/day) — not before an interview.
//
// One round per profile, the way main.js runs it (history recorded per turn):
//   1  problem statement            → Ask these / Assuming / Rough numbers, REQ block, no diagram
//   2  info + question mixed         → the question answered normally, REQ updated (confirmed items)
//   3  theory question (CAP)         → normal answer, "REQ: same" (card unchanged)
//   4  Build design (reasoning)      → Requirements recap, API, data model, ```mermaid, Components
//   5  design-changing follow-up     → full diagram with :::changed, NEW/CHANGED components
//   6  explanation-only follow-up    → no diagram
// Mermaid sources are written to <tmp>/opencluely-sd-<label>/ for the real
// renderer check (scripts/sd-render-check.js, runs mermaid in Electron).
const env = require('../test/helpers/env');
const fs = require('fs');
const os = require('os');
const path = require('path');

const realEnv = require('dotenv').parse(fs.readFileSync(path.join(env.ROOT, '.env')));
process.env.GEMINI_API_KEY = realEnv.GEMINI_API_KEY || '';
for (const id of ['android', 'frontend', 'fullstack']) {
  const saved = path.join(process.env.APPDATA || '', 'opencluely', 'resume-profiles', `${id}.txt`);
  if (fs.existsSync(saved)) env.writeResume(id, fs.readFileSync(saved, 'utf8'));
}
const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');
const sd = env.req('src/core/system-design');
const { promptLoader } = env.req('prompt-loader.js');
llm.initializeClient();

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || 'run';
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
// --steps=3: run steps 1..3 only (no Build design, saves the reasoning quota)
const MAX_STEP = Number((args.find(a => a.startsWith('--steps=')) || '--steps=6').slice(8));
const GAP_MS = 4500;
const OUT = path.join(os.tmpdir(), `opencluely-sd-${label}`);
fs.mkdirSync(OUT, { recursive: true });

const ROUNDS = {
  fullstack: [
    'Design a chat feature for our app.',
    "It's one-to-one and small group chats, web and mobile, about five million monthly users. How would you make sure messages arrive in the right order?",
    'Quick one: what is the CAP theorem?',
    'BUILD',
    'How would you add image attachments to messages?',
    'Why did you pick WebSockets over long polling?',
  ],
  frontend: [
    'Design the frontend for a live sports scores web app.',
    'It needs SEO for match pages and should work well on slow mobile networks. How would you keep the scores live without hammering the server?',
    'Quick one: what is the difference between SSR and SSG?',
    'BUILD',
    'Now add a personalized "my teams" feed for logged-in users. How does the design change?',
    'Why TanStack Query instead of keeping everything in a global store?',
  ],
  android: [
    'Design an offline-first chat app for Android.',
    'Messages must be readable offline and sent when the network comes back, about 50 thousand daily users. How would you handle process death while a message is being sent?',
    'Quick one: what is the difference between StateFlow and SharedFlow?',
    'BUILD',
    'How would you add image attachments with upload progress?',
    'Why use WorkManager for sending instead of a foreground service?',
  ],
};

// Framework per profile for diagram 2 (what the user would select).
const FRAMEWORK = { fullstack: 'nextjs', frontend: 'vue3', android: 'compose' };
const frameworkModule = env.req('src/core/framework');
// Form-style labels the components must no longer use (2026-10-11 feedback).
const HOW_RE = /\*\*How it works:?\*\*/g;
const FORM_LABEL_RE = /(^|\s|·)(what|why|term|trade-off):\s/im;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const countMermaid = (t) => (t.match(/```mermaid/g) || []).length;

async function turn(skill, question, { reasoning = false } = {}) {
  const start = Date.now();
  let first = null;
  const result = await llm.processTextWithSkillStream(question, skill, [], skill === 'android' ? 'kotlin' : 'typescript',
    (d) => { if (first === null && d) first = Date.now() - start; }, null, { reasoning: reasoning ? { maxOutputTokens: 16384 } : false });
  const total = Date.now() - start;
  session.addUserInput(question, 'chat');
  session.addModelResponse(result.response, { skill });
  sd.afterAnswer({ question, response: result.response, reqLines: result.metadata.reqLines || null });
  return { result, first, total };
}

(async () => {
  const report = [];
  for (const skill of Object.keys(ROUNDS)) {
    if (ONLY.length && !ONLY.includes(skill)) continue;
    session.clear();
    frameworkModule.setFramework(FRAMEWORK[skill], skill);
    sd.setOn(true);
    console.log(`\n================ ${skill} ================`);
    console.log(`system prompt (mode on, gathering): ${promptLoader.getSkillPrompt(skill).length} chars`);
    for (const [i, q] of ROUNDS[skill].entries()) {
      const step = i + 1;
      if (step > MAX_STEP) break;
      const build = q === 'BUILD';
      const question = build ? sd.buildDesignRequestText(skill) : q;
      if (build) sd.setStage('built');
      let r;
      const logStart = env.logs.length;
      try {
        r = await turn(skill, question, { reasoning: build });
      } catch (e) {
        console.log(`[${step}] ERROR ${e.message}`);
        report.push({ skill, step, error: e.message });
        continue;
      }
      const text = r.result.response;
      const st = sd.getState();
      const row = {
        skill, step, build,
        model: llm.lastModel || null,
        firstChunkMs: r.first, totalMs: r.total, chars: text.length,
        mermaid: countMermaid(text),
        changedMarks: (text.match(/:::changed/g) || []).length,
        reqLines: r.result.metadata.reqLines === undefined ? 'n/a' : (r.result.metadata.reqLines ? r.result.metadata.reqLines.length : 'none'),
        leakedReq: /^\s*(\*\*)?REQ:/m.test(text),
        askThese: /Ask these/i.test(text),
        sections: build ? ['Summary', 'Requirements', 'API', 'Data model', 'High-level architecture', 'App architecture', 'Key flow', 'Components'].filter(h => new RegExp(`^#{2,4}\\s*${h}`, 'mi').test(text)) : undefined,
        diagrams: sd.extractDiagrams(text).map(d => d.title),
        howItWorks: (text.match(HOW_RE) || []).length,
        formLabels: (() => { const c = /^#{2,4}\s*Components\b[\s\S]*?(?=^#{2,4}\s|(?![\s\S]))/im.exec(text); return c ? FORM_LABEL_RE.test(c[0]) : false; })(),
        req: JSON.parse(JSON.stringify(st.requirements)),
      };
      report.push(row);
      sd.extractDiagrams(text).forEach((d, k) => fs.writeFileSync(path.join(OUT, `${skill}-${step}-${k + 1}.mmd`), d.source));
      fs.writeFileSync(path.join(OUT, `${skill}-${step}.md`), `Q: ${question}\n\n${text}\n\n---\nREQ lines: ${JSON.stringify(r.result.metadata.reqLines)}\n`);
      console.log(`[${step}]${build ? ' BUILD' : ''} ${row.model} first ${r.first}ms total ${r.total}ms chars ${text.length} mermaid ${row.mermaid} changed ${row.changedMarks} req ${row.reqLines} leaked ${row.leakedReq}${row.sections ? ` sections ${row.sections.join('/')}` : ''} diagrams [${row.diagrams.join(' | ')}] howItWorks ${row.howItWorks} formLabels ${row.formLabels}`);
      if (build) {
        // Which models were tried and why the answer came from the one it did.
        env.logs.slice(logStart)
          .filter(l => /model|skip|hedge|first chunk|stall|503|429|quota/i.test(String(l.message)) && l.level !== 'debug')
          .forEach(l => console.log(`     log: ${l.level} ${l.message} ${JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k]) => !['level', 'message', 'timestamp', 'service'].includes(k) && typeof k === 'string'))).slice(0, 220)}`));
      }
      if (!build) console.log(`     card: +${st.requirements.confirmed.length} ~${st.requirements.assuming.length} !${st.requirements.edge.length} -${st.requirements.out.length} ?${st.requirements.next.length}`);
      await sleep(GAP_MS);
    }
    sd.setOn(false);
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nSaved to ${OUT}`);
})();
