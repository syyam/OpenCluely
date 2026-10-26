// Framework preference (React, Vue 3, Spring Boot, ...) — extra context for
// Gemini that sits alongside the coding-language selection. It never decides
// whether an answer gets code (that's answer-format.js); it only says which
// framework to build with when code is needed. 'auto' (the default) adds
// nothing to the prompt, so it behaves exactly as before the setting existed.
//
// In-memory like the coding language: resets to Auto on restart, and to Auto
// on a profile switch when the current pick isn't offered by the new profile.

const formats = require('./code-formats');

// languages: coding-language ids the framework can be written in. When the
// selected language isn't one of them, the first one is used for prompts
// (Rails is Ruby no matter what the language dropdown says). null = any
// language (DSA answers are written in whatever language is selected).
const DSA = 'dsa';
const FRAMEWORKS = {
  [DSA]: { label: 'DSA / LeetCode', languages: null },
  react: { label: 'React', languages: ['typescript', 'javascript'], idioms: 'function components and hooks, `useEffect` cleanup, custom hooks' },
  'react-native': { label: 'React Native', languages: ['typescript', 'javascript'], idioms: 'function components and hooks, core components (`FlatList`, `View`), `useEffect` cleanup' },
  vue3: { label: 'Vue 3', languages: ['typescript', 'javascript'], idioms: 'Composition API (`setup()` on a CDN page, `<script setup>` in an SFC), `ref`/`computed`/`watch` with `onCleanup`' },
  vue2: { label: 'Vue 2', languages: ['typescript', 'javascript'], idioms: 'Options API `data`/`computed`/`watch`/`methods`, cleanup in `beforeDestroy`' },
  nextjs: { label: 'Next.js', languages: ['typescript', 'javascript'], idioms: 'App Router, server components by default, `"use client"` only where interactivity needs it' },
  nuxt: { label: 'Nuxt', languages: ['typescript', 'javascript'], idioms: 'auto-imported Composition API, `useFetch`/`useAsyncData` for data' },
  nodejs: { label: 'Node.js', languages: ['typescript', 'javascript'], idioms: 'async/await, middleware-based routing, centralized error handling' },
  'node-react': { label: 'Node + Express + React', languages: ['javascript', 'typescript'], idioms: 'a Vite React frontend (function components + hooks) calling an Express backend over a /api proxy' },
  'spring-boot': { label: 'Spring Boot', languages: ['kotlin', 'java'], idioms: 'annotations, constructor injection, controller → service → repository layers' },
  rails: { label: 'Ruby on Rails', languages: ['ruby'], idioms: 'conventions over configuration, ActiveRecord, RESTful controllers' },
  compose: { label: 'Jetpack Compose', languages: ['kotlin'], idioms: 'state hoisting, `remember`/`LaunchedEffect`, ViewModel + `StateFlow`' },
  'android-views': { label: 'Android Views (XML)', languages: ['kotlin', 'java'], idioms: 'ViewBinding, ViewModel + LiveData/`StateFlow`, `RecyclerView` + `ListAdapter`' },
};

// Options offered per resume profile (ids from candidate-context.js PROFILES).
const PROFILE_FRAMEWORKS = {
  android: [DSA, 'compose', 'android-views', 'react-native', 'spring-boot'],
  frontend: [DSA, 'react', 'react-native', 'vue3', 'vue2', 'nextjs', 'nuxt'],
  fullstack: [DSA, 'react', 'react-native', 'vue3', 'vue2', 'nextjs', 'nuxt', 'nodejs', 'node-react', 'spring-boot', 'rails'],
};

const AUTO = 'auto';
let current = AUTO;

function isValidFor(frameworkId, profileId) {
  return (PROFILE_FRAMEWORKS[profileId] || []).includes(frameworkId);
}

/** [{id, label}] for the profile's dropdown, Auto first. */
function getFrameworkOptions(profileId) {
  return [{ id: AUTO, label: 'Auto' }].concat(
    (PROFILE_FRAMEWORKS[profileId] || []).map(id => ({ id, label: FRAMEWORKS[id].label }))
  );
}

function getFramework() {
  return current;
}

/** Set the framework for a profile; anything not offered there becomes Auto. */
function setFramework(frameworkId, profileId) {
  current = isValidFor(frameworkId, profileId) ? frameworkId : AUTO;
  return current;
}

/** The coding language prompts should use for this framework + language pick. */
function getEffectiveLanguage(frameworkId, language) {
  const fw = FRAMEWORKS[frameworkId];
  if (!fw || !fw.languages || !language || fw.languages.includes(String(language).toLowerCase())) return language;
  return fw.languages[0];
}

// Appended to the system prompt right after the Implementation language
// block (prompt-loader.js). '' for Auto/unknown ids. The file format a
// framework's code is written in lives in getFrameworkDefaultsBlock.
function getFrameworkBlock(frameworkId) {
  const fw = FRAMEWORKS[frameworkId];
  if (!fw) return '';
  if (frameworkId === DSA) return getDsaBlock();
  if (frameworkId === 'node-react') return getNodeReactBlock();
  return `\n\n## Framework: ${fw.label}
The candidate selected ${fw.label} as the framework. When code is needed (see "When code is needed" below) and the question leaves the framework open, write it with ${fw.label}, using ${fw.label}'s own idiomatic APIs and patterns (${fw.idioms}), not another framework's or version's. This is context, not a trigger: it never makes an answer need code and never changes which questions get code. The interview is about ${fw.label}, so the question often won't name it: a coding question gets ${fw.label} code even when it doesn't mention ${fw.label} or calls the task a "function" (e.g. "implement a search function that gets data from a fake API" → the ${fw.label} version with that logic). When the question or the code it gives uses a different framework, or explicitly asks for plain code (e.g. "in plain JavaScript"), follow that. A standalone helper the question asks for by name (e.g. "implement debounce", a deep clone) is written as that plain function, the way it would sit in a ${fw.label} codebase.`;
}

// Node + Express + React full-stack starter: the candidate's own repo layout
// (frontend/ Vite React on :5173 proxying /api, backend/ Express on :3001).
// A dedicated block (not the generic template) so the AI writes BOTH sides to
// this exact structure. Only reaches the prompt when this framework is picked,
// which is the fullstack profile only (PROFILE_FRAMEWORKS). Mirrors the VM
// starter at C:\projects\node-react-express.
function getNodeReactBlock() {
  return `\n\n## Framework: Node + Express + React (full-stack)
The candidate builds in a fixed full-stack starter: a **Vite React** frontend and an **Express** backend in one repo. When a coding question needs code (see "When code is needed" below) and leaves the stack open, write it for **this** structure. This is context, not a trigger: it never makes an answer need code and never changes which questions get code. The interview is about this stack, so a coding question gets this stack's code even when it doesn't name React, Express or Node.
- **Repo layout:** \`frontend/\` (Vite + React, JavaScript) and \`backend/\` (Express), with a root \`package.json\` whose \`npm run dev\` starts both. The frontend dev server runs on **5173**, the backend on **3001**; \`frontend/vite.config.js\` proxies \`/api\` -> \`http://localhost:3001\`.
- **A full-stack task gets both sides:** the Express route(s) in \`backend/server.js\` (or a router file) **and** the React piece in \`frontend/src/\` that calls it.
- **One file per code block, each as its own section:** never merge files into a single block. For each file give a short bold label naming its path (e.g. **\`backend/server.js\`**, **\`frontend/src/App.jsx\`**), then one line on what it does, then its own fenced code block — backend blocks first, then frontend — so each is easy to find and drop into the repo.
- **Keep the normal coding-answer sections across the files:** short numbered \`(n)\` comments inline on each logical line as usual, and the single **Implementation** list below is the deeper explanation — each \`(n)\` point explains its line in more depth (the logic, the API, the concept), as the coding-answer format already says. **Number the \`(n)\` comments continuously across all the files in code order — the first file's numbers run on into the next (backend \`(1)\`, \`(2)\`; frontend continues \`(3)\`, \`(4)\`, …), not restarting per file — so every code comment lines up with its Implementation point.** One Approach and one Implementation for the whole answer, not one per file.
- **Backend:** Express with \`express.json()\` and \`cors\` already set up; add routes under \`/api/...\`, use \`async\`/\`await\`, reply with \`res.json(...)\`, and handle errors with a status code + JSON body. Default to JavaScript (CommonJS \`require\`) unless the Implementation language above is TypeScript.
- **Frontend:** function components + hooks, \`.jsx\` (JavaScript). Fetch data with **relative** paths — \`fetch('/api/...')\` — because the Vite proxy forwards them; never hard-code \`http://localhost:3001\` in the client and don't add client-side CORS.
- **Scope to what's asked:** a clearly frontend-only question gets just the React code; a clearly backend-only question gets just the Express code; a standalone helper asked for by name (e.g. "implement debounce", a deep clone) is that plain function, the way it would sit in this repo.
- When the question or the code it gives uses a different stack, or explicitly asks for plain code (e.g. "in plain JavaScript"), follow that instead.`;
}

// DSA / LeetCode practice: algorithm and data-structure problems in the
// selected language. No web-framework format block goes with it
// (getFrameworkDefaultsBlock), and its answers get no conversion buttons.
function getDsaBlock() {
  return `\n\n## Framework: DSA / LeetCode
The candidate selected DSA practice: coding questions are algorithm and data-structure problems (LeetCode style), solved in the Implementation language above — no framework, UI, components, HTTP or I/O code. This is context, not a trigger: a conceptual question ("what is a heap?", "explain dynamic programming") is still answered in words.
- Submission shape: the function or class the problem gives, with its exact signature. Otherwise the LeetCode signature for the Implementation language, e.g. \`class Solution { fun twoSum(nums: IntArray, target: Int): IntArray }\` in Kotlin, \`class Solution { public int[] twoSum(int[] nums, int target) }\` in Java, \`function twoSum(nums: number[], target: number): number[]\` in TypeScript, \`def twoSum(self, nums: List[int], target: int) -> List[int]\` inside \`class Solution\` in Python. No \`main\`, input parsing or printing unless asked; LeetCode's helper types (\`ListNode\`, \`TreeNode\`) are assumed given.
- The solution is the standard optimal approach an interviewer expects for this problem, not brute force. The Key idea names the pattern (hash map, two pointers, sliding window, binary search, BFS/DFS, heap, stack, prefix sums, dynamic programming, backtracking, union-find, …) and why it fits. In the Approach, the line right after \`**Key idea:**\` is always \`**Brute force:** <what it would do> — O(…) because <why>; <the pattern> gets it to O(…).\` (one line, no brute-force code), then the numbered steps, each saying what I do and why.
- Handle the edge cases this problem actually has (empty input, one element, duplicates, negatives, overflow, cycles, …) and name them in Implementation.
- Complexity is always Big-O time and space, derived from the lines responsible.
- Example flow is a dry run on the problem's example (or a small input), showing the key variables at each step.
- If the question clearly asks for framework or UI code, follow the question.`;
}

// Profiles whose answers can contain React/Vue code (frontend, fullstack).
function offersWebFrameworks(profileId) {
  return (PROFILE_FRAMEWORKS[profileId] || []).some(id => id === 'react' || id === 'vue3');
}

// The ONLY place that says which code format each web framework defaults to
// and what happens under Auto. Appended to web profiles after the Framework
// block, whatever the selection (Auto included), because a framework can also
// come from the question itself ("do it in Vue"). The conversion buttons
// (code-formats.js) produce the other formats on demand.
function getFrameworkDefaultsBlock(profileId, frameworkId = current) {
  if (!offersWebFrameworks(profileId) || frameworkId === DSA) return '';
  return `\n\n## Framework code format (only when an answer's code uses a framework)
- Which framework: the one the question, its given code or the earlier answer uses; otherwise the selected Framework above — when one is selected, it's the default for every coding question, whether or not the question names it. With no selection (Auto): React for UI work, and plain code (never wrapped in a component) for an algorithm/DSA problem or a standalone utility asked for by name (e.g. "implement debounce").
- Default format per framework:
  - React: function components + hooks, TypeScript (TSX), fenced \`\`\`tsx — JSX (\`\`\`jsx) when the Implementation language is JavaScript.
  - Vue 3: ${formats.getFormat('vue-composition-cdn').describe}.
  - Vue 2 (only when Vue 2 is selected or asked for): ${formats.getFormat('vue2-options-cdn').describe}.
  - No boilerplate in any Vue format — interviewers read the logic: the in-page form above has no page scaffolding (the page and Vue are already there), and an SFC is only its \`<template>\` and \`<script>\` (no \`<style>\` block, no \`main.js\`/app mount code). The template has only what the question renders (a logic-only question can be just the \`<script>\`). Write a complete runnable HTML page (\`<!DOCTYPE>\`, \`<head>\`, the Vue \`<script src>\`) only when the question asks for a full/runnable page, an \`index.html\` from scratch, or to design a page.
  - The Vue version comes from the selected Framework or the question, never from the API style: Options API under Vue 3 is still Vue 3 (\`createApp\` from the global \`Vue\`) — \`new Vue\` only when Vue 2 is selected or asked for.
  - Vue's script here is plain JavaScript (it runs in the browser without a build step), whatever the Implementation language.
  - A reusable component (one that takes props or emits events, e.g. "a component that takes a prop M") uses the same short form, not an SFC: register it (Vue 3 \`app.component('release-list', { props: [...], template: … })\` before \`.mount('#app')\`, Vue 2 \`Vue.component('release-list', { … })\` before \`new Vue\`) and use it inside \`#app\` with a sample prop value (e.g. \`<release-list :m="3"></release-list>\`). The browser lowercases attribute and tag names in the page's own template, so declare props in lowercase or camelCase and write them in kebab-case there — a prop the question calls \`M\` is declared as \`m\` (\`:M="3"\` would never reach a prop named \`M\`); \`maxItems\` is written \`:max-items\`. Component names are kebab-case (\`release-list\`).
- A format the question names or its given/earlier code already uses (single-file component / \`.vue\` / a Vite or Nuxt project, a full in-browser/CDN page, class component, plain JavaScript/JSX) wins over these defaults and carries into follow-ups. Naming only a Vue API style (Options API or Composition API) changes the style and keeps the in-page form above (e.g. Vue 3 Options API → ${formats.getFormat('vue-options-cdn').describe}); an SFC is written only when the question asks for one or the given code already is one. A full in-browser/CDN page is one complete HTML page (\`\`\`html) loading the framework from a CDN, with its script in plain JavaScript.`;
}

// Whether algorithm/DSA problems are expected: DSA, or Auto (mixed). A
// selected framework means framework work only.
function expectsAlgorithms(frameworkId) {
  return frameworkId === DSA || !FRAMEWORKS[frameworkId];
}

module.exports = {
  AUTO,
  DSA,
  expectsAlgorithms,
  getFrameworkOptions,
  getFramework,
  setFramework,
  getEffectiveLanguage,
  getFrameworkBlock,
  getFrameworkDefaultsBlock,
  offersWebFrameworks,
};
