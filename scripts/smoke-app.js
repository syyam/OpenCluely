// App launch smoke test — npm run test:smoke
// Starts the real Electron app, waits until it logs "Application initialized
// successfully", checks nothing was written to the error/exception logs, then
// closes it. HOME/USERPROFILE point at a temp dir so the logs land there, not
// in ~/.OpenCluely, and --user-data-dir gives it its own settings folder: the
// app allows one instance per settings folder, so without it a launch while
// your OpenCluely is open would just quit. That also means it starts like a
// first run (onboarding window) using the project .env. The overlay windows
// appear on screen for a few seconds.
// No Gemini requests are made (nothing is asked).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 25000;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-smoke-'));
const logDir = path.join(home, '.OpenCluely', 'logs');
const userDataDir = path.join(home, 'userData');

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
    // A moment for anything that fails right after start-up to log.
    setTimeout(() => finish(true, `app initialized in ${Date.now() - t0}ms`), 2000);
  } else if (Date.now() - t0 > TIMEOUT_MS) {
    done = true;
    clearInterval(poll);
    finish(false, `app did not initialize within ${TIMEOUT_MS}ms`);
  }
}, 250);
