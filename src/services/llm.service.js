const { GoogleGenAI } = require('@google/genai');
const logger = require('../core/logger').createServiceLogger('LLM');
const config = require('../core/config');
const { promptLoader } = require('../../prompt-loader');
const responseLanguage = require('../core/response-language');
const { matchKnowledge } = require('../core/knowledge');
const { getComparisonNote } = require('../core/answer-format');
const codeFormats = require('../core/code-formats');
const modelHealth = require('../core/model-health');

// Appended (last) to the active profile prompt (prompts/<profile>.md) for
// voice requests only. The profile prompt stays authoritative for content
// and style; this covers what's specific to live-transcript input — most
// importantly that spoken questions are answered in words, not code.
const VOICE_TRANSCRIPT_NOTE = `

## Live Transcript Input (overrides the sections above for this message)
The user turn is a live speech-to-text transcript of what the interviewer just said. It may be fragmentary, run two sentences together, or contain misheard words — infer the intended question from the wording and the conversation so far, and answer that.
- MISHEARD TECHNICAL TERMS: speech recognition often turns a technical term into a sound-alike word, number or name. Before answering, read any word that doesn't fit a technical interview as the technical term that sounds like it, preferring the selected framework, the profile's stack and the topic of the conversation. Examples: "V4" / "V for" → \`v-for\`, "V if" → \`v-if\`, "V model" → \`v-model\`, "V bind" → \`v-bind\`, "View JS" / "ViewJS" → Vue.js, "composition a p i" → Composition API, "ZulStrand" / "Zoo stand" → Zustand, "Redex" → Redux, "VFF" → BFF, "use effect" → \`useEffect\`, "collagens" → Coroutines. "in a loop" / "Inalou" next to \`v-for\` means "in a loop" / "in the loop" of a Vue template. Answer the corrected question directly; do not mention the mishearing or ask what they meant unless no reading makes technical sense.
- DEFAULT FOR SPOKEN QUESTIONS: a verbal, skimmable answer with NO code blocks. This applies to "what is X", "how does X work", "why X", "how would you handle/approach/design X", "how did you do/handle/solve X", "tell me about X" and experience/project questions — explain in words; if a class, function, or library name helps, put it inline as a short code-highlighted span, never a fenced code block.
- Only include a code block when the interviewer explicitly asks you to write, code, implement, or show code, reads out a concrete coding/algorithm problem to solve (e.g. "write a function that reverses a linked list"), asks you to fix/modify specific code, or asks to change or redo code from an earlier answer (e.g. "now do it in Vue"). Then use the coding format above.
- For an explicit system-design question ("design X"), a short text flow diagram is fine — that is not code.
- Pure social small talk with no technical content (e.g. a bare "hello", "how are you", "can you hear me") gets a brief, natural one-line reply, then stop.
- Anything with technical content or an actual question in it gets a real answer — never dismiss it as "not relevant."`;

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
  - Behavioral/personal: expand ONLY with information actually present in the Candidate Background / Personal & Interview Notes above. Never invent companies, projects, responsibilities, achievements, opinions, or experiences — if nothing more is available, add depth on reasoning/approach instead of new facts.
  - My own project / architecture (e.g. "tell me more about your work at GORA", "walk me through GORA"): the deep, readable walkthrough of the same topic. Build on the original answer without reprinting it. Open with one or two lines of context (the product, and what the walkthrough covers), then follow the flow layer by layer the way a request travels (e.g. user → frontend → API layer → BFF → services → data → back to the UI); on the Frontend profile the frontend layers get the most depth. Give each layer a \`###\` heading, and \`####\` sub-headings for its main parts when it has several (e.g. rendering, state, forms). Under them, write 2-4 bullets of simple, complete first-person sentences that are easy to read out loud: what the layer does, which libraries we used there, how data moves on to the next layer, and where my own work fits. Add a **The Why:** line only where a decision is worth explaining — why we chose or added it (e.g. Sentry: what it catches and why we added it) — not on every layer. For a "my work" question, keep the walkthrough anchored on the features I built and show where each one sits in the flow. Add a \`\`\`text flow when it helps follow the data. No label-only fragments such as "Technologies: X, Y" or one-line bullets per field. Use the reference notes and never contradict them (e.g. don't relabel the stack with technologies the notes don't name) or blur separate systems (e.g. the GORA customer platform vs the B2B portal). Substantially deeper than the original answer, still skimmable.
- When the original answer has no code, include code only when it materially helps (e.g. the question explicitly asked for code); otherwise explain in words.
- The original question may be a live speech-to-text transcript (possibly misheard) — interpret it the same way the original answer did.`;

// Appended to the active profile prompt ONLY for a user-triggered "Optimized
// solution" request (processExpansionStream with mode 'optimized'). Normal
// answers give one simple solution (answer-format.js); this is the only path
// that produces the optimized one.
const OPTIMIZE_NOTE = `

## Optimized Solution Request (overrides "Give ONE solution" for this message)
The conversation contains the original question and the first solution already given. Give the optimized version of that solution — think it through more deeply than the first answer.
- What "optimized" means depends on the problem:
  - DSA/algorithm problem: better time/space complexity (name the technique and why it's faster), or say why the current one is already optimal.
  - Frontend, backend or mobile implementation (Vue, React, Spring, Node, Android…): not Big-O — the best industry-standard way to build it, using the established patterns and APIs of the framework and version in use instead of custom mechanisms: correctness and realistic edge cases, race conditions and cleanup, error handling, maintainability, concise idiomatic code (lambdas, built-ins).
  - Add caching, better state management or abstractions only when they meaningfully improve this problem; stay proportionate to the interview question.
- Build on the first solution inside the same given code/signature (see "Working inside given code"); don't switch to a different architecture.
- Use the same Coding answer format with the heading \`### Optimized — <short name>\`: Understanding = one line on what's being improved; Approach = each improvement, the concrete problem it prevents, and how; numbered \`(n)\` code comments matching the Implementation points, with new or changed lines marked, e.g. \`// (2) NEW: <what changed>\`; Complexity compares with the first solution; Example flow shows the same input before → after the improvement.
- If the first solution is already optimal and follows best practice, say so in one line and list only refinements that genuinely matter — no micro-optimizations or engine-specific tweaks.`;

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
- Use the Candidate Background, Personal / Interview Notes, reference notes, selected framework/language and the conversation only where relevant to this question. Never invent experience, projects, companies, metrics or responsibilities to make the answer sound stronger; don't dump unrelated project details.

### Theory, "how does it work", architecture and my own project work
Use only the sections that fit the question, in this order:
- **How it works** — definition and the mechanism, step by step.
- **Architecture / data flow** — when the question is about a system or a project: the flow layer by layer the way a request travels, with a \`\`\`text diagram (boxes and arrows) when it helps.
- **Technologies and responsibilities** — what each important technology does in this system and why it's there.
- **Design decisions** — each with a **The Why:** line (the problem it solves and what the alternative would have cost).
- **Trade-offs and failure cases** — plus scalability, performance, security, testing and operations only where they actually matter for this question.
- **Pitfalls** and a short **real-world example** or my relevant experience.
For my own project work, keep three things clearly apart with these labels: **What the project used** (facts from the notes), **What I built** (only work the notes attribute to me), **Inference** (reasonable architectural reasoning not stated in the notes — say so).

### Coding answers (the answer contains code)
Review, don't redesign — a different algorithm or complexity class is what the separate "Optimized solution" button is for. ALWAYS use exactly this structure: the first line of the response is the \`### Solution — … (reviewed)\` heading below, then optionally one \`### Improved — …\` section — no other top-level headings, and no section about what was wrong with a "previous"/"original" answer (weaknesses go in Edge cases).
- Keep the exact format, framework, API style (e.g. Options API vs Composition API, CDN page vs SFC), language, names and signature of the given solution and of any code shown in the question. Don't rewrite surrounding code.
- \`### Solution — <same short name> (reviewed)\` — Understanding (1-2 lines), then **Approach** as a concise thought process (numbered steps), then the SAME code copied verbatim with its same numbered \`(n)\` comments (don't edit, renumber or add lines — fixes belong in Improved), then **Implementation**: every \`(n)\` explained, including the language/framework features involved (closures, reactivity, hooks, async/await…) where they're non-obvious or likely follow-ups. Then **Complexity** derived step by step — each step names the line(s) responsible, quoted as inline code, and the totals follow from them (time, then space). Then **Edge cases** it handles or misses.
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

    const parts = [{ text: this.formatImageInstruction(activeSkill, programmingLanguage, { count: images.length, text }) }];
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

    try {
      const fullText = await this.executeStreamingRequest(request, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      }, deadline, { onReset });

      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

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
          ...this._imageMetadata(images)
        }
      };
    } catch (error) {
      logger.warn('Streaming image analysis failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      return this.processImageWithSkill(images, activeSkill, programmingLanguage, { text, deadline, request });
    }
  }

  formatImageInstruction(activeSkill, programmingLanguage, { count = 1, text = '' } = {}) {
    const langNote = programmingLanguage ? ` If code is warranted, use only ${programmingLanguage.toUpperCase()} for it.` : '';
    const intro = count > 1
      ? `These ${count} screenshots were taken during a ${activeSkill.toUpperCase()} interview. They are sequential parts of ONE interviewer question, in order (Image 1 → Image ${count}) — e.g. a scrolled page, or a description in one image and the code/signature or extra requirements in another. Read them all together and give one answer; don't answer them separately.`
      : `This screenshot was taken during a ${activeSkill.toUpperCase()} interview.`;
    const typed = String(text || '').trim();
    const typedNote = typed ? ` The candidate also typed this about it — treat it as more context for the same question: "${typed}".` : '';
    return `${intro}${typedNote} First identify what is being asked, what code/environment is already shown or handled by the platform, which part you must implement, which function/component/signature must be kept, and whether this modifies an earlier solution — then answer inside that structure. Determine what it actually shows: a conceptual/behavioral question, a coding/implementation problem, or existing code to review/debug/explain. Then respond appropriately for that content — a conceptual question gets a plain-language answer with no code block; a coding problem or a request to modify/debug existing code gets the relevant code. If no explicit question is visible, answer what it most likely asks (e.g. implement the shown stub, or explain/fix the shown code). Do not add a code block just because this is a screenshot.${langNote}`;
  }

  async processTextWithSkill(text, activeSkill, sessionMemory = [], programmingLanguage = null, { deadline = null } = {}) {
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

      const geminiRequest = this.buildGeminiRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const response = await this._executeWithFallback(geminiRequest, deadline);
      
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

  async processTextWithSkillStream(text, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null, onReset = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check Gemini API key configuration.');
    }

    const startTime = Date.now();
    const deadline = this._newDeadline();
    this.requestCount++;

    try {
      const geminiRequest = this.buildGeminiRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      }, deadline, { onReset });

      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

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
          streamed: true
        }
      };
    } catch (error) {
      logger.warn('Streaming text failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      return this.processTextWithSkill(text, activeSkill, sessionMemory, programmingLanguage, { deadline });
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
      // Framework formats keep their own tag (Vue SFC, TSX/JSX, CDN html page).
      const keepTags = new Set(['text', 'plaintext', 'txt', 'diff', 'bash', 'sh', 'shell', 'console', 'sql', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'vue', 'tsx', 'jsx']);

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

  buildGeminiRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    // Check if we have the new conversation history format
    const sessionManager = require('../managers/session.manager');
    
    if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
      const conversationHistory = sessionManager.getConversationHistory(15);
      const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
      return this.buildGeminiRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage);
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

  buildGeminiRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage) {
    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Use the skill prompt from context (which may already include programming language)
    if (skillContext.skillPrompt) {
      request.systemInstruction = {
        parts: [{ text: skillContext.skillPrompt }]
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
    const formattedMessage = String(text || '').trim() + this._prepNotes(text, activeSkill, conversationHistory) + getComparisonNote(text);
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
      parts: [{ text: text + this._prepNotes(text, activeSkill, conversationHistory) + getComparisonNote(text) }]
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
   * within the same exercise.
   */
  _prepNotes(question, activeSkill, history = []) {
    const prev = [...(history || [])].reverse().find(e => e && e.role === 'user' && typeof e.content === 'string');
    const { ids, block } = matchKnowledge(question, activeSkill, prev ? prev.content : '');
    if (ids.length) logger.info('Prep notes attached', { ids, chars: block.length });
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
  async processTranscriptionWithIntelligentResponseStream(text, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null, onReset = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check Gemini API key configuration.');
    }

    const startTime = Date.now();
    const deadline = this._newDeadline();
    this.requestCount++;

    try {
      const geminiRequest = this.buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      }, deadline, { onReset });

      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

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
          isTranscriptionResponse: true
        }
      };
    } catch (error) {
      logger.warn('Streaming transcription failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      // Non-streaming path returns the same shape; the caller renders it as a
      // single final response.
      return this.processTranscriptionWithIntelligentResponse(text, activeSkill, sessionMemory, programmingLanguage, { deadline });
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
    const questionParts = images.length
      ? [
          { text: this.formatImageInstruction(record.skill, record.programmingLanguage, { count: images.length, text: record.question }) },
          ...images.flatMap((img, i) => [
            ...(images.length > 1 ? [{ text: `Image ${i + 1} of ${images.length}:` }] : []),
            { inlineData: { data: img.buffer.toString('base64'), mimeType: img.mimeType || 'image/png' } }
          ])
        ]
      : [{ text: (String(record.question || '').trim() || '(question not available)') + this._prepNotes(record.question, record.skill) }];

    const ask = convertTo ? `Convert this solution to ${convertTo.label}.`
      : optimized ? 'Give the optimized solution.'
      // Restated in the turn itself for coding answers: the lite fallback
      // model skipped the reviewed section when it was only in the system
      // prompt (2026-09-28).
      : deep ? (/```/.test(record.answer)
        ? 'Deep reasoning review of this answer, please. Start with `### Solution — … (reviewed)` containing the code above copied verbatim with its deeper Approach, Implementation, step-by-step Complexity and Edge cases; then `### Improved — …` only if a meaningful fix to the same approach exists, otherwise "Possible improvements" bullets.'
        : 'Deep reasoning review of this answer, please.')
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

    let fullText;
    let streamed = true;
    try {
      // Reasoning models think before their first token, so they get their
      // own first-chunk allowance before moving to the next model.
      fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      }, deadline, reasoning ? { ...modelOptions, firstChunkTimeoutMs: reasoning.firstChunkTimeoutMs, backupFirstChunkTimeoutMs: reasoning.backupFirstChunkTimeoutMs, onReset } : { onReset });
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

    const finalResponse = record.programmingLanguage
      ? this.enforceProgrammingLanguage(fullText, record.programmingLanguage)
      : fullText;

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
  async executeStreamingRequest(geminiRequest, onDelta, deadline = null, { firstChunkTimeoutMs = null, backupFirstChunkTimeoutMs = null, models = null, timeoutMs = null, onReset = null } = {}) {
    const firstChunkMs = firstChunkTimeoutMs || config.get('llm.gemini.firstChunkTimeoutMs') || 0;
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

    for (const modelName of modelsToTry) {
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

          if (isModelUnavailable && modelName !== modelsToTry[modelsToTry.length - 1]) {
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

  _streamRequestForModel(geminiRequest, modelName, apiKey, onDelta, firstChunkMs = 0, timeoutMs = null) {
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