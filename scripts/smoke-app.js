// App launch smoke test — npm run test:smoke
// Starts the real Electron app, waits until it logs "Application initialized
// successfully", checks nothing was written to the error/exception logs, then
// closes it. HOME/USERPROFILE point at a temp dir so the logs land there, not
// in ~/.OpenCluely, and --user-data-dir gives it its own settings folder: the
// app allows one instance per settings folder, so without it a launch while
// your OpenCluely is open would just quit. That also means it starts like a
// first run (onboarding window) using the project .env. The overlay windows
// appear on screen for a few seconds.
// No questions are asked; the only Gemini traffic is the model monitor's
// start-up probe (one tiny "Say hi." request, more only if the primary fails),
// which the test waits for when a key is configured.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 25000;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-smoke-'));
const logDir = path.join(home, '.OpenCluely', 'logs');
const userDataDir = path.join(home, 'userData');

// The Deep reasoning primary is probed after the normal chain at start-up.
const appConfig = require(path.join(ROOT, 'src', 'core', 'config.js'));
const NORMAL_CHAIN = [appConfig.get('llm.gemini.model'), ...(appConfig.get('llm.gemini.fallbackModels') || [])];
const REASONING_ONLY = (appConfig.get('llm.gemini.reasoning.models') || []).filter(m => !NORMAL_CHAIN.includes(m));
const electronBin = require('electron'); // path to the binary when required from Node
const childEnv = { ...process.env, HOME: home, USERPROFILE: home };
delete childEnv.ELECTRON_RUN_AS_NODE;

const t0 = Date.now();
const child = spawn(electronBin, ['.', `--user-data-dir=${userDataDir}`], { cwd: ROOT, env: childEnv, stdio: 'ignore', windowsHide: false });

function readLogs(prefix) {
  if (!fs.existsSync(logDir)) return '';
  return fs.readdirSync(logDir).filter(f => f.startsWith(prefix)).map(f => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n');
}

function stop() {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function finish(ok, message) {
  stop();
  const errors = readLogs('error-').trim();
  const exceptions = readLogs('exceptions').trim();
  const lines = [message];
  if (errors) lines.push('error log:\n' + errors.slice(0, 2000));
  if (exceptions) lines.push('exceptions log:\n' + exceptions.slice(0, 2000));
  const pass = ok && !errors && !exceptions;
  console.log((pass ? 'PASS ' : 'FAIL ') + lines.join('\n'));
  setTimeout(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch (_) { /* locked on Windows */ }
    process.exit(pass ? 0 : 1);
  }, 500);
}

let done = false;
child.on('exit', (code) => {
  if (!done) { done = true; finish(false, `app exited early with code ${code} after ${Date.now() - t0}ms`); }
});

const poll = setInterval(() => {
  if (done) return clearInterval(poll);
  const app = readLogs('application-');
  if (/Application initialized successfully/.test(app)) {
    done = true;
    clearInterval(poll);
    const initMs = Date.now() - t0;
    // Wait for the model monitor's start-up probes (normal chain, then the
    // Deep reasoning chain; up to 25s), then a moment for anything that fails
    // right after start-up to log.
    const probeDeadline = Date.now() + 25000;
    const waitProbe = setInterval(() => {
      const logs = readLogs('application-');
      const probes = [...logs.matchAll(/Model probe (answered|failed)[\s\S]*?"model": "([^"]+)"/g)].map(m => `${m[2]} ${m[1]}`);
      const noKey = /Gemini API key not configured/.test(logs);
      // Done once a reasoning-only model (Deep reasoning primary) was probed too.
      const reasoningOnly = REASONING_ONLY.length ? probes.some(p => REASONING_ONLY.some(m => p.startsWith(m + ' '))) : true;
      if ((probes.length && reasoningOnly) || noKey || Date.now() > probeDeadline) {
        clearInterval(waitProbe);
        const note = probes.length ? `, start-up model probe: ${probes.join(', ')}` : noKey ? ', no API key (no probe)' : ', NO model probe logged';
        setTimeout(() => finish(!!probes.length || noKey, `app initialized in ${initMs}ms${note}`), 2000);
      }
    }, 250);
  } else if (Date.now() - t0 > TIMEOUT_MS) {
    done = true;
    clearInterval(poll);
    finish(false, `app did not initialize within ${TIMEOUT_MS}ms`);
  }
}, 250);
