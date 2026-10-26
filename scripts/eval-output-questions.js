// LIVE prompt eval — screenshots of finished code that calls its own
// functions ("what will this output?"), 2026-10-01.
// Run on demand: node scripts/eval-output-questions.js [label] [--runs=N] [--only=FLOW,C1]
// Uses your real key (.env) and saved resume. Quota: about 9 × runs requests
// on the normal chain (3.5-flash-lite first) — not before an interview.
// Windows only: the screenshots are drawn with System.Drawing (PowerShell).
//
// FLOW replays the user's session in order, history carried like main.js:
//   1  screenshot: obj with regular() + a call       → full format + output
//   2  voice "Now, in this object add an arrow function." → coding follow-up
//   3  voice "that returns the state.name."               → coding follow-up
//   4  screenshot: arrow using this.name, both calls  → full format + output
//   5  screenshot: this?.name version                 → full format + output
// Controls (fresh session each):
//   C1 stub screenshot (debounce TODO)                → implementation layout
//   C2 conceptual screenshot (arrow vs regular)       → words, no code block
//   C3 complete code + calls with a TODO comment to add greet() → implemented
//   C4 complete code screenshot + typed "add a greet() method"  → implemented
// Results are saved to <tmp>/opencluely-output-<label>.json for before/after.
const env = require('../test/helpers/env');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const realEnv = require('dotenv').parse(fs.readFileSync(path.join(env.ROOT, '.env')));
process.env.GEMINI_API_KEY = realEnv.GEMINI_API_KEY || '';
const saved = path.join(process.env.APPDATA || '', 'opencluely', 'resume-profiles', 'frontend.txt');
if (fs.existsSync(saved)) env.writeResume('frontend', fs.readFileSync(saved, 'utf8'));
const llm = env.req('src/services/llm.service');
const session = env.req('src/managers/session.manager');
llm.initializeClient();

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || 'run';
const RUNS = Number((args.find(a => a.startsWith('--runs=')) || '--runs=1').slice(7));
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const GAP_MS = 4500;
const LANG = 'typescript';

const CODE = {
  s1: `const obj = {
  name: 'pp',
  regular() {
    return this.name;
  },
};

console.log(obj.regular());`,
  s4: `const obj = {
  name: 'pp',
  regular() {
    return this.name;
  },
  arrow: () => this.name,
};

console.log(obj.arrow());
console.log(obj.regular());`,
  s5: `const obj = {
  name: 'pp',
  regular() {
    return this.name;
  },
  arrow: () => this?.name,
};

obj.arrow();
obj.regular();`,
  c1: `// Implement debounce: fn runs only after \`wait\` ms
// have passed without another call.
function debounce(fn, wait) {
  // TODO
}`,
  c2: `Question 3

Explain the difference between arrow functions
and regular functions in JavaScript.`,
  c3: `const user = {
  name: 'pp',
  regular() {
    return this.name;
  },
  // TODO: add a greet() method that returns "Hi, " + name
};

console.log(user.regular());`,
  c4: `const user = {
  name: 'pp',
  regular() {
    return this.name;
  },
};

console.log(user.regular());`,
};

// Editor-like PNG (dark theme, monospace), cached in tmp.
function render(id) {
  const dir = path.join(os.tmpdir(), 'opencluely-output-eval');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.png`);
  const txt = path.join(dir, `${id}.txt`);
  fs.writeFileSync(txt, CODE[id]);
  const ps = `Add-Type -AssemblyName System.Drawing
$t = [IO.File]::ReadAllText('${txt}')
$bmp = New-Object Drawing.Bitmap 1400, 640
$g = [Drawing.Graphics]::FromImage($bmp)
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([Drawing.Color]::FromArgb(30,30,30))
$f = New-Object Drawing.Font 'Consolas', 20
$b = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(212,212,212))
$n = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(110,118,129))
$y = 30; $i = 1
foreach ($line in $t -split "\`n") { $g.DrawString(([string]$i).PadLeft(2), $f, $n, 20, $y); $g.DrawString($line, $f, $b, 90, $y); $y += 34; $i++ }
$bmp.Save('${file}', [Drawing.Imaging.ImageFormat]::Png)`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps]);
  return { buffer: fs.readFileSync(file), mimeType: 'image/png' };
}

const fence = (r) => /```/.test(r);
const fullLayout = (r) => /###\s*Solution/i.test(r) && /\*\*Approach\*\*/.test(r) && fence(r);
const exampleFlow = (r) => /Example flow/i.test(r);
// Each named value must appear in the Example flow section (not only in prose).
const flowHas = (r, ...res) => {
  const m = r.split(/\*\*Example flow\*\*|Example flow/i)[1] || '';
  return res.every(re => re.test(m));
};
const outputCase = (...res) => (r) => fullLayout(r) && exampleFlow(r) && flowHas(r, ...res);
const followUp = (r) => fullLayout(r) && /CHANGED:/.test(r);

const STEPS = {
  FLOW: [
    { n: 1, kind: 'image', img: 's1', check: outputCase(/'pp'|"pp"|\bpp\b/) },
    { n: 2, kind: 'voice', q: 'Now, in this object add an arrow function.', check: followUp },
    { n: 3, kind: 'voice', q: 'that returns to the state.name.', check: followUp },
    { n: 4, kind: 'image', img: 's4', check: outputCase(/undefined/, /'pp'|"pp"|\bpp\b/) },
    { n: 5, kind: 'image', img: 's5', check: outputCase(/undefined/, /'pp'|"pp"|\bpp\b/) },
  ],
  C1: [{ n: 1, kind: 'image', img: 'c1', check: (r) => fullLayout(r) && /setTimeout/.test(r) }],
  C2: [{ n: 1, kind: 'image', img: 'c2', check: (r) => !fence(r) && !/###\s*Solution/i.test(r) }],
  C3: [{ n: 1, kind: 'image', img: 'c3', check: (r) => fullLayout(r) && /greet\s*\(/.test(r) }],
  C4: [{ n: 1, kind: 'image', img: 'c4', text: 'add a greet() method that returns "Hi, " + name', check: (r) => fullLayout(r) && /greet\s*\(/.test(r) }],
};

async function runStep(step, images) {
  const t0 = Date.now();
  let first = null;
  const onDelta = () => { if (first === null) first = Date.now() - t0; };
  let r;
  if (step.kind === 'image') {
    r = await llm.processImageWithSkillStream([images[step.img]], 'frontend', LANG, onDelta, { text: step.text || '' });
    session.addUserInput(step.text ? `[Screenshot] ${step.text}` : '[Screenshot]', 'screenshot');
  } else {
    r = await llm.processTranscriptionWithIntelligentResponseStream(step.q, 'frontend', [], LANG, onDelta, null);
    session.addUserInput(step.q, 'speech');
  }
  session.addModelResponse(r.response, { skill: 'frontend' });
  return { response: r.response, first, total: Date.now() - t0 };
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY in .env');
  const images = Object.fromEntries(Object.keys(CODE).map(id => [id, render(id)]));
  const out = {};
  for (const [id, steps] of Object.entries(STEPS).filter(([id]) => !ONLY.length || ONLY.includes(id))) {
    out[id] = [];
    for (let i = 0; i < RUNS; i++) {
      session.clear();
      session.setActiveSkill('frontend');
      for (const step of steps) {
        let res;
        try { res = await runStep(step, images); } catch (e) { res = { response: `ERROR: ${e.message}`, first: null, total: 0 }; }
        const pass = !!step.check(res.response);
        out[id].push({ run: i + 1, step: step.n, pass, chars: res.response.length, first: res.first, response: res.response });
        console.log(`${pass ? 'PASS' : 'FAIL'} ${id}.${step.n} #${i + 1} — first ${res.first}ms, ${res.response.length} chars\n     ${res.response.replace(/\s+/g, ' ').slice(0, 170)}`);
        await new Promise(r => setTimeout(r, GAP_MS));
      }
    }
  }
  const file = path.join(os.tmpdir(), `opencluely-output-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('\nSummary');
  const rows = [];
  for (const [id, list] of Object.entries(out)) {
    for (const n of [...new Set(list.map(x => x.step))]) {
      const xs = list.filter(x => x.step === n);
      rows.push({ case: `${id}.${n}`, pass: `${xs.filter(x => x.pass).length}/${xs.length}`,
        firstMs: Math.round(xs.reduce((a, x) => a + (x.first || 0), 0) / xs.length),
        chars: Math.round(xs.reduce((a, x) => a + x.chars, 0) / xs.length) });
    }
  }
  console.table(rows);
  console.log(`Saved ${file}`);
})();
