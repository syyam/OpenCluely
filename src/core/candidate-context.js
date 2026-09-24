const fs = require('fs');
const path = require('path');

// Named resume profiles. Each id matches the corresponding skill/prompt file
// (prompts/<id>.md) 1:1 — switching the active profile in Settings switches
// both which resume gets injected into Gemini's context AND which prompt
// depth (Android/Frontend/Full-Stack) is used, via the same activeSkill
// value threaded through main.js/prompt-loader.js/llm.service.js.
const PROFILES = {
  android: { label: 'Android' },
  frontend: { label: 'Frontend' },
  fullstack: { label: 'Full-Stack' },
};
const DEFAULT_PROFILE = 'android';

function getProfileList() {
  return Object.entries(PROFILES).map(([id, meta]) => ({ id, label: meta.label }));
}

function normalizeProfileId(profileId) {
  return Object.prototype.hasOwnProperty.call(PROFILES, profileId) ? profileId : DEFAULT_PROFILE;
}

// Where resume profile text is persisted — one file per profile, in the
// userData dir (packaged builds) or project dir (run from source). Lives
// outside the .env pipeline since resumes are multi-line and formatEnvValue()
// in main.js collapses newlines to spaces for .env values, which would
// mangle the text.
function resolveProfilesDir() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'resume-profiles');
  } catch (_) {
    return path.join(process.cwd(), 'resume-profiles');
  }
}

function resolveProfilePath(profileId) {
  return path.join(resolveProfilesDir(), `${normalizeProfileId(profileId)}.txt`);
}

function readCandidateContext(profileId) {
  try {
    const p = resolveProfilePath(profileId);
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8');
  } catch (_) {
    return '';
  }
}

function writeCandidateContext(profileId, text) {
  const p = resolveProfilePath(profileId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(text || ''), 'utf8');
  return p;
}

// Extract plain text from an uploaded resume file. .txt/.md are read
// directly; .pdf goes through pdf-parse. Anything else is rejected with a
// clear message rather than silently returning garbage/binary.
async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf8');
  }

  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const data = fs.readFileSync(filePath);
    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      return result.text || '';
    } finally {
      await parser.destroy();
    }
  }

  throw new Error(`Unsupported resume file type "${ext}". Use .txt, .md, or .pdf, or paste the text directly.`);
}

// Formatted block appended to whatever system prompt is sent to Gemini, so
// answers are tailored to this specific candidate/profile instead of
// generic advice. Returns '' (no-op) when nothing has been saved for that
// profile yet. profileId is the active skill value ('android'/'frontend'/
// 'fullstack'/any profile added to PROFILES).
function getCandidateContextBlock(profileId) {
  // Strict: an unrecognized profile id gets no resume rather than falling
  // back to the default profile's — never inject another profile's resume.
  if (!Object.prototype.hasOwnProperty.call(PROFILES, profileId)) return '';
  const text = readCandidateContext(profileId).trim();
  if (!text) return '';
  return `\n\n## Candidate Background\nThe following is the candidate's actual resume/background. Tailor answers, examples, and follow-up depth to their real experience level and stack — don't ask them to restate it, and don't assume experience they don't have.\n\n${text}`;
}

module.exports = {
  PROFILES,
  DEFAULT_PROFILE,
  getProfileList,
  normalizeProfileId,
  resolveProfilesDir,
  resolveProfilePath,
  readCandidateContext,
  writeCandidateContext,
  extractTextFromFile,
  getCandidateContextBlock,
};
