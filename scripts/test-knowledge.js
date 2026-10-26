// Offline check for knowledge/ matching and consistency. No API calls.
//   node scripts/test-knowledge.js
// Asserts which entries each sample question pulls in per profile, prints
// the size of the appended notes block, and lints the knowledge files for
// facts that must live in only one place.
const fs = require('fs');
const path = require('path');
const { matchKnowledge, loadKnowledge, KNOWLEDGE_DIR } = require('../src/core/knowledge');

// [profile, question, ids that must match, ids that must not match, prevQuestion, prevAnswer, earlier turns]
const CASES = [
  ['frontend', 'Can you walk me through the architecture of Rakuten GORA?', ['gora-fe-summary'], ['gora-summary']],
  ['fullstack', 'Can you walk me through the architecture of Rakuten GORA?', ['gora-fe-summary', 'gora-summary'], []],
  ['android', 'Can you walk me through the architecture of Rakuten GORA?', ['gora-summary'], ['gora-fe-summary']],
  ['frontend', 'How did you manage state in the GORA frontend?', ['gora-fe-state'], []],
  ['frontend', 'Have you used Zustand or React Query?', ['gora-fe-state'], []],
  ['frontend', 'What did you do for frontend performance at Rakuten?', ['gora-fe-performance'], []],
  ['frontend', 'How was testing and CI/CD set up for GORA?', ['gora-fe-testing-ci'], ['gora-infra']],
  ['frontend', 'How did the frontend talk to the backend in GORA?', ['gora-fe-api-bff'], []],
  ['frontend', 'How did Kafka and the backend services work in GORA?', ['gora-data'], ['gora-fe-api-bff']],
  ['android', 'How did Kafka work in GORA?', ['gora-data'], []],
  ['frontend', 'How did you monitor errors in production at GORA?', ['gora-fe-observability'], []],
  // Proudest / biggest challenge: GORA (app side on frontend) first, then Speeqr.
  ['frontend', 'What is your proudest project?', ['gora-fe-billing', 'speeqr-proud-fe'], ['gora-billing', 'speeqr-proud']],
  ['frontend', 'What was the biggest challenge you faced?', ['gora-fe-billing', 'speeqr-proud-fe'], ['gora-billing']],
  ['frontend', 'Which project are you most proud of?', ['gora-fe-billing', 'speeqr-proud-fe'], ['gora-billing']],
  ['fullstack', 'What is your proudest project?', ['gora-billing', 'speeqr-proud'], ['gora-fe-billing', 'speeqr-proud-fe']],
  ['android', 'What was the hardest problem you solved?', ['gora-billing', 'speeqr-proud'], ['gora-fe-billing']],
  // Backend-only GORA notes stay off the frontend profile for role / scale questions.
  ['frontend', 'What is your role at Rakuten?', ['gora-fe-components'], ['gora-billing', 'speeqr-proud-fe']],
  ['frontend', 'How did you handle scale at peak traffic at GORA?', ['gora-fe-performance'], ['gora-peak-traffic']],
  ['frontend', 'How did you keep subscriptions consistent at GORA?', ['gora-fe-billing'], ['gora-billing']],
  ['fullstack', 'How did you keep subscriptions consistent at GORA?', ['gora-billing'], ['gora-fe-billing']],
  ['frontend', 'How would you implement subscription billing in React?', [], ['gora-fe-billing', 'gora-billing']],
  // Claude / AI-tooling story (every profile), including Whisper's "cloud" / "claw" for Claude.
  ['frontend', 'How do you use Claude in your workflow?', ['gora-ai-claude'], []],
  ['android', 'Have you used Claude Code?', ['gora-ai-claude'], []],
  ['fullstack', 'Tell me about the AI agents you built', ['gora-ai-claude'], []],
  ['frontend', 'What AI tools do you use for code review?', ['gora-ai-claude'], []],
  ['android', 'How do you use cloud code for PR reviews?', ['gora-ai-claude'], []],
  ['frontend', 'How do you use cloud code in your daily work?', ['gora-ai-claude'], []],
  ['frontend', 'Have you worked with clawed?', ['gora-ai-claude'], []],
  ['frontend', 'Tell me about your multi-agent review setup', ['gora-ai-claude'], []],
  ['frontend', 'How do you use AI in your development workflow?', ['gora-ai-claude'], []],
  ['frontend', 'Which cloud provider did you use, AWS or GCP?', [], ['gora-ai-claude']],
  ['fullstack', 'How did you deploy to the cloud?', [], ['gora-ai-claude']],
  ['frontend', 'What are React hooks?', [], ['gora-ai-claude']],
  ['frontend', 'Explain useEffect', [], ['gora-ai-claude']],
  ['frontend', 'How did the AI assistant work in GORA?', ['gora-fe-ai-assistant'], ['gora-ai-claude']],
  ['frontend', 'Can you walk me through the architecture of Rakuten GORA?', [], ['gora-ai-claude']],
  ['android', 'Can you walk me through the architecture of Rakuten GORA?', [], ['gora-ai-claude']],
  ['frontend', 'How do you use AI at Rakuten?', ['gora-ai-claude'], []],
  // Speeqr: design trade-offs and the setup-time work, one version per profile
  // (React Native client / Android client / backend side).
  ['frontend', 'Why did you choose P2P over an SFU in Speeqr?', ['speeqr-tradeoffs-fe'], ['speeqr-tradeoffs-android', 'speeqr-tradeoffs-backend']],
  ['android', 'Why did you use Action Cable instead of SIP for signaling?', ['speeqr-tradeoffs-android'], ['speeqr-tradeoffs-fe', 'speeqr-tradeoffs-backend']],
  ['fullstack', 'What trade-offs did you make in Speeqr?', ['speeqr-tradeoffs-backend'], ['speeqr-tradeoffs-fe', 'speeqr-tradeoffs-android']],
  ['android', 'What trade-offs did you make in Speeqr?', ['speeqr-tradeoffs-android'], []],
  ['frontend', 'How did you cut call setup time in Speeqr?', ['speeqr-setup-time-fe'], ['speeqr-setup-time-android']],
  ['android', 'How did you get a 99.5% call success rate?', ['speeqr-setup-time-android'], ['speeqr-setup-time-fe']],
  ['fullstack', 'How did you cut call setup time in Speeqr?', ['speeqr-setup-time-backend'], ['speeqr-setup-time-fe']],
  ['frontend', 'How did Speeqr handle a network change during a call?', ['speeqr-reconnect'], []],
  ['frontend', 'What are the trade-offs of server-side rendering?', [], ['speeqr-tradeoffs-fe']],
  ['frontend', 'How would you make an API call faster?', [], ['speeqr-setup-time-fe']],
  // B2B Business Innovation Portal (single-spa): all four BIP notes, nothing
  // from the customer platform or the PayPay single-spa theory note.
  ['frontend', 'Tell me about your work in Rakuten GORA, single-spa app.', ['gora-bip-summary', 'gora-bip-inventory', 'gora-bip-frontend', 'gora-bip-architecture'], ['q-singlespa-state', 'gora-fe-summary', 'gora-fe-rendering']],
  ['fullstack', 'Tell me about the Business Innovation Portal', ['gora-bip-summary', 'gora-bip-inventory'], ['gora-fe-summary']],
  ['frontend', 'How does the single-spa lifecycle work in the B2B portal?', ['gora-bip-architecture'], ['q-singlespa-state']],
  ['frontend', 'How did the admin portal talk to the backend?', ['gora-bip-frontend'], ['gora-fe-api-bff']],
  ['frontend', 'How would you share state between single-spa apps?', ['q-singlespa-state'], []],
  ['android', 'Tell me about the B2B portal at GORA', [], ['gora-bip-summary', 'gora-bip-inventory']],
  ['frontend', 'Tell me about your work at Rakuten GORA', ['gora-fe-summary'], ['gora-bip-architecture']],
  // Claude deep-dives (knowledge/projects/gora/ai-claude.md): one per workflow.
  ['android', 'Walk me through your /verify pipeline step by step', ['gora-ai-verify'], []],
  ['frontend', 'How did your multi-agent PR review with Claude work?', ['gora-ai-claude', 'gora-ai-verify'], []],
  ['frontend', 'How did you use the Figma MCP?', ['gora-ai-figma'], []],
  ['android', 'Did you convert Figma designs to code with Claude?', ['gora-ai-figma'], []],
  ['fullstack', 'How did you write HLD docs with Claude?', ['gora-ai-hld'], []],
  ['frontend', 'Did you create Jira tickets with AI?', ['gora-ai-jira'], []],
  ['frontend', 'How did you use cloud code for Jira?', ['gora-ai-jira'], []],
  ['android', 'How do you generate release notes?', ['gora-ai-agents-workflow'], []],
  ['frontend', 'How did the issue validator work?', ['gora-ai-verify'], [], 'Tell me about your /verify multi-agent review'],
  ['frontend', 'What is Figma?', [], ['gora-ai-figma']],
  ['frontend', 'How do you write good Jira tickets?', [], ['gora-ai-jira']],
  ['frontend', 'How do you do code reviews in your team?', [], ['gora-ai-verify']],
  ['frontend', 'Can you walk me through the architecture of Rakuten GORA?', [], ['gora-ai-figma', 'gora-ai-hld', 'gora-ai-jira', 'gora-ai-verify']],
  ['frontend', 'How did authentication work at GORA?', ['gora-auth'], []],
  // Follow-up without the project name still stays in the GORA group.
  ['frontend', 'And how did you test it?', ['gora-fe-testing-ci'], [], 'How did you manage state in the GORA frontend?'],
  // Theory / coding questions get no project notes.
  ['frontend', 'Implement a debounce function without lodash', ['ex-a-debounce'], ['ex-a-task', 'gora-fe-summary', 'gora-fe-performance']],
  // Exercise A without naming Vue or the exact task wording (live voice question, 2026-09-28).
  ['frontend', 'So I need you to implement a search function that gets data from a fake API and searches the name in the list', ['ex-a-task'], []],
  ['frontend', 'Implement a search that fetches users from an API and filters them by name', ['ex-a-task'], []],
  ['frontend', 'Please implement a function in Vue that takes a search function. It searches for name.', ['ex-a-task'], []],
  ['frontend', 'Implement binary search on a sorted array', [], ['ex-a-task']],
  ['frontend', 'How did your API handle users at GORA?', [], ['ex-a-task']],
  ['frontend', 'How do you design a REST API for users?', [], ['ex-a-task']],
  ['frontend', 'How did the frontend fetch data from the API in GORA?', ['gora-fe-api-bff'], ['ex-a-task']],
  ['frontend', 'What is code splitting?', [], ['gora-fe-performance']],
  ['frontend', 'Explain server side rendering vs client side rendering', [], ['gora-fe-rendering']],
  ['frontend', 'What is the difference between Zustand and Redux?', [], ['gora-fe-state']],
  ['frontend', 'How do you share state between micro frontends?', ['q-singlespa-state'], []],
  ['frontend', 'Vuex vs Pinia, which have you used?', ['q-pinia', 'ecommerce-pinia'], []],
  // Two separate GORA frontends: customer platform (Module Federation) vs B2B portal (single-spa).
  ['frontend', 'Have you used single-spa?', ['gora-bip-summary'], ['gora-fe-microfrontends']],
  ['frontend', 'What did you build in the GORA admin portal?', ['gora-bip-summary', 'gora-bip-inventory'], []],
  ['frontend', 'How did you work on golf course inventory at Rakuten?', ['gora-bip-inventory'], []],
  ['frontend', 'Can you walk me through the architecture of Rakuten GORA?', ['gora-fe-summary'], ['gora-bip-summary', 'gora-bip-inventory']],
  ['frontend', 'How did you use Module Federation at GORA?', ['gora-fe-microfrontends'], ['gora-bip-summary', 'gora-bip-inventory']],
  ['frontend', 'How did micro-frontends work at GORA?', ['gora-fe-microfrontends'], ['gora-bip-summary']],
  ['frontend', 'What is single-spa?', [], ['gora-bip-summary', 'gora-bip-inventory']],
  ['frontend', 'How do you share state between micro frontends?', ['q-singlespa-state'], ['gora-bip-summary', 'gora-bip-inventory']],
  ['android', 'Have you used single-spa?', [], ['gora-bip-summary']],
  // Project carry-over (2026-10-01 voice session, frontend): Whisper heard
  // "Speeqr" as "speaker", and a follow-up with no project name that named
  // GORA tech (Next.js, single-spa) got no notes and was answered for GORA.
  ...(() => {
    const q1 = 'Tell me about the architecture of this speaker app';
    const a1 = '### The speaker app (Speeqr) — Architecture\n\nSpeeqr is a real-time voice calling app I built from scratch in React Native at Afiniti';
    const q2 = 'How about the total architecture was it? Next year, single-spa? How was the back end linked with the frontend?';
    const a2 = 'At Rakuten GORA, we used a hybrid micro-frontend architecture for the consumer reservation platform and single-spa for the B2B portal.';
    const gora = ['gora-fe-summary', 'gora-bip-summary', 'gora-bip-architecture', 'gora-summary'];
    return [
      ['frontend', q1, ['speeqr-architecture-fe', 'speeqr-summary'], gora],
      ['frontend', q2, ['speeqr-architecture-fe'], gora, q1, a1],
      ['android', q2, ['speeqr-architecture-android'], gora, q1, a1],
      ['fullstack', q2, ['speeqr-architecture-backend'], gora, q1, a1],
      // The correction re-asks the previous question for Speeqr, even after a GORA answer.
      ['frontend', 'I meant for speaker.', ['speeqr-architecture-fe'], gora, q2, a2],
      ['frontend', 'I meant for Speeqr.', ['speeqr-architecture-fe'], gora, q2, a2],
      // The previous answer names the project when the previous question didn't match.
      ['frontend', 'How was the backend linked with the frontend?', ['speeqr-architecture-fe'], gora, 'Tell me about that calling project', a1],
      ['frontend', 'What was the tech stack?', ['speeqr-architecture-fe'], [], q1, a1],
      ['frontend', 'Tell me about Speeqr', ['speeqr-summary', 'speeqr-architecture-fe'], []],
      // Only the matching profile's architecture note.
      ['android', 'Tell me about the architecture of Speeqr', ['speeqr-architecture-android'], ['speeqr-architecture-fe', 'speeqr-architecture-backend']],
      // Carry-over never reaches generic or other-project questions.
      ['frontend', 'What is useEffect?', [], ['speeqr-summary', 'speeqr-architecture-fe', 'speeqr-web'], q1, a1],
      ['frontend', 'Implement a search that fetches users from an API and filters them by name', ['ex-a-task'], ['speeqr-architecture-fe'], q1, a1],
      ['frontend', 'How do you design a REST API for users?', [], ['speeqr-architecture-fe'], q1, a1],
      ['frontend', 'Tell me about your work at Rakuten GORA', ['gora-fe-summary'], ['speeqr-summary', 'speeqr-architecture-fe', 'speeqr-web'], q1, a1],
      ['frontend', 'How does the single-spa lifecycle work in the B2B portal?', ['gora-bip-architecture'], ['speeqr-web', 'speeqr-architecture-fe'], q1, a1],
      ['android', 'How did you handle scale at peak traffic at GORA?', ['gora-peak-traffic'], ['speeqr-backend'], q1, a1],
      ['android', 'How did the B2B portal talk to the backend?', ['gora-summary'], ['speeqr-architecture-android'], 'Tell me about your work at Rakuten GORA', 'At Rakuten GORA I worked on the golf platform'],
      ['frontend', 'Tell me about the architecture of Speeqr', ['speeqr-summary'], ['gora-fe-summary'], 'Tell me about your work at Rakuten GORA', 'At Rakuten GORA I worked on the golf platform'],
      ['frontend', 'What about uPaisa?', ['upaisa-summary'], ['speeqr-architecture-fe', 'speeqr-summary'], q2, a1],
      // A short question that names the project isn't a correction: matched on its own.
      ['frontend', 'How did Kafka work in GORA?', ['gora-data'], ['ex-b-expect'], 'Implement expect(actual).toBe(expected)'],
    ];
  })(),
  // GORA's two web apps in follow-ups (2026-10-01): a follow-up that names an
  // app gets that app; one that names neither stays on the app being discussed,
  // also over a chain of unnamed follow-ups; theory questions stay clean.
  ...(() => {
    const work = ['Tell me about your work at Rakuten GORA', 'At Rakuten GORA I worked on two web apps: the customer reservation platform and the Business Innovation Portal.'];
    const b2b = ['Tell me about your work on the B2B portal at GORA', 'The Business Innovation Portal is the operator-facing B2B app built with single-spa.'];
    const state = ['How did you manage state there?', 'On the B2B portal, state stayed in the modules.'];
    const mf = ['How did Module Federation work at GORA?', 'On the customer platform, Module Federation streams in React SPAs.'];
    const cust = ['gora-fe-state', 'gora-fe-forms', 'gora-fe-rendering', 'gora-fe-microfrontends', 'gora-fe-testing-ci'];
    const bip = ['gora-bip-summary', 'gora-bip-frontend', 'gora-bip-inventory', 'gora-bip-architecture'];
    return [
      ['frontend', 'How did the single-spa part work?', ['gora-bip-summary'], cust, ...work],
      ['frontend', 'And how did the customer side handle state?', ['gora-fe-state'], bip, 'How did the single-spa part work?', 'The single-spa portal mounts modules.', [work]],
      ['frontend', 'How was server rendering done on the booking site?', ['gora-fe-rendering'], bip, 'How did the Business Innovation Portal talk to the backend?', 'The portal called REST APIs on the Kotlin BFF.', [work]],
      ['frontend', 'How did you manage state there?', ['gora-bip-frontend'], ['gora-fe-state'], ...b2b],
      ['frontend', 'How were the modules loaded and mounted?', ['gora-bip-architecture'], cust, ...state, [b2b]],
      ['frontend', 'How did you handle forms there?', ['gora-fe-forms'], bip, ...mf],
      ['frontend', 'And what about the admin side for golf course operators?', ['gora-bip-summary'], [], 'How did you handle forms there?', 'React Hook Form and Zod.', [mf]],
      ['frontend', 'Tell me more about the single-spa portal', ['gora-bip-summary'], cust, 'Walk me through the architecture of Rakuten GORA', 'Rakuten GORA has two web frontends on one Kotlin BFF.'],
      ['fullstack', 'How did it talk to the backend?', ['gora-bip-frontend'], ['gora-fe-api-bff'], 'Tell me about your work on the Business Innovation Portal', 'The Business Innovation Portal is a single-spa B2B app.'],
      // Theory / hypothetical questions mid-conversation get no portal notes.
      ['frontend', 'What is single-spa?', [], bip, ...work],
      ['frontend', 'How would you share state between single-spa apps?', ['q-singlespa-state'], bip, ...work],
      ['frontend', 'What is useEffect?', [], [...bip, ...cust, 'gora-fe-summary'], ...state, [b2b]],
    ];
  })(),
  // "How does it connect" libraries (2026-10-01, plausible defaults the user chose):
  // each probe reaches its entry; theory / other-project questions don't.
  ['frontend', 'At GORA, how did the Vite-built micro-frontends load into the Next.js host?', ['gora-fe-mf-integration'], ['gora-bip-tech']],
  ['frontend', 'How did the GORA micro-frontends share React and avoid loading it twice?', ['gora-fe-mf-integration'], []],
  ['frontend', 'At GORA, which HTTP client did the frontend use to call the BFF, and how were the API types kept in sync?', ['gora-fe-api-client'], ['gora-bip-tech']],
  ['frontend', 'How was the user session handled in the browser on GORA?', ['gora-fe-web-session'], []],
  ['frontend', 'How did you do internationalization in the GORA frontend?', ['gora-fe-i18n-maps'], []],
  ['frontend', 'How was the GORA frontend repository organized and how were the remotes deployed?', ['gora-fe-repo'], []],
  ['frontend', 'What did you use for forms and validation in the B2B portal?', ['gora-bip-tech'], ['gora-fe-forms']],
  ['frontend', 'Which HTTP client did the B2B portal modules use to call the BFF?', ['gora-bip-tech'], ['gora-fe-api-client']],
  ['frontend', 'In Speeqr, how did an incoming call ring when the app was closed?', ['speeqr-rn-libs-fe'], ['speeqr-android-libs']],
  ['android', 'In the Speeqr Android client, how did an incoming call ring when the app was closed?', ['speeqr-android-libs'], ['speeqr-rn-libs-fe']],
  ['frontend', 'What backend did the Vue Storefront app on the e-commerce marketplace talk to?', ['ecommerce-stack'], ['gora-bff']],
  ['frontend', 'How were payments integrated into the custom checkout on the fashion marketplace?', ['ecommerce-stack'], []],
  ['frontend', 'Which library did you use for in-app purchases in the GORA React Native app?', ['gora-fe-billing'], []],
  ['frontend', 'Tell me about your work at Winkelstraat', ['ecommerce-vue'], ['gora-fe-summary']],
  ['frontend', 'How do nested routes work in Vue Router?', [], ['speeqr-rn-libs-fe'], 'Tell me about Speeqr', 'Speeqr is a calling app.'],
  ['frontend', 'Explain server side rendering vs client side rendering', [], ['gora-fe-api-client'], 'Tell me about your work at Rakuten GORA', 'At Rakuten GORA I worked on two web apps.'],
  ['frontend', 'How do you store tokens securely in a single page app?', [], ['speeqr-rn-libs-fe', 'gora-fe-web-session']],
  ['frontend', 'How does HTTP caching work?', [], ['ecommerce-stack']],
  ['frontend', 'What is a hash map?', [], ['gora-fe-i18n-maps'], 'Tell me about your work at Rakuten GORA', 'At Rakuten GORA I worked on two web apps.'],
  // Exercise B progression: each follow-up gets its own step's note, not the final solution.
  ['frontend', 'Implement expect(actual).toBe(expected) in plain JavaScript/TypeScript.', ['ex-b-expect'], ['ex-b-not', 'ex-b-toequal', 'ex-b-deep']],
  ['frontend', 'Can you support expect(5).not.toBe(6)?', ['ex-b-not'], ['ex-b-toequal', 'ex-b-deep']],
  ['frontend', 'What happens with NaN? Should expect(NaN).toBe(NaN) pass?', ['ex-b-nan'], ['ex-b-deep'], 'Can you support expect(5).not.toBe(6)?'],
  ['frontend', 'What is the difference between === and Object.is?', ['ex-b-nan'], []],
  ['frontend', 'Now add toEqual so objects can be compared by value rather than reference.', ['ex-b-toequal'], ['ex-b-edge-cases']],
  ['frontend', 'Your toEqual only works for shallow objects. Can you make it handle nested objects?', ['ex-b-deep'], ['ex-b-edge-cases']],
  ['frontend', 'What other cases should your deep-equality function handle?', ['ex-b-edge-cases'], [], 'Your toEqual only works for shallow objects. Can you make it handle nested objects?'],
  ['frontend', 'Guard against empty, negative and decimal input and other edge cases.', ['ex-c-guards'], ['ex-b-edge-cases', 'ex-b-deep']],
  ['frontend', 'How do nested routes work in Vue Router?', [], ['ex-b-deep']],
  // Login per GORA client (2026-10-02): web cookie session, RN / native Android
  // PKCE + tokens, B2B operators with roles. Theory questions get none of them.
  ['frontend', 'How did users log in to GORA?', ['gora-fe-web-session', 'gora-auth'], ['gora-fe-mobile-auth']],
  ['frontend', 'How did auth work in the mobile app at GORA?', ['gora-fe-mobile-auth'], ['gora-fe-web-session', 'gora-android-auth']],
  ['frontend', 'How did you store tokens in the GORA app?', ['gora-fe-mobile-auth'], ['gora-fe-web-session']],
  ['frontend', 'How did the app keep the user logged in at Rakuten?', ['gora-fe-web-session', 'gora-fe-mobile-auth'], []],
  ['frontend', 'How did login work in the React Native app?', ['gora-fe-mobile-auth'], ['gora-fe-web-session'], 'Tell me about the React Native app at Rakuten GORA'],
  ['fullstack', 'How did auth work in the mobile app at GORA?', ['gora-fe-mobile-auth', 'gora-auth'], ['gora-android-auth']],
  ['android', 'How did auth work in the mobile app at GORA?', ['gora-android-auth'], ['gora-fe-mobile-auth', 'gora-fe-web-session']],
  ['android', 'How did you store tokens in the GORA app?', ['gora-android-auth'], []],
  ['frontend', 'How did authentication work in the Business Innovation Portal?', ['gora-bip-auth'], ['gora-fe-web-session', 'gora-fe-mobile-auth']],
  ['fullstack', 'How did you handle roles and permissions in the B2B portal?', ['gora-bip-auth'], []],
  ['frontend', 'And how did login work there?', ['gora-bip-auth'], ['gora-fe-web-session'], 'How did the Business Innovation Portal work?'],
  ['frontend', 'How does authentication work in single-spa?', [], ['gora-bip-auth']],
  ['frontend', 'How do you store tokens securely in React Native?', [], ['gora-fe-mobile-auth', 'gora-fe-web-session']],
  ['frontend', 'How do you keep users logged in in a React app?', [], ['gora-fe-mobile-auth', 'gora-fe-web-session']],
  ['android', 'How do you store tokens securely on Android?', [], ['gora-android-auth']],
];

// [file, forbidden pattern, reason, allowed lines (disambiguation)]
const LINTS = [
  // GORA: each fact lives in one file. Frontend files hold no backend infra,
  // the backend file holds no frontend stack, and the two portals don't mix.
  ['projects/gora/frontend-customer.md', /single-spa|\bJest\b|\bELK\b|Bitrise|Prometheus|Kafka|Debezium|Redis|Kubernetes|WSO2/i, 'customer frontend only; backend facts live in gora/backend.md', /Business Innovation Portal/],
  ['projects/gora/frontend-business-portal.md', /Module Federation|Next\.js|Kafka|Redis|Kubernetes/i, 'the B2B portal is single-spa only; backend facts live in gora/backend.md', /customer/i],
  ['projects/gora/backend.md', /single-spa|Next\.js|Module Federation|Cloudflare|GitHub Actions|Sentry|Datadog|Zustand|TanStack|Vitest|Playwright|\bJest\b|Spring Cloud Gateway|Kong|silently refreshed/i, 'backend/platform only; frontend facts live in gora/frontend-*.md'],
  ['interview/frontend-paypay.md', /GORA|Rakuten|Speeqr|uPaisa|storefront|My experience|Resume fact/i, 'PayPay notes are theory/programming only'],
];

let failed = 0;
const fail = (msg) => { failed++; console.log('  FAIL ' + msg); };

console.log('Matching');
for (const [profile, q, must, mustNot, prev, prevAnswer, earlier] of CASES) {
  const { ids, block } = matchKnowledge(q, profile, prev || '', prevAnswer || '', earlier || []);
  console.log(`${String(block.length).padStart(5)}ch ${profile.padEnd(9)} ${q}\n        -> [${ids.join(', ')}]`);
  for (const id of must) if (!ids.includes(id)) fail(`missing ${id}`);
  for (const id of mustNot) if (ids.includes(id)) fail(`unexpected ${id}`);
}

// "More details" / "Deep reasoning" ({ expansion: true }): a career answer gets
// every project's architecture entries; the first answer gets none.
const CAREER_Q = 'Tell us a little bit about yourself and your experience.';
const EXPANSION_CASES = [
  // [profile, question, expansion, must, mustNot]
  ['frontend', CAREER_Q, true, ['career-arch-fe', 'gora-fe-summary', 'gora-bip-architecture', 'gora-fe-react-native', 'speeqr-architecture-fe', 'ecommerce-stack', 'upaisa-summary'], ['gora-summary']],
  ['android', CAREER_Q, true, ['career-arch-android', 'gora-summary', 'speeqr-architecture-android', 'upaisa-summary'], ['ecommerce-stack', 'ecommerce-vue', 'gora-fe-summary', 'speeqr-architecture-fe']],
  ['fullstack', CAREER_Q, true, ['career-arch-fullstack', 'gora-rails-services', 'speeqr-architecture-backend', 'ecommerce-stack'], ['speeqr-architecture-fe']],
  ['frontend', CAREER_Q, false, [], ['career-arch-fe']],
  ['android', 'Walk me through your resume', false, [], ['career-arch-android']],
  ['frontend', 'Tell me about your work at Rakuten GORA', true, ['gora-fe-summary'], ['career-arch-fe']],
];
console.log('\nExpansion matching');
for (const [profile, q, expansion, must, mustNot] of EXPANSION_CASES) {
  const { ids, block } = matchKnowledge(q, profile, '', '', [], { expansion });
  console.log(`${String(block.length).padStart(5)}ch ${profile.padEnd(9)} ${expansion ? '[exp] ' : ''}${q}\n        -> [${ids.join(', ')}]`);
  for (const id of must) if (!ids.includes(id)) fail(`missing ${id}`);
  for (const id of mustNot) if (ids.includes(id)) fail(`unexpected ${id}`);
}

console.log('\nLint');
for (const [rel, re, why, allow] of LINTS) {
  const text = fs.readFileSync(path.join(KNOWLEDGE_DIR, rel), 'utf8');
  text.split(/\r?\n/).forEach((line, i) => {
    if (re.test(line) && !(allow && allow.test(line))) fail(`${rel}:${i + 1} (${why}): ${line.trim().slice(0, 100)}`);
  });
}

// Every include must point at an existing entry, and ids must be unique.
const { entries, byId } = loadKnowledge();
const seen = new Set();
for (const e of entries) {
  if (seen.has(e.id)) fail(`duplicate id ${e.id}`);
  seen.add(e.id);
  for (const inc of e.include) if (!byId.has(inc)) fail(`${e.id} includes missing ${inc}`);
}

console.log(failed ? `\n${failed} failure(s)` : `\nAll checks passed (${entries.length} entries)`);
process.exit(failed ? 1 : 0);
