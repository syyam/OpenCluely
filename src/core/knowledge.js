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
//   unless: b2b portal          (optional, entry is skipped when one of these is in the
//                                question, e.g. an overview that belongs to another system)
//   topic: speeqr, speaker app  (optional, before the first entry or per entry: the
//                                project's names. See "Project carry-over" below)
//   app: single spa, portal     (optional, file level: names of this app inside a
//   sibling: gora-fe             project that has two apps, and the other app's group.
//                                See "Two apps in one project" below)
//   when: expansion             (optional, entry is only matched for a "More details" /
//                                "Deep reasoning" request, never for the first answer)
//   cap: 13000                  (optional, larger char cap for this entry + its includes)
//   <body markdown...>
//
// Project carry-over: an interviewer's follow-up often doesn't repeat the
// project name ("how was the backend linked with the frontend?"), and Whisper
// can garble the name ("Speeqr" -> "speaker"). When the question names no
// topic, the groups of the project under discussion count as follow-up groups
// (need is waived, +1 score): first the groups the previous question matched,
// else the project the previous answer opens with (the model resolves a
// garbled name there, e.g. "### The speaker app (Speeqr)"). A correction that
// is only a project name ("I meant for Speeqr", "what about uPaisa?") is scored
// together with the previous question, limited to that project's entries, so
// it re-asks the previous question for that project (unless the previous
// question already named it). Names are project names,
// never technologies: "single-spa" in a Speeqr follow-up must not switch it.
//
// The previous turn's groups are the groups its question actually matched,
// with its own context (up to MAX_CONTEXT_TURNS turns back), so a chain of
// follow-ups without names ("state there?" → "and how were modules mounted?")
// keeps its app.
//
// Two apps in one project (GORA customer platform / B2B portal): while the
// conversation is on that project (the entry's group or its sibling group
// carries over) and the question names no project:
//   - a question that names this app with an experience cue ("how did the
//     single-spa part work?", "the booking site", not "what is single-spa?")
//     gets this app's entries as a follow-up (need waived, +1);
//   - a question that names only the other app, or neither app while the
//     conversation is only on the other app, skips this app's entries.
// Outside such a conversation the normal rules apply ("What is single-spa?"
// gets no GORA notes).

const KNOWLEDGE_DIR = path.join(__dirname, '..', '..', 'knowledge');
const MAX_ENTRIES = 3;      // matched entries per question (includes are extra)
const MAX_CHARS = 7000;     // hard cap on the appended block
const META_RE = /^(id|keys|group|include|min|profiles|need|unless|topic|app|sibling|when|cap):\s*(.*)$/i;
const MAX_CONTEXT_TURNS = 3;
// A question that names one app of a two-app project is about my work there
// only when it also has one of these ("how would you…" stays hypothetical).
const EXPERIENCE_CUES = ['did', 'was', 'were', 'your', 'we', 'our', 'there', 'part', 'side', 'tell me', 'more about', 'walk me through', 'have you', 'you used', 'you use', 'you worked', 'you built']
  .map(k => ({ norm: k, squashed: k.replace(/ /g, ''), weight: 1, prefix: false }));    // earlier turns replayed to find the previous turn's groups
const ANSWER_TOPIC_CHARS = 300; // opening of the previous answer searched for its project
// A correction is the project name plus only these words ("I meant for
// Speeqr", "no, what about uPaisa?"); "How did Kafka work in GORA?" is not one.
const CORRECTION_WORDS = new Set(('i meant mean no sorry for about what how the in at on of was it is a an and '
  + 'then ok okay im talking asking project app one that same question').split(' '));

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
  let topic = [];
  let app = [];
  let sibling = [];
  const entries = [];
  let cur = null;
  let inMeta = false;
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      cur = { title: h[1], id: null, keys: [], need: [], unless: [], topic: null, group: null, include: [], min: 2, when: null, cap: 0, body: [], profiles: null, file: base };
      entries.push(cur);
      inMeta = true;
      continue;
    }
    const m = line.match(META_RE);
    if (!cur) {
      if (m && m[1].toLowerCase() === 'profiles') {
        profiles = m[2].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      } else if (m && m[1].toLowerCase() === 'topic') {
        topic = m[2].split(',').map(parseKey).filter(Boolean);
      } else if (m && m[1].toLowerCase() === 'app') {
        app = m[2].split(',').map(parseKey).filter(Boolean);
      } else if (m && m[1].toLowerCase() === 'sibling') {
        sibling = m[2].split(',').map(x => x.trim()).filter(Boolean);
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
      else if (key === 'unless') cur.unless = val.split(',').map(parseKey).filter(Boolean);
      else if (key === 'topic') cur.topic = val.split(',').map(parseKey).filter(Boolean);
      else if (key === 'group') cur.group = val;
      else if (key === 'include') cur.include = val.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'min') cur.min = Number(val) || 2;
      else if (key === 'when') cur.when = val.toLowerCase();
      else if (key === 'cap') cur.cap = Number(val) || 0;
      continue;
    }
    inMeta = false;
    cur.body.push(line);
  }
  for (const e of entries) {
    e.id = e.id || `${base}-${slug(e.title)}`;
    e.profiles = e.profiles || profiles;
    e.topic = e.topic || topic;
    e.app = app;
    e.sibling = sibling;
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

// byGroup: group -> app names of that group's file (for "names only the other app").
function scoreAll(entries, text, groupBonus, apps = null) {
  const norm = normalize(text);
  const squashed = norm.replace(/ /g, '');
  const scored = [];
  entries.forEach((e, order) => {
    let followUp = !!(e.group && groupBonus && groupBonus.has(e.group));
    // Two apps in one project (see the header); only inside that project's conversation.
    if (apps && e.sibling.length && groupBonus
        && (followUp || e.sibling.some(g => groupBonus.has(g)))) {
      const own = e.app.some(k => keyHit(k, norm, squashed));
      const other = e.sibling.some(g => (apps.get(g) || []).some(k => keyHit(k, norm, squashed)));
      if (own) {
        // Naming the app is about my work only with an experience cue; "What
        // is single-spa?" stays a theory question.
        if (!EXPERIENCE_CUES.some(k => keyHit(k, norm, squashed))) return;
        followUp = true;
      } else if (other || !followUp) return;
    }
    if (e.need.length && !followUp && !e.need.some(k => keyHit(k, norm, squashed))) return;
    if (e.unless.some(k => keyHit(k, norm, squashed))) return;
    let s = scoreEntry(e, norm, squashed);
    if (s > 0 && followUp) s += 1;
    if (s >= e.min) scored.push({ e, s, order });
  });
  scored.sort((a, b) => b.s - a.s || a.order - b.order);
  return scored;
}

// Topic names found in text: Map of topic norm -> first position.
function topicsIn(entries, text) {
  const norm = normalize(text);
  const squashed = norm.replace(/ /g, '');
  const found = new Map();
  for (const e of entries) {
    for (const k of e.topic) {
      if (found.has(k.norm) || !keyHit(k, norm, squashed)) continue;
      const at = norm.indexOf(' ' + k.norm);
      found.set(k.norm, at >= 0 ? at : norm.length);
    }
  }
  return found;
}

const hasTopic = (e, names) => e.topic.some(k => names.has(k.norm));

// Only a project name plus correction words (see CORRECTION_WORDS).
function isCorrection(question, named) {
  let rest = normalize(question);
  for (const n of named.keys()) rest = rest.split(' ' + n + ' ').join(' ');
  return rest.trim().split(' ').filter(w => w && !CORRECTION_WORDS.has(w)).length === 0;
}

const groupsOf = (scored) => new Set(scored.slice(0, MAX_ENTRIES).map(x => x.e.group).filter(Boolean));

// Scored entries for one question, given the turn before it and that turn's
// groups (see "Project carry-over" and "Two apps in one project").
function matchTop(question, entries, eligible, apps, prevQuestion, prevAnswer, prevGroupsIn) {
  const prevGroups = new Set(prevGroupsIn);
  // Project names are looked up in every entry, so a project this profile has
  // no notes for (e.g. the B2B portal on android) still stops another
  // project's carry-over.
  const named = topicsIn(entries, question);
  const prevNamed = prevQuestion ? topicsIn(entries, prevQuestion) : new Map();
  const sameProject = entries.some(e => hasTopic(e, named) && hasTopic(e, prevNamed));
  if (named.size && prevQuestion && !sameProject && isCorrection(question, named)) {
    const own = eligible.filter(e => hasTopic(e, named));
    const ownGroups = new Set(own.map(e => e.group).filter(Boolean));
    const top = scoreAll(own, prevQuestion + ' ' + question, ownGroups);
    if (top.length) return top;
  }
  if (!named.size && !prevGroups.size && prevAnswer) {
    const opening = String(prevAnswer).slice(0, ANSWER_TOPIC_CHARS);
    const inAnswer = topicsIn(eligible, opening);
    if (inAnswer.size) {
      const first = Math.min(...inAnswer.values());
      const lead = new Set([...inAnswer].filter(([, at]) => at === first).map(([n]) => n));
      for (const e of eligible) if (e.group && hasTopic(e, lead)) prevGroups.add(e.group);
    }
  }
  // A question that names a project is about that one: groups of other
  // projects don't carry over.
  const carry = new Set(prevGroups);
  if (named.size) {
    for (const e of eligible) if (e.group && e.topic.length && !hasTopic(e, named)) carry.delete(e.group);
  }
  return scoreAll(eligible, question, carry, named.size ? null : apps);
}

/**
 * Entries relevant to this question, as a block to append to the user turn.
 * @param {string} question - the interviewer question / transcript
 * @param {string} profileId - active profile ('frontend', ...)
 * @param {string} [prevQuestion] - previous user question, for follow-ups
 * @param {string} [prevAnswer] - previous answer, for the project it was about
 * @param {Array<[string, string]>} [earlier] - [question, answer] turns before
 *   the previous one, oldest first (only the last few are used)
 * @returns {{ids: string[], block: string}} block is '' when nothing matches
 */
function matchKnowledge(question, profileId, prevQuestion = '', prevAnswer = '', earlier = [], opts = {}) {
  try {
    if (!question || !String(question).trim()) return { ids: [], block: '' };
    const { entries, byId } = loadKnowledge();
    if (!entries.length) return { ids: [], block: '' };
    const profile = String(profileId || '').toLowerCase();
    const eligible = entries.filter(e => (!e.profiles || e.profiles.includes(profile))
      && (!e.when || (e.when === 'expansion' && opts.expansion)));
    const apps = new Map();
    for (const e of entries) if (e.group && e.app.length && !apps.has(e.group)) apps.set(e.group, e.app);

    // Replay the last few turns so the previous turn's groups are what it
    // actually matched in its own context.
    const turns = [...(earlier || []).slice(-(MAX_CONTEXT_TURNS - 1)), [prevQuestion, prevAnswer]];
    let groups = new Set();
    let pq = '', pa = '';
    for (const [q, a] of turns) {
      groups = q ? groupsOf(matchTop(q, entries, eligible, apps, pq, pa, groups)) : new Set();
      pq = q || ''; pa = a || '';
    }
    const top = matchTop(question, entries, eligible, apps, prevQuestion, prevAnswer, groups).slice(0, MAX_ENTRIES).map(x => x.e);
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
    const cap = Math.max(MAX_CHARS, ...picked.map(e => e.cap || 0));
    for (const e of picked) {
      const part = `### ${e.title}\n${e.body}\n\n`;
      if (body.length + part.length > cap && ids.length) break;
      body += part;
      ids.push(e.id);
    }

    const block = '\n\n---\n[Reference notes. The question above and the system instructions decide the answer type and format, including whether any code is shown; these notes never do. They are background from earlier practice, not the question: the real question may use different names, data, fields or requirements, and those always come from the question. Use only the parts that help answer that exact question and ignore the rest, including any code in them unless the question itself asks for code. They may shape how the asked-for code is written (patterns like debounce, abort, error handling), but never add what the question did not ask for (backends, mock data, extra features or state). Never mention notes or preparation, never copy them verbatim, and never contradict them. When the question asks about something they do not cover, still answer, in first person, with what fits the described architecture.]\n\n' + body.trim();
    logger.debug('Knowledge matched', { ids, chars: block.length });
    return { ids, block };
  } catch (err) {
    logger.warn('Knowledge matching failed', { error: err.message });
    return { ids: [], block: '' };
  }
}

module.exports = { loadKnowledge, matchKnowledge, KNOWLEDGE_DIR };
