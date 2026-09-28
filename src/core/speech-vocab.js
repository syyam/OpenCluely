// Whisper vocabulary hint (initial_prompt) for the active profile + framework.
// Biases decoding toward technical terms so they aren't misheard as
// sound-alike words ("v-for" -> "V4", "Zustand" -> "ZulStrand", "BFF" ->
// "VFF"). Whisper keeps only the LAST ~224 prompt tokens, so the most
// specific terms (the selected framework) go last and the list stays a flat
// comma-separated list rather than prose.

const COMMON = 'API, REST, GraphQL, CI/CD, Git, Docker, Kubernetes, architecture, BFF, Rakuten GORA, UPaisa';

const PROFILE_TERMS = {
  android: 'Kotlin, Coroutines, Flow, StateFlow, Android, Jetpack Compose, ViewModel, Retrofit, Room, Hilt, Dagger, Gradle, AOSP, RxJava, lifecycle, dependency injection, React Native',
  frontend: 'TypeScript, JavaScript, React, React Native, Next.js, useState, useEffect, Redux Toolkit, Zustand, TanStack Query, Vue.js, Nuxt, Pinia, Webpack, Module Federation, single-spa, Vite, Vitest, Playwright',
  fullstack: 'TypeScript, JavaScript, React, Next.js, Zustand, TanStack Query, Vue.js, Node.js, Express, Spring Boot, Kotlin, Ruby on Rails, PostgreSQL, Redis, Kafka, microservices',
};

// Framework-specific terms, placed last so they survive prompt truncation.
const FRAMEWORK_TERMS = {
  react: 'React hooks, useState, useEffect, useMemo, useCallback, useRef, useContext, JSX, props, key',
  'react-native': 'React Native, FlatList, View, StyleSheet, useEffect, Expo, Metro, Hermes',
  vue3: 'Vue 3, Composition API, script setup, v-for, v-if, v-else, v-show, v-model, v-bind, v-on, :key, ref, reactive, computed, watch, watchEffect, defineProps, defineEmits, onMounted, Pinia',
  vue2: 'Vue 2, Options API, v-for, v-if, v-else, v-show, v-model, v-bind, v-on, :key, data, computed, watch, methods, mounted, Vuex',
  nextjs: 'Next.js, App Router, server components, use client, getServerSideProps, middleware',
  nuxt: 'Nuxt, v-for, v-if, v-model, useFetch, useAsyncData, composables, Pinia',
  nodejs: 'Node.js, Express, middleware, async/await, event loop, npm',
  'spring-boot': 'Spring Boot, Kotlin, @RestController, @Service, JPA, Hibernate, WebFlux',
  rails: 'Ruby on Rails, ActiveRecord, migrations, controllers, Sidekiq',
  compose: 'Jetpack Compose, remember, LaunchedEffect, recomposition, State hoisting, Modifier',
  'android-views': 'RecyclerView, ListAdapter, ViewBinding, LiveData, Fragment, Activity',
};

// Frontend/fullstack with the framework on Auto: interviewers still ask Vue
// template questions, so keep the directive names in the hint.
const WEB_AUTO_TERMS = 'Vue 3, Composition API, v-for, v-if, v-model, v-bind, ref, reactive, computed, watch';

function getWhisperPrompt(profileId, frameworkId) {
  const parts = [COMMON, PROFILE_TERMS[profileId] || PROFILE_TERMS.android];
  if (FRAMEWORK_TERMS[frameworkId]) {
    parts.push(FRAMEWORK_TERMS[frameworkId]);
  } else if (profileId === 'frontend' || profileId === 'fullstack') {
    parts.push(WEB_AUTO_TERMS);
  }
  return parts.join(', ');
}

module.exports = { getWhisperPrompt };
