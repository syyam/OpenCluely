const fs = require('fs');
const path = require('path');

// System design round mode (chat header toggle, one interview round).
//
// Off: nothing here touches a request â€” every function below returns '' or
// passes text through, so normal answers are byte-for-byte what they were.
//
// On, two stages:
//   'clarify' â€” requirement gathering. Answers are normal answers (any
//               question the interviewer asks is answered as usual) that
//               end with a hidden REQ: block: the full requirements list so
//               far. The app strips it (createReqFilter / splitReqBlock) and
//               shows it as the pinned card in chat. No design is drawn.
//   'built'   â€” the user clicked "Build design" (runs on the reasoning
//               chain); the answer's ```mermaid diagram and Components are
//               kept as latestDesign, and follow-ups update that design.
//
// In memory only (not a flag file like Japanese mode): it lasts one round,
// so it is off at every app start. Static rules + the profile playbook go in
// the system prompt (getSystemDesignBlock); the changing state (requirements
// card, current diagram) goes in the user turn (getSystemDesignTurnNote), so
// the system prompt stays identical between requests of one stage.

const PLAYBOOK_DIR = path.join(__dirname, '..', '..', 'prompts', 'system-design');
const LIST_KEYS = ['confirmed', 'assuming', 'edge', 'out', 'next'];
const REQ_PREFIX = 'REQ:';

const emptyRequirements = () => ({ confirmed: [], assuming: [], edge: [], out: [], next: [] });

const state = {
  on: false,
  stage: 'clarify',
  problem: '',
  requirements: emptyRequirements(),
  // Current diagrams by title, in build order (High-level architecture,
  // App architecture (â€¦), Key flow: â€¦). A follow-up replaces only the
  // diagrams it redraws.
  diagrams: new Map(),
  latestComponents: '',
  designs: 0, // design answers so far (build + design-changing follow-ups)
};

const playbookCache = new Map();
function readPlaybook(skill) {
  const id = ['android', 'frontend', 'fullstack'].includes(skill) ? skill : 'fullstack';
  if (!playbookCache.has(id)) {
    let text = '';
    try { text = fs.readFileSync(path.join(PLAYBOOK_DIR, `${id}.md`), 'utf8').trim(); } catch (_) {}
    playbookCache.set(id, text);
  }
  return playbookCache.get(id);
}

function hasRequirements(req = state.requirements) {
  return LIST_KEYS.some(k => req[k] && req[k].length);
}

function isOn() { return state.on; }
function getStage() { return state.on ? state.stage : null; }

/** Copy of the state for the chat window (and tests). */
function getState() {
  return {
    on: state.on,
    stage: state.stage,
    problem: state.problem,
    requirements: JSON.parse(JSON.stringify(state.requirements)),
    hasDesign: state.diagrams.size > 0,
    diagrams: [...state.diagrams.keys()],
    designs: state.designs,
  };
}

/** Back to the start of a round (keeps the mode on/off as it is). */
function reset() {
  state.stage = 'clarify';
  state.problem = '';
  state.requirements = emptyRequirements();
  state.diagrams = new Map();
  state.latestComponents = '';
  state.designs = 0;
}

// Off pauses the round, it doesn't end it: switching back on brings the
// requirements, the design and the Build button back (an accidental click
// used to wipe them, 2026-10-11). While off, nothing reaches any request.
// A new round starts with reset() â€” the chat trash button / clear history.
function setOn(on) {
  state.on = !!on;
  return state.on;
}

function setStage(stage) {
  if (stage === 'clarify' || stage === 'built') state.stage = stage;
}

// ---------------------------------------------------------------------------
// Prompt blocks

const COMMON_RULES = `

## System design round mode (ON)
The interviewer is running a system design round. These rules REPLACE the "System Design" section above for every design-related answer in this conversation: there I state requirements myself instead of asking â€” here I gather them first. Every other kind of question (theory, coding, behavioral, "tell me about yourself", a question about my projects) is answered exactly as the rest of this prompt says, in its normal format.`;

const CLARIFY_RULES = `

### Stage now: requirement gathering â€” do NOT design yet
No API, data model, components or diagram in this stage, even when the problem statement is one line: the candidate will press "Build design" when the requirements are ready. **No diagram of any kind** until then â€” no \`\`\`text flow and no \`\`\`mermaid, even for "how would you handle X?" (this overrides "a text flow diagram is required" above): explain it in words and bullets.
- **The problem statement** (the first design question, e.g. "design a golf booking system"; the user turn says "Requirements so far: none yet") gets exactly this, short:
  - \`**Ask these:**\` 3-4 numbered clarifying questions I can read out, most important first (scope / users and clients / scale / consistency or the key edge case), each one line, taken from the playbook's question bank for this problem.
  - \`**Assuming:**\` 3-5 bullets of sensible defaults I'd say if the interviewer says "you decide", each a short sentence I can read out ("I'd assume web and mobile clients.") â€” functional first, then non-functional.
  - \`**Rough numbers:**\` 2-3 short spoken lines (users, peak requests/sec, storage per year), only enough to justify later choices.
  - \`**Functional:**\` and \`**Non-functional:**\` â€” 2-4 bullets each, each a short plain sentence ("Golfers can book and cancel a tee time."), no +/~ marks (those belong only in the REQ block): my first draft of the requirements.
- **A turn that only gives information** (the interviewer answers my questions or adds a requirement, e.g. "mobile only, about a million users"): one line starting \`**Noted:**\` with what changed, then \`**Ask next:**\` with the 1-2 most useful open questions. Nothing else.
- **A turn that asks me something** (any question â€” design, theory, behavioral, about my projects â€” even mixed with information, e.g. "It's mobile only. How would you handle peak traffic?"): answer the question first, exactly as I normally would, then nothing extra in the visible answer.
- **Every answer in this stage ends with the hidden requirements block**: after everything else, a line \`REQ:\` and then the FULL current list (not only what changed), one item per line, short phrases (max ~8 words), at most 14 lines. Line marks:
  - \`+ FR: â€¦\` / \`+ NFR: â€¦\` ONLY for what the interviewer actually said or confirmed in this conversation â€” never my own idea;
  - \`~ FR: â€¦\` / \`~ NFR: â€¦\` my assumption, not confirmed yet. After the problem statement EVERY requirement is \`~\`: the interviewer hasn't confirmed anything yet;
  - \`! â€¦\` an edge case to handle (1-3); \`- â€¦\` out of scope; \`? â€¦\` the 1-2 most useful questions still open.
  When the interviewer confirms or corrects an assumption, it becomes \`+\` (or is replaced). Example, after the problem statement "design a golf booking system":
    REQ:
    ~ FR: search courses and tee times
    ~ FR: book, cancel and view bookings
    ~ NFR: web + mobile, ~1M users
    ~ NFR: no double booking (strong consistency)
    ! two players booking the same slot
    ! payment fails after the slot is held
    ? Web, mobile or both?
    ? Bookings per day at peak?
  A turn with no new requirement facts (a theory, behavioral or coding question) ends with only the line \`REQ: same\`. Never mention the REQ block in the visible answer, and nothing comes after it.`;

const BUILT_RULES = `

### Stage now: design built â€” follow-ups refine THIS design
Everything I write here is read out loud in the interview: short first-person sentences in plain words, the proper term said inside the sentence (in **bold**), never form-style labels like \`what:\`, \`why:\`, \`term:\`, \`trade-off:\`, \`(NFR: â€¦)\`.

- **Building the design** (the turn asks to build it from the requirements): exactly these sections, in order:
  1. \`### Summary\` â€” 2-3 sentences: what we're building and the core idea of the design.
  2. \`### Requirements\` â€” "So to confirm, we're buildingâ€¦": **Functional** and **Non-functional** bullets, each a short sentence; unconfirmed ones end with "(assumed)".
  3. \`### Rough numbers\` â€” 2-3 short spoken lines.
  4. \`### API\` â€” the key endpoints, each \`METHOD /path\` plus one sentence on what it does (and why, when it isn't obvious: "it takes an **idempotency key**, so a retried request can't book twice").
  5. \`### Data model\` â€” in the form the playbook says for this profile; key fields, constraints and indexes each with a few words on why ("\`UNIQUE(slot_id)\` â€” so two players can never hold the same slot").
  6. **The diagrams of this round**, in the order listed below under "Diagrams for this round". For each one: a \`### <its title>\` heading (the App architecture heading also names the framework), then \`**How it works**\` (rules below), then ONE \`\`\`mermaid diagram with that exact title. Each diagram adds something the others don't â€” never redraw the same chain twice.
  7. \`### Components\` â€” one entry per numbered node of the diagram marked "numbered" below, in node order: \`- **(n) <Name> (<technology>)** â€” <2-3 short spoken sentences: what it does in this design; why I chose it and which requirement it serves, said in words; the main trade-off>\`. Example: \`- **(4) Load balancer (AWS ALB)** â€” It spreads REST calls and WebSocket connections across the gateway servers. I use a **layer-7** balancer so WebSocket upgrades can be routed separately from normal API calls, which is what lets us scale out. The trade-off is that WebSocket connections stay open a long time, so I balance by least connections instead of round-robin.\`
  8. \`### Key decisions & trade-offs\` â€” 3-5 spoken bullets ("I went with â€¦ because â€¦, the cost is â€¦"), then \`### Bottlenecks at 10Ã—\` â€” 2-3 bullets ("If traffic grows 10Ã—, the first thing to break is â€¦, so I'd â€¦").
- **Flows are drawn ON the architecture diagrams** (there is no separate sequence diagram): every flow gets a letter, and its arrows are numbered in order â€” **A** = the main write path (the user's main action), **B** = the read / realtime path (data or events coming back), **C** = background, offline and failure paths (dashed). Labels look like \`-->|"A1. tap Send"|\`, \`-.->|"C2. retry when online"|\`. \`**How it works**\` lists each flow as its own group: a bold line \`**<flow name> (A1â€“A6)**\` followed by one short spoken sentence per step, in arrow order ("A1. The user taps Send and the screen sends the event up to the ViewModel."). A diagram without flows (component tree, state diagram) gets 3-5 spoken sentences on how to read it instead.
- **A follow-up that changes the design** ("add a cache", "how do you prevent double booking?", "add image attachments", "what if Redis goes down?"): explain the change in 2-4 spoken sentences with the proper terms, then a short \`**How it works**\` for the changed flow, then ONLY the diagram(s) the change affects, each complete and with its SAME title (a client-side change usually touches App architecture, Component tree & state or State & lifecycle; a backend change touches High-level architecture or Backend services): new or changed nodes / states marked \`:::changed\`, new flow steps continuing the letters (A7, A8â€¦). Then \`### Components\` with ONLY the new / changed numbered nodes, in the same spoken format, the number followed by \`NEW:\` or \`CHANGED:\`. Existing nodes keep their numbers; new ones take the next free numbers.
- **A follow-up that only asks for an explanation** ("why Postgres over Mongo?", "what is consistent hashing?"): answer it in words â€” no diagram. Only "walk me through X step by step" may get a \`sequenceDiagram\` (titled \`Key flow\`).
- "Anything you'd improve?" / "what breaks first?": trade-offs and bottlenecks of THIS design with fixes; a diagram only if the answer changes the design.

### Mermaid rules (rendered by mermaid.js, so the syntax must be valid)
- Every diagram starts with a title block on its first lines:
  \`---\`
  \`title: <its title>\`
  \`---\`
  then the diagram type line. Use exactly the titles listed under "Diagrams for this round".
- **Flowcharts**: \`flowchart TD\`; group nodes in \`subgraph <Name>\` â€¦ \`end\`. As many nodes as the design really needs â€” no artificial limit. Node ids: short letters/digits only (\`API\`, \`DB1\`, \`Q\`). Every label in double quotes. In the "numbered" diagram, nodes are numbered (1), (2), (3)â€¦ with no 3a: \`API["(3) Booking API"]\`, database \`DB[("(5) PostgreSQL")]\`, queue \`Q[["(6) Kafka"]]\`, and after each one's first definition a comment line \`%% (n) why: <a few words>\`. App architecture / component nodes name the real class / file of the framework (see "Frameworks to draw"). Never put \`"\` inside a label. Label EVERY arrow with the flow step and what moves: \`A -->|"A1. send message (WSS)"| B\`; solid arrows are synchronous calls, dashed \`-.->\` are async (events, queues, push, background work).
- **State diagrams**: \`stateDiagram-v2\`; \`[*] --> Sending\`, \`Sending --> Sent : server ack\`, \`state "Failed (will retry)" as Failed\`, \`note right of Failed : â€¦\`, a final \`Read --> [*]\` where it ends. State ids are single words; transition text has no \`:\` inside it.
- **Sequence diagrams** (only when asked to walk through steps): \`sequenceDiagram\`, \`autonumber\`, \`participant VM as <real name>\`, \`A->>B: call\`, \`B-->>A: result\`, \`A-)B: event\`; message text has no \`;\` or \`#\`.
- No \`style\`, \`classDef\`, \`click\`, \`%%{init}\` or themes â€” only \`:::changed\` (written right after the node or state, no space: \`API["(4) API"]:::changed\`) in follow-ups (the app colors it).
- Use \`\`\`mermaid instead of \`\`\`text box diagrams for the whole round.`;


// Diagram 2 ("App architecture") per selected framework: the layers and the
// terms to say, step by step. Auto / DSA falls back to the profile default.
const ARCHITECTURE_PATTERNS = {
  compose: 'Android, Jetpack Compose with MVVM + unidirectional data flow: Compose screen (collects `UiState` with `collectAsStateWithLifecycle`, sends events up) â†’ ViewModel (`StateFlow<UiState>`, `viewModelScope`, `SavedStateHandle` for process death) â†’ UseCase (optional domain logic) â†’ Repository (single source of truth, exposes `Flow`) â†’ Room DAO / DataStore (local) and Retrofit + OkHttp / OkHttp WebSocket (remote); Hilt wires it; WorkManager for sync and retries; FCM for push.',
  'android-views': 'Android Views with MVVM: Activity / Fragment with ViewBinding (observes with `repeatOnLifecycle`) â†’ ViewModel (`LiveData` / `StateFlow`, `viewModelScope`) â†’ Repository (single source of truth) â†’ Room DAO and Retrofit + OkHttp; `RecyclerView` + `ListAdapter` with `DiffUtil`; Hilt; WorkManager; FCM.',
  vue3: 'Vue 3, which is MVVM by design: View = the component `<template>` (bindings, `v-for`, events) â†” ViewModel = `<script setup>` + composables (`ref`, `computed`, `watch`) â†” Model = Pinia store (shared state, actions) + an API client layer (fetch / axios, TanStack Vue Query for server state and caching) â†’ REST and WebSocket to the backend; Vue Router for pages.',
  vue2: 'Vue 2, MVVM: View = template â†” ViewModel = the Options API component (`data`, `computed`, `methods`, `watch`) â†” Model = Vuex (or Pinia) store modules with actions â†’ API client (axios) â†’ REST / WebSocket.',
  react: 'React: components (presentational + container) â†’ custom hooks â†’ TanStack Query for server state (cache, refetch, optimistic updates) + Zustand / Context for client state â†’ typed API client (OpenAPI types) â†’ REST / WebSocket; React Router for pages.',
  nextjs: 'Next.js App Router: Server Components fetch data on the server; Client Components (`"use client"`) for interaction â†’ hooks â†’ TanStack Query (server state) + Zustand (client state) â†’ typed API client â†’ Route Handlers / BFF â†’ backend services; middleware for auth redirects.',
  nuxt: 'Nuxt 3: pages / components â†’ composables (`useFetch` / `useAsyncData`) + Pinia store â†’ Nitro `server/api` routes (BFF) â†’ backend services; SSR with hydration, route middleware for auth.',
  'react-native': 'React Native: screens (React Navigation) â†’ custom hooks â†’ TanStack Query (server state) + Zustand (client state) â†’ API client + WebSocket; local persistence in SQLite / MMKV for offline; push via @react-native-firebase/messaging.',
  nodejs: 'Node.js backend service: route â†’ middleware (auth, validation, rate limit) â†’ controller â†’ service (business logic) â†’ repository / ORM (Prisma / TypeORM) â†’ database; queue workers (BullMQ) for async jobs.',
  'spring-boot': 'Spring Boot backend service: `@RestController` â†’ `@Service` (business logic, `@Transactional`) â†’ `@Repository` (Spring Data JPA) â†’ database; filters for auth; `@Async` / Kafka listeners for async work.',
  rails: 'Ruby on Rails backend service: routes â†’ controller (strong params, auth before_action) â†’ service objects / models (ActiveRecord validations, transactions) â†’ database; ActiveJob / Sidekiq for async jobs; Action Cable for WebSockets.',
};
// Example names per framework (a chat problem), so diagram 2 and the key
// flow don't borrow names from another stack (a Next.js build once had a
// "ChatViewModel").
const ARCHITECTURE_NAMES = {
  compose: '`ChatScreen`, `ChatViewModel`, `SendMessageUseCase`, `MessageRepository`, `MessageDao`, `ChatApi`, `SyncWorker`',
  'android-views': '`ChatFragment`, `MessageListAdapter`, `ChatViewModel`, `MessageRepository`, `MessageDao`, `ChatApi`',
  vue3: '`ChatView.vue`, `useChat()` composable, `useChatStore` (Pinia), `chatApi.ts`, `useChatSocket()`',
  vue2: '`ChatView.vue` (Options API), `chat` Vuex module, `chatApi.js`',
  react: '`ChatPage`, `MessageList`, `useMessages()` (TanStack Query), `useChatStore` (Zustand), `chatClient.ts`',
  nextjs: '`app/chat/[id]/page.tsx` (Server Component), `MessageList` (Client Component), `useMessages()`, `app/api/messages/route.ts`',
  nuxt: '`pages/chat/[id].vue`, `useChat()` composable, `useChatStore` (Pinia), `server/api/messages.post.ts`',
  'react-native': '`ChatScreen`, `useMessages()`, `useChatStore` (Zustand), `chatClient.ts`, `messagesDb` (SQLite)',
  nodejs: '`messages.routes.ts`, `authMiddleware`, `MessagesController`, `MessageService`, `MessageRepository`',
  'spring-boot': '`MessageController`, `MessageService`, `MessageRepository` (JPA), `MessageEventListener`',
  rails: '`MessagesController`, `Messages::Create` service, `Message` model, `MessageBroadcastJob`, `ChatChannel` (Action Cable)',
};
const DEFAULT_ARCHITECTURE = {
  android: 'compose',
  frontend: 'react',
  fullstack: 'nextjs',
};
const BACKEND_FRAMEWORKS = new Set(['nodejs', 'spring-boot', 'rails']);
const DEFAULT_BACKEND = 'rails';

// The diagrams each profile's build draws, in order (2026-10-11, user's
// choice): no separate sequence diagram â€” its steps were the App architecture
// drawn twice â€” so the flows are drawn ON the architectures, and each diagram
// adds something the others don't. Frontend and Android rounds go deep on the
// app; fullstack gets the frontend set plus the whole-system HLD plus the
// backend services. `numbered`: the diagram whose nodes the Components list
// explains.
const DIAGRAM_SETS = {
  frontend: [
    { title: 'System context', what: 'small: the browser â†” CDN / edge â†” BFF / API â†” realtime channel, labelled with the rendering strategy per route (SSR / SSG / CSR) and where HTML and assets are cached; the backend as one black box. Flows A (first load) and B (realtime) only.' },
    { title: 'App architecture', numbered: true, what: 'the frontend in depth, in the framework below: View (routes / pages and the key components), ViewModel / state (hooks or composables, stores), data access (query cache, API client, WebSocket / SSE client, service worker if offline), each layer a subgraph. Flows on it: the first load / hydration, A = the main user action â†’ optimistic update â†’ API â†’ reconcile or roll back, B = a realtime event or refetch â†’ cache merge â†’ re-render, C = failure / slow network / offline (dashed).' },
    { title: 'Component tree & state', what: 'the component hierarchy for the main screen (page â†’ sections â†’ lists â†’ items, forms), props down as arrows and events up as dashed arrows, and every component labelled with where its state lives â€” server cache, store, URL, or local â€” so the data model and the component interfaces are visible.' },
  ],
  android: [
    { title: 'System context', what: 'small: the app â†” API gateway (REST), realtime (WebSocket), push (FCM) and CDN for media â€” the backend contract only, as the app sees it. Flows A (main request) and B (realtime / push) only.' },
    { title: 'App architecture', numbered: true, what: 'the app in depth, in the framework below: UI, Presentation, Domain (if used), Data, Remote and Background layers as subgraphs, with the real class names. Flows on it: A = the main user action (UI event â†’ ViewModel â†’ Repository â†’ Room first â†’ network, the outbox if offline), B = data coming back (WebSocket / FCM / response â†’ Room â†’ Flow â†’ ViewModel â†’ UI), C = background sync, retries and process-death recovery (WorkManager, SavedStateHandle) as dashed arrows.' },
    { title: 'State & lifecycle', what: 'a stateDiagram-v2 of the key entity or screen â€” e.g. a message SENDING â†’ SENT â†’ DELIVERED â†’ READ with FAILED â†’ retry, or the screen Loading â†’ Content / Empty / Error â†’ Refreshing â€” with the events that move it (server ack, timeout, process death, retry, back online) on the transitions.' },
  ],
  fullstack: [
    { title: 'High-level architecture', numbered: true, what: 'the WHOLE system in depth: clients, edge (CDN, WAF, rate limiting), load balancer + API gateway / BFF with auth, every service by domain (the core services, realtime gateway, notification, media, searchâ€¦), each service with its own data store (primary + replica, partition key in the label), the cache, the queue / stream topics and their workers, object storage, and one monitoring box. Flows A (main write path), B (read / realtime path), C (async: queue â†’ workers â†’ push / index).' },
    { title: 'App architecture', what: 'the frontend in depth, in the frontend framework below: View, ViewModel / state, data access layers with the real names, and flows A (main action with optimistic update â†’ API â†’ reconcile), B (realtime / refetch â†’ cache â†’ re-render), C (failure / offline).' },
    { title: 'Component tree & state', what: 'the main screen\'s component hierarchy, props down and events up, each component labelled with where its state lives (server cache, store, URL, local).' },
    { title: 'Backend services', what: 'the core backend service(s) in depth, in the backend framework below: controller â†’ service â†’ repository / ORM, the transaction boundary, cache-aside reads, the outbox â†’ queue â†’ consumers, idempotency keys, retries with backoff and the dead-letter queue, the database partitioning and replicas. Flows A (the write through the layers) and C (the async part and failure handling) on it.' },
  ],
};

function profileOf(skill) {
  return DIAGRAM_SETS[skill] ? skill : 'fullstack';
}

/** { client, backend } framework ids for diagram 2 / Backend services. */
function frameworksFor(skill, framework) {
  const profile = profileOf(skill);
  // Node + Express + React is a combined full-stack pick: draw the React client
  // (App architecture) and the Express/Node backend (Backend services), reusing
  // those two frameworks' patterns and names.
  if (framework === 'node-react' && profile === 'fullstack') return { client: 'react', backend: 'nodejs' };
  const known = ARCHITECTURE_PATTERNS[framework] ? framework : null;
  if (profile !== 'fullstack') return { client: known && !BACKEND_FRAMEWORKS.has(known) ? known : DEFAULT_ARCHITECTURE[profile], backend: null };
  if (known && BACKEND_FRAMEWORKS.has(known)) return { client: DEFAULT_ARCHITECTURE.fullstack, backend: known };
  return { client: known || DEFAULT_ARCHITECTURE.fullstack, backend: DEFAULT_BACKEND };
}

const FRAMEWORK_LABELS = {
  compose: 'Jetpack Compose', 'android-views': 'Android Views', vue3: 'Vue 3', vue2: 'Vue 2', react: 'React',
  nextjs: 'Next.js', nuxt: 'Nuxt', 'react-native': 'React Native', nodejs: 'Node.js', 'spring-boot': 'Spring Boot', rails: 'Ruby on Rails',
};

/** This profile's diagram list + the frameworks they're drawn in (built stage). */
function layoutFor(skill, framework) {
  const profile = profileOf(skill);
  const { client, backend } = frameworksFor(skill, framework);
  const lines = ['\n\n### Diagrams for this round (in this order)'];
  DIAGRAM_SETS[profile].forEach((d, i) => {
    const heading = d.title === 'App architecture' ? `App architecture (${FRAMEWORK_LABELS[client]})` : d.title;
    lines.push(`${i + 1}. \`${d.title}\`${d.numbered ? ' â€” numbered' : ''} (heading \`### ${heading}\`): ${d.what}`);
  });
  lines.push('\n### Frameworks to draw');
  lines.push(`- App architecture${profile === 'android' ? '' : ' and Component tree & state'}: ${ARCHITECTURE_PATTERNS[client]} Names like ${ARCHITECTURE_NAMES[client]} â€” never names from another framework.`);
  if (backend) lines.push(`- Backend services: ${ARCHITECTURE_PATTERNS[backend]} Names like ${ARCHITECTURE_NAMES[backend]}.`);
  return lines.join('\n');
}

/** The diagram titles a profile's build draws (Build turn + tests). */
function diagramTitles(skill) {
  return DIAGRAM_SETS[profileOf(skill)].map(d => d.title);
}

/**
 * System-prompt block for the current stage + the active profile's playbook
 * (+ this profile's diagram set and frameworks once the design is built).
 * '' when the mode is off.
 */
function getSystemDesignBlock(skill, framework = null) {
  if (!state.on) return '';
  const playbook = readPlaybook(skill);
  const built = state.stage === 'built';
  return COMMON_RULES + (built ? BUILT_RULES + layoutFor(skill, framework) : CLARIFY_RULES) + (playbook ? `\n\n${playbook}` : '');
}

function formatRequirements(req = state.requirements) {
  const lines = [];
  const add = (mark, items) => (items || []).forEach(t => lines.push(`${mark} ${t}`));
  add('+', req.confirmed); add('~', req.assuming); add('!', req.edge); add('-', req.out); add('?', req.next);
  return lines.join('\n');
}

/**
 * Appended to the user turn while the mode is on: what the round has so far.
 * '' when the mode is off.
 */
function getSystemDesignTurnNote() {
  if (!state.on) return '';
  const req = hasRequirements() ? formatRequirements() : 'none yet';
  if (state.stage === 'clarify') {
    const ending = hasRequirements()
      ? 'End the answer with the REQ: block: the full updated list (+ only for what the interviewer said), or only "REQ: same" if this turn added no requirement facts. No diagram.'
      : 'If this is the problem statement: nothing is confirmed yet, so every REQ item is ~ (assumed), plus ! edge cases and ? next questions. No diagram.';
    return `\n\n[System design round â€” requirement gathering. Problem: ${state.problem || '(this turn)'}\nRequirements so far:\n${req}\n${ending}]`;
  }
  const parts = [`\n\n[System design round â€” design built. Problem: ${state.problem || '(see conversation)'}`];
  if (hasRequirements()) parts.push(`Requirements:\n${req}`);
  if (state.diagrams.size) {
    parts.push('Current diagrams (latest versions; redraw only the ones a change affects, keeping their titles and node numbers):');
    for (const [title, source] of state.diagrams) parts.push(`${title}:\n\`\`\`mermaid\n${source}\n\`\`\``);
  }
  if (state.latestComponents) parts.push(`Components so far:\n${state.latestComponents}`);
  return parts.join('\n') + ']';
}

// What the diagrams must contain, by profile, plus add-ons by problem type
// (matched on the problem statement + requirements). Restated in the Build
// turn itself: in the system prompt's playbook alone, the lite backup drew a
// 9-box chat design without presence, replicas, receipts or monitoring
// (2026-10-11).
const MUST_SHOW = {
  fullstack: 'CDN / edge with WAF and rate limiting; load balancer + API gateway or BFF that checks auth; every service by domain, each with its own data store; primary database + read replica with the partition key; cache; queue topics + workers; object storage when there are files; one monitoring box (logs, metrics, tracing); in the frontend diagrams the rendering strategy, the data-access layer with its query cache, and where each piece of state lives; in Backend services the transaction boundary, cache-aside, outbox, idempotency keys, retries with backoff and a dead-letter queue',
  frontend: 'the rendering strategy per page and where HTML is cached (CDN); the view components, the client store, the data-access layer with its query cache, the API client; the BFF / API as a black box; realtime transport if any; loading / error / offline handling; in Component tree & state, where each component\'s state lives (server cache, store, URL, local)',
  android: 'the MVVM layers (screen, ViewModel, Repository, Room as the single source of truth, Retrofit / OkHttp); the sync worker (WorkManager); push (FCM); token refresh; where state survives configuration changes and process death; in State & lifecycle, every state of the key entity or screen and the event behind each transition',
};
const PROBLEM_ADDONS = [
  { re: /\b(chat|messag|messenger|whatsapp|slack|dms?\b|inbox)/i, fullstack: 'WebSocket gateway fleet; presence service; message ids with per-conversation ordering (sequence number / Snowflake id); message store partitioned by conversation id; pub/sub fan-out to the gateways; sent / delivered / read receipts; offline delivery (store + sync on reconnect) and push via FCM / APNs; media via presigned S3 upload + CDN', frontend: 'WebSocket client with reconnect + backoff; optimistic send with a client id; merging incoming messages into the query cache; virtualized message list; unread counts', android: 'message status (sending / sent / delivered / read) in Room; client-generated message id for dedupe; WebSocket in the foreground + FCM in the background; ordering by server sequence number; media upload through WorkManager with progress' },
  { re: /\b(feed|timeline|news ?feed|instagram|twitter|posts?\b)/i, fullstack: 'fan-out on write into timeline caches vs fan-out on read (hybrid for huge accounts); ranking; media CDN', frontend: 'infinite scroll with cursor pagination; list virtualization; optimistic likes; image lazy loading', android: 'Paging 3 with RemoteMediator; Coil image caching; pull to refresh' },
  { re: /\b(book|reserv|ticket|tee[- ]?time|appointment|inventory|seat)/i, fullstack: 'short holds with expiry; unique constraint or optimistic locking against double booking; idempotency keys; payment through an outbox / saga', frontend: 'availability polling or push; optimistic hold with rollback; idempotent submit', android: 'idempotent booking request with a client key; offline-safe retry through WorkManager' },
  { re: /\b(search|autocomplete|typeahead)/i, fullstack: 'search index fed by change data capture; autocomplete service; ranking', frontend: 'debounced input; cancelling stale requests (AbortController); result cache', android: 'debounced query in the ViewModel (Flow debounce + flatMapLatest); cached results' },
  { re: /\b(upload|video|photo|image|file|media|stream)/i, fullstack: 'presigned direct-to-storage upload; processing workers (thumbnails, transcoding); CDN delivery', frontend: 'chunked / resumable upload with progress; previews', android: 'WorkManager upload with progress + retry; foreground service for long uploads' },
  { re: /\bnotif/i, fullstack: 'notification service with user preferences, dedupe, per-user rate limits and retries', frontend: 'in-app notification center with realtime updates', android: 'FCM with notification channels; deep links' },
  { re: /\b(live|real[- ]?time|scores?|dashboard|stock|tracking|location)/i, fullstack: 'realtime gateway (WebSocket / SSE) with pub/sub; snapshot + delta updates', frontend: 'SSE / WebSocket with reconnect; snapshot then deltas merged into the cache; throttled re-renders', android: 'foreground updates via WebSocket, background via FCM; battery-aware batching' },
  { re: /\b(url shortener|tinyurl|short links?)/i, fullstack: 'key generation (base62 of an id range); cache-heavy redirects; async click analytics', frontend: 'copy / share flow; analytics view', android: 'share intent; deep links' },
];

function mustShowFor(skill, text) {
  const profile = MUST_SHOW[skill] ? skill : 'fullstack';
  const addons = PROBLEM_ADDONS.filter(a => a.re.test(text)).map(a => a[profile]);
  return [MUST_SHOW[profile], ...addons].join('; ');
}

/** The "Build design" chat turn. */
function buildDesignRequestText(skill = 'fullstack') {
  const req = hasRequirements() ? formatRequirements() : '(none gathered â€” use sensible assumptions and mark them "(assumed)")';
  const problem = state.problem.replace(/[.?!\s]+$/, '');
  const must = mustShowFor(skill, `${problem}\n${req}`);
  const titles = diagramTitles(skill);
  const numbered = (DIAGRAM_SETS[profileOf(skill)].find(d => d.numbered) || {}).title || titles[0];
  return `Build the design now${problem ? ` for: ${problem}` : ''}. Use the requirements we gathered (the interviewer's answers are in our conversation above); items marked ~ are still assumptions:\n${req}\nThe diagrams must show (as nodes, arrows or participants, each in the How it works steps too): ${must}.\nIn the ${numbered} diagram number the nodes (1), (2), (3)â€¦ with no 3a / 5b. Draw the flows on the architecture diagrams with lettered steps on EVERY arrow â€” A = the main write path, B = the read / realtime path, C = background / offline / failure (dashed), e.g. \`S -->|"A1. tap Send"| VM\` â€” and list each flow as a group in How it works. No sequence diagram.\nFollow the "Building the design" layout: Summary, Requirements, Rough numbers, API, Data model, then the ${titles.length} diagrams (${titles.join(', ')}), each after its How it works, then Components, Key decisions, Bottlenecks.`;
}

// ---------------------------------------------------------------------------
// REQ block (clarify stage)

// A REQ line: "REQ:" at the start of a line, optionally bold ("**REQ:**").
const REQ_LINE_RE = /^\s*(?:\*\*)?REQ:(?:\*\*)?\s*(.*)$/;

/** 'yes' | 'maybe' (could still become the REQ line) | 'no' for a line start. */
function reqLineState(line) {
  const s = String(line).replace(/^\s+/, '').replace(/^\*\*/, '');
  if (!s) return 'maybe';
  if (s.startsWith(REQ_PREFIX)) return 'yes';
  return REQ_PREFIX.startsWith(s) || '**'.startsWith(String(line).trim()) ? 'maybe' : 'no';
}

/**
 * Splits a finished answer into its visible body and the REQ block lines.
 * { body, lines: string[] | null, same: boolean } â€” lines null when there
 * was no block. A bare fence opener right before REQ: is dropped too.
 */
function splitReqBlock(text) {
  const s = String(text || '');
  const lines = s.split('\n');
  const idx = lines.findIndex(l => REQ_LINE_RE.test(l));
  if (idx === -1) return { body: s, lines: null, same: false };
  let cut = idx;
  while (cut > 0 && /^\s*(```|~~~)\s*\w*\s*$/.test(lines[cut - 1])) cut--;
  while (cut > 0 && !lines[cut - 1].trim()) cut--;
  const head = REQ_LINE_RE.exec(lines[idx])[1].trim();
  const rest = lines.slice(idx + 1).filter(l => !/^\s*(```|~~~)\s*$/.test(l));
  const same = /^same\b/i.test(head) && rest.every(l => !l.trim());
  const items = [head, ...rest].map(l => l.trim()).filter(Boolean);
  return { body: lines.slice(0, cut).join('\n').replace(/\s+$/, ''), lines: same ? [] : items, same };
}

/** Parses REQ lines into the five lists; lines it can't classify are dropped. */
function parseRequirements(lines) {
  const req = emptyRequirements();
  const seen = new Set();
  for (const raw of lines || []) {
    // "+ FR: â€¦", also a doubled mark the model sometimes writes when it
    // changes one ("+ ~ FR: â€¦" â†’ the last mark counts) or a bullet in front.
    const m = /^\s*(?:\*\s+)?((?:[+~!?-]\s+)+)(.+?)\s*$/.exec(raw) || /^\s*()([+~!?-])(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const marks = m[1] ? m[1].replace(/\s+/g, '') : m[2];
    const mark = marks[marks.length - 1];
    const body = m[1] ? m[2] : m[3];
    const text = body.replace(/^\*\*|\*\*$/g, '').replace(/^out( of scope)?:\s*/i, '').replace(/\s*\(assumed\)$/i, '').trim();
    if (!text || seen.has(mark + text.toLowerCase())) continue;
    seen.add(mark + text.toLowerCase());
    const key = { '+': 'confirmed', '~': 'assuming', '!': 'edge', '-': 'out', '?': 'next' }[mark];
    req[key].push(text.slice(0, 160));
  }
  req.next = req.next.slice(0, 3);
  return req;
}

/**
 * Streaming side of splitReqBlock: text passes through as it comes; only a
 * line start that could still be "REQ:" is held back, and from the REQ line
 * on everything is dropped (the block is the last thing in the answer).
 */
function createReqFilter(emit) {
  let held = '';
  let lineOpen = false;
  let done = false;
  return {
    push(delta) {
      if (done) return;
      let s = held + String(delta || '');
      held = '';
      let out = '';
      while (s) {
        if (lineOpen) {
          const nl = s.indexOf('\n');
          if (nl === -1) { out += s; s = ''; } else { out += s.slice(0, nl + 1); s = s.slice(nl + 1); lineOpen = false; }
          continue;
        }
        const nl = s.indexOf('\n');
        const line = nl === -1 ? s : s.slice(0, nl);
        const kind = reqLineState(line);
        if (kind === 'yes') { done = true; s = ''; break; }
        if (kind === 'no') { lineOpen = true; continue; }
        if (nl === -1) { held = s; s = ''; } else { out += s.slice(0, nl + 1); s = s.slice(nl + 1); }
      }
      if (out) emit(out);
    },
    flush() {
      if (!done && held && reqLineState(held) !== 'yes') emit(held);
      held = '';
    },
    reset() {
      held = '';
      lineOpen = false;
      done = false;
    }
  };
}

// ---------------------------------------------------------------------------
// After an answer

/** The last ```mermaid fence's source, or ''. */
function extractMermaid(text) {
  const all = extractDiagrams(text);
  return all.length ? all[all.length - 1].source : '';
}

// The three diagrams a build draws; a title that starts with one of these
// ("App architecture (Vue 3)") is that diagram.
const CANONICAL_TITLES = ['High-level architecture', 'System context', 'App architecture', 'Component tree & state', 'State & lifecycle', 'Backend services', 'Key flow'];

function canonicalTitle(title, source) {
  const t = String(title || '').replace(/["']/g, '').trim();
  const known = CANONICAL_TITLES.find(c => t.toLowerCase().startsWith(c.toLowerCase()));
  if (known) return known;
  if (t) return t.slice(0, 80);
  // Untitled: by diagram type (a flowchart is taken as the overview).
  if (/^\s*stateDiagram/m.test(source)) return 'State & lifecycle';
  return /^\s*sequenceDiagram\b/m.test(source) ? 'Key flow' : 'High-level architecture';
}

/** Every ```mermaid fence in order: [{ title, source }] (title from its `---\ntitle: â€¦\n---` block). */
function extractDiagrams(text) {
  const re = /(```|~~~)\s*mermaid[^\n]*\n([\s\S]*?)\1/gi;
  const out = [];
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const source = m[2].replace(/\s+$/, '');
    const front = /^\s*---\s*\n([\s\S]*?)\n\s*---\s*(\n|$)/.exec(source);
    const title = front ? ((/^\s*title:\s*(.+)$/m.exec(front[1]) || [])[1] || '') : '';
    out.push({ title: canonicalTitle(title, source), source });
  }
  return out;
}

/** The "### Components" section's text (up to the next heading), or ''. */
function extractComponents(text) {
  const m = /^#{2,4}\s*Components\b[^\n]*\n([\s\S]*?)(?=^#{2,4}\s|\s*$(?![\s\S]))/im.exec(String(text || ''));
  return m ? m[1].trim().slice(0, 5000) : '';
}

/** "~ FR: â€¦" / "~ NFR: â€¦" lines from a stage-1 answer's **Functional:** / **Non-functional:** bullets. */
function requirementsFromAnswer(text) {
  const lines = [];
  let kind = null;
  for (const line of String(text || '').split('\n')) {
    const head = /^\s*(?:#{2,4}\s*)?\*{0,2}(Functional|Non-functional)(?: requirements)?:?\*{0,2}:?\s*$/i.exec(line);
    if (head) { kind = /^non/i.test(head[1]) ? 'NFR' : 'FR'; continue; }
    if (!kind) continue;
    const item = /^\s*[-*]\s+(?:[+~]\s+)?(.+?)\s*$/.exec(line);
    if (item) lines.push(`~ ${kind}: ${item[1].replace(/\s*\(assumed\)$/i, '')}`);
    else if (line.trim()) kind = null;
  }
  return lines.length ? lines : null;
}

/**
 * Updates the round after a finished answer (only while the mode is on).
 * In 'clarify', the first question becomes the problem and the REQ lines
 * replace the requirements list; in 'built', an answer with a diagram
 * becomes the current design. Returns true when the state changed.
 */
function afterAnswer({ question = '', response = '', reqLines = null } = {}) {
  if (!state.on) return false;
  let changed = false;
  if (state.stage === 'clarify') {
    // A first answer that forgot its REQ block still lists its draft
    // requirements in the visible Functional / Non-functional bullets.
    if (reqLines === null && !hasRequirements()) reqLines = requirementsFromAnswer(response);
    if (Array.isArray(reqLines) && reqLines.length) {
      const req = parseRequirements(reqLines);
      if (hasRequirements(req)) {
        state.requirements = req;
        // The first question that produced requirements is the problem
        // statement (a "tell me about yourself" before it doesn't count).
        if (!state.problem && question) state.problem = String(question).replace(/\s+/g, ' ').trim().slice(0, 300);
        changed = true;
      }
    }
    return changed;
  }
  const diagrams = extractDiagrams(response);
  if (diagrams.length) {
    const components = extractComponents(response);
    // Only the diagrams this answer drew are replaced; the others stay.
    for (const d of diagrams) state.diagrams.set(d.title, d.source.slice(0, 8000));
    if (components) {
      // The build lists every component; a follow-up lists only NEW/CHANGED
      // ones, which are added under the earlier list.
      state.latestComponents = state.designs === 0 || !state.latestComponents
        ? components
        : `${state.latestComponents}\n${components}`.slice(-6000);
    }
    state.designs += 1;
    changed = true;
  }
  return changed;
}

module.exports = {
  isOn,
  getStage,
  getState,
  setOn,
  setStage,
  reset,
  getSystemDesignBlock,
  getSystemDesignTurnNote,
  buildDesignRequestText,
  splitReqBlock,
  parseRequirements,
  createReqFilter,
  reqLineState,
  extractMermaid,
  extractDiagrams,
  diagramTitles,
  extractComponents,
  afterAnswer,
  formatRequirements,
};
