const { GoogleGenAI } = require('@google/genai');
const logger = require('../core/logger').createServiceLogger('LLM');
const config = require('../core/config');
const { promptLoader } = require('../../prompt-loader');
const responseLanguage = require('../core/response-language');
const { matchKnowledge } = require('../core/knowledge');
const { getComparisonNote, CHAT_CLARIFY_NOTE, SPOKEN_NOTE, HEARD_PREFIX, splitImplementOffer, createImplementFilter, CLARIFY_PREFIX, clarifyState, clarifyQuestion, heardCodingQuestion } = require('../core/answer-format');

/**
 * 'yes' when text starts with the marker (after whitespace, optionally
 * bold), 'maybe' while it could still become it, 'no' otherwise.
 */
function markerState(text, marker) {
  const head = String(text || '').trimStart().toUpperCase();
  for (const prefix of [marker, `**${marker}`]) {
    if (head.startsWith(prefix)) return 'yes';
    if (prefix.startsWith(head)) return 'maybe';
  }
  return 'no';
}

/**
 * Split an interviewer answer into its optional first "HEARD: a → b" line
 * (returned as note "a → b") and the answer itself.
 */
function splitHeardNote(text) {
  const s = String(text || '');
  if (markerState(s, HEARD_PREFIX) !== 'yes') return { note: null, body: s };
  const trimmed = s.trimStart();
  const nl = trimmed.indexOf('\n');
  const line = nl === -1 ? trimmed : trimmed.slice(0, nl);
  const note = line.replace(/^(\*\*)?HEARD:(\*\*)?\s*/i, '').replace(/\*\*$/, '').trim();
  return { note: note || null, body: nl === -1 ? '' : trimmed.slice(nl + 1).replace(/^\s*\n/, '') };
}

// System design mode, requirement-gathering stage: the hidden REQ: block at
// the end of an answer is cut from what's shown and returned as
// metadata.reqLines (src/core/system-design.js). A no-op in every other case,
// so normal answers are untouched. Read once per request, at its start.
function reqStripper() {
  if (systemDesign.getStage() !== 'clarify') {
    return { active: false, wrap: (emit) => emit, reset() {}, flush() {}, split: (text) => ({ body: text, reqLines: null }) };
  }
  let filter = null;
  return {
    active: true,
    wrap(emit) {
      filter = createReqFilter((d) => { if (d) emit(d); });
      return (d) => { if (d) filter.push(d); };
    },
    reset() { if (filter) filter.reset(); },
    flush() { if (filter) filter.flush(); },
    split(text) {
      const { body, lines } = splitReqBlock(text);
      return { body, reqLines: lines };
    }
  };
}

// Same for a finished non-streamed result.
function withReqLines(result, stripper) {
  if (!stripper.active || !result || typeof result.response !== 'string') return result;
  const { body, reqLines } = stripper.split(result.response);
  return { ...result, response: body, metadata: { ...(result.metadata || {}), reqLines } };
}

// Strips the IMPLEMENT line from a finished result into metadata.implementOffer.
function withImplementOffer(result) {
  if (!result || typeof result.response !== 'string') return result;
  const { offer, body } = splitImplementOffer(result.response);
  if (!offer && body === result.response) return result;
  return { ...result, response: body, metadata: { ...(result.metadata || {}), implementOffer: offer } };
}
const codeFormats = require('../core/code-formats');
const systemDesign = require('../core/system-design');
const { createReqFilter, splitReqBlock } = systemDesign;
const modelHealth = require('../core/model-health');

// Appended (last) to the active profile prompt (prompts/<profile>.md) for
// voice requests only. The profile prompt stays authoritative for content
// and style; this covers what's specific to live-transcript input — most
// importantly that spoken questions are answered in words, not code.
const VOICE_TRANSCRIPT_NOTE = `

## Live Transcript Input (overrides the sections above for this message)
The user turn is a live speech-to-text transcript of what the interviewer just said. It may be fragmentary, run two sentences together, or contain misheard words — infer the intended question from the wording and the conversation so far, and answer that.
- MISHEARD TECHNICAL TERMS: speech recognition garbles spoken code and technical terms in predictable ways — it merges or splits identifiers, swaps letters and syllables for sound-alike words, numbers or names, and drops or spells out dots and brackets. Before answering, check every word or phrase that doesn't name a real thing in a technical interview, or makes no sense as code, and rebuild the most likely real term: first by how it sounds, then by what actually exists in the selected framework and language, the profile's stack and the conversation so far (an API or name from the previous answer is the most likely match). Examples of the pattern, not a complete list: "V4" / "V for" → \`v-for\`, "V if" → \`v-if\`, "V model" → \`v-model\`, "V bind" → \`v-bind\`, "View JS" / "ViewJS" → Vue.js, "composition a p i" → Composition API, "ZulStrand" / "Zoo stand" → Zustand, "Redex" → Redux, "VFF" → BFF, "use effect" → \`useEffect\`, "collagens" → Coroutines, "set time out" → \`setTimeout\`. "cloud" / "claw" / "clawed" / "cloud code" → Claude / Claude Code (Anthropic's AI) when the question is about AI tools, agents, automation or code review; a question about cloud hosting or infrastructure stays "cloud". "speaker" / "speaker app" / "speakr" → Speeqr (my calling app) when the question is about my projects, an app's architecture or the conversation is already about Speeqr; an audio speaker stays a speaker. "in a loop" / "Inalou" next to \`v-for\` means "in a loop" / "in the loop" of a Vue template. A term that makes sense as spoken stays as it is (a "2D array" or a 2D canvas is real). In a question about the code from the previous answer ("why didn't you use safe count?"), words that sound like a name for something in that code are a proposed name (\`safeCount\` for the guarded count), not a mishearing. Answer the rebuilt question directly — exactly what it asks, nothing more; do not mention the mishearing in the answer. The one exception is a request to write or change code whose unclear term you can't rebuild with confidence: see "Unclear word in a coding request" below.
- NOTE FOR THE CANDIDATE: only when you answered a different real term than the words in the transcript (a rebuilt misheard term — not a spacing or capitalization fix like "use effect" → \`useEffect\`), make the very first line \`${HEARD_PREFIX} <words as transcribed> → <term you answered>\`, then the answer exactly as usual. When the transcribed sound also fits other real terms, end that line with \` | <term>, <term>\` (at most 2): real API or library names that sound like the transcribed words syllable by syllable, the selected framework's own API first, each different from the term you answered, e.g. \`${HEARD_PREFIX} view ex → Vue.js | Vuex\`. Leave it off when only one reading fits. That line is shown to the candidate only, never part of the answer. No such line when nothing was rebuilt.
- DEFAULT FOR SPOKEN QUESTIONS: a verbal, skimmable answer that's easy to read out, with NO code blocks. This applies to "what is X", "how does X work", "why X", "how would you handle/approach/design X", "how did you do/handle/solve X", "tell me about X" and experience/project questions — explain in words; if a class, function, or library name helps, put it inline as a short code-highlighted span, never a fenced code block.
- Only include a code block when the interviewer explicitly asks you to write, code, implement, or show code, reads out a concrete coding/algorithm problem to solve (e.g. "write a function that reverses a linked list"), asks you to fix/modify specific code, or asks to change or redo code from an earlier answer (e.g. "now do it in Vue"). Then use the coding format above. A question about code from an earlier answer ("why didn't you use X?", "could we use X?") is not a request to change it: answer it as "When code is needed" above says for that case (words, at most the few lines that would change, and the IMPLEMENT line when there's a change worth making).
- For an explicit system-design question ("design X"), a short text flow diagram is fine — that is not code.
- Pure social small talk with no technical content (e.g. a bare "hello", "how are you", "can you hear me") gets a brief, natural one-line reply, then stop.
- Anything with technical content or an actual question in it gets a real answer — never dismiss it as "not relevant."

## Unclear word in a coding request (interviewer)
Only when the interviewer asks to write or change code, including a follow-up like "add …" to the code above. Building the wrong change costs the candidate far more than one question. Before writing anything, compare each unclear word with the term you would build. Every heard word must be explained by that term: a change that leaves heard words unexplained, or adds a feature none of them name (for example the next step you'd expect rather than what was said), doesn't match.
- Its sounds match exactly one real term syllable by syllable, and that term fits the code so far: build it as usual (with the HEARD line).
- Otherwise build nothing. That covers sounds that fit two or more real terms that would produce different code (spoken dots and words can be a chain of separate calls or one method name), a term the sounds don't really match, and a fit that would mean inventing a mode, option, matcher or API (a word that merely starts like a real one is not a fit). The whole reply is one line, ${CLARIFY_PREFIX} Did you mean \`<term>\`, \`<term>\` or \`<term>\`? with 1 to 3 real terms that sound like it and fit the framework and the code so far, most likely first, no explanation. If no real term fits at all, the line is ${CLARIFY_PREFIX} What did you mean by "<the words>"? The candidate picks one and then you build it.
A clear request for a real feature is never questioned. Concept, experience and design questions are never questioned: answer them.`;

// True for an answer whose only fenced blocks are ```text flows (an
// architecture / "my work" answer), never for one with code.
function hasTextFlowOnly(answer) {
  const fences = String(answer || '').match(/^\s*```[^\n]*/gm) || [];
  const openings = fences.filter((_, i) => i % 2 === 0).map(f => f.trim().slice(3).trim().toLowerCase());
  return openings.length > 0 && openings.every(lang => lang === 'text');
}

// Appended to the active profile prompt ONLY for a user-triggered "More
// details" request (see processExpansionStream). The normal answer path never
// uses it.
const EXPANSION_NOTE = `

## More Details Request (overrides the answer formats above for this message)
The conversation contains the original interview question and the concise answer already given. The candidate asked for more details. Expand the existing answer with the most useful additional depth for the original interview question.
- Start directly with the content, with a short summary/intro in first person — no preamble such as "To elaborate…" or "Here is more detail…".
- Preserve the original answer's meaning and correctness. Do not repeat what it already covers beyond a one-line anchor — add what's missing (a coding answer keeps its sections, see Coding/DSA below, but each adds depth rather than restating).
- Prioritize the details an interviewer would care about most if they said "can you elaborate?".
- Keep it concise, structured, and easy to scan (short headers/bullets). Add depth, not filler. Moderately longer than the original answer, not dramatically (own-project / architecture answers: see below) — never a textbook, tutorial, or long essay.
- Adapt the depth to the topic:
  - Technical theory: deeper reasoning, important internals, practical implications, key trade-offs, common pitfalls.
  - Android/Kotlin: relevant internals, lifecycle/concurrency implications, practical production considerations, important edge cases.
  - Coding/DSA (the answer has code): keep the same sections, each more in depth and readable. Implementation: explain every numbered \`(n)\` comment in the code — what that line does and why, and the language/framework concepts involved (closures, higher-order functions, rest/spread, destructuring, async/await, Vue reactivity, computed/watchers, React hooks…) — only those that are relevant, non-obvious or useful for an interview follow-up, not every feature for its own sake. Example flow: trace what actually happens when the code runs, step by step (calls, what a closure captures, state/reactivity updates, re-renders), with the matching \`(n)\`. Also deeper edge cases, complexity details and trade-offs. Don't reprint the code — refer to its lines by \`(n)\`, using only the numbers that actually appear in that code; a line without a number (or code with no numbered comments) is referred to by quoting it as inline code.
  - System design: ALWAYS include a design diagram in easily readable text form (boxes and arrows, e.g. [Client] --> [API] --> [DB]) — if the original answer already had one, give a more detailed version rather than omitting it. Then deeper design reasoning, important trade-offs, scaling considerations, reliability/failure cases, and the relevant data flow.
  - Behavioral/personal (a career walkthrough: see below): expand ONLY with information actually present in the Candidate Background / Personal & Interview Notes above. Never invent companies, projects, responsibilities, achievements, opinions, or experiences — if nothing more is available, add depth on reasoning/approach instead of new facts.
  - Career walkthrough ("tell me about yourself / your experience / walk me through your resume"): substantially longer than the original answer and covering every project in it, in the same order, down to the last one. Use exactly the original \`### Company — role, dates\` and \`#### Project\` headings. Under each project: one anchor line (no restated bullets), a compact \`\`\`text flow from the reference notes, then 2-4 bullets on the main layers the way a request travels (this profile's side gets the most depth: e.g. rendering, state, API layer), each naming its libraries and where my features sit, and one **The Why:** line for the key decision. Rakuten GORA (each app) and Speeqr get the most depth; the other projects get a short flow and 2 bullets. Facts only from the reference notes, the Candidate Background and the original answer.
  - My own project / architecture (e.g. "tell me more about your work at GORA", "walk me through GORA"): the deep, readable walkthrough of the same topic. Build on the original answer without reprinting it: it already introduced the product, the architecture, the stack and my work, so don't introduce them again — open with one line saying what this goes deeper on, then follow the flow layer by layer the way a request travels (e.g. user → frontend → API layer → BFF → services → data → back to the UI); on the Frontend profile the frontend layers get the most depth. Give each layer a \`###\` heading, and \`####\` sub-headings for its main parts when it has several (e.g. rendering, state, forms). Under them, write 2-4 bullets of simple, complete first-person sentences that are easy to read out loud: what the layer does, which libraries we used there, how data moves on to the next layer, and where my own work fits. Add a **The Why:** line only where a decision is worth explaining — why we chose or added it (e.g. Sentry: what it catches and why we added it) — not on every layer. For a "my work" question, keep the walkthrough anchored on the features I built and show where each one sits in the flow. Add a \`\`\`text flow when it helps follow the data. No label-only fragments such as "Technologies: X, Y" or one-line bullets per field. Use the reference notes and never contradict them (e.g. don't relabel the stack with technologies the notes don't name) or blur separate systems (e.g. the GORA customer platform vs the B2B portal). Cover what the first answer only named: the architecture layer by layer and how my module fits, the technology choices with their Why, the data flow, and the implementation details of my features (state, validation, API calls, error handling, lifecycle). Facts only from the reference notes, the Candidate Background and the original answer — no new technologies, features or numbers; where the notes are silent, describe following the existing patterns. Substantially deeper than the original answer, still skimmable.
- When the original answer has no code, include code only when it materially helps (e.g. the question explicitly asked for code); otherwise explain in words.
- The original question may be a live speech-to-text transcript (possibly misheard) — interpret it the same way the original answer did.`;

// Appended to the active profile prompt ONLY for a user-triggered "Optimized
// solution" request (processExpansionStream with mode 'optimized'). Normal
// answers give one simple solution (answer-format.js); this is the only path
// that produces the optimized one.
const OPTIMIZE_NOTE = `

## Optimized Solution Request (overrides "Give ONE solution" for this message)
The conversation contains the original question and the first solution already given. Give the optimized version of that solution.
- First check whether it can be meaningfully improved. If it is already optimal and idiomatic, say so in the Understanding line, keep its code, and give at most 1-2 refinements that genuinely matter under Possible improvements — no micro-optimizations or engine-specific tweaks.
- Otherwise make at most 3 changes — the ones with the biggest real effect on this code, each fixing a concrete problem it has; anything else worth doing goes in one line under Possible improvements:
  - DSA/algorithm problem: better time/space complexity (name the technique and why it's faster).
  - Frontend, backend or mobile implementation (Vue, React, Spring, Node, Android…): not Big-O — a real bug or missed edge case, or a clearer, more idiomatic use of the established APIs of the framework and version in use instead of a custom mechanism.
- Keep it about the same size: build on the first solution inside the same given code/signature and structure (see "Working inside given code"); no new functions, hooks, classes or layers unless a fix needs one. The first answer's Possible improvements are not a to-do list — add one only if it fixes a real problem in this code.
- Use the same Coding answer format with the heading \`### Optimized — <short name>\`: Understanding = one line on what's being improved; Approach (required) = \`**Key idea:**\` one sentence on the main improvement, then numbered steps that walk through the whole optimized solution, with each improvement step marked **(new)** and saying the concrete problem it prevents and how; numbered \`(n)\` comments on each logical step of the code (same density as the Coding answer format) matching the Implementation points, with new or changed lines marked \`NEW:\` (in this mode, not \`CHANGED:\`) saying in a few words what changed and why it's better, e.g. \`// (2) NEW: cancel the previous request so a slow old response can't overwrite newer results\`; the Implementation point of a NEW line says what was wrong or missing in the first solution and how this line fixes it; Complexity compares with the first solution; Example flow shows the same input before → after the improvement when the behavior changed, otherwise a normal Example flow.`;

// Appended to the active profile prompt ONLY for a user-triggered "Deep
// reasoning" request (processExpansionStream with mode 'deep'). Unlike
// EXPANSION_NOTE (adds depth to the answer as given) this reviews the answer
// and produces a better-reasoned version of it; unlike OPTIMIZE_NOTE it never
// swaps a coding answer for a different algorithm.
const DEEP_REASONING_NOTE = `

## Deep Reasoning Request (overrides the answer formats above for this message)
The conversation contains the original interview question and the answer already given. Think the question through again from scratch, then review that answer against it: keep everything that is correct, fix anything weak, inaccurate, contradictory or badly structured, and add the important points an experienced engineer would expect and the answer is missing. The result is a better, more complete and better-reasoned answer to the SAME question — not a longer copy of the original and not a list of extra details.
- Start directly with the content, in first person — no preamble such as "Here is a deeper look…", and don't mention reviewing or the original answer.
- Readable and skimmable during a live interview: a one- or two-line summary first, then short \`###\` headings with bullets, numbered steps, compact tables and \`\`\`text diagrams where they help. No long paragraphs, no repetition.
- Build on the Candidate Background, Personal / Interview Notes, reference notes, selected framework/language and the conversation. This mode exists to reason BEYOND them: anticipate and fill in what isn't written down — how something most likely worked in practice, implementation details, edge cases, failure modes, trade-offs, alternatives considered, what I'd do differently, and what an interviewer will probe next — and say it naturally in first person as part of my experience, as long as it fits the described architecture and stack and never contradicts the notes. Keep the fixed facts fixed: don't change companies, projects, dates, roles or numbers the notes give, and don't make up new precise metrics (percentages, user counts, time saved) — describe impact qualitatively instead. Don't dump unrelated project details.

### Theory, "how does it work", architecture and my own project work
Use only the sections that fit the question, in this order:
- **How it works** — definition and the mechanism, step by step.
- **Architecture / data flow** — when the question is about a system or a project: the flow layer by layer the way a request travels, with a \`\`\`text diagram (boxes and arrows) when it helps.
- **Technologies and responsibilities** — what each important technology does in this system and why it's there.
- **Design decisions** — each with a **The Why:** line (the problem it solves and what the alternative would have cost).
- **Trade-offs and failure cases** — plus scalability, performance, security, testing and operations only where they actually matter for this question.
- **Pitfalls** and a short **real-world example** or my relevant experience.
For my own project work, blend the facts from the notes and the reasoned details into one natural first-person answer — no "inference" or "not in the notes" labels.

### Behavioral stories (proudest project, biggest challenge, a hard problem…)
Keep the same story or stories and every project the answer already covered (e.g. a closing Speeqr section stays), in the same order (the problem, my part, what I did, the result). Go deeper on each: why the problem happened in the first place, how each fix worked step by step, the trade-offs and alternatives we weighed, what I learned or would do differently, then a short **Likely follow-ups** list: 2-4 questions the interviewer may ask next, each with a one- or two-line answer.

### Career walkthrough ("tell me about yourself / your experience")
Keep the original \`### Company\` / \`#### Project\` headings in the same order. Under each project, go deeper on its architecture from the reference notes: a \`\`\`text flow, the layers, the key decisions and their trade-offs, and where my features sit. Rakuten GORA (each app) and Speeqr get the most depth.

### Coding answers (the answer contains code)
Review, don't redesign — a different algorithm or complexity class is what the separate "Optimized solution" button is for. ALWAYS use exactly this structure: the first line of the response is the \`### Solution — … (reviewed)\` heading below, then optionally one \`### Improved — …\` section — no other top-level headings, and no section about what was wrong with a "previous"/"original" answer (weaknesses go in Edge cases).
- Keep the exact format, framework, API style (e.g. Options API vs Composition API, CDN page vs SFC), language, names and signature of the given solution and of any code shown in the question. Don't rewrite surrounding code.
- \`### Solution — <same short name> (reviewed)\` — Understanding (1-2 lines), then **Approach** (required): a \`**Key idea:**\` sentence, then a concise thought process (numbered steps), then the SAME code copied verbatim with its same numbered \`(n)\` comments (don't edit, renumber or add lines — fixes belong in Improved), then **Implementation**: every \`(n)\` explained, including the language/framework features involved (closures, reactivity, hooks, async/await…) where they're non-obvious or likely follow-ups. Then **Complexity** derived step by step — each step names the line(s) responsible, quoted as inline code, and the totals follow from them (time, then space). Then **Edge cases** it handles or misses.
- If there is a meaningful correctness, robustness or readability improvement to the SAME approach (a bug, a missed edge case, a race/cleanup issue, clearer idiomatic code), add \`### Improved — <short name>\`: what changes and why (bullets), then the complete improved code with changed lines marked \`// (n) CHANGED: …\` (comment syntax valid at that spot), then any Complexity difference. Otherwise end with a short **Possible improvements** bullet list instead — no second code block.`;

// Expansion modes that run on the reasoning models (llm.gemini.reasoning).
const REASONING_MODES = ['optimized', 'deep'];

// Per-model generation-config overrides. Some models reject settings that
// the primary model accepts: gemini-3.5-flash-lite returns 400
// INVALID_ARGUMENT for thinkingConfig.thinkingBudget = 0 but accepts
// thinkingLevel 'minimal' (verified 2026-09-24; gemini-3.5-flash also
// verified to accept 'minimal'), which made it a fallback that could never
// succeed.
const MODEL_THINKING_OVERRIDES = {
  'gemini-3.5-flash-lite': { thinkingLevel: 'minimal' },
  'gemini-3.5-flash': { thinkingLevel: 'minimal' }
};

class LLMService {
  constructor() {
    this.client = null;
    this.model = null;
    this.isInitialized = false;
    this.requestCount = 0;
    this.errorCount = 0;
    // The model that produced the most recent answer (status display).
    this.lastModel = null;
    
    this.initializeClient();
  }

  initializeClient() {
    const apiKey = config.getApiKey('GEMINI');
    
    if (!apiKey || apiKey === 'your-api-key-here') {
      logger.warn('Gemini API key not configured', { 
        keyExists: !!apiKey,
        isPlaceholder: apiKey === 'your-api-key-here'
      });
      return;
    }

    try {
      this.client = new GoogleGenAI({ apiKey });
      
      // Use the configured model name (default: gemini-3.5-flash)
      this.model = config.get('llm.gemini.model');
      this.isInitialized = true;
      
      logger.info('Gemini AI client initialized successfully', {
        model: this.model
      });
    } catch (error) {
      logger.error('Failed to initialize Gemini client', { 
        error: error.message 
      });
    }
  }

  getGenerationConfig(overrides = {}) {
    const defaults = config.get('llm.gemini.generation') || {};
    const fallback = {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 }
    };

    const merged = { ...fallback, ...defaults, ...overrides };
    return Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined && value !== null)
    );
  }

  applyGenerationDefaults(request, overrides = {}) {
    request.generationConfig = this.getGenerationConfig({ ...(request.generationConfig || {}), ...overrides });
    return request;
  }

  /**
   * Copy of the request adjusted for a specific model (see
   * MODEL_THINKING_OVERRIDES). The primary model's request is returned
   * unchanged.
   */
  _requestForModel(geminiRequest, modelName) {
    const thinkingOverride = MODEL_THINKING_OVERRIDES[modelName];
    const thinkingConfig = geminiRequest.generationConfig && geminiRequest.generationConfig.thinkingConfig;
    // Only the default thinkingBudget config is swapped; an explicit
    // thinkingLevel (the Optimized request) is kept as-is.
    if (!thinkingOverride || !thinkingConfig || thinkingConfig.thinkingBudget === undefined) {
      return geminiRequest;
    }
    return {
      ...geminiRequest,
      generationConfig: { ...geminiRequest.generationConfig, thinkingConfig: { ...thinkingOverride } }
    };
  }

  /**
   * Absolute time after which no NEW attempt or retry is started for one
   * user request (an attempt already in flight is never cut off). Without
   * this, an overloaded API walked the whole streaming → HTTPS → SDK chain
   * with backoff (~50s observed) while later questions queued behind it.
   */
  _newDeadline() {
    const budgetMs = config.get('llm.gemini.requestBudgetMs') || 12000;
    return Date.now() + budgetMs;
  }

  _deadlinePassed(deadline, extraMs = 0) {
    return typeof deadline === 'number' && Date.now() + extraMs >= deadline;
  }

  /**
   * Models to try in order: an explicit list (the reasoning models for
   * "Optimized solution" / "Deep reasoning"), else the configured primary
   * model followed by its fallbacks.
   */
  _modelsToTry(models = null) {
    if (Array.isArray(models) && models.length) return [...new Set(models)];
    const fallbackModels = config.get('llm.gemini.fallbackModels') || [];
    return [...new Set([this.model || config.get('llm.gemini.model'), ...fallbackModels])];
  }

  /** True when the server answered with an HTTP error (as opposed to a network-level failure). */
  _isHttpStatusError(error) {
    return !!(error && typeof error.message === 'string' && /^HTTP \d{3}/.test(error.message));
  }

  /**
   * Shared non-streaming execution: preferred method first, then the other
   * one — but the SDK fallback only when it can plausibly help. If the HTTPS
   * path got a real HTTP error back from Gemini (503 overload, 400, 429…),
   * the SDK would hit the same server with the same result, so it is skipped;
   * it's still tried after network-level HTTPS failures. Nothing new starts
   * once the deadline has passed.
   */
  async _executeWithFallback(geminiRequest, deadline, options = {}) {
    if (this._deadlinePassed(deadline)) {
      throw new Error('Gemini request time budget exhausted before non-streaming attempt');
    }

    const preferAlternative = !!config.get('llm.gemini.enableFallbackMethod');
    const primaryFn = preferAlternative ? this.executeAlternativeRequest.bind(this) : this.executeRequest.bind(this);
    const secondaryFn = preferAlternative ? this.executeRequest.bind(this) : this.executeAlternativeRequest.bind(this);
    const secondaryLabel = preferAlternative ? 'primary SDK method' : 'alternative HTTPS method';

    try {
      return await primaryFn(geminiRequest, deadline, options);
    } catch (error) {
      if (preferAlternative && this._isHttpStatusError(error)) {
        logger.warn('HTTPS method got an HTTP error from Gemini; skipping SDK fallback (same server, same result)', {
          error: error.message.substring(0, 200),
          requestId: this.requestCount
        });
        throw error;
      }
      if (this._deadlinePassed(deadline)) {
        logger.warn('Gemini time budget exhausted; skipping secondary method', {
          error: error.message.substring(0, 200),
          requestId: this.requestCount
        });
        throw error;
      }

      logger.warn(`${preferAlternative ? 'Alternative' : 'Primary'} method failed, trying ${secondaryLabel}`, {
        error: error.message,
        requestId: this.requestCount
      });
      try {
        return await secondaryFn(geminiRequest, deadline, options);
      } catch (secondaryError) {
        logger.error('Both Gemini request methods failed', {
          firstError: error.message,
          secondError: secondaryError.message,
          requestId: this.requestCount
        });
        throw secondaryError;
      }
    }
  }

  extractTextFromCandidates(response) {
    // New @google/genai SDK exposes response.text as a convenience getter.
    if (response && typeof response.text === 'string' && response.text.trim().length > 0) {
      return {
        text: response.text.trim(),
        candidate: response.candidates?.[0] || null,
        finishReason: response.candidates?.[0]?.finishReason || null
      };
    }

    const candidates = Array.isArray(response?.candidates)
      ? response.candidates
      : Array.isArray(response)
        ? response
        : [];

    if (!candidates.length) {
      throw new Error('No candidates in Gemini response');
    }

    const candidateWithText = candidates.find(candidate => {
      const parts = candidate?.content?.parts;
      return Array.isArray(parts) && parts.some(part => typeof part.text === 'string' && part.text.trim().length > 0);
    });

    if (!candidateWithText) {
      const finishReasons = candidates.map(c => c.finishReason || 'unknown').join(', ');
      throw new Error(`No text parts in candidates. Finish reasons: ${finishReasons}`);
    }

    const textParts = candidateWithText.content.parts
      .filter(part => typeof part.text === 'string' && part.text.trim().length > 0)
      .map(part => part.text.trim());

    if (!textParts.length) {
      throw new Error(`Candidate parts missing text after filtering: ${JSON.stringify(candidateWithText)}`);
    }

    const text = textParts.join('\n');

    return {
      text,
      candidate: candidateWithText,
      finishReason: candidateWithText.finishReason || null
    };
  }

  /**
   * One screenshot request for one or more images (hotkey capture or images
   * attached in chat). Images keep their order and go in ONE user turn, so
   * several screenshots are read as one question. Base64 is encoded here,
   * once, and the streaming → non-streaming fallback reuses this request.
   * @param {Array<{buffer: Buffer, mimeType: string}>} images
   * @param {{text?: string}} options - text typed alongside the images
   */
  buildImageRequest(images, activeSkill, programmingLanguage, { text = '' } = {}) {
    if (!Array.isArray(images) || !images.length || !images.every(img => img && Buffer.isBuffer(img.buffer) && img.buffer.length)) {
      throw new Error('Invalid image(s) provided for screenshot analysis');
    }

    const sessionManager = require('../managers/session.manager');
    const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
    if (!skillContext.skillPrompt) {
      throw new Error(`No prompt found for profile: ${activeSkill}`);
    }

    const parts = [{ text: this.formatImageInstruction(activeSkill, programmingLanguage, { count: images.length, text }) + systemDesign.getSystemDesignTurnNote() }];
    images.forEach((img, i) => {
      if (images.length > 1) parts.push({ text: `Image ${i + 1} of ${images.length}:` });
      parts.push({ inlineData: { data: img.buffer.toString('base64'), mimeType: img.mimeType || 'image/png' } });
    });

    const request = {
      contents: [
        // Recent text turns so a screenshot follow-up can build on the
        // previous answer; earlier screenshots themselves are not resent.
        ...this._historyContents(sessionManager.getConversationHistory(10), 8),
        { role: 'user', parts }
      ]
    };
    this.applyGenerationDefaults(request);
    request.systemInstruction = { parts: [{ text: skillContext.skillPrompt }] };
    return request;
  }

  _imageMetadata(images) {
    return {
      isImageAnalysis: true,
      imageCount: images.length,
      mimeType: images[0].mimeType || 'image/png'
    };
  }

  /**
   * Non-streaming screenshot analysis. Called standalone, or as the fallback
   * of processImageWithSkillStream, which passes its already-built request and
   * deadline so the whole chain shares one time budget and one encode.
   * @param {Array<{buffer: Buffer, mimeType: string}>} images - in order
   * @returns {Promise<{response: string, metadata: object}>}
   */
  async processImageWithSkill(images, activeSkill, programmingLanguage = null, { text = '', deadline = null, request = null } = {}) {
    deadline = deadline || this._newDeadline();
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check Gemini API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      request = request || this.buildImageRequest(images, activeSkill, programmingLanguage, { text });

      const responseText = await this._executeWithFallback(request, deadline);

      // Enforce language in code fences if provided
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(responseText, programmingLanguage)
        : responseText;

      logger.logPerformance('LLM image processing', startTime, {
        activeSkill,
        imageCount: images.length,
        imageBytes: images.reduce((n, img) => n + img.buffer.length, 0),
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          ...this._imageMetadata(images)
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM image processing failed', {
        error: error.message,
        activeSkill,
        requestId: this.requestCount
      });

      if (config.get('llm.gemini.fallbackEnabled')) {
        return this.generateFallbackResponse('[image]', activeSkill);
      }
      throw error;
    }
  }

  /**
   * Streaming screenshot analysis — the one path for both the full-screen
   * hotkey and images attached in chat.
   * @param {Array<{buffer: Buffer, mimeType: string}>} images - in order
   */
  async processImageWithSkillStream(images, activeSkill, programmingLanguage = null, onDelta = null, { text = '', onReset = null } = {}) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check Gemini API key configuration.');
    }

    const request = this.buildImageRequest(images, activeSkill, programmingLanguage, { text });
    const startTime = Date.now();
    const deadline = this._newDeadline();
    this.requestCount++;
    const req = reqStripper();

    try {
      const push = req.wrap((delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      });
      const rawText = await this.executeStreamingRequest(request, push, deadline, {
        onReset: () => {
          req.reset();
          if (typeof onReset === 'function') onReset();
        }
      });
      req.flush();
      const { body: fullText, reqLines } = req.split(rawText);

      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

      this._warnIfApproachMissing(finalResponse, { source: 'image' });

      logger.logPerformance('LLM image streaming', startTime, {
        activeSkill,
        imageCount: images.length,
        imageBytes: images.reduce((n, img) => n + img.buffer.length, 0),
        responseLength: finalResponse.length,
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          streamed: true,
          ...this._imageMetadata(images),
          ...(req.active ? { reqLines } : {})
        }
      };
    } catch (error) {
      logger.warn('Streaming image analysis failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      return withReqLines(await this.processImageWithSkill(images, activeSkill, programmingLanguage, { text, deadline, request }), req);
    }
  }

  formatImageInstruction(activeSkill, programmingLanguage, { count = 1, text = '' } = {}) {
    const langNote = programmingLanguage ? ` If code is warranted, use only ${programmingLanguage.toUpperCase()} for it.` : '';
    const intro = count > 1
      ? `These ${count} screenshots were taken during a ${activeSkill.toUpperCase()} interview. They are sequential parts of ONE interviewer question, in order (Image 1 → Image ${count}) — e.g. a scrolled page, or a description in one image and the code/signature or extra requirements in another. Read them all together and give one answer; don't answer them separately.`
      : `This screenshot was taken during a ${activeSkill.toUpperCase()} interview.`;
    const typed = String(text || '').trim();
    const typedNote = typed ? ` The candidate also typed this about it — treat it as more context for the same question: "${typed}".` : '';
    return `${intro}${typedNote} First decide silently (never write this analysis out — the reply starts with the answer itself) what is being asked, what code/environment is already shown or handled by the platform, which part you must implement, which function/component/signature must be kept, and whether this modifies an earlier solution — then answer inside that structure. Determine what it actually shows: a conceptual/behavioral question, a coding/implementation problem, existing code to review/debug/explain, or finished code that calls its own functions or logs values where the question is what it outputs. Then respond appropriately for that content — a conceptual question gets a plain-language answer with no code block; a coding problem or a request to modify/debug existing code gets the relevant code; a what-does-it-output question gets the full coding answer format (never a prose paragraph): the shown code in the code block with a numbered comment on each call saying what it returns, the Implementation points explaining why each value comes out, and the Example flow listing every call → its exact output in run order. If no explicit question is visible, answer what it most likely asks: implement the shown stub or what the latest request in the conversation asks for, explain/fix the shown code, or — only when nothing is left to implement — what the shown code outputs. Never answer with only a description of the screenshot. Do not add a code block just because this is a screenshot.${langNote}`;
  }

  async processTextWithSkill(text, activeSkill, sessionMemory = [], programmingLanguage = null, { deadline = null, spoken = false, models = null } = {}) {
    // Called standalone, or as the fallback of a streaming call that passes its
    // own deadline so the whole chain shares one time budget.
    deadline = deadline || this._newDeadline();
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check Gemini API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing text with LLM', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const geminiRequest = this.buildGeminiRequest(text, activeSkill, sessionMemory, programmingLanguage, { spoken });

      const response = await this._executeWithFallback(geminiRequest, deadline, models ? { models } : {});
      
      // Enforce language in code fences if programmingLanguage specified
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('LLM text processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.gemini.fallbackEnabled')) {
        return this.generateFallbackResponse(text, activeSkill);
      }

      throw error;
    }
  }

  /** Typed chat (and chat text filled in by My Microphone: spoken = true). */
  async processTextWithSkillStream(text, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null, onReset = null, { spoken = false, reasoning = false } = {}) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check Gemini API key configuration.');
    }

    const startTime = Date.now();
    // reasoning: the system design "Build design" turn runs on the reasoning
    // chain (same models, thinking and time budget as Deep reasoning). An
    // object overrides parts of it ({ maxOutputTokens } for the build).
    const reasoningConfig = reasoning
      ? { ...(config.get('llm.gemini.reasoning') || {}), ...(typeof reasoning === 'object' ? reasoning : {}) }
      : null;
    const deadline = reasoningConfig && reasoningConfig.requestBudgetMs ? startTime + reasoningConfig.requestBudgetMs : this._newDeadline();
    this.requestCount++;
    const req = reqStripper();

    try {
      const geminiRequest = this.buildGeminiRequest(text, activeSkill, sessionMemory, programmingLanguage, { spoken });
      if (reasoningConfig) {
        this.applyGenerationDefaults(geminiRequest, {
          maxOutputTokens: reasoningConfig.maxOutputTokens || 8192,
          thinkingConfig: { thinkingLevel: reasoningConfig.thinkingLevel || 'medium' }
        });
      }

      const offerFilter = createImplementFilter((d) => {
        if (typeof onDelta === 'function' && d) onDelta(d);
      });
      const push = req.wrap((d) => offerFilter.push(d));
      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (delta) push(delta);
      }, deadline, {
        ...(reasoningConfig ? {
          models: reasoningConfig.models,
          timeoutMs: reasoningConfig.timeoutMs,
          firstChunkTimeoutMs: reasoningConfig.firstChunkTimeoutMs,
          backupFirstChunkTimeoutMs: reasoningConfig.backupFirstChunkTimeoutMs,
          hedgeAfterMs: reasoningConfig.hedgeAfterMs || 0
        } : {}),
        onReset: () => {
          req.reset();
          offerFilter.reset();
          if (typeof onReset === 'function') onReset();
        }
      });
      req.flush();
      offerFilter.flush();

      const { body: visible, reqLines } = req.split(fullText);
      const { offer, body } = splitImplementOffer(visible);
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(body, programmingLanguage)
        : body;

      this._warnIfApproachMissing(finalResponse, { source: 'text' });

      logger.logPerformance('LLM text streaming', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          streamed: true,
          implementOffer: offer,
          ...(req.active ? { reqLines } : {}),
          ...(reasoning ? { reasoning: true } : {})
        }
      };
    } catch (error) {
      logger.warn('Streaming text failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      return withImplementOffer(withReqLines(await this.processTextWithSkill(text, activeSkill, sessionMemory, programmingLanguage, { deadline, spoken, models: reasoningConfig ? reasoningConfig.models : null }), req));
    }
  }

  async processTranscriptionWithIntelligentResponse(text, activeSkill, sessionMemory = [], programmingLanguage = null, { deadline = null } = {}) {
    // Called standalone, or as the fallback of a streaming call that passes its
    // own deadline so the whole chain shares one time budget.
    deadline = deadline || this._newDeadline();
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check Gemini API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing transcription with intelligent response', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const geminiRequest = this.buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const response = await this._executeWithFallback(geminiRequest, deadline);
      
      // Enforce language in code fences if programmingLanguage specified
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('LLM transcription processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isTranscriptionResponse: true
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM transcription processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.gemini.fallbackEnabled')) {
        return this.generateIntelligentFallbackResponse(text, activeSkill);
      }
      
      throw error;
    }
  }

  /**
   * Coding answers must have an Approach section (answer-format.js); the
   * fast model used to drop it on short framework answers. Log it when it
   * still happens so it can be measured — no retry, it would cost latency.
   */
  _warnIfApproachMissing(text, context) {
    if (!codeFormats.solutionCode(text)) return;
    if (/^\s*(?:#{2,4}\s*|[-*]\s*)?\*{0,2}Approach\b/mi.test(text)) return;
    logger.warn('Coding answer missing Approach', context);
  }

  /**
   * Normalize OPENING code fences to the selected programming language tag.
   * Closing fences are left bare (retagging them would turn them into new
   * openers and break the markdown/code extraction), and fences tagged as
   * non-code text (diagrams, shell, data formats) keep their tag. Tilde
   * fences are normalized to backticks. Does not alter the inner code.
   */
  enforceProgrammingLanguage(text, programmingLanguage) {
    try {
      if (!text || !programmingLanguage) return text;
      const norm = String(programmingLanguage).toLowerCase();
      const fenceTagMap = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript', typescript: 'typescript', ts: 'typescript' };
      const fenceTag = fenceTagMap[norm] || norm || 'text';
      // Framework formats keep their own tag (Vue SFC, TSX/JSX, CDN html page),
      // and so do system design mermaid diagrams (drawn by the overlay).
      const keepTags = new Set(['text', 'plaintext', 'txt', 'diff', 'bash', 'sh', 'shell', 'console', 'sql', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'vue', 'tsx', 'jsx', 'mermaid']);

      let openFence = null; // '```' or '~~~' while inside a code block
      return text.split('\n').map(line => {
        const m = line.match(/^(\s*)(```|~~~)(.*)$/);
        if (!m) return line;
        const [, indent, fence, info] = m;
        if (openFence) {
          if (fence === openFence && info.trim() === '') {
            openFence = null;
            return indent + '```';
          }
          return line; // a fence-like line inside the code itself
        }
        openFence = fence;
        const current = info.trim().split(/\s+/)[0].toLowerCase();
        const tag = current === fenceTag || keepTags.has(current) ? current : fenceTag;
        return indent + '```' + tag;
      }).join('\n');
    } catch (_) {
      return text;
    }
  }

  buildGeminiRequest(text, activeSkill, sessionMemory, programmingLanguage, { spoken = false } = {}) {
    // Check if we have the new conversation history format
    const sessionManager = require('../managers/session.manager');

    if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
      const conversationHistory = sessionManager.getConversationHistory(15);
      const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
      return this.buildGeminiRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage, { spoken });
    }

    // Fallback to old method for compatibility - now with programming language support
    const requestComponents = promptLoader.getRequestComponents(
      activeSkill, 
      text, 
      sessionMemory,
      programmingLanguage
    );

    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Use the skill prompt that already has programming language injected
    if (requestComponents.shouldUseModelMemory && requestComponents.skillPrompt) {
      request.systemInstruction = {
        parts: [{ text: requestComponents.skillPrompt }]
      };
      
      logger.debug('Using language-enhanced system instruction for skill', {
        skill: activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        promptLength: requestComponents.skillPrompt.length,
        requiresProgrammingLanguage: requestComponents.requiresProgrammingLanguage
      });
    }

    request.contents.push({
      role: 'user',
      parts: [{ text: String(text || '').trim() }]
    });

    return request;
  }

  buildGeminiRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage, { spoken = false } = {}) {
    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Use the skill prompt from context (which may already include programming language).
    // Chat only: the "did you mean…?" rule (answered in the chat window).
    if (skillContext.skillPrompt) {
      request.systemInstruction = {
        parts: [{ text: skillContext.skillPrompt + CHAT_CLARIFY_NOTE }]
      };
      
      logger.debug('Using skill context prompt as system instruction', {
        skill: activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        promptLength: skillContext.skillPrompt.length,
        requiresProgrammingLanguage: skillContext.requiresProgrammingLanguage || false,
        hasLanguageInjection: programmingLanguage && skillContext.requiresProgrammingLanguage
      });
    }

    // Conversation history (excluding system messages)
    request.contents.push(...this._historyContents(conversationHistory, 15));

    // The question as typed, like voice. A "Text to analyze:" wrapper here made
    // short follow-ups ("option api") get described instead of answered.
    const formattedMessage = String(text || '').trim() + (spoken ? SPOKEN_NOTE : '') + this._prepNotes(text, activeSkill, conversationHistory) + getComparisonNote(text) + systemDesign.getSystemDesignTurnNote();
    if (!formattedMessage || formattedMessage.trim().length === 0) {
      throw new Error('Failed to format user message or message is empty');
    }

    // Add the current user input
    request.contents.push({
      role: 'user',
      parts: [{ text: formattedMessage }]
    });

    logger.debug('Built Gemini request with conversation history', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      historyLength: conversationHistory.length,
      totalContents: request.contents.length,
      hasSystemInstruction: !!request.systemInstruction,
      requiresProgrammingLanguage: skillContext.requiresProgrammingLanguage || false
    });

    return request;
  }

  buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    const cleanText = text && typeof text === 'string' ? text.trim() : '';
    if (!cleanText) {
      throw new Error('Empty or invalid transcription text provided to buildIntelligentTranscriptionRequest');
    }

    const sessionManager = require('../managers/session.manager');
    const conversationHistory = sessionManager.getConversationHistory(10);
    const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
    return this.buildIntelligentTranscriptionRequestWithHistory(cleanText, activeSkill, conversationHistory, skillContext, programmingLanguage);
  }

  buildIntelligentTranscriptionRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage) {
    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Same profile prompt as typed chat and screenshots (resume, identity and
    // language blocks included), plus the live-transcript note.
    if (!skillContext.skillPrompt) {
      throw new Error(`No prompt found for profile: ${activeSkill}`);
    }
    request.systemInstruction = { parts: [{ text: skillContext.skillPrompt + VOICE_TRANSCRIPT_NOTE }] };

    // Recent conversation history (excluding system messages). The current
    // transcript is not in history yet — main.js records it with its answer.
    request.contents.push(...this._historyContents(conversationHistory, 8));

    request.contents.push({
      role: 'user',
      parts: [{ text: text + this._prepNotes(text, activeSkill, conversationHistory) + getComparisonNote(text) + systemDesign.getSystemDesignTurnNote() }]
    });

    logger.debug('Built intelligent transcription request with conversation history', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      historyLength: conversationHistory.length,
      totalContents: request.contents.length,
      cleanTextLength: text.length,
      requiresProgrammingLanguage: skillContext.requiresProgrammingLanguage || false
    });

    return request;
  }

  /**
   * The last `limit` non-empty, non-system history turns as Gemini contents —
   * the one history builder for chat, voice and screenshots. Expansions
   * (More details, Deep reasoning, Optimized, conversions) are never turns of
   * their own. The one exception is code: when the MOST RECENT answer has a
   * newer version of its code (latestCode, set by an Optimized/converted/
   * Deep-reasoning-improved solution), that code stands in for the answer so
   * a follow-up ("now add pagination") builds on what's on screen. Older
   * answers always go as the normal answer, so once a new question has been
   * answered no expansion content is sent any more.
   */
  _historyContents(conversationHistory, limit) {
    const events = (conversationHistory || [])
      .filter(event => event.role !== 'system' &&
        typeof event.content === 'string' &&
        event.content.trim().length > 0)
      .slice(-limit);
    // An answer whose question fell outside the window is dropped too.
    if (events.length && events[0].role === 'model') events.shift();
    let lastModel = -1;
    events.forEach((event, i) => { if (event.role === 'model') lastModel = i; });
    return events.map((event, i) => {
      const latest = i === lastModel && event.latestCode && event.latestCode.code;
      return {
        role: event.role === 'model' ? 'model' : 'user',
        parts: [{ text: latest ? this._latestCodeTurn(event.latestCode) : event.content.trim() }]
      };
    });
  }

  /** Compact stand-in for an answer whose code was replaced by an expansion. */
  _latestCodeTurn({ mode, code }) {
    const format = String(mode || '').startsWith('convert:') ? codeFormats.getFormat(mode.slice(8)) : null;
    const source = format ? `converted to ${format.label}`
      : mode === 'deep' ? 'improved in a deep-reasoning review'
      : 'optimized';
    return `[Current version of this solution (${source}) — build any follow-up on this code.]\n\n${code}`;
  }

  /**
   * Prep notes / project knowledge matching this question (src/core/knowledge.js),
   * to append to the current user turn only. '' when nothing matches, so an
   * unrelated question's request is unchanged. The previous user question
   * from history lets follow-ups ("and where would you create it?") match
   * within the same exercise, and the previous answer tells which project a
   * follow-up without a project name is about (knowledge.js "carry-over").
   */
  _prepNotes(question, activeSkill, history = [], opts = {}) {
    // [question, answer] turns in order; the last one is the previous turn,
    // the ones before it let a chain of follow-ups keep its project / app.
    const turns = [];
    for (const e of history || []) {
      if (!e || typeof e.content !== 'string') continue;
      if (e.role === 'user') turns.push([e.content, '']);
      else if (e.role === 'model') {
        // An answer with no question before it (expansion context) still counts.
        if (turns.length && !turns[turns.length - 1][1]) turns[turns.length - 1][1] = e.content;
        else turns.push(['', e.content]);
      }
    }
    const [prevQuestion, prevAnswer] = turns.pop() || ['', ''];
    const { ids, block } = matchKnowledge(question, activeSkill, prevQuestion, prevAnswer, turns, opts);
    if (ids.length) logger.info('Prep notes attached', { ids, chars: block.length });
    // Logged so a question that should have had notes (e.g. a misheard
    // project name) can be diagnosed from the log.
    else logger.info('Prep notes: none', { question: String(question || '').slice(0, 100) });
    return block;
  }

  async executeRequest(geminiRequest, deadline = null, { models = null, timeoutMs = null } = {}) {
    const maxRetries = config.get('llm.gemini.maxRetries');
    const timeout = timeoutMs || config.get('llm.gemini.timeout');
    // Models known to be out of quota / overloaded / silent right now go
    // last (src/core/model-health.js); the first healthy one leads.
    const modelsToTry = modelHealth.order(this._modelsToTry(models));

    logger.debug('Executing Gemini request', {
      hasModel: !!this.model,
      hasClient: !!this.client,
      requestKeys: Object.keys(geminiRequest),
      timeout,
      maxRetries,
      modelsToTry,
      nodeVersion: process.version,
      platform: process.platform
    });

    let lastError = null;

    for (const modelName of modelsToTry) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Don't start a new attempt once the request's time budget is spent.
        if (lastError && this._deadlinePassed(deadline)) {
          logger.warn('Gemini time budget exhausted; not starting another attempt', { model: modelName, attempt });
          throw lastError;
        }
        try {
          // Cleared once the race is decided, so a finished request doesn't
          // leave a live timer behind for the full timeout.
          let timeoutTimer = null;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutTimer = setTimeout(() => reject(new Error('Request timeout')), timeout);
          });

          logger.debug(`Gemini API attempt ${attempt} starting with model ${modelName}`, {
            timestamp: new Date().toISOString(),
            timeout,
            model: modelName
          });

          // @google/genai only reads systemInstruction from inside `config`;
          // passed at the top level it is silently dropped.
          const modelRequest = this._requestForModel(geminiRequest, modelName);
          const requestPromise = this.client.models.generateContent({
            model: modelName,
            contents: modelRequest.contents,
            config: {
              ...modelRequest.generationConfig,
              ...(modelRequest.systemInstruction ? { systemInstruction: modelRequest.systemInstruction } : {})
            }
          });
          let result;
          try {
            result = await Promise.race([requestPromise, timeoutPromise]);
          } finally {
            clearTimeout(timeoutTimer);
          }

          if (!result) {
            throw new Error('Empty response from Gemini API');
          }

          const { text, finishReason } = this.extractTextFromCandidates(result);

          if (finishReason === 'MAX_TOKENS') {
            logger.warn('Gemini response reached max tokens limit', {
              attempt,
              finishReason,
              model: modelName
            });
          }

          logger.debug('Gemini API request successful', {
            attempt,
            model: modelName,
            responseLength: text.length,
            finishReason
          });

          modelHealth.recordSuccess(modelName);
          this.lastModel = modelName;
          return text;
        } catch (error) {
          const errorInfo = this.analyzeError(error);
          lastError = error;
          modelHealth.recordFailure(modelName, error);

          // Enhanced error logging for fetch failures
          if (errorInfo.type === 'NETWORK_ERROR') {
            logger.error('Network error details', {
              attempt,
              model: modelName,
              errorMessage: error.message,
              errorStack: error.stack,
              errorName: error.name,
              nodeEnv: process.env.NODE_ENV,
              electronVersion: process.versions.electron,
              chromeVersion: process.versions.chrome,
              nodeVersion: process.versions.node,
              userAgent: this.getUserAgent()
            });
          }

          logger.warn(`Gemini API attempt ${attempt} failed for model ${modelName}`, {
            error: error.message,
            errorType: errorInfo.type,
            isNetworkError: errorInfo.isNetworkError,
            suggestedAction: errorInfo.suggestedAction,
            remainingAttempts: maxRetries - attempt,
            model: modelName
          });

          // For model-unavailable / overloaded / rate-limit / retired-model
          // errors, move to the next fallback model immediately instead of
          // burning all retries — a 404/NOT_FOUND means the model is gone
          // and will never succeed no matter how many times it's retried.
          const isModelUnavailable = errorInfo.type === 'RATE_LIMIT_ERROR' ||
            error.message.includes('503') ||
            error.message.includes('UNAVAILABLE') ||
            error.message.includes('high demand') ||
            error.message.includes('404') ||
            error.message.includes('NOT_FOUND') ||
            error.message.includes('no longer available');

          if (isModelUnavailable && modelName !== modelsToTry[modelsToTry.length - 1]) {
            logger.info(`Switching to fallback model after ${modelName} unavailable`, {
              model: modelName,
              error: error.message
            });
            break; // exit retry loop for this model and try next model
          }

          if (attempt === maxRetries) {
            break; // exit retry loop for this model and try next model
          }

          // Use exponential backoff with jitter for network errors
          const baseDelay = errorInfo.isNetworkError ? 2500 : 1500;
          const delay = baseDelay * attempt + Math.random() * 1000;

          logger.debug(`Waiting ${delay}ms before retry ${attempt + 1}`, {
            baseDelay,
            isNetworkError: errorInfo.isNetworkError,
            model: modelName
          });

          if (this._deadlinePassed(deadline, delay)) {
            break; // no time left for this backoff; the budget check above ends the loop
          }
          await this.delay(delay);
        }
      }
    }

    const finalErrorInfo = this.analyzeError(lastError);
    const finalError = new Error(`Gemini API failed after trying ${modelsToTry.join(', ')}: ${lastError?.message}`);
    finalError.errorAnalysis = finalErrorInfo;
    finalError.originalError = lastError;
    throw finalError;
  }

  /**
   * Streaming sibling of processTranscriptionWithIntelligentResponse. Emits
   * incremental text via onDelta so the UI can render the answer as it is
   * generated (much faster perceived latency). Returns the same
   * {response, metadata} shape. Falls back to the non-streaming path on any
   * streaming failure so reliability is never worse than before.
   */
  /**
   * Interviewer answers. A first line "HEARD: a → b" (the model answered b
   * for misheard a) never reaches onDelta or the returned response: it goes
   * to onHeard("a → b") and to metadata.heard. A "CLARIFY: Did you mean …?"
   * reply (a coding request with a genuinely unclear term) never reaches
   * onDelta either: it comes back as metadata.clarify (the question line).
   * Both are spotted in the same first characters that were already held
   * back for HEARD, so a normal answer isn't delayed.
   * A coding answer (its first line is the "**Understanding**" heading) after
   * a HEARD note that names other readings ("a → b | c") is turned into the
   * same question (heardCodingQuestion): the model wasn't sure which change
   * was asked for. onClarify(question) fires as soon as that's known; the
   * unused answer finishes without being shown.
   */
  async processTranscriptionWithIntelligentResponseStream(text, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null, onReset = null, { onHeard = null, onClarify = null } = {}) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check Gemini API key configuration.');
    }

    const startTime = Date.now();
    const deadline = this._newDeadline();
    this.requestCount++;

    // Hold the first characters until it's clear whether they are a HEARD
    // line or a CLARIFY question; then pass everything after it through
    // unchanged. The line after a HEARD note may still be a question.
    let state = 'pending'; // → 'note' (inside the HEARD line) → 'afterNote' → 'pass', or 'clarify'
    let held = '';
    let noteLine = null;
    let gateQuestion = null; // set when a HEARD note + coding answer became a question
    // Everything shown passes the REQ-block filter (system design mode) and
    // then the IMPLEMENT-line filter last.
    const offerFilter = createImplementFilter((d) => { if (typeof onDelta === 'function' && d) onDelta(d); });
    const req = reqStripper();
    const emit = req.wrap((d) => offerFilter.push(d));
    const isCodingStart = (t) => /^\s*\*\*Understanding\*\*/i.test(t);
    const heard = (note) => { if (note && typeof onHeard === 'function') onHeard(note); };

    try {
      const geminiRequest = this.buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (!delta) return;
        if (state === 'pass') return emit(delta);
        held += delta;
        if (state === 'clarify') return;
        if (state === 'pending') {
          const kind = markerState(held, HEARD_PREFIX);
          const ask = clarifyState(held);
          if (ask === 'yes') { state = 'clarify'; return; }
          if (kind === 'maybe' || ask === 'maybe') return;
          if (kind === 'no') { state = 'pass'; emit(held); held = ''; return; }
          state = 'note';
        }
        if (state === 'note') {
          if (!held.includes('\n') && held.length <= 400) return;
          const { note, body } = splitHeardNote(held.includes('\n') ? held : held + '\n');
          noteLine = note;
          held = body;
          state = 'afterNote';
        }
        const ask = clarifyState(held);
        if (ask === 'yes') { state = 'clarify'; return; }
        if (ask === 'maybe') return;
        const gate = isCodingStart(held) ? heardCodingQuestion(noteLine) : null;
        if (gate) {
          gateQuestion = gate;
          state = 'clarify';
          if (typeof onClarify === 'function') onClarify(gate);
          return;
        }
        heard(noteLine);
        state = 'pass';
        emit(held);
        held = '';
      }, deadline, {
        onReset: () => {
          state = 'pending';
          held = '';
          noteLine = null;
          gateQuestion = null;
          req.reset();
          offerFilter.reset();
          if (typeof onReset === 'function') onReset();
        }
      });

      const { note, body: heardBody } = splitHeardNote(fullText);
      const { body: visible, reqLines } = req.split(heardBody);
      const { offer, body } = splitImplementOffer(visible);
      const gate = gateQuestion || (isCodingStart(body) ? heardCodingQuestion(note) : null);
      if (clarifyState(body) === 'yes' || gate) {
        const clarify = gate || clarifyQuestion(body);
        logger.info('Interviewer coding request needs a clarification', { clarify, requestId: this.requestCount });
        return {
          response: '',
          metadata: {
            skill: activeSkill,
            programmingLanguage,
            processingTime: Date.now() - startTime,
            requestId: this.requestCount,
            usedFallback: false,
            streamed: true,
            isTranscriptionResponse: true,
            heard: null,
            clarify
          }
        };
      }

      if (state !== 'pass') {
        // A short answer that ended while still held back.
        heard(note);
        emit(body);
      }
      req.flush();
      offerFilter.flush();
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(body, programmingLanguage)
        : body;

      this._warnIfApproachMissing(finalResponse, { source: 'transcription' });

      logger.logPerformance('LLM transcription streaming', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          streamed: true,
          isTranscriptionResponse: true,
          heard: note,
          implementOffer: offer,
          ...(req.active ? { reqLines } : {})
        }
      };
    } catch (error) {
      logger.warn('Streaming transcription failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      // Non-streaming path returns the same shape; the caller renders it as a
      // single final response.
      const result = await this.processTranscriptionWithIntelligentResponse(text, activeSkill, sessionMemory, programmingLanguage, { deadline });
      const { note, body } = splitHeardNote(result.response);
      const gate = /^\s*\*\*Understanding\*\*/i.test(body) ? heardCodingQuestion(note) : null;
      if (clarifyState(body) === 'yes' || gate) {
        return { ...result, response: '', metadata: { ...result.metadata, heard: null, clarify: gate || clarifyQuestion(body) } };
      }
      heard(note);
      return withImplementOffer(withReqLines({ ...result, response: body, metadata: { ...result.metadata, heard: note } }, req));
    }
  }

  /**
   * Build the "More details" / "Deep reasoning" / "Optimized solution" /
   * conversion request for a previously answered question. Focused on that
   * one exchange: original question → original answer → the ask — no other
   * history, so it stays fast. Uses the record's own profile/language (the
   * ones that produced the original answer), never whatever profile happens
   * to be active now.
   * @param {{kind: string, question: string, answer: string, skill: string,
   *   programmingLanguage: string|null, framework: string, format?: string,
   *   images?: Array<{buffer: Buffer, mimeType: string}>}} record - `format`
   *   is set on a converted solution (its code-formats.js id)
   * @param {'details'|'deep'|'optimized'|string} mode - or 'convert:<format id>'
   */
  /**
   * Context for an expansion's notes: the question asked before this one
   * ("I meant for Speeqr" re-asks it) and this record's own answer, which
   * names the project the question was about.
   */
  _expansionNotesContext(record) {
    return [
      ...(record.prevQuestion ? [{ role: 'user', content: record.prevQuestion }] : []),
      { role: 'model', content: record.answer }
    ];
  }

  buildExpansionRequest(record, mode = 'details') {
    if (!record || !record.answer) {
      throw new Error('Expansion request needs the original answer');
    }

    const skillPrompt = promptLoader.getSkillPrompt(record.skill, record.programmingLanguage, record.framework);
    if (!skillPrompt) {
      throw new Error(`No prompt found for profile: ${record.skill}`);
    }
    const optimized = mode === 'optimized';
    const deep = mode === 'deep';
    // 'convert:<format id>' — the same solution in another code format.
    const convertTo = String(mode).startsWith('convert:') ? codeFormats.getFormat(mode.slice(8)) : null;
    if (String(mode).startsWith('convert:') && !convertTo) {
      throw new Error(`Unknown code format: ${mode}`);
    }

    const images = record.kind === 'image' && Array.isArray(record.images) ? record.images : [];
    const notes = images.length ? '' : this._prepNotes(record.question, record.skill, this._expansionNotesContext(record), { expansion: true });
    // A career answer ("tell me about yourself") got its projects' architecture
    // notes (knowledge/interview/career-walkthrough.md); the layout is restated
    // in the turn because the lite models kept the short behavioral shape when
    // it was only in the system prompt (2026-10-02).
    const career = notes.includes('### Career walkthrough — ');
    const questionParts = images.length
      ? [
          { text: this.formatImageInstruction(record.skill, record.programmingLanguage, { count: images.length, text: record.question }) },
          ...images.flatMap((img, i) => [
            ...(images.length > 1 ? [{ text: `Image ${i + 1} of ${images.length}:` }] : []),
            { inlineData: { data: img.buffer.toString('base64'), mimeType: img.mimeType || 'image/png' } }
          ])
        ]
      : [{ text: (String(record.question || '').trim() || '(question not available)') + notes }];

    const ask = convertTo ? `Convert this solution to ${convertTo.label}.`
      : optimized ? 'Give the optimized solution.'
      // Restated in the turn itself for coding answers: the lite fallback
      // model skipped the reviewed section when it was only in the system
      // prompt (2026-09-28).
      : deep ? (/```/.test(record.answer)
        ? 'Deep reasoning review of this answer, please. Start with `### Solution — … (reviewed)` containing the code above copied verbatim with its deeper Approach, Implementation, step-by-step Complexity and Edge cases; then `### Improved — …` only if a meaningful fix to the same approach exists, otherwise "Possible improvements" bullets.'
        : career ? 'Deep reasoning review of this answer, please: keep my exact `### Company — role, dates` and `#### Project` headings and go deeper on the architecture, key decisions and trade-offs of every project, down to the last one.'
        : 'Deep reasoning review of this answer, please.')
      : career ? 'More details, please: go deeper on the architecture of every project in my answer, down to the last one. Keep my exact `### Company — role, dates` and `#### Project` headings; under each project, a ```text flow, the layers with their libraries and where my features sit, and one **The Why:** line. Much longer than my answer.'
      // An answer with a text flow and no code (architecture / "my work"):
      // the lite models drew a flow in only 3 of 10 More details answers when
      // the rule sat in EXPANSION_NOTE, and once merged the two GORA apps on
      // one line (`TanStack Query / Axios`), so it's restated here (2026-10-02).
      : hasTextFlowOnly(record.answer) ? 'More details, please. Include a ```text flow drawn fresh from the reference notes, not the one above: one hop per line, a separate flow per app (apps that share a backend may meet there, each on its own line), and only that app\'s own tools in it.'
      : 'More details, please.';
    // A converted solution answers the original question in another format;
    // without pinning it, the question ("…in Vue 3") and the Implementation
    // language block pull the model back to the default format.
    const answerFormat = record.format ? codeFormats.getFormat(record.format) : null;
    const formatPin = answerFormat
      ? ` The solution above is in ${answerFormat.label} format (${answerFormat.describe}) — keep that exact format in your answer.`
      : '';

    const request = {
      contents: [
        { role: 'user', parts: questionParts },
        { role: 'model', parts: [{ text: record.answer }] },
        { role: 'user', parts: [{ text: ask + formatPin }] }
      ]
    };
    // Optimized and Deep reasoning are where the deeper reasoning happens:
    // the reasoning models (processExpansionStream) with a real thinking
    // level instead of the normal 'minimal', and room for longer code. A
    // conversion keeps normal thinking but gets the same room (a CDN page is
    // longer than the component it ports).
    const reasoning = config.get('llm.gemini.reasoning') || {};
    this.applyGenerationDefaults(request, optimized || deep ? {
      maxOutputTokens: reasoning.maxOutputTokens || 8192,
      thinkingConfig: { thinkingLevel: reasoning.thinkingLevel || 'medium' }
    } : convertTo ? { maxOutputTokens: 8192 } : {});
    const note = convertTo ? codeFormats.getConvertNote(mode.slice(8), record.programmingLanguage)
      : optimized ? OPTIMIZE_NOTE : deep ? DEEP_REASONING_NOTE : EXPANSION_NOTE;
    request.systemInstruction = { parts: [{ text: skillPrompt + note }] };
    return request;
  }

  /**
   * User-triggered expansion (mode: "More details", "Deep reasoning",
   * "Optimized solution" or 'convert:<id>') of an existing answer. Same
   * streaming, model-fallback and time-budget path as normal answers, but on
   * total failure it throws instead of returning the canned "could you
   * repeat" text — the UI turns that into a retry button. Deep reasoning and
   * Optimized run on the reasoning models (llm.gemini.reasoning) with their
   * own, longer timeouts; the other modes use the normal model.
   */
  async processExpansionStream(record, onDelta = null, mode = 'details', onReset = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check Gemini API key configuration.');
    }

    const startTime = Date.now();
    const reasoning = REASONING_MODES.includes(mode) ? (config.get('llm.gemini.reasoning') || {}) : null;
    const deadline = reasoning && reasoning.requestBudgetMs ? startTime + reasoning.requestBudgetMs : this._newDeadline();
    const modelOptions = reasoning ? { models: reasoning.models, timeoutMs: reasoning.timeoutMs } : {};
    this.requestCount++;

    const geminiRequest = this.buildExpansionRequest(record, mode);
    // System design requirement stage: an expansion of a stage-1 answer may
    // end with the REQ block too; it's never shown.
    const req = reqStripper();
    const onResetAll = () => {
      req.reset();
      if (typeof onReset === 'function') onReset();
    };

    let fullText;
    let streamed = true;
    try {
      // Reasoning models think before their first token, so they get their
      // own first-chunk allowance before moving to the next model.
      fullText = await this.executeStreamingRequest(geminiRequest, req.wrap((delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      }), deadline, reasoning ? { ...modelOptions, firstChunkTimeoutMs: reasoning.firstChunkTimeoutMs, backupFirstChunkTimeoutMs: reasoning.backupFirstChunkTimeoutMs, hedgeAfterMs: reasoning.hedgeAfterMs || 0, onReset: onResetAll } : { onReset: onResetAll });
      req.flush();
    } catch (error) {
      logger.warn('Streaming expansion failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      streamed = false;
      try {
        fullText = await this._executeWithFallback(geminiRequest, deadline, modelOptions);
      } catch (secondError) {
        this.errorCount++;
        throw secondError;
      }
    }

    fullText = req.split(fullText).body;
    const finalResponse = record.programmingLanguage
      ? this.enforceProgrammingLanguage(fullText, record.programmingLanguage)
      : fullText;

    if (mode !== 'details') this._warnIfApproachMissing(finalResponse, { source: 'expansion', mode });

    logger.logPerformance('LLM expansion', startTime, {
      activeSkill: record.skill,
      kind: record.kind,
      mode,
      originalLength: record.answer.length,
      responseLength: finalResponse.length,
      requestId: this.requestCount
    });

    return {
      response: finalResponse,
      metadata: {
        skill: record.skill,
        programmingLanguage: record.programmingLanguage,
        processingTime: Date.now() - startTime,
        requestId: this.requestCount,
        usedFallback: false,
        streamed,
        isExpansion: true,
        expansionMode: mode
      }
    };
  }

  /** Safely pull the text delta out of a streamed Gemini chunk. */
  _extractChunkText(chunk) {
    try {
      const t = chunk && chunk.text;
      if (typeof t === 'string') {
        return t;
      }
    } catch (_) {
      // `.text` getter can throw on non-text parts; fall through to manual read.
    }
    try {
      const parts = (chunk && chunk.candidates && chunk.candidates[0] &&
        chunk.candidates[0].content && chunk.candidates[0].content.parts) || [];
      return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    } catch (_) {
      return '';
    }
  }

  /**
   * Run a streaming Gemini request with the same model-fallback + retry policy
   * as executeRequest. Accumulates and returns the full text; invokes onDelta
   * for each chunk.
   */
  async executeStreamingRequest(geminiRequest, onDelta, deadline = null, { firstChunkTimeoutMs = null, backupFirstChunkTimeoutMs = null, models = null, timeoutMs = null, onReset = null, hedgeAfterMs = null } = {}) {
    const firstChunkMs = firstChunkTimeoutMs || config.get('llm.gemini.firstChunkTimeoutMs') || 0;
    // Normal answer chain only (an explicit model list is the reasoning
    // chain, whose models think for seconds before their first token).
    const hedgeMs = hedgeAfterMs !== null ? hedgeAfterMs : (models ? 0 : (config.get('llm.gemini.hedgeAfterMs') || 0));
    // Models after the first may get a shorter allowance (fast backups).
    const backupFirstChunkMs = backupFirstChunkTimeoutMs || firstChunkMs;
    const maxRetries = config.get('llm.gemini.maxRetries');
    const apiKey = config.getApiKey('GEMINI');
    // Models known to be out of quota / overloaded / silent right now go
    // last (src/core/model-health.js); the first healthy one leads.
    const modelsToTry = modelHealth.order(this._modelsToTry(models));

    // A failed attempt may already have streamed part of an answer to the
    // UI. onReset tells the caller to discard it before the next attempt —
    // or before this call throws and the caller falls back to non-streaming —
    // so a retry never appends to a half answer.
    let emitted = false;
    const emit = (piece) => {
      emitted = true;
      if (typeof onDelta === 'function') onDelta(piece);
    };
    const resetShownText = () => {
      if (!emitted) return;
      emitted = false;
      if (typeof onReset === 'function') onReset();
    };

    let lastError = null;
    let queue = modelsToTry;

    // Hedged first attempt: if the first model sends nothing within hedgeMs,
    // the next one starts in parallel and whichever streams first is shown.
    if (hedgeMs > 0 && (!firstChunkMs || hedgeMs < firstChunkMs) && modelsToTry.length > 1 && !this._deadlinePassed(deadline)) {
      resetShownText();
      try {
        const { text, model } = await this._hedgedAttempt(geminiRequest, modelsToTry[0], modelsToTry[1], emit, {
          apiKey, firstChunkMs, backupFirstChunkMs, hedgeMs, timeoutMs
        });
        modelHealth.recordSuccess(model);
        this.lastModel = model;
        return text;
      } catch (error) {
        lastError = error;
        const tried = error.triedModels || [modelsToTry[0]];
        queue = modelsToTry.filter(m => !tried.includes(m));
        if (!queue.length) {
          resetShownText();
          throw error;
        }
      }
    }

    for (const modelName of queue) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Don't start a new attempt once the request's time budget is spent.
        if (lastError && this._deadlinePassed(deadline)) {
          logger.warn('Gemini time budget exhausted; not starting another attempt', { model: modelName, attempt });
          resetShownText();
          throw lastError;
        }
        resetShownText();
        try {
          const modelFirstChunkMs = modelName === modelsToTry[0] ? firstChunkMs : backupFirstChunkMs;
          const fullText = await this._streamRequestForModel(this._requestForModel(geminiRequest, modelName), modelName, apiKey, emit, modelFirstChunkMs, timeoutMs);

          if (!fullText) {
            throw new Error('Empty streamed response from Gemini API');
          }

          logger.debug('Gemini streaming request successful', {
            attempt,
            model: modelName,
            responseLength: fullText.length
          });

          modelHealth.recordSuccess(modelName);
          this.lastModel = modelName;
          return fullText;
        } catch (error) {
          const errorInfo = this.analyzeError(error);
          lastError = error;
          modelHealth.recordFailure(modelName, error);

          logger.warn(`Gemini streaming attempt ${attempt} failed for model ${modelName}`, {
            error: error.message,
            errorType: errorInfo.type,
            remainingAttempts: maxRetries - attempt,
            model: modelName
          });

          // A stalled model (nothing streamed) or one that broke off
          // mid-answer goes straight to the next model; retrying the same
          // one would likely do it again.
          const isModelUnavailable = error.firstChunkTimeout || error.incompleteStream ||
            errorInfo.type === 'RATE_LIMIT_ERROR' ||
            error.message.includes('503') ||
            error.message.includes('UNAVAILABLE') ||
            error.message.includes('high demand') ||
            error.message.includes('404') ||
            error.message.includes('NOT_FOUND') ||
            error.message.includes('no longer available');

          if (isModelUnavailable && modelName !== queue[queue.length - 1]) {
            break; // try next fallback model
          }

          if (attempt === maxRetries) {
            break;
          }

          const baseDelay = errorInfo.isNetworkError ? 2500 : 1500;
          const delay = baseDelay * attempt + Math.random() * 1000;
          if (this._deadlinePassed(deadline, delay)) {
            break; // no time left for this backoff; the budget check above ends the loop
          }
          await this.delay(delay);
        }
      }
    }

    resetShownText();
    throw lastError || new Error('Gemini streaming request failed');
  }

  /**
   * One attempt raced across two models: `primary` starts now, `backup` after
   * hedgeMs of silence from it (or right away if `primary` fails first). The
   * first model to stream text wins and is the only one shown; the other is
   * aborted. A primary that lost this way is recorded as silent, so the next
   * questions skip it and the background probe (model-monitor.js) brings it
   * back. Rejects with `triedModels` — the models that really failed — so the
   * caller continues with the rest of the chain.
   * @returns {Promise<{text: string, model: string}>}
   */
  _hedgedAttempt(geminiRequest, primary, backup, emit, { apiKey, firstChunkMs, backupFirstChunkMs, hedgeMs, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const runs = new Map(); // model → { abort, settled }
      const failed = [];
      let winner = null;
      let lastError = null;
      let finished = false;
      let hedgeTimer = null;

      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        if (hedgeTimer) clearTimeout(hedgeTimer);
        fn(value);
      };
      const running = () => [...runs.values()].filter(r => !r.settled).length;
      const failAll = () => {
        const err = lastError || new Error('Hedged Gemini request failed');
        err.triedModels = [...failed];
        finish(reject, err);
      };
      const onFailure = (model) => {
        if (!winner && model === primary) start(backup, backupFirstChunkMs);
        if (!running()) failAll();
      };

      const start = (model, fcMs) => {
        if (runs.has(model) || finished) return;
        const run = { abort: null, settled: false };
        runs.set(model, run);
        if (model === backup) {
          logger.info('Primary model slow or failing; starting the backup', { primary, backup, afterMs: hedgeMs });
        }
        this._streamRequestForModel(this._requestForModel(geminiRequest, model), model, apiKey, (piece) => {
          if (!winner) {
            winner = model;
            if (hedgeTimer) { clearTimeout(hedgeTimer); hedgeTimer = null; }
            for (const [other, r] of runs) {
              if (other === model || r.settled) continue;
              r.settled = true;
              if (r.abort) r.abort();
              if (other === primary) {
                // Lost the race without sending anything: treat like a silent
                // model (and don't retry it if the winner breaks off later).
                failed.push(primary);
                modelHealth.recordFailure(primary, Object.assign(new Error(`No response from ${primary} before ${backup} answered (hedged)`), { firstChunkTimeout: true }));
              }
            }
            if (model === backup) logger.info('Backup model answered first', { primary, backup });
          }
          if (winner === model) emit(piece);
        }, fcMs, timeoutMs, (abort) => { run.abort = abort; })
          .then((text) => {
            run.settled = true;
            if (winner === model && text) {
              finish(resolve, { text, model });
              return;
            }
            if (winner && winner !== model) return;
            lastError = new Error('Empty streamed response from Gemini API');
            failed.push(model);
            onFailure(model);
          })
          .catch((error) => {
            if (error && error.aborted) return;
            run.settled = true;
            if (winner && winner !== model) return;
            lastError = error;
            failed.push(model);
            modelHealth.recordFailure(model, error);
            logger.warn(`Gemini streaming attempt 1 failed for model ${model}`, { error: error.message, model, hedged: true });
            if (winner === model) {
              failAll(); // broke off mid-answer; the other run was already aborted
              return;
            }
            onFailure(model);
          });
      };

      start(primary, firstChunkMs);
      hedgeTimer = setTimeout(() => {
        hedgeTimer = null;
        if (!winner) start(backup, backupFirstChunkMs);
      }, hedgeMs);
    });
  }

  /**
   * Tiny request that tells whether a model answers quickly right now (used by
   * src/services/model-monitor.js so a real question never has to find out).
   * Records the result in model health.
   * @returns {Promise<{ok: boolean, ms: number, error?: string, recorded?: boolean}>}
   */
  async probeModel(model) {
    const probe = config.get('llm.gemini.probe') || {};
    const apiKey = config.getApiKey('GEMINI');
    // A model only in the reasoning chain (Deep reasoning / Optimized) is a
    // thinking model: it gets the smallest thinking level instead of budget 0
    // (a 400 is never recorded, so a rejected probe would never bring it back)
    // and a little longer to its first chunk.
    const reasoningOnly = !this._modelsToTry().includes(model)
      && ((config.get('llm.gemini.reasoning') || {}).models || []).includes(model);
    const request = this._requestForModel({
      contents: [{ role: 'user', parts: [{ text: 'Say hi.' }] }],
      generationConfig: { maxOutputTokens: 16, thinkingConfig: reasoningOnly ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 } }
    }, model);
    const firstChunkMs = reasoningOnly
      ? (probe.reasoningFirstChunkTimeoutMs || 8000)
      : (probe.firstChunkTimeoutMs || 5000);
    const t0 = Date.now();
    try {
      await this._streamRequestForModel(request, model, apiKey, null, firstChunkMs, probe.timeoutMs || 10000);
      const ms = Date.now() - t0;
      modelHealth.recordSuccess(model);
      logger.info('Model probe answered', { model, ms });
      return { ok: true, ms };
    } catch (error) {
      const ms = Date.now() - t0;
      const verdict = modelHealth.recordFailure(model, error);
      logger.info('Model probe failed', { model, ms, error: String(error.message).slice(0, 160), recorded: !!verdict });
      return { ok: false, ms, error: String(error.message).slice(0, 200), recorded: !!verdict };
    }
  }

  _streamRequestForModel(geminiRequest, modelName, apiKey, onDelta, firstChunkMs = 0, timeoutMs = null, onRequest = null) {
    const https = require('https');
    const timeout = timeoutMs || config.get('llm.gemini.timeout');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse`;
    const postData = JSON.stringify(geminiRequest);
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': this.getUserAgent()
      },
      timeout,
      agent
    };

    return new Promise((resolve, reject) => {
      // Nothing received within firstChunkMs → give up on this model (see
      // llm.gemini.firstChunkTimeoutMs). Cleared by the first byte, so a
      // long answer that is already streaming is never cut off.
      let firstChunkTimer = null;
      const clearFirstChunkTimer = () => {
        if (firstChunkTimer) { clearTimeout(firstChunkTimer); firstChunkTimer = null; }
      };
      // Set once the promise is decided, so a later 'end'/'error' from the
      // destroyed request can't log or settle a second outcome.
      let settled = false;
      const req = https.request(url, options, (res) => {
        if (res.statusCode !== 200) {
          clearFirstChunkTimer();
          let errBody = '';
          res.on('data', (c) => { errBody += c; });
          res.on('end', () => {
            if (settled) return;
            settled = true;
            reject(new Error(`HTTP ${res.statusCode}: ${errBody}`));
          });
          return;
        }

        let fullText = '';
        let buffer = '';
        // How the stream ended. Gemini can fail AFTER answering 200 and
        // streaming part of the answer: it sends an {"error": {...}} event
        // (e.g. 503 "high demand") and closes with no finishReason. Reading
        // only the text used to return that half answer as a success
        // (reproduced on gemini-3.6-flash 2026-09-28, ~2k of 8192 tokens).
        let finishReason = null;
        let usage = null;
        const fail = (err) => {
          if (settled) return;
          settled = true;
          clearFirstChunkTimer();
          reject(err);
          req.destroy();
        };

        const handleLine = (rawLine) => {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) {
            return;
          }
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') {
            return;
          }
          let json;
          try {
            json = JSON.parse(payload);
          } catch (_) {
            // Partial JSON across chunk boundaries is rare with line framing;
            // skip anything that doesn't parse cleanly.
            return;
          }
          if (json.error) {
            const code = json.error.code || 'unknown';
            const err = new Error(`HTTP ${code} (mid-stream, after ${fullText.length} chars): ${json.error.message || json.error.status || 'stream error'}`);
            err.incompleteStream = true;
            fail(err);
            return;
          }
          const candidate = json.candidates && json.candidates[0];
          if (candidate && candidate.finishReason) finishReason = candidate.finishReason;
          if (json.usageMetadata) usage = json.usageMetadata;
          const piece = this._extractChunkText(json);
          if (piece) {
            fullText += piece;
            if (typeof onDelta === 'function') {
              onDelta(piece);
            }
          }
        };

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          clearFirstChunkTimer();
          if (settled) return;
          buffer += chunk;
          let idx;
          while (!settled && (idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            handleLine(line);
          }
        });

        res.on('end', () => {
          clearFirstChunkTimer();
          if (settled) return;
          if (buffer.trim()) handleLine(buffer);
          if (settled) return;
          const details = {
            model: modelName,
            finishReason,
            chars: fullText.length,
            outputTokens: usage ? usage.candidatesTokenCount : undefined,
            thoughtsTokens: usage ? usage.thoughtsTokenCount : undefined,
            promptTokens: usage ? usage.promptTokenCount : undefined,
            maxOutputTokens: geminiRequest.generationConfig && geminiRequest.generationConfig.maxOutputTokens
          };
          if (!finishReason) {
            // Closed without saying it was done: an incomplete answer, never
            // a success — the caller moves on to the next model.
            logger.warn('Gemini stream ended without a finishReason (incomplete answer)', details);
            const err = new Error(`HTTP 503 (incomplete stream: ended without finishReason after ${fullText.length} chars)`);
            err.incompleteStream = true;
            settled = true;
            reject(err);
            return;
          }
          if (finishReason === 'MAX_TOKENS') {
            // A real token-limit cut: kept (retrying would hit the same
            // limit), but logged so it shows up in the logs with its cause.
            logger.warn('Gemini answer hit maxOutputTokens and is cut off', details);
          } else if (finishReason !== 'STOP') {
            logger.warn('Gemini stream finished with an unusual finishReason', details);
          } else {
            logger.info('Gemini stream finished', details);
          }
          settled = true;
          resolve(fullText.trim());
        });
        res.on('error', (error) => {
          clearFirstChunkTimer();
          if (settled) return;
          settled = true;
          reject(new Error(`Streaming response error: ${error.message}`));
        });
      });

      if (firstChunkMs > 0) {
        firstChunkTimer = setTimeout(() => {
          firstChunkTimer = null;
          if (settled) return;
          settled = true;
          const err = new Error(`No response from ${modelName} within ${Math.round(firstChunkMs / 1000)}s (first-chunk timeout)`);
          err.firstChunkTimeout = true;
          reject(err);
          req.destroy();
        }, firstChunkMs);
      }

      // Lets a hedged race cancel the attempt it no longer needs.
      if (typeof onRequest === 'function') {
        onRequest(() => {
          clearFirstChunkTimer();
          if (settled) return;
          settled = true;
          req.destroy();
          reject(Object.assign(new Error(`Streaming request to ${modelName} aborted`), { aborted: true }));
        });
      }

      req.on('error', (error) => {
        clearFirstChunkTimer();
        if (settled) return;
        settled = true;
        reject(new Error(`Streaming request failed: ${error.message}`));
      });
      req.on('timeout', () => {
        clearFirstChunkTimer();
        if (settled) return;
        settled = true;
        // No data for `timeout` ms, possibly mid-answer: treated like a
        // broken stream so the next model is tried.
        const err = new Error('Streaming request timeout');
        err.incompleteStream = true;
        req.destroy();
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  async performPreflightCheck() {
    // Quick connectivity check
    try {
      const startTime = Date.now();
      await this.testNetworkConnection({ 
        host: 'generativelanguage.googleapis.com', 
        port: 443, 
        name: 'Gemini API Endpoint' 
      });
      const latency = Date.now() - startTime;
      
      logger.debug('Preflight check passed', { latency });
    } catch (error) {
      logger.warn('Preflight check failed', { 
        error: error.message,
        suggestion: 'Network connectivity issue detected before API call'
      });
      // Don't throw here - let the actual API call fail with more detail
    }
  }

  getUserAgent() {
    try {
      // Try to get user agent from Electron if available
      if (typeof navigator !== 'undefined' && navigator.userAgent) {
        return navigator.userAgent;
      }
      return `Node.js/${process.version} (${process.platform}; ${process.arch})`;
    } catch {
      return 'Unknown';
    }
  }

  analyzeError(error) {
    const errorMessage = error.message.toLowerCase();
    
    // Network connectivity errors
    if (errorMessage.includes('fetch failed') || 
        errorMessage.includes('network error') ||
        errorMessage.includes('enotfound') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('timeout')) {
      return {
        type: 'NETWORK_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check internet connection and firewall settings'
      };
    }
    
    // API key errors
    if (errorMessage.includes('unauthorized') || 
        errorMessage.includes('invalid api key') ||
        errorMessage.includes('forbidden')) {
      return {
        type: 'AUTH_ERROR',
        isNetworkError: false,
        suggestedAction: 'Verify Gemini API key configuration'
      };
    }
    
    // Rate limiting
    if (errorMessage.includes('quota') || 
        errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests')) {
      return {
        type: 'RATE_LIMIT_ERROR',
        isNetworkError: false,
        suggestedAction: 'Wait before retrying or check API quota'
      };
    }
    
    // Timeout errors
    if (errorMessage.includes('request timeout') || errorMessage.includes('etimedout')) {
      return {
        type: 'TIMEOUT_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check network latency or increase timeout'
      };
    }
    
    return {
      type: 'UNKNOWN_ERROR',
      isNetworkError: false,
      suggestedAction: 'Check logs for more details'
    };
  }

  async checkNetworkConnectivity() {
    const connectivityTests = [
      { host: 'google.com', port: 443, name: 'Google (HTTPS)' },
      { host: 'generativelanguage.googleapis.com', port: 443, name: 'Gemini API Endpoint' }
    ];

    const results = await Promise.allSettled(
      connectivityTests.map(test => this.testNetworkConnection(test))
    );

    const connectivity = {
      timestamp: new Date().toISOString(),
      tests: results.map((result, index) => ({
        ...connectivityTests[index],
        success: result.status === 'fulfilled' && result.value,
        error: result.status === 'rejected' ? result.reason.message : null
      }))
    };

    logger.info('Network connectivity check completed', connectivity);
    return connectivity;
  }

  async testNetworkConnection({ host, port, name }) {
    return new Promise((resolve, reject) => {
      const net = require('net');
      const socket = new net.Socket();
      
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${host}:${port}`));
      }, 5000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Connection failed to ${host}:${port}: ${error.message}`));
      });

      socket.connect(port, host);
    });
  }

  generateFallbackResponse(text, activeSkill) {
    logger.info('Generating fallback response', { activeSkill });

    const fallbackResponses = {
      'dsa': 'This appears to be a data structures and algorithms problem. Consider breaking it down into smaller components and identifying the appropriate algorithm or data structure to use.',
      'system-design': 'For this system design question, consider scalability, reliability, and the trade-offs between different architectural approaches.',
      'programming': 'This looks like a programming challenge. Focus on understanding the requirements, edge cases, and optimal time/space complexity.',
      'default': 'I can help analyze this content. Please ensure your Gemini API key is properly configured for detailed analysis.'
    };

    const response = fallbackResponses[activeSkill] || fallbackResponses.default;
    
    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true
      }
    };
  }

  generateIntelligentFallbackResponse(text, activeSkill) {
    logger.info('Generating intelligent fallback response for transcription', { activeSkill });

    // This only runs when the actual Gemini API call threw (network/API
    // failure) — it's an honest "something went wrong" message, not a
    // relevance judgment. It used to guess relevance from skill-specific
    // keywords and fall back to a "not relevant" refusal when nothing
    // matched, which could misfire on real questions (e.g. "explain merge
    // sort" has no question word/'?') and silently violate "never refuse."
    // This is the one code path that bypasses prompt construction entirely
    // (the API call itself failed, so there's no systemInstruction to
    // append a language block to) — it needs its own language-aware copy so
    // Japanese mode doesn't silently break here.
    const response = responseLanguage.getFallbackMessage();

    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true,
        isTranscriptionResponse: true
      }
    };
  }

  async testConnection() {
    if (!this.isInitialized) {
      return { success: false, error: 'Service not initialized' };
    }

    try {
      // First check network connectivity
      const networkCheck = await this.checkNetworkConnectivity();
      const hasNetworkIssues = networkCheck.tests.some(test => !test.success);
      
      if (hasNetworkIssues) {
        logger.warn('Network connectivity issues detected', networkCheck);
      }

      const generationConfig = this.getGenerationConfig({ temperature: 0, maxOutputTokens: 64 });
      const modelsToTry = this._modelsToTry();

      let lastError = null;
      let result = null;
      let usedModel = null;

      for (const modelName of modelsToTry) {
        try {
          const startTime = Date.now();
          result = await this.client.models.generateContent({
            model: modelName,
            contents: 'Test connection. Please respond with "OK".',
            config: generationConfig
          });
          usedModel = modelName;
          const latency = Date.now() - startTime;
          const { text } = this.extractTextFromCandidates(result);

          logger.info('Connection test successful', {
            response: text,
            latency,
            model: usedModel,
            networkCheck: hasNetworkIssues ? 'issues_detected' : 'healthy'
          });

          return {
            success: true,
            response: text,
            latency,
            model: usedModel,
            networkConnectivity: networkCheck
          };
        } catch (error) {
          lastError = error;
          logger.warn(`Connection test failed for model ${modelName}`, {
            error: error.message,
            model: modelName
          });

          const isModelUnavailable = error.message.includes('503') ||
            error.message.includes('UNAVAILABLE') ||
            error.message.includes('high demand') ||
            error.message.includes('quota') ||
            error.message.includes('rate limit') ||
            error.message.includes('404') ||
            error.message.includes('NOT_FOUND') ||
            error.message.includes('no longer available');

          if (!isModelUnavailable && modelName === this.model) {
            // Primary model failed for a non-availability reason; don't hide it
            break;
          }
        }
      }

      throw lastError || new Error('Connection test failed on all models');
    } catch (error) {
      const errorAnalysis = this.analyzeError(error);
      logger.error('Connection test failed', {
        error: error.message,
        errorAnalysis
      });

      // Map raw SDK errors to user-friendly messages. The wizard only
      // surfaces `error`, so any raw SDK error string would land in the
      // UI verbatim.
      const friendlyError = this._friendlyTestError(error, errorAnalysis);

      return {
        success: false,
        error: friendlyError,
        errorType: errorAnalysis?.type || 'UNKNOWN',
        errorAnalysis,
        networkConnectivity: await this.checkNetworkConnectivity().catch(() => null)
      };
    }
  }

  /**
   * Translate raw SDK / network errors into something a user can act on.
   */
  _friendlyTestError(error, analysis) {
    const type = analysis?.type;
    const raw = (error?.message || '').toLowerCase();

    if (type === 'NETWORK_ERROR' || raw.includes('fetch failed') || raw.includes('enotfound')) {
      return 'Cannot reach Google servers. Check your internet connection, firewall, or VPN settings.';
    }
    if (type === 'AUTH_ERROR' || raw.includes('api key') || raw.includes('401') || raw.includes('403')) {
      return 'Invalid API key or insufficient permissions. Double-check the key at aistudio.google.com/apikey.';
    }
    if (type === 'RATE_LIMIT_ERROR' || raw.includes('429') || raw.includes('quota')) {
      return 'Rate limit or quota exceeded. Wait a moment or check your Google Cloud billing.';
    }
    if (type === 'TIMEOUT_ERROR') {
      return 'Request timed out. The Google API may be slow or unreachable right now.';
    }
    if (type === 'MODEL_ERROR' || raw.includes('model') || raw.includes('404')) {
      return 'The configured Gemini model is unavailable. Try a different model in Settings.';
    }
    if (raw.includes('503') || raw.includes('unavailable') || raw.includes('high demand')) {
      return 'Gemini is experiencing high demand. Please wait a moment and try again.';
    }
    // Fall back to a stripped-down raw message (no SDK prefix noise)
    return (error?.message || 'Connection failed').replace(/^\[(GoogleGenerativeAI|GoogleGenAI) Error\]:\s*/i, '');
  }

  updateApiKey(newApiKey) {
    process.env.GEMINI_API_KEY = newApiKey;
    this.isInitialized = false;
    this.initializeClient();
    
    logger.info('API key updated and client reinitialized');
  }

  getStats() {
    return {
      isInitialized: this.isInitialized,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      successRate: this.requestCount > 0 ? ((this.requestCount - this.errorCount) / this.requestCount) * 100 : 0,
      config: config.get('llm.gemini')
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async executeAlternativeRequest(geminiRequest, deadline = null, { models = null, timeoutMs = null } = {}) {
    const apiKey = config.getApiKey('GEMINI');
    // Models known to be out of quota / overloaded / silent right now go
    // last (src/core/model-health.js); the first healthy one leads.
    const modelsToTry = modelHealth.order(this._modelsToTry(models));
    const primaryModel = modelsToTry[0];

    logger.info('Using alternative HTTPS request method', { modelsToTry });

    let lastError = null;

    for (const modelName of modelsToTry) {
      if (lastError && this._deadlinePassed(deadline)) {
        logger.warn('Gemini time budget exhausted; not trying further models', { model: modelName });
        break;
      }
      try {
        const result = await this._executeAlternativeRequestForModel(this._requestForModel(geminiRequest, modelName), modelName, apiKey, timeoutMs);
        modelHealth.recordSuccess(modelName);
        this.lastModel = modelName;
        return result;
      } catch (error) {
        lastError = error;
        modelHealth.recordFailure(modelName, error);
        logger.warn(`Alternative HTTPS request failed for model ${modelName}`, {
          error: error.message,
          model: modelName
        });

        // Quota errors (429) count too, as on the streaming path: a primary
        // out of quota used to stop this whole chain, so no backup was tried.
        const isModelUnavailable = error.message.includes('503') ||
          error.message.includes('429') ||
          error.message.includes('RESOURCE_EXHAUSTED') ||
          error.message.includes('UNAVAILABLE') ||
          error.message.includes('high demand') ||
          error.message.includes('404') ||
          error.message.includes('NOT_FOUND') ||
          error.message.includes('no longer available');

        if (!isModelUnavailable && modelName === primaryModel) {
          break;
        }
      }
    }

    throw lastError || new Error('Alternative HTTPS request failed for all models');
  }

  async _executeAlternativeRequestForModel(geminiRequest, modelName, apiKey, timeoutMs = null) {
    const https = require('https');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    const postData = JSON.stringify(geminiRequest);

    const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': this.getUserAgent()
      },
      timeout: timeoutMs || config.get('llm.gemini.timeout'),
      agent
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }
            
            const response = JSON.parse(data);
            
            logger.debug('Alternative request response structure', {
              hasResponse: !!response,
              hasCandidates: !!response.candidates,
              candidatesLength: response.candidates?.length,
              responseKeys: Object.keys(response || {}),
              firstCandidateKeys: response.candidates?.[0] ? Object.keys(response.candidates[0]) : []
            });

            const { text, finishReason } = this.extractTextFromCandidates(response);

            if (finishReason === 'MAX_TOKENS') {
              logger.warn('Gemini alternative response reached max tokens limit', {
                finishReason
              });
            }
            
            logger.info('Alternative request successful', {
              responseLength: text.length,
              statusCode: res.statusCode,
              finishReason
            });
            
            resolve(text.trim());
          } catch (parseError) {
            logger.error('Failed to parse alternative response', {
              error: parseError.message,
              rawResponse: data.substring(0, 500),
              statusCode: res.statusCode
            });
            reject(new Error(`Failed to parse response: ${parseError.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(new Error(`Alternative request failed: ${error.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Alternative request timeout'));
      });
      
      req.write(postData);
      req.end();
    });
  }
}

module.exports = new LLMService();