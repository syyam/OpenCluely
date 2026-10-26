// Whisper vocabulary hint (initial_prompt) for the active profile + framework.
// Biases decoding toward technical terms so they aren't misheard as
// sound-alike words ("v-for" -> "V4", "Zustand" -> "ZulStrand", "BFF" ->
// "VFF"). Whisper keeps only the LAST ~224 prompt tokens, so the most
// specific terms (the selected framework) go last and the list stays a flat
// comma-separated list rather than prose.

const COMMON = 'API, REST, GraphQL, CI/CD, Git, Docker, Kubernetes, architecture, BFF, Anthropic, MCP, sub-agents';

// My project names, in every profile. They sit after the profile terms, not
// in COMMON at the start, because a long hint (framework + answer terms) cuts
// the start off. Without them Whisper hears "Speeqr" as "speaker" (2026-10-01:
// three Speeqr questions got no notes) and Claude as "cloud" / "claw".
const PROJECTS = 'Rakuten GORA, Speeqr, WebRTC, Action Cable, UPaisa, Claude, Claude Code';

const PROFILE_TERMS = {
  android: 'Kotlin, Coroutines, Flow, StateFlow, Android, Jetpack Compose, ViewModel, Retrofit, Room, Hilt, Dagger, Gradle, AOSP, RxJava, lifecycle, dependency injection, React Native',
  frontend: 'TypeScript, JavaScript, React, React Native, Next.js, useState, useEffect, Redux Toolkit, Zustand, TanStack Query, Vue.js, Nuxt, Pinia, Webpack, Module Federation, single-spa, Vite, Vitest, Playwright',
  fullstack: 'TypeScript, JavaScript, React, Next.js, Zustand, TanStack Query, Vue.js, Node.js, Express, Spring Boot, Kotlin, Ruby on Rails, PostgreSQL, Redis, Kafka, microservices',
};

// Framework-specific terms, placed last so they survive prompt truncation.
// Vite is repeated in the Vue lists: next to v-for / v-if, "veet" came out
// as "v-it" / "V" (2026-10-02, eval-speech-terms S49-S51 hard 2/4 → 4/4).
const FRAMEWORK_TERMS = {
  dsa: 'LeetCode, Big O, time complexity, space complexity, hash map, HashMap, two pointers, sliding window, binary search, BFS, DFS, recursion, backtracking, memoization, dynamic programming, DP, heap, priority queue, stack, queue, deque, linked list, binary tree, BST, trie, graph, topological sort, union-find, prefix sum, monotonic stack, greedy',
  react: 'React hooks, useState, useEffect, useMemo, useCallback, useRef, useContext, JSX, props, key',
  'react-native': 'React Native, FlatList, View, StyleSheet, useEffect, Expo, Metro, Hermes',
  vue3: 'Vue 3, Vite, Composition API, script setup, v-for, v-if, v-else, v-show, v-model, v-bind, v-on, :key, ref, reactive, shallowRef, computed, watch, watchEffect, nextTick, defineProps, defineEmits, onMounted, Pinia',
  vue2: 'Vue 2, Options API, v-for, v-if, v-else, v-show, v-model, v-bind, v-on, :key, data, computed, watch, methods, mounted, Vuex',
  nextjs: 'Next.js, App Router, server components, use client, getServerSideProps, middleware',
  nuxt: 'Nuxt, Vite, v-for, v-if, v-model, useFetch, useAsyncData, composables, nextTick, Pinia',
  nodejs: 'Node.js, Express, middleware, async/await, event loop, npm',
  'spring-boot': 'Spring Boot, Kotlin, @RestController, @Service, JPA, Hibernate, WebFlux',
  rails: 'Ruby on Rails, ActiveRecord, migrations, controllers, Sidekiq',
  compose: 'Jetpack Compose, remember, LaunchedEffect, recomposition, State hoisting, Modifier',
  'android-views': 'RecyclerView, ListAdapter, ViewBinding, LiveData, Fragment, Activity',
};

// Frontend/fullstack with the framework on Auto: interviewers still ask Vue
// template questions, so keep the directive names in the hint.
const WEB_AUTO_TERMS = 'Vue 3, Vite, Composition API, v-for, v-if, v-model, v-bind, ref, reactive, computed, watch, nextTick';

// Names from the latest answer (its inline-code spans and the functions,
// methods and properties in its code) go at the very end of the hint, so a
// follow-up about the code just discussed ("and not toBe") is transcribed
// with those names instead of sound-alikes ("not 2d"). No fixed word list:
// the terms come from whatever the conversation is about.
const MAX_CONTEXT_TERMS = 20;
const NOT_TERMS = new Set(('if else for while do switch case break continue return function const let var new this class extends '
  + 'import export from default async await try catch finally throw typeof instanceof in of true false null undefined void '
  + 'console log error warn String Number Boolean Object Array Math JSON Promise Error Date Map Set length push pop map filter '
  + 'forEach reduce keys values entries includes slice then value prototype call apply bind get set has delete add name type '
  + 'div span template script input button label style class id key text html').split(' '));

function extractTerms(text) {
  const src = String(text || '');
  const found = [];
  const add = (t) => {
    const term = String(t || '').trim();
    if (term.length < 3 || term.length > 30 || NOT_TERMS.has(term) || found.includes(term)) return;
    if (!/^[A-Za-z_$][\w$.-]*[\w$]$/.test(term)) return;
    found.push(term);
  };
  // Inline code outside fences: `toBe`, `Object.is`, `v-for`, `useEffect()`.
  const prose = src.replace(/```[\s\S]*?```/g, ' ');
  for (const m of prose.matchAll(/`([^`\n]{2,40})`/g)) add(m[1].replace(/\(.*$/, ''));
  // Code: declared or called names (function expect, toBe(, .toEqual(, isEqual =).
  for (const block of src.matchAll(/```\w*\n([\s\S]*?)```/g)) {
    const code = block[1].replace(/\/\/.*$|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/gm, ' ');
    for (const m of code.matchAll(/(?:function|class)\s+([A-Za-z_$][\w$]*)|\.?([A-Za-z_$][\w$]*)\s*(?:\(|=\s*(?:\(|function|async))/g)) add(m[1] || m[2]);
  }
  return found.slice(0, MAX_CONTEXT_TERMS);
}

function getWhisperPrompt(profileId, frameworkId, contextTerms = []) {
  const parts = [COMMON, PROFILE_TERMS[profileId] || PROFILE_TERMS.android, PROJECTS];
  if (FRAMEWORK_TERMS[frameworkId]) {
    parts.push(FRAMEWORK_TERMS[frameworkId]);
  } else if (profileId === 'frontend' || profileId === 'fullstack') {
    parts.push(WEB_AUTO_TERMS);
  }
  const terms = (contextTerms || []).filter(Boolean).slice(0, MAX_CONTEXT_TERMS);
  if (terms.length) parts.push(terms.join(', '));
  return parts.join(', ');
}

module.exports = { getWhisperPrompt, extractTerms };
