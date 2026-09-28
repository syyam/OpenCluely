// The knowledge matcher already has a thorough offline check with its own
// case table (scripts/test-knowledge.js); run it as-is and require a pass.
const env = require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

test('scripts/test-knowledge.js passes', () => {
  const r = spawnSync(process.execPath, [path.join(env.ROOT, 'scripts', 'test-knowledge.js')], {
    cwd: env.ROOT,
    env: { ...process.env, HOME: env.TMP, USERPROFILE: env.TMP },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `test-knowledge failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /All checks passed/);
});
