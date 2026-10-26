// LIVE speech eval — are spoken JS / Vue terms transcribed and understood?
// Run on demand:
//   node scripts/eval-speech-terms.js [label] [--fw=vue3,auto] [--only=S1,S2] [--llm]
//
// 1. Speaks each sentence with Windows SAPI (System.Speech) into a 16 kHz WAV
//    under <tmp>/opencluely-speech-bench (made once, then reused).
// 2. Transcribes it with the real Whisper worker (.venv-whisper, WHISPER_MODEL
//    from .env) and the real hint (speech-vocab getWhisperPrompt('frontend',
//    fw)). Local only — no Gemini quota.
// 3. --llm: each transcript that lost the term goes through the interviewer
//    (Meeting Audio) request path, like eval-voice-heard.js, to see whether
//    the answer still names the right term. About 1 lite-model request per
//    miss (500/day free) — not before an interview.
//
// SAPI is a clean synthetic voice, so this finds systematic misses (a term
// the hint or the prompt doesn't cover), not every accent or room problem.
const env = require('../test/helpers/env');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const realEnv = require('dotenv').parse(fs.readFileSync(path.join(env.ROOT, '.env')));
const { getWhisperPrompt } = require('../src/core/speech-vocab');

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || 'run';
const FWS = (args.find(a => a.startsWith('--fw=')) || '--fw=vue3,auto').slice(5).split(',');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const LLM = args.includes('--llm');
// --hard: faster speech, phone-band audio and background noise, closer to a
// call than the clean default voice.
const HARD = args.includes('--hard');
const SUFFIX = HARD ? '-hard' : '';
const DIR = path.join(os.tmpdir(), 'opencluely-speech-bench');

// say: what the interviewer says. heard: the term written correctly (spacing
// and case don't matter — "use memo" is fine, the model joins it). meant: the
// term the answer must use.
const S = [
  ['S1', 'Why would you use use memo in a component?', /use ?memo/i, /useMemo/],
  ['S2', 'What does use callback do?', /use ?callback/i, /useCallback/],
  ['S3', 'What is the difference between v show and v if?', /v-?show/i, /v-show/],
  ['S4', 'How does v on click work in Vue?', /v-?on/i, /v-on|@click/],
  ['S5', 'Why do we use at click instead of v on?', /@click|at ?click/i, /@click/],
  ['S6', 'Why do you need colon key in a v for loop?', /:key|colon key/i, /:key/],
  ['S7', 'How do define props and define emits work in script setup?', /define ?props/i, /defineProps/],
  ['S8', 'When would you use next tick in Vue?', /next ?tick/i, /nextTick/],
  ['S9', 'What is the difference between watch and watch effect?', /watch ?effect/i, /watchEffect/],
  ['S10', 'What happens in on mounted?', /on ?mounted/i, /onMounted/],
  ['S11', 'What does keep alive do in Vue?', /keep[- ]?alive/i, /KeepAlive|keep-alive/],
  ['S12', 'When would you use teleport?', /teleport/i, /Teleport|teleport/],
  ['S13', 'How do provide and inject work?', /provide/i, /provide/],
  ['S14', 'Why would you choose Pinia over Vuex?', /pinia/i, /Pinia/],
  ['S15', 'How is state managed with Vuex?', /vuex/i, /Vuex/],
  ['S16', 'What does Nuxt give you over plain Vue?', /nuxt/i, /Nuxt/],
  ['S17', 'Why is Vite faster than Webpack in development?', /vite/i, /Vite/],
  ['S18', 'What does script setup change in a single file component?', /script setup/i, /script setup/],
  ['S19', 'Why do you need ref dot value in the script but not in the template?', /\.value|dot value/i, /\.value/],
  ['S20', 'What does promise dot all do if one promise rejects?', /promise\.all|promise dot all/i, /Promise\.all/],
  ['S21', 'What is the difference between promise dot all and promise dot all settled?', /allSettled|all settled/i, /allSettled/],
  ['S22', 'What is the nullish coalescing operator?', /nullish/i, /\?\?|nullish/i],
  ['S23', 'How does optional chaining work?', /optional chaining/i, /\?\.|optional chaining/i],
  ['S24', 'Can you explain destructuring in JavaScript?', /destructur/i, /destructur/i],
  ['S25', 'What is hoisting?', /hoist/i, /hoist/i],
  ['S26', 'What is a closure in JavaScript?', /closure/i, /closure/i],
  ['S27', 'What is the difference between debounce and throttle?', /debounc/i, /debounc/i],
  ['S28', 'How does the event loop handle microtasks?', /micro ?task/i, /microtask/i],
  ['S29', 'When would you use a weak map?', /weak ?map/i, /WeakMap/],
  ['S30', 'What is the difference between type of and instance of?', /instance ?of/i, /instanceof/],
  ['S31', 'How does async await work under the hood?', /async/i, /async/],
  ['S32', 'What happens with set timeout zero?', /set ?timeout/i, /setTimeout/],
  ['S33', 'What does array dot from do?', /array\.from|array dot from/i, /Array\.from/],
  ['S34', 'What does object dot freeze do?', /object\.freeze|object dot freeze/i, /Object\.freeze/],
  ['S35', 'Why can JSON dot parse throw?', /json\.parse|json dot parse/i, /JSON\.parse/],
  ['S36', 'What is the difference between local storage and session storage?', /local ?storage/i, /localStorage|local storage/i],
  ['S37', 'Why would you use Axios instead of fetch?', /axios/i, /Axios|axios/],
  ['S38', 'Why would you pick Zustand over Redux?', /zustand/i, /Zustand/],
  ['S39', 'What does TanStack Query do for caching?', /tan ?stack/i, /TanStack/],
  ['S40', 'How does use effect cleanup work?', /use ?effect/i, /useEffect/],
  ['S41', 'What is the Composition API?', /composition api/i, /Composition API/],
  ['S42', 'How does v model work on a custom component?', /v-?model/i, /v-model/],
  ['S43', 'Can you add a dot not to the expect function?', /\.not|dot not/i, /\.not/],
  ['S44', 'What does array dot map return?', /\.map|dot map/i, /\.map|map\(/],
  ['S45', 'What is the difference between computed and watch?', /computed/i, /computed/],
  ['S46', 'What is a composable in Vue?', /composable/i, /composable/i],
  ['S47', 'How does reactive differ from ref?', /reactive/i, /reactive/],
  ['S48', 'What is shallow ref used for?', /shallow ?ref/i, /shallowRef/],
  // Vite as people say it ("veet"); SAPI reads "Vite" in S17 like "kite".
  // 2026-10-02: heard as "need" and other rhymes.
  ['S49', 'Why is veet faster than Webpack in development?', /vite/i, /Vite/],
  ['S50', 'We moved the build from Webpack to veet.', /vite/i, /Vite/],
  ['S51', 'How does veet handle hot module replacement?', /vite/i, /Vite/],
].map(([id, say, heard, meant]) => ({ id, say, heard, meant }));

function makeWavs(list) {
  fs.mkdirSync(DIR, { recursive: true });
  const wav = (s) => path.join(DIR, `${s.id}${SUFFIX}.wav`);
  const todo = list.filter(s => !fs.existsSync(wav(s)));
  if (!todo.length) return;
  const lines = todo.map(s => `@('${wav(s)}','${s.say.replace(/'/g, "''")}')`).join(',');
  const ps = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = ${HARD ? 3 : 0}
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($p in @(${lines})) { $s.SetOutputToWaveFile($p[0], $fmt); $s.Speak($p[1]) }
$s.SetOutputToNull(); $s.Dispose()`;
  const file = path.join(DIR, 'make.ps1');
  fs.writeFileSync(file, '﻿' + ps, 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { stdio: 'inherit' });
  if (HARD) todo.forEach(s => degrade(wav(s)));
}

// 8 kHz phone band (average pairs, then hold) plus white noise at about
// 15 dB under the speech level. Fixed seed, so runs are comparable.
function degrade(file) {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf('data') + 8;
  const n = (buf.length - at) >> 1;
  let rms = 0;
  for (let i = 0; i < n; i++) { const v = buf.readInt16LE(at + i * 2); rms += v * v; }
  rms = Math.sqrt(rms / n);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let i = 0; i + 1 < n; i += 2) {
    const a = buf.readInt16LE(at + i * 2), b = buf.readInt16LE(at + i * 2 + 2);
    const avg = (a + b) / 2;
    for (const k of [i, i + 1]) {
      const v = Math.max(-32768, Math.min(32767, Math.round(avg + rnd() * rms * 0.6)));
      buf.writeInt16LE(v, at + k * 2);
    }
  }
  fs.writeFileSync(file, buf);
}

function startWorker() {
  const py = path.join(env.ROOT, '.venv-whisper', 'Scripts', 'python.exe');
  const proc = spawn(py, [path.join(env.ROOT, 'scripts', 'whisper_worker.py')], { cwd: env.ROOT });
  const waiting = new Map();
  let buf = '';
  let readyResolve;
  const ready = new Promise(r => { readyResolve = r; });
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
      if (msg.event === 'ready') readyResolve(msg);
      else if (waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    }
  });
  proc.stderr.on('data', () => {});
  let n = 0;
  const call = (req) => new Promise((resolve) => {
    const id = `r${++n}`;
    waiting.set(id, resolve);
    proc.stdin.write(JSON.stringify({ id, ...req }) + '\n');
  });
  return { ready, call, stop: () => proc.kill() };
}

async function understood(transcript, fw) {
  const llm = env.req('src/services/llm.service');
  const session = env.req('src/managers/session.manager');
  if (!understood.init) {
    process.env.GEMINI_API_KEY = realEnv.GEMINI_API_KEY || '';
    llm.initializeClient();
    understood.init = true;
  }
  env.req('src/core/framework').setFramework(fw === 'auto' ? '' : fw, 'frontend');
  session.clear();
  session.setActiveSkill('frontend');
  let heard = null;
  const r = await llm.processTranscriptionWithIntelligentResponseStream(
    transcript, 'frontend', [], 'typescript', () => {}, () => {}, { onHeard: (n) => { heard = n; } });
  return { body: r.response, heard: (r.metadata && r.metadata.heard) || heard };
}

(async () => {
  const list = S.filter(s => !ONLY.length || ONLY.includes(s.id));
  makeWavs(list);
  const w = startWorker();
  const info = await w.ready;
  console.log(`Whisper worker ready (gpu: ${info.gpu || 'none'}), model ${realEnv.WHISPER_MODEL || 'small'}`);
  const modelDir = path.join(env.ROOT, '.whisper-models');
  const out = {};
  for (const fw of FWS) {
    const prompt = getWhisperPrompt('frontend', fw === 'auto' ? null : fw);
    for (const s of list) {
      const r = await w.call({ action: 'transcribe', audio_path: path.join(DIR, `${s.id}${SUFFIX}.wav`), model: realEnv.WHISPER_MODEL || 'small', model_dir: modelDir, language: realEnv.WHISPER_LANGUAGE || 'auto', prompt });
      const text = r.ok ? r.text : `ERROR ${r.error}`;
      const ok = s.heard.test(text);
      (out[s.id] = out[s.id] || { say: s.say, runs: {} }).runs[fw] = { text, ok };
      console.log(`${ok ? 'ok  ' : 'MISS'} ${s.id} [${fw}] ${text}`);
    }
  }
  w.stop();

  if (LLM) {
    console.log('\nInterviewer answers for the transcripts that lost the term');
    for (const s of list) {
      for (const fw of FWS) {
        const run = out[s.id].runs[fw];
        if (run.ok) continue;
        let res;
        try { res = await understood(run.text, fw); } catch (e) { res = { body: `ERROR ${e.message}`, heard: null }; }
        run.answerOk = s.meant.test(res.body);
        run.heardNote = res.heard;
        console.log(`${run.answerOk ? 'understood' : 'WRONG     '} ${s.id} [${fw}] heard=${JSON.stringify(res.heard)}\n     ${res.body.replace(/\s+/g, ' ').slice(0, 140)}`);
        await new Promise(r => setTimeout(r, 4500));
      }
    }
  }

  const file = path.join(os.tmpdir(), `opencluely-speech-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('\nSummary');
  console.table(Object.entries(out).map(([id, v]) => {
    const row = { id, said: v.say.slice(0, 50) };
    for (const fw of FWS) {
      const r = v.runs[fw];
      row[fw] = r.ok ? 'ok' : (r.answerOk === undefined ? 'MISS' : r.answerOk ? 'miss→understood' : 'MISS→wrong');
    }
    return row;
  }));
  for (const fw of FWS) console.log(`${fw}: transcribed ${Object.values(out).filter(v => v.runs[fw].ok).length}/${Object.keys(out).length}`);
  console.log('Saved', file);
  process.exit(0);
})();
