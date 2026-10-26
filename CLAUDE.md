# OpenCluely — working notes for Claude

Read this first. It describes what the app does, where the code lives, and the rules this repo follows. Keep it up to date when a feature or rule lands. The detailed reasoning stays in code comments (especially `src/core/config.js`).

## What it is
- A personal fork of TechyCSR/OpenCluely: an **Electron 29 overlay that works as a live interview assistant**.
- Inputs:
  - **voice**, transcribed by local Whisper on two channels: "Meeting Audio" loopback and "My Microphone"
  - **screenshots / image attachments**
  - **typed chat**
- Output: streamed **Gemini** answers, written as the candidate **"Syyam Noor"** (first person, no AI self-reference).
- Resume **profiles** `android` / `frontend` / `fullstack`. The profile id is also the `activeSkill`, which picks both `prompts/<id>.md` and which resume gets injected.
- `webapp/` is the upstream marketing site and is unrelated to the app.

## Run / test / build
- `npm start` (or `Launch-OpenCluely.vbs`, which runs `node_modules/electron/dist/electron.exe .`).
- **`npm test`**: offline suite, node:test + jsdom, about 80+ tests in about 3s. It fakes the Gemini network (`test/helpers/fake-gemini.js`), stubs electron (`electron-stub.js`), and isolates HOME/cwd (`env.js`). **Run it after every change.**
- `npm run test:live`: real API speed and completeness table. **It uses quota.**
- `npm run test:smoke`: launches the real app with its own `--user-data-dir`. It works while the user's instance is open.
- `scripts/eval-*.js`, `scripts/test-knowledge.js`: ad-hoc live evals of the prompt, knowledge and misheard-speech handling.
- `scripts/eval-system-design.js`: live system design round per profile (5 normal + 1 reasoning request each; `--only=`, `--steps=3` skips the build). `scripts/sd-render-check.js` (run with `node_modules/electron/dist/electron.exe`): draws the saved diagrams with the real mermaid and screenshots the overlay; no API calls.
- `scripts/eval-speech-terms.js`: 48 spoken JS/Vue sentences, voiced with Windows SAPI and run through the real Whisper worker and hint.
  - `--hard` adds faster speech, phone band and noise. `--llm` sends the misses through the interviewer path (uses quota). Transcription alone is local and free.
  - Baseline 2026-10-01 (turbo): clean 46/48, hard 39–40/48.
  - Whisper already writes a spoken "dot" as `.` (`ref.value`, `Promise.all`, `JSON.parse`); "a dot not" stays as words, and the model still builds `.not`. So there's no dot rewrite.
  - Adding `nextTick` / `shallowRef` to the Vue hints (+8 tokens; vue3 hint is 209 of ~224) fixed "Next Take in Blue" / "Yellow Refused" at the source.
  - Still ambiguous: "on mounted" → "UnMounted" (answered as `onUnmounted`).
  - **Vite** (2026-10-02): said "veet", it was heard as "need" / "v-it" / "V". It was already in the frontend profile list and survives truncation (vue3 + 20 answer terms: 200 of 223 tokens), but the Vue directives nearby pulled it to "v-". Fix: `Vite` also in the vue3 / nuxt / Auto lists. S49–S51 (spelled "veet") hard 2/4 → 4/4. Clean: Auto 4/4; Vue 3 3/4 ("…to veet." at the end of a sentence is still "v-it"). The other 48 sentences are unchanged (hard 41/48 both). The interviewer prompt needs no Vite example: Gemini already answers "need" / "v-it" in a build question as Vite (eval-voice-heard W1/W2 4/4 without one), and the W3/W4 controls keep `v-if` / `v-for`.
- `npx electron-builder --win` fails locally at the winCodeSign extraction step (no symlink privilege). That's an environment limit, not a code bug.

## Where things live
| Path | What |
|---|---|
| `main.js` | `ApplicationController`: startup, stealth, global shortcuts (`setupGlobalShortcuts`, ~l.450), all IPC (`setupIPCHandlers`, ~l.542), voice coalescing, `processWithLLM` / `processTranscriptionWithLLM` / `processImagesWithLLM`, expansions (`rememberResponse`, `rebuildResponseRecord`, `requestMoreDetails`), `getSettings` / `saveSettings` → `persistEnvUpdates` |
| `preload.js` | contextBridge API for every renderer (add new IPC here too) |
| `prompt-loader.js` | `getSkillPrompt`: assembles the system prompt (see below) |
| `index.html` + `src/ui/main-window.js` | the floating control bar |
| `llm-response.html` | answer overlay: streaming render and expansion/convert buttons |
| `chat.html` + `src/ui/chat-window.js` | chat window, model status bar (`#modelBar`) |
| `settings.html` + `src/ui/settings-window.js` | settings (profile, language, framework, resume, JP mode, speech, keys) |
| `onboarding.html/.js`, `src/core/first-run.js` | first-run flow (API key, Whisper install) |
| `src/core/answer-format.js` | **the** shared coding-answer layout (Approach / Key idea / Brute force / Implementation…) plus comparison note |
| `src/core/candidate-context.js` | profiles, default language, resume text stored in `userData/resume-profiles/<id>.txt` |
| `src/core/framework.js` | per-profile frameworks, `dsa` mode, framework default-format blocks |
| `src/core/code-formats.js` | detect a code format and `convert:<id>` options/notes |
| `src/core/knowledge.js` | keyword-matched notes from `knowledge/**/*.md` (the file format is documented in its header) |
| `src/core/identity.js`, `response-language.js`, `interview-metadata.js` | voice-as-Syyam block; English/Japanese output; JP-mode interview notes (`userData/interview-metadata.txt`) |
| `src/core/speech-vocab.js` | `extractTerms`: names from the latest answer, fed to Whisper as a hint |
| `src/core/system-design.js` + `prompts/system-design/<profile>.md` | System design round mode: state, stage prompt blocks, hidden `REQ:` block filter/parser, design extraction; per-profile playbooks (see "System design round mode") |
| `src/core/model-health.js` | skip/escalation state per model (`userData/model-health.json`) |
| `src/core/config.js` | all tunables: model chains, timeouts, hedging, probe, Whisper VAD |
| `src/services/llm.service.js` | Gemini over raw HTTPS SSE streaming, fallback chain, hedging, SDK fallback |
| `src/services/model-monitor.js` | background "Say hi." probes that bring skipped models back |
| `src/services/speech.service.js` + `whisper-worker.service.js` + `scripts/whisper_worker.py` | Whisper: energy VAD, two channels, hallucination filter, Python worker (`.venv-whisper/`, `.whisper-models/`) |
| `src/managers/session.manager.js` | conversation memory / history |
| `src/managers/window.manager.js` | all BrowserWindows, visibility, click-through, binding/positioning |
| `prompts/<profile>.md` | per-profile base system prompt |
| `knowledge/interview/*.md`, `knowledge/projects/**` | interview prep (e.g. PayPay exercises) and project notes |
| `lib/` | markdown/math/table renderers used by the overlay |
| `test/` | `*.test.js` integration, `unit/`, `helpers/`, `live/` |

Config lives in `.env` (git-ignored). In dev that's the project `.env` if userData has none, otherwise `userData/.env`; see `resolveEnvPath` in main.js. Keys are listed in `env.example`. **Never copy key values anywhere.**

## How it works

### Request flow
- **Voice:**
  1. `speech.service` does VAD segmentation (700ms silence hangover, 15s cap).
  2. A hallucination/noise filter runs.
  3. `handleTranscriptionFragment` merges fragments that arrive within **800ms** (`_utteranceCoalesceMs`).
  4. `dispatchCoalescedUtterance` hands off to `processTranscriptionWithLLM`, which adds `VOICE_TRANSCRIPT_NOTE` (in `llm.service.js`).
  5. The answer goes to the chat window and/or overlay (`WHISPER_RESPONSE_TARGET` = chat | overlay | both).
- **Screenshot** (`Ctrl+Shift+S`) and chat attachments go to `processImagesWithLLM`. Typed chat goes to `send-chat-message` → `processWithLLM`.
- Unclear questions can trigger a clarification (`askClarification`, `CLARIFY_PREFIX`).
  - Chat coding requests only (never voice, screenshots or non-coding questions). The model gives 1–3 backticked real terms that sound like the unclear word, most likely first (`CHAT_CLARIFY_NOTE`).
  - In `chat.html` each guess is a `.suggestion-chip` button (`renderSuggestions`). A click sends it via `sendText`, the same path as a typed reply, so main wraps it with `withClarificationReply`. The input box is left alone.
  - Chips are spent after any text send (`disableSuggestions`). History-restored bubbles aren't clickable because main no longer has the pending question. Heard notes stay plain.
  - **Non-coding chat questions with a misheard word** (2026-10-02): "Are you good at the Alascript or Tidescripts?" (dictated, after 3 career/GORA turns) got the reply `TypeScript` (1 output token). Replayed with that history, the old note gave a `CLARIFY:` line 5/5 (the live run dropped the prefix, so it went to the response window as a one-word answer); with the note blanked, 0/4. The note now opens with "skip this section for any other question", lists skill questions ("have you used / are you good at X?") as non-coding, and ends with "a full answer… never with only a term: a misheard or unclear word in it is answered as the most likely real term(s)". All three are needed: each pair alone still asked 5/5. Measured on 3.5-flash-lite: replay 0/10 short; eval-misheard G6 added; coding rows the same as the same-day baseline (B is the known failure); eval-why-followups 9/9. G5 put a code example in 4/17 runs (all in one 3-minute window; 0/6 in an alternating old/new run), so watch it.
  - `clarifyKind` (main.js) skips a leading `**Understanding**` heading: Flash Lite sometimes writes it above the CLARIFY line, and the question then leaked into the response window. It holds back only that heading line of a normal answer.
  - **Interviewer (Meeting Audio) side:** theory / experience questions never ask. The `HEARD: a → b` line may end with ` | c, d` (≤2 other real terms that fit the sound). chat.html shows them under the 🎧 note as "Meant instead:" chips. Repeats or substrings of the answered term are dropped. A click sends `I meant c, not b` through chat, which re-answers with history.
  - **Interviewer coding requests and follow-ups ask first when genuinely unsure** (2026-10-01; user's choice: never build a guessed change, since wrong code is worse than one click). Nothing is built, the previous answer stays, and chat shows "🤔 Interviewer: Did you mean `a`, `b`?" chips (`askClarification(…, 'voice')`). A click goes through `withClarificationReply`, which carries the transcript and asks for a follow-up (smallest change, `CHANGED:`). Not a history turn until answered; a new interviewer question expires the chips (`chat-clarification-expired`). No new request and no added wait: both triggers are read from the prefix that was already held back for HEARD. The two triggers:
    1. The model replies `CLARIFY:` (prompt section "Unclear word in a coding request (interviewer)" at the end of `VOICE_TRANSCRIPT_NOTE`; the "rebuild the term" bullet points to it).
    2. **App-side gate:** a HEARD note with real alternatives followed by a coding answer (first body line `**Understanding**`) becomes the question, answered term first (`heardCodingQuestion` in `answer-format.js`; ≤40 chars per term). `onClarify` fires as soon as it's detected; the unused answer finishes unseen. Why: in the live eval the prompt alone made Flash Lite ask only ~1 run in 4, while its own HEARD alternatives reliably flag doubt.
    - Measured (`node scripts/eval-voice-heard.js <label> --runs=2`, 36 requests): clean / theory / clear-from-context ("pagan nation", "a bort controller", DotNord, V4) never asked; first chunk median 1.04 s (morning ~1.0 s). "Flembic mode" asked or was gated in most runs.
    - **Known gap:** garbled "to x dot be y" after a toBe answer is still built as `.not` with no HEARD line (the model doesn't notice it guessed), so neither trigger fires. When Whisper writes the dots (`.to(x).be(y)`), it builds the right chain 2/2.
    - Measured 2026-10-01: no notes on clean questions, unchanged first-chunk time (~1.0 s) and length. Alternatives are useful only sometimes ("Overgo X" → offered `Vuex`). Badly garbled audio ("Next Take in Blue", "Yellow Refused") can't be recovered from text alone, so the Whisper hint is the real fix for those.
  - Live check: `node scripts/eval-misheard.js <label> --runs=1` (H1/H2 are ambiguous cases; every CLARIFY line must be one line with ≤3 guesses). Measured 2026-10-01: real APIs (toEqual / toMatchObject / toBeCloseTo / debounce) were never questioned, and non-coding was never questioned. "pagan nation" → `pagination` only. A pure nonsense word still gets loose guesses.

### Prompt assembly (`getSkillPrompt`)
The system prompt is built in this order:

`prompts/<profile>.md` + programming language + framework block + framework-defaults block + resume + (JP mode only) interview notes + `getCodingAnswerBlock` + identity + response language.

**Knowledge entries never go into the system prompt.** At most 3 matched entries (7000 chars max) are appended to the *user turn*. That keeps the system prompt and history prefix identical between requests.

### Model chains (`config.js` → `llm.gemini`)
- **Normal chain:** `gemini-3.5-flash-lite` → `3.1-flash-lite` → `3-flash-preview` → `3.1-flash-lite-preview`
  - thinking off (budget 0)
  - first-chunk timeout 8s, request budget 12s
  - **hedge**: if the primary sends nothing for 3.5s, the next model starts in parallel and the first chunk wins
- **Reasoning chain** (Deep / Optimized only): `3.8-flash` → `3.6-flash` → `3.5-flash-lite` → `3.1-flash-lite`, medium thinking, 20s first-chunk timeout (10s for backups), **hedged after 12s** (`reasoning.hedgeAfterMs`).
  - 3.8-flash added first on 2026-10-10, after Google retired 3.7-flash (redirected to 3.8). Live, real Deep/Optimized requests, 4 each: 3.8 4/4 OK (first chunk 9–29s), 3.6 2/4 (two 503s, first chunk 8–15s); quality similar. Each has its own 20/day, so Deep gets 40/day before the lite models.
- **Model health:** overloaded or silent models are skipped for 2(3) → 5 → 10 → 20 → 30 min, reset on success.
  - **Both chains are probe-managed**: an expired skip stays in place until `model-monitor` gets a probe answer (5s; 8s with `thinkingLevel: 'minimal'` for reasoning-only models such as 3.8-flash / 3.6-flash).
  - At startup the monitor probes the normal chain, then the reasoning chain (`probeStartup`), so neither the first question nor the first Deep click hits a dead primary.
  - Each 3.8-flash / 3.6-flash probe uses 1 of that model's 20/day. Startup probing stops at the first model that answers, so 3.6-flash is probed only when 3.8-flash is down.
  - The status line in chat uses IPC `get-model-status` / `probe-model` and the event `model-status`, and has a "Try <model> now" button. It adds `· Deep: using <backup>, 3.8-flash <reason>…` while the reasoning primary is skipped.
- Free-tier quota: the lite models allow **500/day each**, `3.8-flash` and `3.6-flash` only **20/day** each (5/min). The preview shares 3.1-flash-lite's quota row.
- Retired models (404): 2.5-flash(-lite). `flash-lite-latest` is just an alias for 3.5-flash-lite.

### Expansions (overlay buttons)
- `requestMoreDetails(parentId, mode)` with mode `details` | `deep` | `optimized` | `convert:<formatId>`.
- Expansions are **never** history turns. Newer code is attached to the parent event (`latestCode`) only while it is the latest answer.
- Response records are capped at 200 (images kept only on the newest 10). The overlay sends `{answer}` with each click, so `rebuildResponseRecord` can rebuild an evicted record.
- History: `getConversationHistory` drops system events and canned-fallback Q/A pairs, and an orphan leading answer is dropped.

### System design round mode (added 2026-10-11)
- **Toggle:** the sitemap button (`#systemDesignButton`) in the top bar, next to JP (`index.html` + `src/ui/main-window.js`; moved out of the chat header on 2026-10-11). The requirements card + Build design stay in chat. State is held in memory only (off at every app start) in `src/core/system-design.js`.
  - **Off pauses, it doesn't end the round:** `setOn(false)` keeps requirements, problem, stage and diagrams, so switching back on restores the card and Build design (an accidental click used to wipe them). While off, nothing reaches any request. A new round starts with the chat trash button / clear history (`resetConversation` → `systemDesign.reset()`, even while paused) or an app restart.
  - IPC: `toggle-system-design` / `get-system-design-state` / `build-system-design`. The chat trash button (clear history) also resets the round, so there's no separate New design button.
  - Every change is broadcast as `system-design-state`.
- **Mode off = nothing changes:** every hook returns `''` or passes text through. A test checks that the system prompt and user turn are byte-identical with the mode off, including after it has been on and switched off again.
- **Stage `clarify` (requirement gathering):**
  - No design and no diagram of any kind, not even a ```text flow. This overrides §3 of the profile prompts ("state them rather than asking", the text diagram).
  - Problem statement → `**Ask these:**` / `**Assuming:**` / `**Rough numbers:**` / `**Functional:**` / `**Non-functional:**`.
  - Info-only turn → `**Noted:**` + `**Ask next:**`.
  - Any question (theory, behavioral, projects) is answered normally.
- **The hidden `REQ:` block:** every gathering answer ends with one, holding the FULL current list:
  - marks: `+` = the interviewer said it, `~` = assumption (everything after the problem statement starts as `~`), `!` = edge case, `-` = out of scope, `?` = next questions. The prompt has a literal example block (without it, Flash Lite marked all 8 items `+` on turn 1).
  - `REQ: same` keeps the card.
  - `createReqFilter` strips it from the stream and `splitReqBlock` from the final text, on every path (chat, voice, screenshot, expansions, non-stream fallbacks). It never reaches the overlay or history.
  - It's returned as `metadata.reqLines`, and `afterSystemDesignAnswer` (main.js) updates the card.
  - Fallbacks: if the first answer has no block, its visible Functional / Non-functional bullets become `~` items. A doubled mark (`+ ~ FR:`) counts as its last mark.
- **Build design:**
  - The ✅ chip is in the sticky header of the pinned chat card. `buildSystemDesign` switches the stage to `built` *before* the request (the system prompt then has the design layout) and runs `processWithLLM(…, { reasoning: true })`, i.e. the Deep reasoning chain (3.8-flash first, medium thinking, 8192 tokens, its own time budget). A failed build goes back to `clarify`. Build is locked (chip disabled, and main refuses) until a problem statement exists: on 2026-10-11 a click right after turning the mode on, with an empty card, made the model invent a booking platform from the prompt's own examples.
  - Layout (v2, 2026-10-11): Summary → Requirements recap → Rough numbers → API → Data model (in the playbook's form: Kotlin data classes / TS types / tables) → **three diagrams**, each right after its `**How it works**` numbered walkthrough (the overlay puts a block's preceding text beside it): `High-level architecture` (flowchart), `App architecture` (the selected framework's layers) and `Key flow` (a `sequenceDiagram` with `autonumber`, one use case through those layers to the backend) → Components → Key decisions → Bottlenecks at 10×. The user chose 3 diagrams over 2, accepting a longer build.
  - Each diagram has a Mermaid frontmatter title (`---
title: …
---`), which is the key for follow-ups: state keeps `diagrams` (title → source, canonical names via `canonicalTitle`), and a follow-up replaces only the diagrams it redraws (a client-side change usually redraws App architecture + Key flow).
  - **Diagram 2 is framework-aware:** `ARCHITECTURE_PATTERNS` + `ARCHITECTURE_NAMES` (system-design.js), keyed by the selected framework (Auto / DSA → android `compose`, frontend `react`, fullstack `nextjs`). For example, compose = screen → ViewModel (StateFlow, SavedStateHandle) → UseCase → Repository (SSOT) → Room / Retrofit / WebSocket + WorkManager + FCM; vue3 = template ↔ `<script setup>` / composables ↔ Pinia + API client. Fullstack also draws the other side (a frontend pick adds a Rails service; a backend pick adds a Next.js client). The example names exist because a Next.js build once borrowed "ChatViewModel".
  - **Must-show lists:** `MUST_SHOW` (per profile) + `PROBLEM_ADDONS` (chat, feed, booking, search, upload, notifications, live, URL shortener; matched on the problem + requirements) are restated in the Build turn itself, together with "number nodes (1), (2)… and label EVERY arrow". With these only in the playbook, the lite backup drew a 9-box chat design and unlabelled arrows.
  - Build gets `maxOutputTokens` 24576 (`processWithLLM(…, { reasoning: { maxOutputTokens } })`), because thinking tokens count toward the limit (3–4 diagrams + walkthroughs; more than Deep reasoning's 8192).
  - **Numbering:** high-level nodes are numbered `ID["(n) Name"]` with a `%% (n) why:` comment line. **Components are spoken** (user feedback 2026-10-11): `- **(n) Name (tech)** — 2-3 short first-person sentences: what it does, why I chose it and which requirement it serves (in words), the trade-off`. There are no `what:` / `why:` / `term:` / `(NFR: …)` labels: they read like a form, and they broke the app's own "a bullet is a sentence I can read out" rule (response-language.js). How it works steps, the API, data-model notes and the gathering-stage bullets are spoken sentences too.
- **Stage `built`:**
  - The user turn carries the current diagram + components (`latestDiagram` / `latestComponents`).
  - Design-changing follow-ups run on the normal chain and return the full diagram, with changed nodes marked `:::changed` and only the `NEW:` / `CHANGED:` components listed.
  - Explanation-only follow-ups have no diagram.
  - `enforceProgrammingLanguage` keeps the `mermaid` fence tag.
- **Static vs dynamic prompt parts:** static rules + the profile playbook go in the system prompt (`getSystemDesignBlock`, appended in `getSkillPrompt`). Dynamic state goes in the user turn (`getSystemDesignTurnNote`).
- **Playbooks** (`prompts/system-design/{android,frontend,fullstack}.md`) share 8 sections: question bank, FR / NFR checklist, layers with terms, data model form, diagram subgraphs, deep dives, failure modes, real project pointers.
  - Android goes deep on the client: lifecycle, process death, MVVM / UDF, Repository as the SSOT, DTO / Entity / domain models.
  - Frontend covers rendering strategy, state, caching, delivery and micro-frontends.
  - Fullstack covers end to end, client + edge + services + data + async.
  - Edit them freely; they're plain prompt text.
- **Overlay** (`llm-response.html`, `buildDiagramEl`):
  - A ```mermaid fence becomes a diagram box in the code column. Other code blocks are unchanged.
  - mermaid 11.17.2 (`node_modules/mermaid/dist/mermaid.min.js`, ~3.5 MB, offline) is lazy-loaded on the first diagram only.
  - Diagram | Code toggle, **Copy diagram** (always the Mermaid source), Fit, ⤢ Expand.
  - **Expand** moves the block to `<body>`, because an ancestor traps `position: fixed`. It starts at `top: 40px`, below the 32px `.window-header`: that header is a window drag region, and Electron's OS-level drag regions win over elements drawn on top of them, so buttons inside it missed clicks. The block is `-webkit-app-region: no-drag`. Esc closes it.
  - Drag to pan and Ctrl+wheel to zoom act on the box only.
  - The first view fits the width but never goes below 0.65 zoom, because a fitted 17-node diagram was unreadable at 840×480.
  - If a diagram won't parse, `repairMermaid` quotes bare labels first; if it still fails, the box opens on Code with a note.
  - A design answer gets no Optimized / convert buttons.
- **Measured 2026-10-11:**
  - `scripts/eval-system-design.js` (3 profiles × 6 steps). Gathering-stage first chunk 0.8–1.4 s on 3.5-flash-lite (same as normal). 0 REQ leaks, 0 diagrams before Build.
  - Build: 3.8-flash first chunk 2.3–7.2 s, total 23–26 s. When 3.8 / 3.6 were overloaded it fell back to 3.6-flash (20 s) or 3.5-flash-lite (7 s), with all sections present.
  - Follow-ups: 2–5 `:::changed` nodes each, existing numbers kept. Explanation questions: no diagram.
  - Voice path: same results.
  - `scripts/sd-render-check.js` (real mermaid in Electron): 9/9 model diagrams drawn without repair, 60–110 ms each (~300 ms for the first, including the library load), plus screenshots at 840×480 / 1100×720.
  - Known: theory turns usually repeat the full list instead of `REQ: same` (harmless, ~100 tokens).
- **Measured v2 (2026-10-11):** fullstack chat / nextjs, frontend live scores / vue3, android offline chat / compose.
  - 3.8-flash and 3.6-flash were overloaded, and later 3.8 hit its 20/day (429, used up by evals), so every build ran on the 3.5-flash-lite backup with medium thinking: first chunk 3–18 s, total 11–47 s.
  - Every build had all 8 sections, 3 titled diagrams and 3 How it works, with 0 form labels.
  - Diagram 2 used the right stack (MatchView.vue → `useMatch()` → Pinia + TanStack Vue Query; ChatScreen → ChatViewModel → SendMessageUseCase → MessageRepository → Room / Retrofit + Authenticator / WorkManager / FCM).
  - Client-side follow-ups redrew only App architecture + Key flow.
  - Real mermaid: 33/33 drawn, 2 after `repairMermaid`. The repairs, both seen live: a space before `:::changed`; `;` inside a sequence message / note, which mermaid reads as a statement break.
  - Not yet measured on 3.8-flash itself — re-run `scripts/eval-system-design.js` when its quota is back.

### Global shortcuts (`main.js` ~l.452)
| Keys | Action |
|---|---|
| `Ctrl+Shift+S` | screenshot → answer |
| `Ctrl+Shift+V` | show/hide |
| `Ctrl+Shift+I` / `Alt+A` | toggle interaction (click-through) |
| `Ctrl+Shift+C` | chat |
| `Alt+R` | start/stop listening |
| `Ctrl+Shift+\` | clear session memory |
| `Ctrl+,` | settings |
| `Ctrl+Shift+T` | force on top |
| `Ctrl+Arrows` | move windows |

## Rules this repo follows
- **Check prompt changes live.** Use a scratch script with the real key (load `.env` the way `test/helpers/env.js` does). Never claim a prompt change works from reading it.
  - Flash Lite follows the **literal Approach layout** in `answer-format.js` over rules stated elsewhere. A new required line only sticks once it's in that layout.
  - Compare like with like: 3.1 and 3.5 behave very differently.
- **Knowledge notes and profiles:** a note with no `profiles:` line reaches *every* profile (that's how the backend GORA billing story leaked into frontend answers).
  - Notes that reach the frontend profile tell things from the client side; the backend is only "the source of truth the app called".
  - "Proudest / biggest challenge" trigger words sit on the story notes themselves, and each note holds the answer order: GORA billing in full first (`gora-fe-billing` on frontend, `gora-billing` on android/fullstack), then Speeqr (`speeqr-proud-fe` / `speeqr-proud`). On a tie the matcher keeps file order, and the `gora/` folder comes before `speeqr.md`.
- **Deep reasoning** (`DEEP_REASONING_NOTE` in `llm.service.js`) may reason beyond the notes, per the user's choice. It fills in likely implementation details, edge cases, trade-offs and follow-ups in first person, with no "inference" labels.
  - It must not contradict the notes, change companies, dates or roles, or make up new precise metrics.
  - Behavioral stories get their own section: keep every project (e.g. Speeqr), go deeper, and add "Likely follow-ups".
  - "More details" (`EXPANSION_NOTE`) adds more to the facts that are in the notes, how things connect with each other.
- **Own-project / work questions** ("tell me about your work at GORA / on the single-spa app / on Speeqr"): §5 of every `prompts/*.md` (android got its own §5 on 2026-09-30).
  - Required sections: The product → Architecture and where my part fits → Tech stack → How it talks to the backend (when documented) → What I built (largest) → optional The Why.
  - The universal "be concise" rule has an exception for these questions. Output size was never the limit (4096 tokens; `requestBudgetMs` doesn't cut a running stream); the old "compact overview, no technology list" wording was.
  - Answers stay on the asked project: no other companies and no "Also proud of" section. Before this, a GORA "work" question got the Speeqr section and uPaisa borrowed Speeqr results.
  - **Facts, not wording** (2026-10-02, §5 of all three prompts, next to "Write it the way I'd say it out loud"): say resume / notes facts in my own spoken words, one idea per sentence, full first-person bullets (a short app label in front is fine; Tech stack lines stay lists), plus one good example (frontend / fullstack only). Cause: 3.5-flash-lite read the dense resume line back word for word ("hybrid micro-frontend architecture where a Next.js host shell…"). Quoting that bad sentence in the prompt as a "don't" example made it *keep* the sentence, so the prompt shows only the good version. The frontend resume line 22 / line 7 and the `gora-fe-summary` "One-line framing" bullet were also rewritten in plain wording (backup `frontend.txt.bak-2026-10-02c`): dense source sentences get copied whatever the rules say. Measured on 3.5-flash-lite: the old sentence 0/4 after vs 1/1 before; source overlap of "work at Rakuten" answers, fullstack 20% → 5–11%; format, controls, latency unchanged.
  - **Diagrams** (2026-10-02, user's choice): first answers keep the short fixed ```text flow from the notes (cheapest; in the live test no diagram line mixed the two GORA apps in 15 answers). More details draws its own: when the original answer's only fences are ```text flows (`hasTextFlowOnly` in llm.service.js), the ask turn becomes "More details, please. Include a ```text flow drawn fresh … a separate flow per app … only that app's own tools". Measured on 3.5-flash-lite: More details diagrams 0/5 → 10/10, no mixed lines, first chunk ~1 s. A rule only in `EXPANSION_NOTE` gave 3/10. Letting first answers draw their own flows was tried and dropped: +18% length, +0.7 s. The customer flow says `TanStack Query → openapi-fetch client`, not `TanStack Query / API layer`: the model filled that slot with the portal's axios.
  - "More details" (`EXPANSION_NOTE`) doesn't re-introduce the product; it goes deeper on the architecture, choices, data flow and implementation, using documented facts only.
  - The B2B portal notes (`gora-bip-summary/architecture/inventory/frontend`) include each other and list the documented BIP stack, because Tailwind from the customer platform leaked into it. Customer-platform entries carry `unless:` B2B words (the matcher's `unless:` meta skips an entry when one of its phrases is in the question).
- **Project carry-over** (`knowledge.js`, added 2026-10-01): each project file has a `topic:` line with the project's *names* (never technologies: "single-spa" must not switch a Speeqr follow-up). Three rules:
  - A follow-up that names no project gets the groups of the project under discussion. These come from the previous question, or else from the opening of the previous answer (where the model already resolved a garbled name, e.g. "The speaker app (Speeqr)").
  - A correction that is only a project name ("I meant for Speeqr", "what about uPaisa?") is matched together with the previous question, limited to that project.
  - A question that names a project drops other projects' carry-over. The B2B portal names count as GORA names too.
  - Expansion records keep `prevQuestion`, so More details gets the same notes. `_prepNotes` logs `Prep notes: none` with the question, which makes misheard names visible in the log.
  - The regression check is `scripts/test-knowledge.js` (cases can pass a previous question and answer).
  - Cause (2026-10-01): Whisper heard "Speeqr" as "speaker". No notes matched any of three questions, and a follow-up naming Next.js / single-spa was answered for GORA.
  - Fixes: `PROJECTS` in `speech-vocab.js` sits after the profile terms so it survives the ~224-token tail; misheard keys `!speaker app` etc. are on `speeqr-summary`; `VOICE_TRANSCRIPT_NOTE` has a speaker → Speeqr example.
- **GORA has two web apps** (2026-10-01): a general GORA / "your work there" / architecture question introduces both, via `gora-fe-summary` (overall-picture bullet + a Business Innovation Portal bullet and flow) and the GORA line in §5 of `frontend.md` / `fullstack.md`.
  - The customer platform comes first, in unchanged full depth. The user asked that the B2B addition never shrink it: add, don't reword.
  - Each app keeps its own flow and Tech stack line. What I built is one section: customer features first, then portal work.
  - Questions about one app still get only that app (`unless:` / `need:` unchanged).
  - **Follow-ups between the two apps** (`knowledge.js` "Two apps in one project"): the two frontend files carry `app:` (names of the app) and `sibling:` (the other app's group). Inside a GORA conversation (no project named in the question):
    - a question that names an app **with an experience cue** (`EXPERIENCE_CUES`: did / was / the … part / side / tell me / your …) gets that app;
    - a question that names neither app stays on the app being discussed.
    - "What is single-spa?" and "How would you share state between single-spa apps?" (theory / hypothetical) get no portal notes.
  - The previous turn's groups come from replaying up to 3 turns (`matchKnowledge(…, earlier)`, fed by `_prepNotes`), so chains of unnamed follow-ups keep their app. Cost is about +0.3 ms per question.
  - The regression check is the 19-turn flow set in `scripts/test-knowledge.js`.
  - Known: fullstack answers sometimes still attach a customer tool (Zod, Tailwind) to the portal, about 1 run in 3. The bigger note pushes `gora-bip-summary` over the 7000-char cap for the fullstack "golf course inventory at Rakuten" question.
- **Pinned "connecting" defaults** (2026-10-01; plausible industry-standard choices the user approved, so every answer names the same library; no metrics). Each lives in its own deep-dive entry with `min: 3` / strong keys, so theory questions don't pull it in:
  - **GORA customer platform:** remotes are built with Vite + `@module-federation/vite`. The App Router host loads them through the Module Federation runtime (`@module-federation/enhanced/runtime` `loadRemote`; `nextjs-mf` doesn't support the App Router), with react / zustand / TanStack shared as singletons. Also:
    - `openapi-typescript` + `openapi-fetch` (no axios)
    - HttpOnly session cookie + CSRF header + Next.js middleware
    - `next-intl` / `react-i18next` (the reservation site is **Japanese only**: `ja` is the only locale and i18n means message files + `Intl`)
    - `@vis.gl/react-google-maps`
    - pnpm + Turborepo
    - MSW
    - RN app (2026-10-02): New Architecture + Hermes, React Navigation, react-native-iap (BFF validates receipts), @react-native-firebase/messaging, @sentry/react-native, RN Testing Library + Detox (no Jest/Bitrise in frontend-customer.md: lint)
  - **Login per GORA client** (2026-10-02; Rakuten ID everywhere, the BFF is the only OIDC client and keeps the Rakuten ID tokens):
    - web: HttpOnly session cookie + CSRF (`gora-fe-web-session`)
    - React Native: Authorization Code + PKCE in the system browser via `react-native-app-auth` (`skipCodeExchange`, the BFF exchanges the code) → BFF access + rotating refresh token in `react-native-keychain`, Bearer middleware on the shared `openapi-fetch` client, single-flight refresh (`gora-fe-mobile-auth`, frontend + fullstack)
    - native Android: AppAuth + Custom Tab, Keystore-encrypted DataStore (Tink), OkHttp Interceptor + synchronized `Authenticator`, KMP shared session logic (`gora-android-auth`, android)
    - B2B operators: Rakuten ID linked to an operator account (courses, role) in User Accounts, cookie session checked once by the root config, role/courses passed as custom props, BFF enforces (`gora-bip-auth`)
    - server side for all of them in `gora-auth`
    - Regression cases at the end of `scripts/test-knowledge.js`; theory token questions get none of these.
  - **B2B portal:** `single-spa-react`, SystemJS import maps, `create-single-spa` webpack, an axios utility module, CustomEvents between modules, Formik + Yup (deliberately not the customer tools; Why: it was the portal's existing form pattern).
  - **Speeqr** (React Native, **Android only**, no CallKit): `@rails/actioncable`, `@react-native-firebase/messaging`, `react-native-callkeep` (ConnectionService), `react-native-incall-manager`, `react-native-keychain`. The Android version uses FirebaseMessagingService, ConnectionService, AudioManager and EncryptedSharedPreferences. Firebase is used only for FCM push (+ Crashlytics); Rails sends pushes from `PushDispatchJob` via the FCM HTTP v1 API.
  - **E-commerce** (Winkelstraat.nl, 2023; named only in the frontend resume, since ecommerce-vue.md reaches every profile): Vue 3 / Nuxt 3 + Alokai SDK → Alokai middleware → commercetools / Storyblok / Algolia (`vue-instantsearch`). Also:
    - Mirakl as the marketplace layer for the 300+ boutiques
    - Adyen Drop-in with iDEAL
    - `@nuxtjs/i18n` and Cloudflare stale-while-revalidate caching
    - a Vue 2 → 3 migration via Vue 2.7 + Nuxt Bridge, Vuex → Pinia store by store (entry `ecommerce-vue3-migration`)
- **Profile focus** (checked live on 2026-10-01, 12 answers):
  - **Frontend** answers are frontend-architecture heavy, with the backend only as the BFF.
  - **Fullstack** answers cover both sides.
  - **Android** answers stay on mobile, with no web-frontend tools.
  - The fullstack resume's "Ruby on Rails backend behind GORA's scheduling and booking" lives in `gora-rails-services` (fullstack only, behind the BFF, never called by clients). It matches only "your work at" / "architecture of" / Rails / backend-work questions.
- GORA Cloudflare Workers do region checks + A/B testing at the edge. The site is Japanese only, so there's no language switching.
- **Follow-ups stay on the project** (§5 of all three `prompts/*.md`): a follow-up without a project name stays on the current project. When it names another project's tech, the answer says "not used here" and answers for this project. "I meant X" re-answers the previous question for X.
- **Speeqr architecture** notes `speeqr-architecture-fe/-android/-backend` hold the three client ↔ backend channels:
  - REST + JWT to the Rails API
  - Action Cable signaling
  - WebRTC media that never goes through Rails
  - plus FCM wake-up
  The RN / Android library names in them (react-native-webrtc, React Navigation, React Query, Retrofit / OkHttp) are plausible defaults the user approved, not confirmed facts.
- **Speeqr** notes that talk about "the client" come in one version per profile, like the proud stories: `-fe` = React Native client (frontend), `-android` = native Android client (android), `-backend` = the server side of the same work (fullstack). Currently `speeqr-setup-time-*` and `speeqr-tradeoffs-*`; keep all three in sync when facts change.
- **"Tell me about yourself / your experience"** (2026-10-02, all three `prompts/*.md` §4): a literal ```text layout (`### Company — role, dates` → `#### Project` → one-line brief → 2-4 bullets) plus a per-profile project list. Prose rules alone were ignored by Flash Lite (Android mixed Speeqr + fintech). Live check (scratch script, 1 question × 3 profiles): Android/Frontend follow it; Fullstack 2/3 runs (1 fell back to a paragraph; Rails work folds into the GORA heading). Switching profile does NOT clear history, so clear it (Ctrl+Shift+\) before comparing profiles; the user chose to keep it manual. Winkelstraat.nl is in the frontend + fullstack resumes only, not android.
- **More details / Deep on a career answer** (2026-10-02): `knowledge/interview/career-walkthrough.md` has one entry per profile with `when: expansion` (matched only by `buildExpansionRequest`, which passes `{ expansion: true }` through `_prepNotes`; the first answer gets nothing) and `cap: 13000`. It `include:`s each project's existing architecture entries (no copied facts). When those notes are attached, `buildExpansionRequest` restates the layout in the ask turn (`career`), because Flash Lite ignored the `EXPANSION_NOTE` bullet alone and answered shorter than the original. Live: frontend More details ~2.2x the answer, every project with a text flow + layers + Why, first chunk ~1 s; Deep keeps all projects (~16 s first chunk, reasoning model). Known slips: "pricing" added to the B2B portal; retail apps sometimes folded into uPaisa.
- **Proudest / biggest challenge** answers must end with `### Also proud of: Speeqr`. The rule is in all three `prompts/*.md` behavioral sections, because `3.5-flash-lite` ignored it when it was only in the notes.
- **Claude / AI-tooling questions** use `knowledge/projects/gora/ai-claude.md` (all profiles; Claude was used **only at Rakuten GORA**).
  - Hub `gora-ai-claude` holds short numbered steps for all six workflows plus the answer shape (a heading and numbered steps per workflow, then the Why), and it includes `gora-ai-verify`.
  - Deep-dives: `gora-ai-verify` (`/verify` multi-agent PR review), `gora-ai-figma` (Figma MCP design-to-code), `gora-ai-hld` (HLD from Jira → Confluence), `gora-ai-jira` (ticket creation), `gora-ai-agents-workflow` (release notes, test writer, CLAUDE.md / hooks / worktrees, team rollout). Each one's `need:` requires an AI/Claude word, so plain Figma / Jira / code-review questions don't pull them in.
  - Keep the hub under ~4k chars and each deep-dive under ~2.5k (7000-char notes cap). Every deep-dive repeats the "No numbers" line, because Gemini made up "crash rate cut by 25%" when only the verify entry was sent.
  - "Claude" must not turn into "cloud": the Whisper hint (`speech-vocab.js` `COMMON`) lists Claude, and `VOICE_TRANSCRIPT_NOTE` has a "cloud / claw → Claude" example.
  - The misheard forms (`!cloud code`, `!claw code`, `!clawed`) are strong keys, while a bare "cloud" is not a key, so real cloud-infra questions aren't hijacked.
- **Watch quota.** Warn the user before running live tests. Prefer models other than 3.5-flash-lite, since a benchmark once used up its 500/day.
- **Garbled speech:** no hard-coded word lists or regex rewrites. Use the general "rebuild the most likely real term" procedure in `VOICE_TRANSCRIPT_NOTE`, plus the Whisper vocab hint.
- **Coding answers** (`answer-format.js`):
  - First answers get only cheap guards. Debounce, abort, recursion and caching go under "Possible improvements".
  - Follow-ups make the smallest change, marked with `CHANGED:` (Optimized uses `NEW:`; `EXTRA:` is a guard only, never a new function).
  - Code comments explain the logic, with no markdown in code and no bold concept labels.
  - Each Implementation point explains its own line.
  - **No "what the interviewer is testing" line** (saves tokens).
  - **Screenshot of code that calls its own functions** ("what will it output?", 2026-10-01): only the screenshot instruction (`formatImageInstruction` in `llm.service.js`) changed; voice/chat prompts and `answer-format.js` didn't.
    - Cause: "First identify what is being asked…" was written out as the answer, and the old type list had no output case, so the model called it "conceptual, no code block" and replied in prose (or only described the screenshot).
    - Now the analysis is silent, and an output question gets the full coding format (comment per call with its value, Example flow listing every call → output). A visible request, the typed note or the latest request in the conversation is still implemented; output-only applies only when nothing is left to build.
    - Live check: `node scripts/eval-output-questions.js <label> --runs=2` (replays screenshot → voice "add an arrow function" → "returns state.name" → edited screenshots, plus implement / concept / add-a-method controls). 3.5-flash-lite: output screenshots 0/6 → 6/6, controls unchanged (C3 1/2 → 2/2, C4 2/2), first chunk ~1.4–2 s either way.
  - **Framework first** (2026-10-01): the framework's own feature before plain JS that does the same job (Vue `v-for="i in count"` over a computed number, not `Array.from`; React derives values during render).
  - **`Simpler:`**: an Implementation point whose line uses a compact construct (`Array.from`, `Math.min` clamp, `reduce`, spread, chained ternary, optional chaining) ends with `Simpler: <plain version>`. The code and the other points are unchanged. The user's coding is basic, so this is the fallback when an interviewer says "keep it simple".
  - **"Why didn't you use X?" about earlier code** (also "I meant… why didn't you…", "could we use X"): answered in words (2–4 bullets, at most the changed lines), never in the coding layout and never with CLARIFY.
    - X may be a name the speaker proposes (`SafeCount` → a `safeCount` computed). That reading is scoped to these questions only: a general "proposed names aren't mishearings" rule made a correction keep the misheard `toBeDotNord` (eval-misheard B2), so it was narrowed.
    - A worthwhile change ends with `IMPLEMENT: <change>`. `createImplementFilter` / `splitImplementOffer` (`answer-format.js`) strip it from the stream and the answer, chat and voice alike, and main sends `chat-implement-offer`. chat.html shows "💡 Could change: …" with an **Implement this** chip, which sends `Implement it: <change>` as a normal chat follow-up (full code, `CHANGED:`).
    - No offer when keeping the code is right.
    - Live check: `node scripts/eval-why-followups.js <label> [--runs=N] [--only=…]` (9 scenarios). 2026-10-01 on 3.5-flash-lite: baseline 6/9 (A, C, D failed) → 9/9; C/D/I 6/6 after scoping. First chunk unchanged (~1.3–3.4 s).
    - Known, pre-existing: eval-misheard B / B2 (correcting DotNord → `.not`) often keep the DotNord matcher, with or without these rules.
- **Frameworks:** the selected framework is the default for every coding question, even when it isn't named. `dsa` is the switch for LeetCode-style work: it keeps the language and drops the web-format block and convert buttons. Vue defaults to the short in-page form; SFCs have no `<style>`.
  - **`node-react`** ("Node + Express + React", **fullstack profile only**, default JavaScript): a combined full-stack pick that writes both sides against the user's VM starter at `C:\projects\node-react-express` — `frontend/` Vite React on :5173 proxying `/api` → `backend/` Express on :3001 (client fetches relative `/api/...`, no CORS). It has its own dedicated block (`getNodeReactBlock` in `src/core/framework.js`, special-cased like DSA) instead of the generic template, so the project-structure instructions only appear when it's selected. In a system-design Build (`frameworksFor` in `system-design.js`) it resolves to client `react` + backend `nodejs`.
- **Model chain changes:** update the reasoning comments in `config.js` along with the lists, and record the date and the measurement.
- Match the surrounding style. Main-process code is CommonJS with no build step or TypeScript.

## Git
- `main` tracks **`syyam`** (github.com/syyam/OpenCluely, private). **Never push to `origin`** (upstream TechyCSR).
- `.env`, `.venv-whisper/`, `.whisper-models/`, `dist/` are ignored. Commit or push only when the user asks.
