// Offline check for knowledge/ matching and consistency. No API calls.
//   node scripts/test-knowledge.js
// Asserts which entries each sample question pulls in per profile, prints
// the size of the appended notes block, and lints the knowledge files for
// facts that must live in only one place.
const fs = require('fs');
const path = require('path');
const { matchKnowledge, loadKnowledge, KNOWLEDGE_DIR } = require('../src/core/knowledge');

// [profile, question, ids that must match, ids that must not match, prevQuestion]
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
  ['frontend', 'What is your proudest project?', ['gora-billing'], []],
  ['frontend', 'How did authentication work at GORA?', ['gora-auth'], []],
  // Follow-up without the project name still stays in the GORA group.
  ['frontend', 'And how did you test it?', ['gora-fe-testing-ci'], [], 'How did you manage state in the GORA frontend?'],
  // Theory / coding questions get no project notes.
  ['frontend', 'Implement a debounce function without lodash', ['ex-a-debounce'], ['gora-fe-summary', 'gora-fe-performance']],
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
for (const [profile, q, must, mustNot, prev] of CASES) {
  const { ids, block } = matchKnowledge(q, profile, prev || '');
  console.log(`${String(block.length).padStart(5)}ch ${profile.padEnd(9)} ${q}\n        -> [${ids.join(', ')}]`);
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
