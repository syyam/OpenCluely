const fs = require('fs');
const path = require('path');
const logger = require('./logger').createServiceLogger('KNOWLEDGE');

// Question-specific prep notes (knowledge/interview/*.md) and project
// knowledge (knowledge/projects/*.md). Unlike prompts/<profile>.md these are
// NOT part of the system prompt: only the entries that match the current
// question are appended to that question's user turn, so an unrelated
// question costs zero extra tokens and the system prompt + history prefix
// stays identical between requests.
//
// File format:
//   profiles: frontend          (optional, before the first entry; omit = all profiles)
//   ## <Entry title>
//   profiles: android, fullstack (optional, overrides the file-level profiles for this entry)
//   id: short-id                (optional, defaults to a slug of the title)
//   keys: !strong phrase, weak phrase, prefix*
//   group: exercise-a           (optional, follow-up questions get +1 within the group)
//   include: other-id, other-id (optional, entries appended along with this one)
//   min: 2                      (optional score threshold, default 2)
//   need: gora, did you         (optional, entry matches only if one of these is in the
//                                question, or it's a follow-up in the same group)
//   <body markdown...>

const KNOWLEDGE_DIR = path.join(__dirname, '..', '..', 'knowledge');
const MAX_ENTRIES = 3;      // matched entries per question (includes are extra)
const MAX_CHARS = 7000;     // hard cap on the appended block
const META_RE = /^(id|keys|group|include|min|profiles|need):\s*(.*)$/i;

let cache = { signature: null, entries: [], byId: new Map() };

function normalize(text) {
  return ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

function slug(text) {
  return normalize(text).trim().replace(/ /g, '-').slice(0, 60);
}

function listFiles(dir) {
  let out = [];
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) out = out.concat(listFiles(p));
    else if (it.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function parseKey(raw) {
  let k = raw.trim();
  if (!k) return null;
  let weight = 1;
  if (k.startsWith('!')) { weight = 2; k = k.slice(1); }
  let prefix = false;
  if (k.endsWith('*')) { prefix = true; k = k.slice(0, -1); }
  const norm = normalize(k).trim();
  if (!norm) return null;
  return { norm, squashed: norm.replace(/ /g, ''), weight, prefix };
}

function parseFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const base = path.basename(filePath, '.md');
  let profiles = null;
  const entries = [];
  let cur = null;
  let inMeta = false;
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      cur = { title: h[1], id: null, keys: [], need: [], group: null, include: [], min: 2, body: [], profiles: null, file: base };
      entries.push(cur);
      inMeta = true;
      continue;
    }
    const m = line.match(META_RE);
    if (!cur) {
      if (m && m[1].toLowerCase() === 'profiles') {
        profiles = m[2].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      }
      continue;
    }
    if (inMeta && m) {
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'profiles') cur.profiles = val.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      else if (key === 'id') cur.id = val;
      else if (key === 'keys') cur.keys = val.split(',').map(parseKey).filter(Boolean);
      else if (key === 'need') cur.need = val.split(',').map(parseKey).filter(Boolean);
      else if (key === 'group') cur.group = val;
      else if (key === 'include') cur.include = val.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'min') cur.min = Number(val) || 2;
      continue;
    }
    inMeta = false;
    cur.body.push(line);
  }
  for (const e of entries) {
    e.id = e.id || `${base}-${slug(e.title)}`;
    e.profiles = e.profiles || profiles;
    e.body = e.body.join('\n').trim();
  }
  return entries;
}

function loadKnowledge() {
  const files = listFiles(KNOWLEDGE_DIR);
  let signature = '';
  for (const f of files) {
    try { signature += f + ':' + fs.statSync(f).mtimeMs + ';'; } catch (_) {}
  }
  if (signature === cache.signature) return cache;
  const entries = [];
  for (const f of files) {
    try { entries.push(...parseFile(f)); } catch (err) {
      logger.warn('Failed to parse knowledge file', { file: f, error: err.message });
    }
  }
  cache = { signature, entries, byId: new Map(entries.map(e => [e.id, e])) };
  return cache;
}

function keyHit(k, norm, squashed) {
  return k.prefix
    ? norm.includes(' ' + k.norm)
    : norm.includes(' ' + k.norm + ' ') || (k.squashed.length >= 8 && squashed.includes(k.squashed));
}

function scoreEntry(entry, norm, squashed) {
  let score = 0;
  for (const k of entry.keys) {
    if (keyHit(k, norm, squashed)) score += k.weight;
  }
  return score;
}

function scoreAll(entries, text, groupBonus) {
  const norm = normalize(text);
  const squashed = norm.replace(/ /g, '');
  const scored = [];
  entries.forEach((e, order) => {
    const followUp = !!(e.group && groupBonus && groupBonus.has(e.group));
    if (e.need.length && !followUp && !e.need.some(k => keyHit(k, norm, squashed))) return;
    let s = scoreEntry(e, norm, squashed);
    if (s > 0 && followUp) s += 1;
    if (s >= e.min) scored.push({ e, s, order });
  });
  scored.sort((a, b) => b.s - a.s || a.order - b.order);
  return scored;
}

/**
 * Entries relevant to this question, as a block to append to the user turn.
 * @param {string} question - the interviewer question / transcript
 * @param {string} profileId - active profile ('frontend', ...)
 * @param {string} [prevQuestion] - previous user question, for follow-ups
 * @returns {{ids: string[], block: string}} block is '' when nothing matches
 */
function matchKnowledge(question, profileId, prevQuestion = '') {
  try {
    if (!question || !String(question).trim()) return { ids: [], block: '' };
    const { entries, byId } = loadKnowledge();
    if (!entries.length) return { ids: [], block: '' };
    const profile = String(profileId || '').toLowerCase();
    const eligible = entries.filter(e => !e.profiles || e.profiles.includes(profile));

    const prevGroups = new Set();
    if (prevQuestion) {
      for (const { e } of scoreAll(eligible, prevQuestion, null).slice(0, MAX_ENTRIES)) {
        if (e.group) prevGroups.add(e.group);
      }
    }

    const top = scoreAll(eligible, question, prevGroups).slice(0, MAX_ENTRIES).map(x => x.e);
    if (!top.length) return { ids: [], block: '' };

    const picked = [];
    const seen = new Set();
    const add = (e) => {
      if (!e || seen.has(e.id)) return;
      if (e.profiles && !e.profiles.includes(profile)) return;
      seen.add(e.id);
      picked.push(e);
    };
    top.forEach(add);
    top.forEach(e => e.include.forEach(id => add(byId.get(id))));

    let body = '';
    const ids = [];
    for (const e of picked) {
      const part = `### ${e.title}\n${e.body}\n\n`;
      if (body.length + part.length > MAX_CHARS && ids.length) break;
      body += part;
      ids.push(e.id);
    }

    const block = '\n\n---\n[Reference notes. The question above and the system instructions decide the answer type and format, including whether any code is shown; these notes never do. Use only the parts that help answer that exact question and ignore the rest, including any code in them unless the question itself asks for code. They may shape how the asked-for code is written (patterns like debounce, abort, error handling), but never add what the question did not ask for (backends, mock data, extra features or state). Never mention notes or preparation, never copy them verbatim, and never contradict them. When the question asks about something they do not cover, still answer, in first person, with what fits the described architecture.]\n\n' + body.trim();
    logger.debug('Knowledge matched', { ids, chars: block.length });
    return { ids, block };
  } catch (err) {
    logger.warn('Knowledge matching failed', { error: err.message });
    return { ids: [], block: '' };
  }
}

module.exports = { loadKnowledge, matchKnowledge, KNOWLEDGE_DIR };
