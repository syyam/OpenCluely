// Keyboard typing on My Microphone: the transcript filter and the mic VAD's
// click rejection. Transcripts are the real ones from 2026-09-29 that got
// through to Gemini before this fix.
const env = require('../helpers/env');
const { installElectron } = require('../helpers/electron-stub');
installElectron(env.TMP);
const test = require('node:test');
const assert = require('node:assert/strict');

const speech = env.req('src/services/speech.service');
speech._getSetting = () => null;

const NOISE = [
  'e-mounted, v-f-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r-r',
  'в-у-у-у-у-у-у-у-у-у-у-u-u-u-u-u-u-u-u-u-u-u-u-u-u-u-u-u-u-u-u-u-u',
  'и в-for, в-for, в-for, в-for, в-for, в-for, в-for, в-for, в-for, в-for',
  'and the other one is the one, the one, the one, the one, the one, the one, the one, the one',
  "and then, we'll see you next time.",
  "We'll see you next time!",
];
const REAL = [
  "Hi, what's your name?",
  'Implement, expect.to be in JavaScript.',
  'You need to implement the same JavaScript code that implements expect.2d function manually',
  'So, last character will go in the A vowel of that particular series.',
  'Explain why you did remove full first or no.',
  'Can you walk me through the one thing you would change, the one thing you would keep?',
];

test('noise transcripts from the typing log are dropped', () => {
  for (const t of NOISE) assert.ok(speech._isHallucinatedTranscript(t, 'en', 0), `kept: ${t}`);
});

test('real questions from the same log still pass', () => {
  for (const t of REAL) assert.equal(speech._isHallucinatedTranscript(t, 'en', 0), null, `dropped: ${t}`);
});

// 256 ms of 16 kHz mono PCM16, amplitude per 16 ms sub-frame.
function chunk(levelFor) {
  const buf = Buffer.alloc(4096 * 2);
  for (let i = 0; i < 4096; i++) {
    const level = levelFor(Math.floor(i / 256));
    buf.writeInt16LE(Math.round(level * 32767 * Math.sin(i / 3)), i * 2);
  }
  return buf;
}
const QUIET = () => 0.001;
const SPEECH = (f) => (f % 5 === 4 ? 0.02 : 0.15);  // mostly loud, short dips
const TYPING = (f) => (f % 4 === 0 ? 0.6 : 0.001);   // a click every 64 ms

test('clicks are loud enough on average but not sustained; speech is', () => {
  assert.ok(speech._chunkRmsEnergy(chunk(TYPING)) > 0.1, 'typing chunk clears a plain energy threshold');
  assert.equal(speech._isSustainedSound(chunk(TYPING), 0.02), false);
  assert.equal(speech._isSustainedSound(chunk(SPEECH), 0.02), true);
});

function feed(pattern, n) {
  for (let i = 0; i < n; i++) speech._ingestMicAudio(chunk(pattern));
}

test('mic VAD: typing never starts an utterance, speech does', () => {
  speech.micListening = true;
  speech.micSegmentBuffers = [];
  speech.micSegmentBytes = 0;
  speech._resetMicVadState();
  feed(QUIET, 4);
  const floorBefore = speech.micVadNoiseFloor;
  feed(TYPING, 12); // ~3 s of typing
  assert.equal(speech.micVadSpeaking, false, 'typing did not start an utterance');
  assert.equal(speech.micSegmentBytes, 0);
  assert.ok(speech.micVadNoiseFloor <= floorBefore * 1.01, 'typing did not raise the noise floor');

  feed(SPEECH, 1);
  assert.equal(speech.micVadSpeaking, true, 'speech starts an utterance');
  speech._resetMicVadState();
  speech.micListening = false;
});
