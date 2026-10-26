// src/core/system-design.js: mode state, prompt blocks, the hidden REQ block
// (stream filter + final split), requirements parsing, design extraction.
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const sd = require('../../src/core/system-design');

const ANSWER = '**Ask these:**\n1. Web or mobile?\n2. Bookings per day?\nA REQ word mid-line stays.\n\nREQ:\n+ FR: book a tee time\n~ NFR: ~1M users, read-heavy\n! two players book the same slot\n- payments\n? Do we need a waitlist?\n';
const VISIBLE = '**Ask these:**\n1. Web or mobile?\n2. Bookings per day?\nA REQ word mid-line stays.\n\n';

test.afterEach(() => { sd.setOn(false); sd.reset(); });

test('mode off: no prompt block, no turn note', () => {
  sd.setOn(false);
  assert.equal(sd.getSystemDesignBlock('frontend'), '');
  assert.equal(sd.getSystemDesignTurnNote(), '');
  assert.equal(sd.getStage(), null);
});

test('mode on: stage block + the profile playbook', () => {
  sd.setOn(true);
  const clarify = sd.getSystemDesignBlock('android');
  assert.match(clarify, /Stage now: requirement gathering/);
  assert.match(clarify, /playbook: Android/);
  assert.doesNotMatch(clarify, /Mermaid rules/);
  assert.match(sd.getSystemDesignBlock('frontend'), /playbook: Frontend/);
  assert.match(sd.getSystemDesignBlock('fullstack'), /playbook: Fullstack/);
  sd.setStage('built');
  const built = sd.getSystemDesignBlock('fullstack');
  assert.match(built, /Stage now: design built/);
  assert.match(built, /Mermaid rules/);
  assert.doesNotMatch(built, /REQ:/);
});

test('REQ stream filter: nothing from the REQ line on is emitted, at any chunk size', () => {
  for (const size of [1, 2, 3, 5, 8, 13, 1000]) {
    let out = '';
    const f = sd.createReqFilter(d => { out += d; });
    for (let i = 0; i < ANSWER.length; i += size) f.push(ANSWER.slice(i, i + size));
    f.flush();
    assert.equal(out, VISIBLE, `chunk size ${size}`);
  }
});

test('REQ stream filter: lines that only start like REQ pass through; reset starts over', () => {
  let out = '';
  const f = sd.createReqFilter(d => { out += d; });
  ['R', 'E', 'ally fine\n**Re', 'quirements**\nREQU', 'IRED is a word\n'].forEach(d => f.push(d));
  f.flush();
  assert.equal(out, 'REally fine\n**Requirements**\nREQUIRED is a word\n');
  out = '';
  f.push('x\nREQ:\n+ a');
  f.reset();
  f.push('again');
  f.flush();
  assert.equal(out, 'x\nagain');
});

test('splitReqBlock: body without the block, bold / fenced variants, "same"', () => {
  const r = sd.splitReqBlock(ANSWER);
  assert.equal(r.body, VISIBLE.trimEnd());
  assert.equal(r.lines.length, 5);
  assert.deepEqual(sd.splitReqBlock('Answer.\n\n**REQ:**\n+ FR: x').lines, ['+ FR: x']);
  const fenced = sd.splitReqBlock('Answer.\n```text\nREQ:\n+ FR: x\n```');
  assert.equal(fenced.body, 'Answer.');
  assert.deepEqual(fenced.lines, ['+ FR: x']);
  const same = sd.splitReqBlock('CAP means…\n\nREQ: same');
  assert.equal(same.body, 'CAP means…');
  assert.deepEqual(same.lines, []);
  assert.equal(same.same, true);
  assert.deepEqual(sd.splitReqBlock('No block here.'), { body: 'No block here.', lines: null, same: false });
});

test('parseRequirements: five lists, "out of scope:" label dropped, dupes removed, ≤3 next questions', () => {
  const req = sd.parseRequirements(['+ FR: book', '+ FR: book', '~ NFR: 1M users', '! double booking', '- out of scope: payments', '? a', '? b', '? c', '? d', 'junk line']);
  assert.deepEqual(req, {
    confirmed: ['FR: book'],
    assuming: ['NFR: 1M users'],
    edge: ['double booking'],
    out: ['payments'],
    next: ['a', 'b', 'c'],
  });
});

test('afterAnswer (gathering): requirements replace the card; problem = first question that produced them', () => {
  sd.setOn(true);
  assert.equal(sd.afterAnswer({ question: 'Tell me about yourself', response: 'I am…', reqLines: [] }), false);
  assert.equal(sd.getState().problem, '');
  assert.equal(sd.afterAnswer({ question: 'Design a golf booking system', response: 'x', reqLines: ['~ FR: book a slot'] }), true);
  assert.equal(sd.getState().problem, 'Design a golf booking system');
  sd.afterAnswer({ question: 'Mobile only, 1M users', response: 'Noted', reqLines: ['+ FR: book a slot', '+ NFR: mobile only'] });
  const st = sd.getState();
  assert.equal(st.problem, 'Design a golf booking system');
  assert.deepEqual(st.requirements.confirmed, ['FR: book a slot', 'NFR: mobile only']);
  assert.deepEqual(st.requirements.assuming, []);
  // "REQ: same" (no lines) keeps the card
  sd.afterAnswer({ question: 'What is CAP?', response: 'CAP…', reqLines: [] });
  assert.equal(sd.getState().requirements.confirmed.length, 2);
  const note = sd.getSystemDesignTurnNote();
  assert.match(note, /Problem: Design a golf booking system/);
  assert.match(note, /\+ NFR: mobile only/);
});

const DESIGN = '### Requirements\n- book\n### High-level design\n```mermaid\nflowchart TD\n  A["(1) App"] --> B["(2) API"]\n```\n### Components\n- (1) App — what: client\n- (2) API — what: REST\n### Key decisions & trade-offs\n- x';

test('afterAnswer (built): diagram + components kept; follow-up diagram replaces it, components add up', () => {
  sd.setOn(true);
  sd.setStage('built');
  assert.equal(sd.afterAnswer({ response: 'Postgres because…' }), false, 'explanation-only answer changes nothing');
  assert.equal(sd.afterAnswer({ response: DESIGN }), true);
  let st = sd.getState();
  assert.equal(st.hasDesign, true);
  let note = sd.getSystemDesignTurnNote();
  assert.match(note, /```mermaid\nflowchart TD\n {2}A\["\(1\) App"\] --> B\["\(2\) API"\]\n```/);
  assert.match(note, /- \(2\) API — what: REST/);
  assert.doesNotMatch(note, /Key decisions/);
  sd.afterAnswer({ response: 'Add a cache.\n```mermaid\nflowchart TD\n  B --> C["(3) Redis"]:::changed\n```\n### Components\n- (3) NEW: Redis — what: cache' });
  note = sd.getSystemDesignTurnNote();
  assert.match(note, /C\["\(3\) Redis"\]:::changed/);
  assert.doesNotMatch(note, /A\["\(1\) App"\] --> B/, 'old diagram replaced');
  assert.match(note, /\(2\) API — what: REST\n- \(3\) NEW: Redis/);
  assert.equal(sd.getState().designs, 2);
});

test('extractMermaid takes the last diagram; buildDesignRequestText carries the requirements', () => {
  assert.equal(sd.extractMermaid('```mermaid\nA\n```\n```mermaid\nB\n```'), 'B');
  assert.equal(sd.extractMermaid('```text\n[A] --> [B]\n```'), '');
  sd.setOn(true);
  sd.afterAnswer({ question: 'Design a URL shortener', reqLines: ['+ FR: shorten', '~ NFR: 100M URLs'] });
  const text = sd.buildDesignRequestText();
  assert.match(text, /^Build the design now for: Design a URL shortener/);
  assert.match(text, /\+ FR: shorten\n~ NFR: 100M URLs/);
});

test('switching off pauses the round (nothing in prompts), switching on restores it; reset starts a new one', () => {
  sd.setOn(true);
  sd.afterAnswer({ question: 'Design X', reqLines: ['+ FR: a'] });
  sd.setStage('built');
  sd.afterAnswer({ response: '```mermaid\nflowchart TD\n  A --> B\n```' });
  sd.setOn(false);
  assert.equal(sd.getSystemDesignBlock('fullstack', 'nextjs'), '', 'paused: no prompt block');
  assert.equal(sd.getSystemDesignTurnNote(), '', 'paused: no turn note');
  assert.equal(sd.getStage(), null);
  sd.setOn(true);
  const st = sd.getState();
  assert.equal(st.problem, 'Design X');
  assert.deepEqual(st.requirements.confirmed, ['FR: a']);
  assert.equal(st.stage, 'built');
  assert.equal(st.hasDesign, true);
  sd.reset();
  assert.deepEqual(sd.getState().requirements.confirmed, []);
  assert.equal(sd.getState().problem, '');
  assert.equal(sd.getState().on, true);
});

test('parseRequirements: a doubled mark counts as its last one; "~1M" in the text is not a mark', () => {
  const req = sd.parseRequirements(['+ ~ FR: operator dashboard', '+ + NFR: 2M users', '+ ~1M users at peak', '- + FR: bullet then mark', '+FR: no space']);
  assert.deepEqual(req.assuming, ['FR: operator dashboard']);
  assert.deepEqual(req.confirmed, ['NFR: 2M users', '~1M users at peak', 'FR: bullet then mark', 'FR: no space']);
});

test('a first answer without its REQ block: the visible Functional / Non-functional bullets become assumptions', () => {
  sd.setOn(true);
  const answer = '**Ask these:**\n1. Pages?\n\n**Functional:**\n- ~ View live scores\n- Match detail page (assumed)\n\n**Non-functional:**\n- SEO for match pages\n\nThanks.';
  assert.equal(sd.afterAnswer({ question: 'Design a live scores app', response: answer, reqLines: null }), true);
  assert.deepEqual(sd.getState().requirements.assuming, ['FR: View live scores', 'FR: Match detail page', 'NFR: SEO for match pages']);
  assert.equal(sd.getState().problem, 'Design a live scores app');
  // Not used once there is a card, or when the block said "same".
  sd.afterAnswer({ question: 'x', response: '**Functional:**\n- Other', reqLines: null });
  assert.equal(sd.getState().requirements.assuming.length, 3);
});

test('extractDiagrams: titles from the frontmatter (canonical names), untitled by type, in order', () => {
  const text = '```mermaid\n---\ntitle: High-level architecture\n---\nflowchart TD\n  A --> B\n```\nx\n```mermaid\n---\ntitle: App architecture (Vue 3)\n---\nflowchart TD\n  V --> VM\n```\n```mermaid\nsequenceDiagram\n  A->>B: go\n```';
  assert.deepEqual(sd.extractDiagrams(text).map(d => d.title), ['High-level architecture', 'App architecture', 'Key flow']);
  assert.equal(sd.extractDiagrams('```mermaid\nflowchart TD\n A-->B\n```')[0].title, 'High-level architecture');
});

test('built: a follow-up replaces only the diagrams it redraws; the turn note carries all of them', () => {
  sd.setOn(true);
  sd.setStage('built');
  const build = ['High-level architecture', 'App architecture', 'Key flow'].map((t, i) =>
    `\`\`\`mermaid\n---\ntitle: ${t}\n---\n${i === 2 ? 'sequenceDiagram\n  U->>VM: send v1' : `flowchart TD\n  N${i}["v1"]`}\n\`\`\``).join('\n');
  sd.afterAnswer({ response: build });
  assert.deepEqual(sd.getState().diagrams, ['High-level architecture', 'App architecture', 'Key flow']);
  sd.afterAnswer({ response: 'Attachments.\n```mermaid\n---\ntitle: Key flow\n---\nsequenceDiagram\n  U->>VM: send v2\n```' });
  const note = sd.getSystemDesignTurnNote();
  assert.match(note, /Current diagrams/);
  assert.match(note, /High-level architecture:\n```mermaid[\s\S]*N0\["v1"\]/);
  assert.match(note, /App architecture:\n```mermaid[\s\S]*N1\["v1"\]/);
  assert.match(note, /Key flow:\n```mermaid[\s\S]*send v2/);
  assert.doesNotMatch(note, /send v1/);
});

test('built block: the selected framework drives diagram 2; Auto falls back per profile; fullstack adds the other side', () => {
  sd.setOn(true);
  assert.doesNotMatch(sd.getSystemDesignBlock('android', 'compose'), /App architecture to draw/, 'not while gathering');
  sd.setStage('built');
  assert.match(sd.getSystemDesignBlock('android', 'compose'), /Jetpack Compose with MVVM[\s\S]*SavedStateHandle/);
  assert.match(sd.getSystemDesignBlock('android', 'auto'), /Jetpack Compose with MVVM/);
  assert.match(sd.getSystemDesignBlock('android', 'android-views'), /Android Views with MVVM/);
  assert.match(sd.getSystemDesignBlock('frontend', 'vue3'), /Vue 3, which is MVVM by design[\s\S]*Pinia/);
  assert.doesNotMatch(sd.getSystemDesignBlock('frontend', 'vue3'), /Backend services:/);
  const fs = sd.getSystemDesignBlock('fullstack', 'vue3');
  assert.match(fs, /Vue 3[\s\S]*Backend services:[\s\S]*Ruby on Rails/);
  // A backend-only pick draws the default client (Next.js) for the App architecture, that pick for Backend services.
  assert.match(sd.getSystemDesignBlock('fullstack', 'spring-boot'), /Next\.js App Router[\s\S]*Backend services:[\s\S]*Spring Boot/);
  // Node + Express + React draws a React client + Node/Express backend.
  assert.match(sd.getSystemDesignBlock('fullstack', 'node-react'), /App architecture \(React\)[\s\S]*Backend services:[\s\S]*Node\.js backend service/);
  assert.match(sd.getSystemDesignBlock('fullstack', 'auto'), /Next\.js App Router/);
  sd.setOn(false);
  assert.equal(sd.getSystemDesignBlock('fullstack', 'vue3'), '');
});

test('built rules ask for spoken components, not form labels', () => {
  sd.setOn(true);
  sd.setStage('built');
  const b = sd.getSystemDesignBlock('fullstack', 'nextjs');
  assert.match(b, /never form-style labels/);
  assert.doesNotMatch(b, /what: … · why:/, 'old label format gone');
  assert.match(b, /\*\*How it works\*\*/);
  assert.match(b, /sequenceDiagram/);
});
