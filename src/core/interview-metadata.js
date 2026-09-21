const fs = require('fs');
const path = require('path');

// Global "Personal / Interview Notes" text — visa status, relocation
// narrative, reason-for-leaving, self-intro facts. Unlike candidate-context.js
// this is NOT per-profile: these facts don't change based on which resume
// (android/frontend/fullstack) is active, so it lives as a single file
// sibling to resume-profiles/, not inside it.
function resolveMetadataPath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'interview-metadata.txt');
  } catch (_) {
    return path.join(process.cwd(), 'interview-metadata.txt');
  }
}

function readInterviewMetadata() {
  try {
    const p = resolveMetadataPath();
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8');
  } catch (_) {
    return '';
  }
}

function writeInterviewMetadata(text) {
  const p = resolveMetadataPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(text || ''), 'utf8');
  return p;
}

// Appended alongside (not instead of) the resume block, regardless of which
// resume profile is active. Returns '' when nothing has been saved yet.
function getInterviewMetadataBlock() {
  const text = readInterviewMetadata().trim();
  if (!text) return '';
  return `\n\n## Personal / Interview Notes\nThe following are additional facts about the candidate (self-introduction, visa/work-authorization status, relocation, reason for leaving current role, etc.) that apply regardless of which resume profile is active. Use these naturally when relevant — do not ask the candidate to restate them.\n\n${text}`;
}

module.exports = {
  resolveMetadataPath,
  readInterviewMetadata,
  writeInterviewMetadata,
  getInterviewMetadataBlock,
};
