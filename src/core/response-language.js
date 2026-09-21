const fs = require('fs');
const path = require('path');

// Global Japanese-romaji-only response mode — an orthogonal language-output
// modifier, not a fourth resume/skill profile. File-backed (not threaded as
// a new activeSkill-style parameter) so it doesn't require touching every
// processXWithSkill call site in main.js/llm.service.js.
function resolveFlagPath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'japanese-mode.flag');
  } catch (_) {
    return path.join(process.cwd(), 'japanese-mode.flag');
  }
}

function isJapaneseModeEnabled() {
  try {
    const p = resolveFlagPath();
    if (!fs.existsSync(p)) return false;
    return fs.readFileSync(p, 'utf8').trim() === 'true';
  } catch (_) {
    return false;
  }
}

function setJapaneseModeEnabled(enabled) {
  const p = resolveFlagPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, enabled ? 'true' : 'false', 'utf8');
  return !!enabled;
}

function getJapaneseModeInstructionBlock() {
  if (!isJapaneseModeEnabled()) return '';
  return `\n\n## Response Language: Japanese (Romaji Only)
Write all explanatory prose in Japanese, using ONLY Hepburn-style romanization (Latin alphabet). Do not use any hiragana, katakana, or kanji characters anywhere in your response — every Japanese word must be spelled out phonetically in romaji (e.g. "kore wa" not "これは").
Use simple, natural, spoken-interview-register Japanese: polite desu/masu form, not complex or literary keigo. Write the way a candidate would actually speak in a live interview, not textbook-formal Japanese.
This applies ONLY to explanatory prose. Code blocks, identifiers, variable/function names, and any syntax must remain in their normal English/ASCII form — do not translate or romanize code.`;
}

// Used by generateIntelligentFallbackResponse (llm.service.js), the one
// code path that bypasses prompt construction entirely (it only fires when
// the actual Gemini API call itself threw) — so it needs its own
// language-aware copy of the fallback message rather than an instruction
// block appended to a prompt.
function getFallbackMessage() {
  if (isJapaneseModeEnabled()) {
    return "Sumimasen, ima sore wo shori dekimasen deshita — mou ichido itte itadakemasu ka?";
  }
  return "I'm having trouble processing that right now — could you repeat or rephrase your question?";
}

module.exports = {
  resolveFlagPath,
  isJapaneseModeEnabled,
  setJapaneseModeEnabled,
  getJapaneseModeInstructionBlock,
  getFallbackMessage,
};
