const env = require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');

const session = env.req('src/managers/session.manager');

test.beforeEach(() => session.clear());

test('user/model turns are recorded in order and returned as history', () => {
  const u = session.addUserInput('Q1', 'speech');
  const m = session.addModelResponse('A1', { skill: 'frontend' });
  assert.ok(u && m && u !== m, 'events get distinct ids');
  const h = session.getConversationHistory(10).filter(e => e.role !== 'system');
  assert.deepEqual(h.map(e => [e.role, e.content]), [['user', 'Q1'], ['model', 'A1']]);
  assert.equal(h[1].latestCode, null);
});

test('setLatestCode attaches to that model event only, and a newer one overwrites', () => {
  session.addUserInput('Q1');
  const a1 = session.addModelResponse('A1');
  session.addUserInput('Q2');
  const a2 = session.addModelResponse('A2');
  assert.equal(session.setLatestCode(a1, { mode: 'optimized', code: 'OPT' }), true);
  assert.equal(session.setLatestCode(a1, { mode: 'convert:react-jsx', code: 'CONV' }), true);
  const h = session.getConversationHistory(10).filter(e => e.role === 'model');
  assert.deepEqual(h.find(e => e.content === 'A1').latestCode, { mode: 'convert:react-jsx', code: 'CONV' });
  assert.equal(h.find(e => e.content === 'A2').latestCode, null);
  assert.equal(session.setLatestCode('no-such-id', { mode: 'optimized', code: 'x' }), false);
  assert.equal(session.setLatestCode(session.addUserInput('Q3'), { mode: 'optimized', code: 'x' }), false, 'user events never get code');
  void a2;
});

test('clear empties the conversation', () => {
  session.addUserInput('Q');
  session.addModelResponse('A');
  session.clear();
  assert.equal(session.getConversationHistory(50).filter(e => e.role !== 'system').length, 0);
});

test('history window returns the most recent entries', () => {
  for (let i = 1; i <= 12; i++) {
    session.addUserInput(`Q${i}`);
    session.addModelResponse(`A${i}`);
  }
  const h = session.getConversationHistory(4);
  assert.deepEqual(h.map(e => e.content), ['Q11', 'A11', 'Q12', 'A12']);
});

test('system events and canned fallback pairs no longer take history slots', () => {
  session.addUserInput('Q1');
  session.addModelResponse('A1');
  session.setActiveSkill('android');                       // system event
  session.addEvent('Application started');                 // plain event
  session.addConversationEvent({ role: 'system', content: 'LLM processing failed: 503', action: 'llm_error' });
  session.addUserInput('garbled question', 'speech');
  session.addModelResponse('Could you repeat that?', { usedFallback: true });
  session.addUserInput('Q2');
  session.addModelResponse('A2');
  assert.deepEqual(session.getConversationHistory(4).map(e => e.content), ['Q1', 'A1', 'Q2', 'A2']);
});
