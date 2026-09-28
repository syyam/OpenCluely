// Framework preference (React, Vue 3, Spring Boot, ...) — extra context for
// Gemini that sits alongside the coding-language selection. It never decides
// whether an answer gets code (that's answer-format.js); it only says which
// framework to build with when code is needed. 'auto' (the default) adds
// nothing to the prompt, so it behaves exactly as before the setting existed.
//
// In-memory like the coding language: resets to Auto on restart, and to Auto
// on a profile switch when the current pick isn't offered by the new profile.

// languages: coding-language ids the framework can be written in. When the
// selected language isn't one of them, the first one is used for prompts
// (Rails is Ruby no matter what the language dropdown says).
const FRAMEWORKS = {
  react: { label: 'React', languages: ['typescript', 'javascript'], idioms: 'function components and hooks, `useEffect` cleanup, custom hooks' },
  'react-native': { label: 'React Native', languages: ['typescript', 'javascript'], idioms: 'function components and hooks, core components (`FlatList`, `View`), `useEffect` cleanup' },
  vue3: { label: 'Vue 3', languages: ['typescript', 'javascript'], idioms: 'Composition API (`<script setup>`), `ref`/`computed`/`watch` with `onCleanup`' },
  vue2: { label: 'Vue 2', languages: ['typescript', 'javascript'], idioms: 'Options API `data`/`computed`/`watch`/`methods`, cleanup in `beforeDestroy`' },
  nextjs: { label: 'Next.js', languages: ['typescript', 'javascript'], idioms: 'App Router, server components by default, `"use client"` only where interactivity needs it' },
  nuxt: { label: 'Nuxt', languages: ['typescript', 'javascript'], idioms: 'auto-imported Composition API, `useFetch`/`useAsyncData` for data' },
  nodejs: { label: 'Node.js', languages: ['typescript', 'javascript'], idioms: 'async/await, middleware-based routing, centralized error handling' },
  'spring-boot': { label: 'Spring Boot', languages: ['kotlin', 'java'], idioms: 'annotations, constructor injection, controller → service → repository layers' },
  rails: { label: 'Ruby on Rails', languages: ['ruby'], idioms: 'conventions over configuration, ActiveRecord, RESTful controllers' },
  compose: { label: 'Jetpack Compose', languages: ['kotlin'], idioms: 'state hoisting, `remember`/`LaunchedEffect`, ViewModel + `StateFlow`' },
  'android-views': { label: 'Android Views (XML)', languages: ['kotlin', 'java'], idioms: 'ViewBinding, ViewModel + LiveData/`StateFlow`, `RecyclerView` + `ListAdapter`' },
};

// Options offered per resume profile (ids from candidate-context.js PROFILES).
const PROFILE_FRAMEWORKS = {
  android: ['compose', 'android-views', 'react-native', 'spring-boot'],
  frontend: ['react', 'react-native', 'vue3', 'vue2', 'nextjs', 'nuxt'],
  fullstack: ['react', 'react-native', 'vue3', 'vue2', 'nextjs', 'nuxt', 'nodejs', 'spring-boot', 'rails'],
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
  if (!fw || !language || fw.languages.includes(String(language).toLowerCase())) return language;
  return fw.languages[0];
}

// Appended to the system prompt right after the Implementation language
// block (prompt-loader.js). '' for Auto/unknown ids. The file format a
// framework's code is written in lives in getFrameworkDefaultsBlock.
function getFrameworkBlock(frameworkId) {
  const fw = FRAMEWORKS[frameworkId];
  if (!fw) return '';
  return `\n\n## Framework: ${fw.label}
The candidate selected ${fw.label} as the framework. When code is needed (see "When code is needed" below) and the question leaves the framework open, write it with ${fw.label}, using ${fw.label}'s own idiomatic APIs and patterns (${fw.idioms}), not another framework's or version's. This is context, not a trigger: it never makes an answer need code and never changes which questions get code. When the question or the code it gives uses a different framework, or asks for plain code without one, follow that. Code where no framework applies (e.g. an algorithm/DSA function) stays plain.`;
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
function getFrameworkDefaultsBlock(profileId) {
  if (!offersWebFrameworks(profileId)) return '';
  return `\n\n## Framework code format (only when an answer's code uses a framework)
- Which framework: the one the question, its given code or the earlier answer uses; otherwise the selected Framework above; with no selection (Auto), React. A question that needs no framework (algorithms/DSA, utilities, plain logic) gets plain code — never wrap it in a component.
- Default format per framework:
  - React: function components + hooks, TypeScript (TSX), fenced \`\`\`tsx — JSX (\`\`\`jsx) when the Implementation language is JavaScript.
  - Vue 3: single-file component (SFC) with the Composition API — \`<script setup lang="ts">\` + \`<template>\` (plain \`<script setup>\` when the Implementation language is JavaScript) — fenced \`\`\`vue.
  - Vue 2 (only when Vue 2 is selected or asked for): SFC with the Options API in JavaScript, fenced \`\`\`vue.
- A format the question names or its given/earlier code already uses (Options API, in-browser/CDN page, class component, plain JavaScript/JSX) wins over these defaults and carries into follow-ups. An in-browser/CDN version is one complete HTML page (\`\`\`html) loading the framework from a CDN, with its script in plain JavaScript.`;
}

module.exports = {
  AUTO,
  getFrameworkOptions,
  getFramework,
  setFramework,
  getEffectiveLanguage,
  getFrameworkBlock,
  getFrameworkDefaultsBlock,
  offersWebFrameworks,
};
