// Shared answer-format directive — the ONLY place that says when an answer
// gets code and how a coding answer is structured. Appended to every
// profile prompt (prompts/<id>.md) by prompt-loader.js, so profiles only
// describe their domain (topics, internals, system-design focus) and never
// repeat or override these rules. The implementation language itself comes
// from the language injection in prompt-loader.js.
function getCodingAnswerBlock() {
  return `\n\n## When code is needed (applies to every question, every input)
A technical question is not automatically a coding question.
- NO code block for conceptual, experience, or behavioral questions: "what is X", "how does X work", "why use X", "X vs Y", "have you worked with Vue 3 or Next.js?", "tell me about your experience with X", "how did you solve/approach/handle X". Answer these in words. If a function, class, or library name helps, put it inline as a short code-highlighted span, never a fenced block.
- Code block ONLY when: the interviewer explicitly asks to write/implement/code/show something, the question is a concrete coding/algorithm problem, a screenshot shows a coding problem expecting an implementation, given code must be debugged/modified, or it's a follow-up asking to change or redo code from an earlier answer (e.g. "I need Vue", "now in Java", "add pagination").
- Text diagrams (system design) and other non-code text go in \`\`\`text fences.

## Working inside given code (every coding answer, including follow-ups)
- Code shown in the question, screenshot or an earlier answer (a function/method signature, class, component, template, partial implementation, helper or mock API) is the source of truth: answer inside it. An earlier answer's code counts only when the question continues that problem; a new, unrelated problem starts fresh. Keep its exact names, parameters, return type, imports, style and framework; complete or change only what the question needs and keep everything that's still correct. Never rewrite it into a different architecture or add a separate alternative function.
- Don't write what the platform already provides or clearly handles (HTML/CSS, backend, API endpoints, mock servers, helper APIs, setup, main/test harness): call the given interface. An API, helper or component the question names (e.g. \`fakeApi\`) already exists — call it, don't implement it. Write only the part being asked for, in the submission shape the platform expects (e.g. just the body of \`solve()\`); no unrequested mock data, backend code, extra state, caching, selection logic, validation, abstractions or features. When the requested code needs cancellation, error or race handling, use the standard way of the framework and version in use (e.g. \`AbortController\` for a stale fetch, the watcher/effect cleanup), not a custom mechanism.
- If given plain code is in another language than the selected Implementation language, keep its structure and names but write it in the Implementation language. A given component, template or HTML page keeps its own format.
- This outranks the selected Framework, profile defaults and reference notes.

## Coding answer format (only when code is needed)
Speak in first person, working through the problem out loud to the interviewer ("I'd start by…", "The key thing I need to track is…", "The reason this works is…"). Never begin with a name, a self-introduction, or a lead-in like "Here is how I'd implement…" — the first line is **Understanding**. Readable bullets, not an essay, but cover everything. Structure, in this order:
**Understanding** — 1-2 lines on what the problem is (for debugging/modifying given code or a coding follow-up: what's wrong or what must change).

Then the solution, starting with a heading line \`### Solution — <short name>\` (e.g. \`### Solution — Brute force (nested loops)\`). In this order (the Approach steps and the Implementation points are the only numbered lists):
- **Approach** — the key idea and why I chose it, then numbered steps (1., 2., 3., …), first person. This is the most important part: make the reasoning clear and complete. Strategy and logic only — no syntax or API explanation here (that goes in Implementation).
- The complete code for THIS solution only (the whole function/component being asked for, inside any given code — see "Working inside given code"), in one code block.
  - Put a short numbered comment only on the important or non-obvious lines — the core logic, a framework/platform API (e.g. \`watch\`, \`onCleanup\`, \`AbortController\`, \`useEffect\` cleanup), or a language feature an interviewer may ask about (closure, rest/spread, destructuring, async/await…), e.g. \`t = setTimeout(() => fn(...args), wait) // (2) restart the timer\`. A few words each; the explanation goes in Implementation. No comments on obvious lines.
  - Number the comments (1), (2), … in code order; each number matches the Implementation point with that number (not the Approach steps). Use the comment syntax that is valid at that spot (\`//\` in JS/TS/Kotlin/Java, \`#\` in Python/Ruby, \`<!-- (n) … -->\` in HTML or a Vue \`<template>\`), so the code still runs.
- **Implementation** — the numbered points (1), (2), … matching the code comments, at most ~7: each 1-2 lines on what that line does and why, naming the language/framework concept involved (e.g. "returns a closure that captures \`t\`; \`...args\` forwards any arguments") only when it's non-obvious or likely to be asked about. Then optionally 1-2 plain bullets with no matching comment: data structures chosen and why, edge cases handled.
- **Complexity** — for UI/framework code where Big-O isn't meaningful, one line on the real cost instead (e.g. one request per settled input, re-renders); otherwise two bullets, each naming the line(s) responsible, quoted as inline code:
  - Time: O(…) — e.g. \`for (i in nums.indices)\` runs n times and \`map[x]\` is O(1) average → O(n).
  - Space: O(…) — e.g. \`map\` holds up to n entries → O(n).
- **Why it works** — 1-2 lines.
- **Example flow** — a short \`\`\`text block (3-10 lines) tracing one sample input through the solution step by step, e.g.:
  \`\`\`text
  nums = [2, 7, 11], target = 9
  i=0: need 7, not seen → map {2:0}
  i=1: need 2, seen at 0 → return [0, 1]
  \`\`\`

Give ONE solution: the clean, correct answer an interviewer expects, the one I'd write first — readable, not naive or flawed. No alternative or optimized versions — those are given only when asked for.

A coding follow-up (change/redo code from an earlier answer) gets this same full format, never code alone, and the code is complete, not a diff: apply the change to the previous solution, keeping everything still correct, rather than replacing it with a different implementation (a framework/language switch ports that same solution). Say in simple words what is changing and why in Understanding and Approach, and don't re-explain unchanged parts beyond one line. Mark the new or changed lines with \`CHANGED:\` in their comment, e.g. \`const results = ref([]) // (1) CHANGED: useState → Vue ref\`; numbered ones still match an Implementation point, and a minor changed line gets a plain \`// CHANGED: …\` with no number.`;
}

// Comparison table for "X vs Y" / "difference between" questions. Kept out
// of the system prompt on purpose: any mention of tables there makes the
// model add them to unrelated answers (measured 2026-09-25), so the note is
// appended to the matching question's own user turn only.
const COMPARISON_RE = /\b(vs\.?|versus|differences?|different from|differ|compare[ds]?|comparison)\b/i;

function getComparisonNote(question) {
  if (!COMPARISON_RE.test(String(question || ''))) return '';
  return '\n\n[After the normal answer, end with a compact markdown comparison table: first column the aspect, one column per item compared, 4-7 rows, a few words per cell.]';
}

module.exports = {
  getCodingAnswerBlock,
  getComparisonNote,
};
