profiles: frontend

<!-- Frontend interview question bank. Only entries whose keys match the
current question are sent to Gemini (see src/core/knowledge.js). Rename or
delete this file to switch the bank off after the interview. -->

## Exercise A — Vue 3 search interface (main task)
id: ex-a-task
group: exercise-a
keys: !vue 3 search, !search interface, !fake backend, !fake api, !index html, search box, search input, user selection, select a user, select user, list of users, vue 3, vue cdn, single file, search, vue, view, api, fetch*, name*, users
need: search*, fake*
Task: build a Vue 3 search UI in one `index.html` (Vue 3 from CDN, `createApp`), a fake backend, and selecting a user from the results.
- Fake backend: `fakeSearch(query, { signal })` returns a Promise that resolves after a **random delay** (e.g. 200-1500 ms) with users whose name includes the query. The random latency is deliberate, because it makes out-of-order responses possible. It must honor `signal`: on `abort` it clears its timer and rejects with `new DOMException('Aborted', 'AbortError')`.
- State: `query`, `results`, `loading`, `error`. Render the input with `v-model`, the loading and error states, and a list with `v-for` + `:key="user.id"`. Only when the question asks for selecting a user: a `selectedUser` set on click, showing its details. An empty query clears the results without a request.
- Search logic: a `watch(query, ...)` calls the search function and writes `results`, with loading/error handling and the empty-query guard. Debounce and cancelling the previous request (`AbortController`) go in only when the task statement asks for them; otherwise they are the usual next follow-ups (see the race / abort / debounce entries), so name them under possible improvements instead of building them upfront.
- Write the template lines and the `createApp`/`setup()` script as they go inside the given `index.html` (Vue already loaded from the CDN); the full page (head, the Vue `<script src>`) only when asked. Mention how you'd test it: type fast, watch that stale results never win.

## Exercise A follow-up — race condition in search
id: ex-a-race
group: exercise-a
keys: !race condition, !overwrite, !out of order, earlier, older response, stale, newer, latest result, previous response, slower, arrives later, wrong results
- Why: every keystroke (or debounced call) starts a request, and responses don't come back in request order. If the request for "jo" is slower than the one for "john", "jo" resolves last and overwrites the newer "john" results. Latency varies (network, server), so ordering isn't guaranteed.
- Fixes:
  1. **Cancel the previous request** with `AbortController`: `controller?.abort(); controller = new AbortController(); fetch(url, { signal: controller.signal })`, and ignore `AbortError` in the catch. This also saves bandwidth and server work.
  2. **Request id / latest-only guard**: `const id = ++latestId; const data = await search(q); if (id !== latestId) return;`. This works even when the API can't be cancelled.
  3. In Vue 3 you can use the watcher's `onCleanup` (`watch(query, (q, _, onCleanup) => { const c = new AbortController(); onCleanup(() => c.abort()) ... })`).
- Best: cancel with `AbortController` (the standard fix); a request-id guard only when the API can't be cancelled. Debounce is separate (it reduces calls, it doesn't fix ordering).

## Exercise A follow-up — cancel the previous request with AbortController
id: ex-a-abort
group: exercise-a
keys: !cancel the previous request, !cancel the old, abort controller, abort, cancel, previous request, new search starts, signal, abort error
- Keep one controller outside the search function: `let controller = null`.
- On every new search: `controller?.abort()` → `controller = new AbortController()` → pass `controller.signal` to `fetch` (or to the fake backend).
- The aborted promise rejects with `AbortError`: `catch (e) { if (e.name === 'AbortError') return; error.value = e.message }`, so it is not shown as an error and doesn't clear loading for the newer request.
- A fake backend must support it: `signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) })`, and check `signal.aborted` up front.
- Also abort on unmount (`onBeforeUnmount(() => controller?.abort())`), and set loading only for the latest request: keep this request's controller in a local `const c = new AbortController(); controller = c`, and in `finally` clear loading only `if (controller === c)`. (Checking `controller.signal.aborted` there is a bug: by then `controller` may already be the newer request's.)
- Abort cancels the *client side*; the server may still process the request, which is fine for idempotent GET searches.

## Exercise A follow-up — implement debounce manually (no lodash)
id: ex-a-debounce
group: exercise-a
keys: !implement debounce, !implement a debounce, !debounce function, !write debounce, !write a debounce, debounc*, without lodash, lodash, settimeout, cleartimeout, delay, wait until, stops typing
- Debounce = run the function only after calls have stopped for `wait` ms.
- It's a **higher-order function** that returns a new function and keeps the timer in a **closure**:
  ```js
  function debounce(fn, wait = 300) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);                              // cancel the pending call
      timer = setTimeout(() => fn.apply(this, args), wait); // schedule the latest
    };
  }
  ```
- Each call clears the pending timeout and schedules a new one, so only the last call in a burst runs. `...args` / `apply(this)` keep arguments and `this`.
- Optional extras: `.cancel()` (clearTimeout on unmount), leading edge; throttle is different (at most once per interval).

## Exercise A follow-up — where to create the debounced function
id: ex-a-debounce-placement
group: exercise-a
keys: !inside the watcher, !recreate*, !created once, where should, create it, created, watcher, watch, setup, once, every time, placement, instance
- Create the debounced function **once** per component instance: in `setup()` / `<script setup>` top level (Composition API) or in `created()` (Options API: `this.debouncedSearch = debounce(this.search, 300)`), then call it from the watcher.
- Why not inside the watcher: every call of `debounce()` creates a **new closure with its own timer**. Creating it inside the watcher gives each keystroke a fresh debouncer that has no pending timer to clear, so every keystroke still fires after the delay and nothing is debounced.
- Don't put it in `methods: { search: debounce(...) }` in the Options API either: that one function is shared by **all component instances** (one shared timer); create it per instance in `created`.
- Clear it on unmount (a `cancel` method, or clearTimeout) so it doesn't fire after the component is gone.

## Exercise A follow-up — does debounce alone fix the race condition?
id: ex-a-debounce-vs-race
group: exercise-a
keys: !debounce alone, !solve the race, !fix the race, !debounce enough, alone, enough, different problems, both, race
- **No.** Debounce reduces *how many* requests are sent (only after the user pauses). It doesn't control *the order responses arrive in*.
- The user can type, pause longer than the debounce delay (request 1 sent), type again, pause (request 2 sent); if request 1 is slower it still overwrites request 2.
- They solve different problems: debounce = fewer calls, less load, less flicker; cancellation (`AbortController`) or a latest-request id guard = correctness of the result. Use both together.

## Exercise B — implement expect(x).toBe(y)
id: ex-b-expect
group: exercise-b
keys: !expect x, !implement tobe, tobe, to be y, expect, closure, matcher, assertion, test library
- `expect(actual)` returns an object whose methods remember `actual` through a **closure**:
  ```js
  function expect(actual) {
    return {
      toBe(expected) {
        if (!Object.is(actual, expected)) {
          throw new Error(`Expected ${String(actual)} to be ${String(expected)}`);
        }
        return true;
      },
    };
  }
  ```
- **Closure:** `toBe` runs later, after `expect` has returned, and still reads `actual` because the returned object closes over it.
- Use `Object.is`, the same as Jest's `toBe`: unlike `===`, `Object.is(NaN, NaN)` is `true` and `Object.is(0, -0)` is `false`. For objects it compares **references**, not content.
- Throw on failure (a test runner catches it); returning true/false is also acceptable if the interviewer asks for that.
- Typing: `actual: unknown` / `expected: unknown` rather than `any` — nothing is done with the values except compare them, and `unknown` stops accidental property access.
- This is the whole first step. `not`, `toEqual` and deep equality are the usual follow-ups, not part of this answer.

## Exercise B follow-up — add not.toBe
id: ex-b-not
group: exercise-b
keys: !not tobe, !not to be, negat*, not, invert, opposite
- Smallest change: keep `toBe` exactly as it is and add a `not` object next to it with its own `toBe` that fails when the values **are** the same:
  ```js
  function expect(actual) {
    return {
      toBe(expected) { /* unchanged */ },
      not: {
        toBe(expected) {
          if (Object.is(actual, expected)) {
            throw new Error(`Expected ${String(actual)} not to be ${String(expected)}`);
          }
          return true;
        },
      },
    };
  }
  ```
- `not` is a plain property holding another object, so `expect(5).not.toBe(6)` is just a property access and a method call. The inner `toBe` still reads `actual` through the same closure.
- Possible improvement only if asked (e.g. once there are several matchers): build both sets from one `makeMatchers(negate)` helper so every new matcher gets `not` for free, or expose `not` as a getter (`get not() { … }`) so it's only built when used.

## Exercise B follow-up — NaN, === vs Object.is
id: ex-b-nan
group: exercise-b
keys: !object is, !nan, strict equality, triple equals, same value, samevalue, negative zero, signed zero
- `===` (strict equality) and `Object.is` (the SameValue algorithm) agree on everything except two cases:
  - `NaN === NaN` is `false`, but `Object.is(NaN, NaN)` is `true`.
  - `0 === -0` is `true`, but `Object.is(0, -0)` is `false`.
- `===` isn't "wrong": it follows the IEEE 754 number comparison rules (NaN is unequal to everything, +0 equals -0). `Object.is` asks a different question, "is this the same value?", which is what an assertion wants.
- So `expect(NaN).toBe(NaN)` should pass. With `Object.is` it already does; with `===` it would fail, and switching the comparison to `Object.is` is a one-line change.
- For objects both compare **references**, so neither makes `{a: 1}` equal `{a: 1}` (that's `toEqual`).

## Exercise B follow-up — add toEqual for objects
id: ex-b-toequal
group: exercise-b
keys: !implement toequal, !add toequal, !add a toequal, toequal, to equal, compare objects, by value, objects
- **Reference vs value:** `{a: 1} === {a: 1}` is `false` — two object literals are two different objects in memory, and `===`/`Object.is` compare references. `toEqual` compares **structure** instead.
- First step, one level (shallow) — add a small `isEqual(a, b)` and a `toEqual` matcher next to `toBe`, leaving `toBe` unchanged:
  - `Object.is(a, b)` → true (primitives, NaN, the same reference).
  - If either one isn't an object or is `null` → false (**`typeof null === 'object'`**, so `null` needs its own check).
  - Same number of own keys (`Object.keys`), every key of `a` also exists in `b` (`Object.hasOwn(b, key)` — otherwise `{a: undefined}` would equal `{b: undefined}`), and the two values are `Object.is`-equal.
- Add `not.toEqual` only if `not` already exists in the code (mirror what was done for `toBe`).
- Nested objects, recursion and special types are the next follow-ups — leave them out of this step.

## Exercise B follow-up — deep equality for nested objects
id: ex-b-deep
group: exercise-b
keys: !nested object*, !deep equal*, !deep equality, !make it recursive, nested, shallow, deep, recursive, recursion
need: equal*, toequal, isequal, object*
- **Recursion:** a nested object is the same problem one level down, so the per-key check changes from `Object.is(a[k], b[k])` to `isEqual(a[k], b[k])` — the function calls itself. The `Object.is` / non-object checks at the top are the base case that stops it.
- **Arrays are objects** in JavaScript, so the same key loop works for them (indexes are keys); add `Array.isArray(a) !== Array.isArray(b)` → false so `[1]` doesn't equal `{0: 1}`.
- Keep everything else unchanged; this is usually a one- or two-line change to `isEqual`.

## Exercise B follow-up — what other cases should deep equality handle
id: ex-b-edge-cases
group: exercise-b
keys: !other cases, !what else, !edge cases, !circular, date, regexp, map, set, cycl*, undefined, prototype
need: equal*, toequal, isequal, deep
- Mention, don't implement unless asked:
  - `Date` (compare `getTime()`), `RegExp` (compare `source` and `flags`).
  - `Map`/`Set` (same size, compare entries — keys of a plain object loop don't see their contents).
  - Circular references (`a.self = a`): recursion never ends → track visited pairs in a `WeakMap`.
  - `undefined` properties: Jest's `toEqual` treats `{a: undefined}` like `{}`; `toStrictEqual` doesn't. Also different prototypes / class instances.
  - Key order doesn't matter (`Object.keys` + lookup), and `NaN` inside objects already works because of `Object.is`.

## Exercise C — Vue Options API: render a list from 1 to N
id: ex-c-options-list
group: exercise-c
keys: !1 to n, !number n, !list from 1, options api, option api, vue options, options based, render a list, v for, input, n
Written in the Options API (`data`, `computed`), not `setup`.
```html
<div id="app">
  <input type="number" v-model.number="n" min="0" step="1" placeholder="Enter N" />
  <p v-if="error">{{ error }}</p>
  <ul><li v-for="i in count" :key="i">{{ i }}</li></ul>
</div>
<script>
  Vue.createApp({
    data() { return { n: 5 }; },
    computed: {
      count() {                      // guarded, always a safe integer
        const v = Number(this.n);
        if (this.n === '' || !Number.isFinite(v) || v < 0) return 0;
        return Math.min(Math.floor(v), 1000);
      },
      error() { /* message for empty, negative or decimal input */ },
    },
  }).mount('#app');
</script>
```
- Put the guard in a `computed`, so the template only ever gets a clean integer, and cap very large N so the page doesn't freeze.

## Exercise C follow-up — why v-for over a number starts at 1
id: ex-c-vfor
group: exercise-c
keys: !starts at 1, !start at 1, !start from 1, !v for over a number, !n in 10, range, why 1, not 0, zero
- `v-for="i in 10"` is Vue's **integer range** syntax: it repeats the template `10` times with `i = 1..10`, **1-based**, unlike array indexes. That's why no `+ 1` is needed to show 1..N.
- For a 0-based index you'd use `v-for="(item, index) in array"`; with a number, `v-for="(i, idx) in 10"` also gives a 0-based `idx`.
- The value must be an integer: a decimal or negative number is invalid, which is one more reason to guard the input.

## Exercise C follow-up — v-model.number
id: ex-c-vmodel-number
group: exercise-c
keys: !v model number, !model number, modifier, string, parsefloat, cast, number modifier
- An `<input>` always gives **strings**, even with `type="number"`. `.number` casts the value with `parseFloat` on each update, so `n` is a number and `n + 1` isn't string concatenation.
- If the value can't be parsed (empty field, just "-"), it keeps the **raw string**, e.g. `''`. So `.number` doesn't replace validation.
- Related modifiers: `.trim` and `.lazy` (update on `change` instead of `input`).

## Exercise C follow-up — guard against empty, negative and decimal input
id: ex-c-guards
group: exercise-c
keys: !empty values, !negative number*, !decimal*, guard*, validat*, edge case*, invalid input, negative, empty
- **Empty:** `v-model.number` gives `''` → treat it as 0 or show "Enter a number"; don't render `v-for` over a string.
- **Negative:** `v-for` over a negative number is invalid (Vue warns / renders nothing, and older versions throw a range error) → clamp to 0 and show a message.
- **Decimal:** `v-for` needs an integer (`5.5` is not a valid range) → `Math.floor` or reject with a message; use `step="1"` on the input.
- Also: NaN / non-finite input, and a very large N (cap it, e.g. 1000, or virtualize) so the tab doesn't freeze.
- Keep the guard in a computed (`count`) and let the template use only that clean value. The input's `min` / `step` attributes help UX but don't guarantee valid data.

## Retries when the server fails immediately and the user keeps pressing the button
id: q-retry-ux
group: reliability
keys: !presses the button, !repeatedly press*, !keeps clicking, !double submit, !fails immediately, button, repeatedly, retry, retries, server fails, user experience
- **Prevent duplicate requests:** disable the button / show a spinner while a request is in flight (or ignore clicks while pending); for writes send an **idempotency key**, so a repeat never double-charges or double-books.
- **Classify the failure:** network error / 5xx / 429 are retryable; 4xx validation or auth errors are not (show the reason and how to fix it).
- **Automatic retry for retryable errors:** a few attempts with exponential backoff + jitter behind the scenes, and a clear status ("Retrying…", then "Something went wrong, try again"). Keep the user's input.
- **If it keeps failing:** stop auto-retrying, show a clear error with a manual Retry, and optionally a circuit breaker (stop calling for N seconds and say the service is temporarily unavailable) so hammering the button doesn't hammer the server. Detect offline with `navigator.onLine` / the `online` event.
- Log it to Sentry with context (endpoint, status, attempt count) for monitoring.

## Retry with backoff, and when to stop retrying
id: q-backoff
group: reliability
keys: !backoff, !exponential, !stop retrying, !when would you stop, retry, retries, jitter, give up, max attempts
- **Exponential backoff:** delay = base × 2^attempt (e.g. 500 ms, 1 s, 2 s, 4 s) with a max delay cap.
- Add **jitter** (random 0-100% of the delay) so many clients don't retry at the same moment (thundering herd).
- Honor a `Retry-After` header on 429/503.
- Only retry **idempotent** requests (GET, or writes with an idempotency key), and only on retryable errors (network, timeout, 5xx, 429).
- **Stop when:** max attempts reached (e.g. 3-5); a total time budget is exceeded; the error is non-retryable (4xx); the user navigated away or started a newer action (abort it with `AbortController`); or the circuit breaker is open after repeated failures. Then show the error and a manual retry.

## Monitoring a frontend app in production
id: q-monitoring
group: observability
keys: !monitor*, !in production, !observability, sentry, crash, error tracking, rum, real user, alert*
- **Errors:** Sentry with uploaded **source maps**, release/version tags, environment, breadcrumbs, user/session context; alerts on new issues and error-rate spikes after a release.
- **Performance / RUM:** collect Core Web Vitals from real users (`web-vitals` library → analytics / Sentry performance), track p75 LCP / INP / CLS per page and device type, plus API latency and failed requests.
- **Lab checks:** Lighthouse (and Lighthouse CI in the pipeline) with performance budgets to catch regressions before release; Chrome DevTools performance profiling for specific slow interactions.
- **Business signals:** conversion / funnel drop-offs, checkout failures, and release health (crash-free sessions).
- **Backend correlation:** a request id so a frontend error can be traced in backend logs.

## Core Web Vitals — LCP, INP, CLS
id: q-cwv
group: performance
keys: !core web vitals, !web vitals, !lcp, !inp, !cls, largest contentful paint, interaction to next paint, cumulative layout shift, page speed, performance metrics
Measured at the **75th percentile** of real users.
- **LCP (Largest Contentful Paint):** how long until the main content (hero image / headline) is visible. Good ≤ **2.5 s**.
  - Improve: fast TTFB (CDN, caching, SSR / SSG); preload the LCP image (`fetchpriority="high"`, never lazy-load it); modern formats (AVIF / WebP), right-sized `srcset`; remove render-blocking CSS / JS; inline critical CSS; `preconnect` to origins.
- **INP (Interaction to Next Paint, replaced FID in 2024):** latency from a user interaction to the next frame. Good ≤ **200 ms**.
  - Improve: break up long tasks (> 50 ms) and yield (`scheduler.yield` / `setTimeout`); less JS (code splitting, remove unused libraries); debounce expensive handlers; avoid large re-renders (memoization, virtualization of long lists); move heavy work to a Web Worker.
- **CLS (Cumulative Layout Shift):** unexpected layout movement. Good ≤ **0.1**.
  - Improve: `width` / `height` or `aspect-ratio` on images, video and embeds; reserve space for ads, banners and async content; `font-display` + font preloading / size-adjust to avoid font swap shifts; animate with `transform`, not layout properties.
- Measure with RUM (`web-vitals`) + Lighthouse / PageSpeed Insights + DevTools Performance.
- Optimization flow: measure first (Lighthouse / RUM / DevTools Performance flame chart) → find the bottleneck (long tasks, big bundles, render-blocking resources, unnecessary re-renders) → fix → verify with the same measurement, and add a budget / CI check so it doesn't regress.

## Vuex vs Pinia
id: q-pinia
group: vue-state
keys: !pinia, !vuex, vue store, state management in vue, store
- **Vuex vs Pinia:** Pinia is the official successor. There are no mutations (actions change state directly), full TypeScript inference, modular stores instead of one big nested module tree, lighter, and devtools support. Only put *shared* state in stores; local UI state stays in components, and server data caching can stay in composables.

## TypeScript in a large codebase
id: q-typescript
group: typescript
keys: !typescript, !type script, !ts, types, typing, generics, type safety
- Typical usage:
  - `strict` mode; typed API contracts (request / response types shared or generated, so a backend change breaks the build instead of production).
  - **Discriminated unions** for UI and request states (`{ status: 'loading' } | { status: 'error'; error } | { status: 'success'; data }`).
  - Generics for reusable components and hooks / composables; utility types (`Partial`, `Pick`, `Omit`, `Record`); `unknown` + narrowing / type guards at API boundaries instead of `any`.
  - Typed props / emits in Vue; typed stores in Pinia.
- Value: safer refactors in a big multi-team codebase, better autocomplete / documentation, and bugs caught in CI.

## State sharing between micro-frontends
id: q-singlespa-state
group: architecture
keys: !share state, !sharing state, !shared state, !state sharing, single spa, micro frontend*, microfrontend*, between apps, module federation, root config, parcels
- Principle: keep micro-frontends **loosely coupled**. Share as little state as possible, and only through explicit contracts, not one global Redux / Pinia store that every app imports (that recreates a monolith and couples deploys).
- Options, from least to most coupled:
  1. **URL / routing** as shared state (the current item, search params).
  2. **Props from the host / shell**: `customProps` in single-spa `registerApplication`, or props passed to a Module Federation remote component, for things like the auth / session provider or locale.
  3. **Browser events**: `CustomEvent` on `window` or a small pub / sub bus for events such as "cart updated" or "user logged out".
  4. A **shared singleton module** for truly cross-cutting state (auth, user profile): a Module Federation `shared` singleton, or a single-spa "utility" module in the import map, exposing a small observable store + typed API. Every app subscribes; there's one version.
- Also: shared framework dependencies as singletons (Module Federation `shared` / single-spa import maps) to avoid duplicate React copies, versioned typed event contracts, each app still owns its own local state, and apps must handle missing / late state (mounted in any order).

## Vue virtual DOM
id: q-vue-vdom
group: vue-internals
keys: !virtual dom, !vdom, !vnode*, diff*, patch*, reconcil*, render function
- The virtual DOM is a lightweight **JS object tree (VNodes)** describing the UI. Templates compile to **render functions** that return VNodes.
- On a state change, the component re-renders to a new VNode tree, Vue **diffs** it against the previous one (patch), and applies only the minimal real DOM operations. Real DOM operations and layout are the expensive part.
- Why it's useful: declarative code (describe the UI for a given state), batching (updates are queued and flushed in one tick, see `nextTick`), cross-platform renderers (SSR, native), and good-enough performance without manual DOM work.
- Vue 3 specifics:
  - **compiler-informed** VDOM: static hoisting, **patch flags** (only dynamic bindings are checked), and block trees (skip static subtrees), so diffing is much cheaper than a naive full diff.
  - Reactivity tracks dependencies **per component**, so only affected components re-render (vs React re-rendering the subtree by default).
- `:key` in `v-for` lets the diff reuse / move the right elements.

## Vue reactivity — Vue 2 Object.defineProperty vs Vue 3 Proxy
id: q-vue-reactivity
group: vue-internals
keys: !reactivity, !defineproperty, !define property, !proxy, vue 2, vue 3, getter, setter, reactive, dependency tracking
- Both use the same model: **track** dependencies on read (getter) and **trigger** effects on write (setter); an effect = component render, computed, or watcher.
- **Vue 2, `Object.defineProperty`:** walks the object at init and converts each existing property into a getter / setter. Limitations:
  - It can't detect **added / deleted properties** (needs `Vue.set` / `Vue.delete`).
  - It can't detect **array index assignment / length change** (arrays are handled by patching mutating methods such as push and splice).
  - Deep objects are converted eagerly, which is slower for big data.
- **Vue 3, `Proxy`:** `reactive()` wraps the whole object in a Proxy with `get` / `set` / `deleteProperty` / `has` / `ownKeys` traps, so added / deleted properties, array indexes / length, `Map` / `Set` all just work. Nested objects are made reactive **lazily** on access, which is faster and uses less memory. `ref()` for primitives (`.value`, getter / setter based).
- Trade-offs: Proxy isn't polyfillable (no IE11, which is why Vue 2 used defineProperty); the Proxy is not identical to the raw object (`toRaw`); destructuring `reactive` loses reactivity (`toRefs`).

## React vs Vue
id: q-react-vs-vue
group: vue-internals
keys: !react vs vue, !vue vs react, !compare react, !react and vue, !difference between react and vue, react, vue, compare
- **Reactivity model:**
  - Vue has **fine-grained reactivity**: it tracks dependencies, so only components whose data changed re-render.
  - React re-runs the component function on state change and re-renders its subtree by default. You optimize with `memo` / `useMemo` / `useCallback` (the React Compiler automates some of this).
- **Templates vs JSX:** Vue uses HTML-like templates (compiler optimizations, directives like `v-if` / `v-for` / `v-model`) with optional JSX; React uses JSX = just JavaScript.
- **State updates:** Vue mutates reactive state directly; React uses immutable updates with `setState`.
- **Ecosystem:**
  - Vue is more "batteries included / official" (Vue Router, Pinia, Nuxt).
  - React is a library with a larger ecosystem and more choices (Next.js, Redux / Zustand, React Query), plus **React Native** for mobile.
- **Learning curve:** Vue is gentler to start. React is more flexible at scale; it's more popular in big companies and has the bigger talent pool.

## CSP, XSS and token handling
id: exp-security
group: security
keys: !csp, !content security policy, !xss, !cross site scripting, !token*, !auth token, security, secure frontend, jwt, cookie, localstorage, csrf, sanitiz*
- XSS: frameworks escape by default, so avoid `v-html` / `dangerouslySetInnerHTML` with untrusted data (sanitize with DOMPurify if needed); validate URLs (no `javascript:`); CSP as defense in depth.
- CSP: `script-src 'self'` + nonces / hashes, no `unsafe-inline` / `unsafe-eval`, `object-src 'none'`, `frame-ancestors`, report-uri / report-to for violations; roll out with `Content-Security-Policy-Report-Only` first.
- Tokens:
  - Prefer **HttpOnly, Secure, SameSite** cookies (JS can't read them); otherwise keep the access token in memory, not `localStorage`.
  - Short-lived access token + refresh-token rotation; CSRF protection when using cookies (SameSite + CSRF token).
  - Never log tokens; clear them on logout.
