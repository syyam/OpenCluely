// Test isolation. Require this FIRST in every test file, before any app module:
// - HOME/USERPROFILE → a temp dir, so nothing is written to the real
//   ~/.OpenCluely (logger) and the user's settings stay untouched;
// - cwd → the same temp dir, because resume profiles, interview notes and the
//   Japanese-mode flag fall back to process.cwd() outside Electron;
// - fixture resumes/notes, a dummy API key, and no GEMINI_MODEL/WHISPER_*
//   overrides, so config defaults are what's tested;
// - the app logger is silenced (no console/file output, no exit-on-uncaught)
//   and captured in memory for assertions.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Transport = require('winston-transport');

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-test-'));

process.env.HOME = TMP;
process.env.USERPROFILE = TMP;
process.env.GEMINI_API_KEY = 'test-key';
for (const key of Object.keys(process.env)) {
  if (/^(GEMINI_MODEL|WHISPER_|AZURE_SPEECH_|SPEECH_PROVIDER)/.test(key)) delete process.env[key];
}
process.chdir(TMP);

const RESUME = {
  android: 'ANDROID_RESUME_MARKER Kotlin Coroutines',
  frontend: 'FRONTEND_RESUME_MARKER React Vue TypeScript',
  fullstack: 'FULLSTACK_RESUME_MARKER Node Spring',
};
const NOTES = 'INTERVIEW_NOTES_MARKER visa status';

function writeResume(profile, text) {
  const dir = path.join(TMP, 'resume-profiles');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile}.txt`), text, 'utf8');
}
for (const [profile, text] of Object.entries(RESUME)) writeResume(profile, text);
fs.writeFileSync(path.join(TMP, 'interview-metadata.txt'), NOTES, 'utf8');

function setJapanese(enabled) {
  fs.writeFileSync(path.join(TMP, 'japanese-mode.flag'), enabled ? 'true' : 'false', 'utf8');
}
setJapanese(false);

/** require() an app module by its repo-relative path. */
function req(rel) {
  return require(path.join(ROOT, rel));
}

// ── Logger: silence + capture ──
const logs = [];
class CaptureTransport extends Transport {
  log(info, callback) {
    logs.push(info);
    callback();
  }
}
const appLogger = req('src/core/logger');
appLogger.logger.clear(); // console + rotating files
appLogger.logger.add(new CaptureTransport({ level: 'debug' }));
appLogger.logger.level = 'debug';
appLogger.logger.exceptions.unhandle();
appLogger.logger.rejections.unhandle();
appLogger.logger.exitOnError = false;

/** Captured log entries whose message matches `pattern` (string or RegExp). */
function findLogs(pattern) {
  return logs.filter(l => (pattern instanceof RegExp ? pattern.test(l.message) : String(l.message).includes(pattern)));
}

process.on('exit', () => {
  // Step out first: Windows can't delete the current working directory.
  try { process.chdir(os.tmpdir()); } catch (_) { /* ignore */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* Windows file locks */ }
});

module.exports = { ROOT, TMP, RESUME, NOTES, req, writeResume, setJapanese, logs, findLogs };
