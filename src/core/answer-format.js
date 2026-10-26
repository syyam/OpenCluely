// Shared answer-format directive — the ONLY place that says when an answer
// gets code and how a coding answer is structured. Appended to every
// profile prompt (prompts/<id>.md) by prompt-loader.js, so profiles only
// describe their domain (topics, internals, system-design focus) and never
// repeat or override these rules. The implementation language itself comes
// from the language injection in prompt-loader.js.
// The Approach layout's Brute force line — only where algorithm problems are
// expected (DSA, or Auto's mixed questions). With a framework selected it's
// left out entirely: a "only for DSA" note alone didn't stop Flash Lite from
// adding it to Vue answers (2026-09-28).
const BRUTE_FORCE_LINE = '\n  **Brute force:** <algorithm/DSA problems only, omit otherwise: what it would do — O(…) because …; this approach gets it to O(…)>';

function getCodingAnswerBlock({ bruteForce = true } = {}) {
  return `\n\n## When code is needed (applies to every question, every input)
A technical question is not automatically a coding question.
- NO code block for conceptual, experience, or behavioral questions: "what is X", "how does X work", "why use X", "X vs Y", "have you worked with Vue 3 or Next.js?", "tell me about your experience with X", "how did you solve/approach/handle X". Answer these in words. If a function, class, or library name helps, put it inline as a short code-highlighted span, never a fenced block.
- Code block ONLY when: the interviewer explicitly asks to write/implement/code/show something, the question is a concrete coding/algorithm problem, a screenshot shows a coding problem expecting an implementation, given code must be debugged/modified, or it's a follow-up asking to change or redo code from an earlier answer (e.g. "I need Vue", "now in Java", "add pagination").
- Text diagrams (system design) and other non-code text go in \`\`\`text fences.
- A question may contain typos or a misspelled or misheard API name: read it as the closest real API that fits the framework, language and conversation, and answer that.
- A question about code from an earlier answer — why I did or didn't use X, could/should we use X, what about X, is X better — asks for my reasoning, not for the code to be rewritten (also when it starts with "I meant…"). X is a real API or a name the speaker suggests for a value in that code (e.g. "safe count" / \`SafeCount\` → a \`safeCount\` computed for the guarded count; often part of it matches a name there, like \`count\`): either way, answer about using it in this code, never that the name is unknown, custom or misheard. Answer in words, with none of the coding answer sections (no Understanding, Approach, Implementation, Complexity…): 2-4 short bullets on why I wrote it this way and whether X is better (if X is cleaner or more idiomatic, say so plainly). When it helps, add one small code block with only the lines that would change, never the whole solution. If X is a change worth making, end the reply with one line \`IMPLEMENT: <the change as a short instruction, under 15 words>\`, after any code block, nothing after it, e.g. \`IMPLEMENT: return the guarded number from a safeCount computed and loop with v-for="i in safeCount"\`. When I'd keep the code as it is, there is no IMPLEMENT line at all (never "IMPLEMENT: keep …"). An instruction to change the code ("use X", "change it to X", "do it with X", "implement it: …") is a coding follow-up as usual, with no IMPLEMENT line.

## Working inside given code (every coding answer, including follow-ups)
- Code shown in the question, screenshot or an earlier answer (a function/method signature, class, component, template, partial implementation, helper or mock API) is the source of truth: answer inside it. An earlier answer's code counts only when the question continues that problem; a new, unrelated problem starts fresh. Keep its exact names, parameters, return type, imports, style and framework; complete or change only what the question needs and keep everything that's still correct. Never rewrite it into a different architecture or add a separate alternative function.
- Don't write what the platform already provides or clearly handles (HTML/CSS, backend, API endpoints, mock servers, helper APIs, setup, main/test harness): call the given interface. An API, helper or component the question names (e.g. \`fakeApi\`) already exists — call it, don't implement it. Write only the part being asked for, in the submission shape the platform expects (e.g. just the body of \`solve()\`); no unrequested mock data, backend code, caching, selection logic, abstractions or features. When the question is unclear or garbled, build the simplest likely reading — never several guesses or a bigger library around it; a word that fits nothing in the context is a typo or mishearing, not a new feature to invent; other readings can go under **Possible improvements**. Small extras that handle a real edge case of the asked-for code are welcome — they earn extra points in an interview — but only cheap guards inside the asked-for code (e.g. loading/error state, an empty or invalid input), never a new function, method or feature, each marked in the code as described in "Coding answer format". A bigger behavior an interviewer typically asks for as the next follow-up (debounce/throttle, cancelling stale requests, a negated or extra matcher, recursion for nested data, caching/memoization, retries) is not built until the question asks for it — name it under **Possible improvements** instead, so each follow-up has a real step to add. When the requested code needs cancellation, error or race handling, use the standard way of the framework and version in use (e.g. \`AbortController\` for a stale fetch, the watcher/effect cleanup), not a custom mechanism. In general, use the framework's own feature before plain JavaScript that does the same job: in Vue, \`v-for="i in count"\` over a computed number for 1..N rather than an array built with \`Array.from\`, a \`computed\` for derived values, \`v-model.number\` for numeric input; in React, derive values during render rather than copying them into state with an effect.
- If given plain code is in another language than the selected Implementation language, keep its structure and names but write it in the Implementation language. A given component, template or HTML page keeps its own format.
- This outranks the selected Framework, profile defaults and reference notes.

## Coding answer format (only when code is needed; never for a "why didn't you use X?" question about earlier code)
Speak in first person, working through the problem out loud to the interviewer ("I'd start by…", "The key thing I need to track is…", "The reason this works is…"). Never begin with a name, a self-introduction, or a lead-in like "Here is how I'd implement…" — the first line is **Understanding**. Readable bullets, not an essay, but cover everything. Every coding answer has all of these sections, every time, in this order: **Understanding** → \`### Solution — …\` → **Approach** (Key idea + numbered steps) → code → **Implementation** → **Complexity** → **Why it works** → **Example flow** → **Possible improvements** (when there is one). Structure:
**Understanding** — 1-2 lines on what the problem is (for debugging/modifying given code or a coding follow-up: what's wrong or what must change).

Then the solution, starting with a heading line \`### Solution — <short name>\` (e.g. \`### Solution — Brute force (nested loops)\`). The line right after that heading is **Approach** — the code comes only after the Approach steps. In this order (the Approach steps and the Implementation points are the only numbered lists):
- **Approach** — REQUIRED in every coding answer, even a short or simple one (a small component, a one-liner): never skip it, and the code block never comes before it. It is what I say out loud before showing code, so it's the most important part. Write it exactly in this layout — the \`**Approach**\` label on its own line, then the Key idea, then at least 3 numbered steps (a Key idea alone is not an Approach):
  \`\`\`text
  **Approach**
  **Key idea:** <one sentence I can say first — the core trick or design choice and why>${bruteForce ? BRUTE_FORCE_LINE : ''}
  1. <first step: what I do and why>
  2. <next step: what I do and why>
  3. <…>
  \`\`\`
  - Steps: as many as the solution needs — no upper limit — first person, in the order I'd explain them, each easy to say out loud. Each is a full sentence saying what I do and why (e.g. "1. First I turn \`M\` into the list 1..M in a computed property, so the template only has to loop over it."). Together they cover the whole solution — the input/props/state, the core logic, what gets returned or rendered, and the edge cases — so I can walk through the code with them.
  - Strategy and logic only — no syntax or API explanation here (that goes in Implementation).
  - When the solution rests on a language concept (e.g. recursion because a nested object is the same problem one level down, a closure that keeps a variable alive), the Key idea or the step that uses it names the concept and says why it fits.
  - If the code adds an extra beyond the literal question (loading/error state, an empty/invalid-input guard…), the step that adds it says which edge case it handles and why — "because …" (e.g. "I also track \`loading\` and \`error\`, because otherwise the user gets no feedback while the request runs or when it fails.") — so I can mention it for extra points.
- The complete code for THIS solution only (the whole function/component being asked for, inside any given code — see "Working inside given code"), in one code block.
  - Put a numbered comment on each logical step of the code — as many as the code needs, no fixed number, including the lines inside functions, computed properties and methods (not just one comment per block): every line or small block that does real work — the core logic, state/props/data, loops and conditions, a framework/platform API (e.g. \`watch\`, \`onCleanup\`, \`AbortController\`, \`useEffect\` cleanup, \`v-for\`), or a line built on a language feature (closure, rest/spread, destructuring, async/await…). Each comment is short plain English saying what the line does in the solution's logic and why — the reasoning, not the name of a language feature — e.g. \`t = setTimeout(() => fn(...args), wait) // (2) restart the timer so only the last call fires\`; the full explanation goes in Implementation. No markdown inside code (no \`**\`), and no comments on trivial lines (closing braces, plain imports, boilerplate).
  - Number the comments (1), (2), … in code order; each number matches the Implementation point with that number (not the Approach steps). Use the comment syntax that is valid at that spot (\`//\` in JS/TS/Kotlin/Java, \`#\` in Python/Ruby, \`<!-- (n) … -->\` in HTML or a Vue \`<template>\`), so the code still runs.
  - An extra's numbered comment starts with \`EXTRA:\` and names the edge case it handles, e.g. \`if (!q.trim()) return // (3) EXTRA: empty input — skip the request\`, and its Implementation point says why it earns its place. In a coding follow-up, every new or changed line's comment starts with \`CHANGED:\` instead, e.g. \`// (4) CHANGED: new remove() method next to add()\`.
- **Implementation** — the numbered points (1), (2), … matching every code comment, each its own list item (\`- (1) …\`, one per line): each 1-3 sentences explaining ITS OWN line: first what it does in the solution's logic and why it's needed, then — only when that exact line uses a JavaScript/TypeScript or framework concept an interviewer may ask about (closure, recursion, getter, higher-order function, reference vs value equality, \`Object.is\`, \`typeof null\`, arrays being objects, \`unknown\` vs \`any\`, lexical scope, \`this\`, coercion, prototype, reactivity…) — name that concept in the same point and say what it does there, e.g. "- (2) Returns the counter function; every later call still sees and updates \`count\` because the inner function is a closure over it." No bold labels at the start of points, and a concept is explained at the line that uses it, never moved to another point. When that line uses a compact construct a beginner might not write themselves (\`Array.from\`, \`Math.min\`/\`Math.max\` to clamp, \`reduce\`, spread, a chained ternary, optional chaining…), end its point with \`Simpler:\` and the plain version in one short line, so I can switch if asked to keep it simple, e.g. "- (6) Caps the count at 1000 so a huge N can't freeze the page. Simpler: \`if (count > 1000) count = 1000\`." The code itself stays as written, and other points get no \`Simpler:\`. Then optionally 1-2 plain bullets with no matching comment: data structures chosen and why, edge cases handled.
- **Complexity** — for UI/framework code where Big-O isn't meaningful, one line on the real cost instead (e.g. one request per settled input, re-renders); otherwise two bullets, each naming the line(s) responsible, quoted as inline code:
  - Time: O(…) — e.g. \`for (i in nums.indices)\` runs n times and \`map[x]\` is O(1) average → O(n).
  - Space: O(…) — e.g. \`map\` holds up to n entries → O(n).
- **Why it works** — 2-3 lines, tying back to the Key idea.
- **Example flow** — a short \`\`\`text block (3-10 lines) tracing one sample input through the solution step by step, e.g.:
  \`\`\`text
  nums = [2, 7, 11], target = 9
  i=0: need 7, not seen → map {2:0}
  i=1: need 2, seen at 0 → return [0, 1]
  \`\`\`
- **Possible improvements** — last: 1-2 bullets I could mention if asked "how would you improve this?" — a missed edge case, a more robust or reusable way, accessibility, a production concern (e.g. "Add a \`:key\` fallback for duplicate names…", "Extract the debounce into a composable so other inputs can reuse it."). Each names the improvement and says why in one line. Mention only — don't implement it or add code. Most solutions have one; leave the section out only when there is genuinely nothing worth adding (no "none" line).

Give ONE solution: the clean, correct answer an interviewer expects, the one I'd write first — readable, not naive or flawed. No alternative or optimized versions — those are given only when asked for.

A coding follow-up (change/redo code from an earlier answer) gets this same full format, never code alone, and the code is complete, not a diff: apply the change to the previous solution, keeping everything still correct, rather than replacing it with a different implementation (a framework/language switch ports that same solution). Make the smallest change that answers the follow-up: keep the existing functions, names and structure, and add only the method, branch or helper the follow-up needs — don't refactor working code into a new pattern (a factory, a shared helper, a class) unless the follow-up can't be done without it, and then one Approach step says why. Don't add what a later follow-up would ask for. If the follow-up corrects or clarifies the previous request (e.g. "no, I meant X", or a short message restating what a garbled request meant), redo that change from the code before it: drop what was built for the misreading instead of keeping it. If the current code already handles what's asked, don't rewrite it: say so in one line and point to the line that handles it and why. Say in simple words what is changing and why in Understanding and Approach (still required, with its Key idea), and don't re-explain unchanged parts beyond one line. Mark the new or changed lines with \`CHANGED:\` in their comment, e.g. \`const results = ref([]) // (1) CHANGED: useState → Vue ref\`; numbered ones still match an Implementation point, and a minor changed line gets a plain \`// CHANGED: …\` with no number.`;
}

// Comparison table for "X vs Y" / "difference between" questions. Kept out
// of the system prompt on purpose: any mention of tables there makes the
// model add them to unrelated answers (measured 2026-09-25), so the note is
// appended to the matching question's own user turn only.
// "compared" alone is left out: "so objects can be compared by value" is a
// coding follow-up, not an X-vs-Y question (it got a table, 2026-09-29).
const COMPARISON_RE = /\b(vs\.?|versus|differences?|different from|differ|compares?|compared (to|with)|comparison)\b/i;

function getComparisonNote(question) {
  if (!COMPARISON_RE.test(String(question || ''))) return '';
  return '\n\n[After the normal answer, add a compact markdown comparison table: first column the aspect, one column per item compared, 4-7 rows, a few words per cell. Then end with a short **When to use which** section: one bullet per item compared, saying in one line when I\'d pick it and why (a concrete case, e.g. "Arrow function — callbacks inside a method, so `this` stays the outer object").]';
}

// Chat window only (typed, or dictated with My Microphone): when a coding
// request names something that fits nothing in the context, the model asks
// "Did you mean …?" instead of inventing it. main.js spots the prefix, shows
// the question in the chat window (not the response window) and sends the
// reply back with it. Non-coding questions never get it — they are answered
// directly, as before. Appended to the chat system prompt (same text every
// request, so the cached prefix is stable).
const CLARIFY_PREFIX = 'CLARIFY:';
const CHAT_CLARIFY_NOTE = `

## Unclear word in a coding request (chat)
Only when my message asks you to write or change code; skip this section for any other question. If it names something that isn't a real API or feature of the technology in use, it's probably a typo or mishearing:
- If the intended real term is clear from the context, use it.
- Otherwise build nothing: the whole reply is one line, ${CLARIFY_PREFIX} Did you mean \`<term>\`, \`<term>\` or \`<term>\`? in place of the coding answer format. Give 1 to 3 real terms (APIs, methods, hooks, operators, libraries or concepts) that sound almost the same as the unclear word when spoken and fit the language, framework and conversation, most likely first. Each one in backticks, just the term with no explanation. A term that only shares a first letter or makes no sense in this code is filler: leave it out, so often there is only one. If no real term fits at all, the line is ${CLARIFY_PREFIX} What did you mean by "<the word>"? with no guesses. Never invent an API, matcher, mode, library or use case to make the word fit.
- If an earlier answer was built around such a word and my new message shows what it meant (often a real term that sounds like it), that is a correction: redo that change with the right meaning and drop what was built for the misheard word.
A clear request for a real feature is never questioned. Any other question (conceptual, experience or skills such as "have you used / are you good at X?", behavioral, or "why didn't you use X?" about earlier code) is always answered directly as a full answer as usual, never with ${CLARIFY_PREFIX} and never with only a term: a misheard or unclear word in it is answered as the most likely real term(s).`;

// Whether streamed text is a "CLARIFY: Did you mean …?" reply: 'yes', 'no',
// or 'maybe' while the text so far could still become the prefix (optionally
// bold, any case, after leading whitespace). Shared by chat (main.js) and
// interviewer answers (llm.service). The coding layout's "**Understanding**"
// heading may come first (2026-10-01: Flash Lite wrote it above the CLARIFY
// line), so it is skipped; that holds back only the heading line of a
// normal answer.
const UNDERSTANDING_HEADING = '**UNDERSTANDING**';
function stripClarifyHeading(text) {
  return String(text || '').trimStart().replace(/^\*\*Understanding\*\*[ \t]*\n\s*/i, '');
}
function clarifyState(text) {
  const raw = String(text || '').trimStart().toUpperCase();
  if (raw && UNDERSTANDING_HEADING.startsWith(raw)) return 'maybe';
  if (raw.startsWith(UNDERSTANDING_HEADING) && !/^\*\*UNDERSTANDING\*\*[ \t]*\n\s*\S/.test(raw)) {
    return /^\*\*UNDERSTANDING\*\*[ \t]*\S/.test(raw) ? 'no' : 'maybe';
  }
  const head = stripClarifyHeading(text).toUpperCase();
  for (const prefix of [CLARIFY_PREFIX, `**${CLARIFY_PREFIX}`]) {
    if (head.startsWith(prefix)) return 'yes';
    if (prefix.startsWith(head)) return 'maybe';
  }
  return 'no';
}
// The question line of a CLARIFY reply, without the prefix.
function clarifyQuestion(text) {
  return stripClarifyHeading(text).trim()
    .replace(/^(\*\*)?CLARIFY:(\*\*)?\s*/i, '')
    .split('\n')[0].trim() || 'Did you mean something else?';
}

// Interviewer (Meeting Audio) answers only: when the model answered a real
// term in place of a misheard one, its first line is
// "HEARD: <as transcribed> → <what it answered>". llm.service strips that
// line from the answer and main.js shows it in the chat window, so a wrong
// guess is easy to spot; the answer itself is unchanged.
const HEARD_PREFIX = 'HEARD:';

// A question about earlier code ("why didn't you use X?") is answered in
// words; when a concrete change is worth making, its last line is
// "IMPLEMENT: <change>". llm.service strips that line from the answer and
// main.js shows it in the chat window as an "Implement this" button, which
// sends the change as a normal coding follow-up.
const IMPLEMENT_PREFIX = 'IMPLEMENT:';

// 'yes' when a line starts with the IMPLEMENT marker (optionally bold),
// 'maybe' while it could still become it, 'no' otherwise.
function implementState(line) {
  const head = String(line || '').trimStart().toUpperCase();
  for (const prefix of [IMPLEMENT_PREFIX, `**${IMPLEMENT_PREFIX}`]) {
    if (head.startsWith(prefix)) return 'yes';
    if (prefix.startsWith(head)) return 'maybe';
  }
  return 'no';
}

// Remove the IMPLEMENT line from a finished answer; the change is the offer.
const IMPLEMENT_LINE_RE = /^[ \t]*(\*\*)?IMPLEMENT:(\*\*)?[ \t]*(.*)$/i;
function splitImplementOffer(text) {
  const s = String(text || '');
  let found = false;
  let offer = null;
  const kept = s.split('\n').filter(line => {
    const m = IMPLEMENT_LINE_RE.exec(line);
    if (!m) return true;
    found = true;
    offer = m[3].replace(/\*\*$/, '').trim() || offer;
    return false;
  });
  if (!found) return { offer: null, body: s };
  return { offer, body: kept.join('\n').replace(/\s+$/, '') };
}

// Streaming side of splitImplementOffer: text passes through as it comes;
// only the start of a line is held back while it could still become the
// IMPLEMENT line, and that line is dropped. Nothing else is delayed.
function createImplementFilter(emit) {
  let held = '';
  let lineOpen = false; // the current line was already let through
  return {
    push(delta) {
      let s = held + String(delta || '');
      held = '';
      let out = '';
      while (s) {
        const nl = s.indexOf('\n');
        if (lineOpen) {
          if (nl === -1) { out += s; s = ''; } else { out += s.slice(0, nl + 1); s = s.slice(nl + 1); lineOpen = false; }
          continue;
        }
        const line = nl === -1 ? s : s.slice(0, nl);
        const kind = implementState(line);
        if (nl !== -1) {
          if (kind !== 'yes') out += s.slice(0, nl + 1);
          s = s.slice(nl + 1);
        } else if (kind === 'no') {
          lineOpen = true;
        } else {
          held = s;
          s = '';
        }
      }
      if (out) emit(out);
    },
    flush() {
      if (held && implementState(held) !== 'yes') emit(held);
      held = '';
      lineOpen = false;
    },
    reset() {
      held = '';
      lineOpen = false;
    }
  };
}

// A HEARD note "a → b | c, d" split into the heard words, the answered term
// and the other terms the sound fits, without repeats of the answered term or
// of each other (same rule as the chat window's "Meant instead:" buttons).
function heardChoices(note) {
  const [main, altText = ''] = String(note || '').split(/\s+\|\s+/);
  const parts = main.split(/\s*(?:→|->)\s*/);
  const plain = (t) => t.replace(/`/g, '').trim();
  const answered = plain(parts.slice(1).join(' → '));
  const seen = [answered.toLowerCase()];
  const alts = altText.split(/\s*,\s*/).map(plain).filter(t => {
    const p = t.toLowerCase();
    if (!p || seen.some(s => s && (s.includes(p) || p.includes(s)))) return false;
    seen.push(p);
    return true;
  }).slice(0, 2);
  return { heard: plain(parts[0]), answered, alts };
}

// Interviewer coding answers: a HEARD note that names other real readings
// means the model itself wasn't sure which change was asked for. Building
// its first guess could put wrong code on screen, so the app asks in chat
// instead ("Did you mean `b`, `c` or `d`?", the answered term first). Null
// when there's nothing to ask (no alternatives, or terms too long to be
// buttons, e.g. a whole rebuilt sentence).
const MAX_CHOICE_CHARS = 40;
function heardCodingQuestion(note) {
  const { answered, alts } = heardChoices(note);
  const terms = [answered, ...alts];
  if (!answered || !alts.length || terms.some(t => t.length > MAX_CHOICE_CHARS)) return null;
  const ticked = terms.map(t => `\`${t}\``);
  return `Did you mean ${ticked.slice(0, -1).join(', ')} or ${ticked[ticked.length - 1]}?`;
}

// User turn only, for chat text that came from My Microphone.
const SPOKEN_NOTE = '\n\n[Dictated with speech recognition — a word that doesn\'t fit may be misheard.]';

module.exports = {
  getCodingAnswerBlock,
  getComparisonNote,
  heardChoices,
  heardCodingQuestion,
  CLARIFY_PREFIX,
  CHAT_CLARIFY_NOTE,
  clarifyState,
  clarifyQuestion,
  HEARD_PREFIX,
  IMPLEMENT_PREFIX,
  splitImplementOffer,
  createImplementFilter,
  SPOKEN_NOTE,
};
