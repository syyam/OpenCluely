topic: gora, rakuten, business innovation, b2b portal, admin portal, business portal
profiles: frontend, fullstack
app: customer side, customer platform, customer reservation*, reservation platform, booking*, golfer*, consumer, next js, nextjs, module federation, host shell
sibling: gora-bip

<!-- Rakuten GORA web frontend knowledge (source: "# Rakuten GORA — Frontend
Architect.txt"). The single place for GORA customer-platform frontend facts;
the B2B portal is in frontend-business-portal.md and backend/platform/mobile
facts are in backend.md. Sections are sent only when their keys
match. -->

## Rakuten GORA — frontend architecture overview
id: gora-fe-summary
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !gora, !rakuten, golf, reservation platform, tee time*, architecture, walk me through, current project, last project, tech stack, frontend architecture
- Overall picture: GORA's web side is **two separate frontends on the same Kotlin + Spring Boot BFF**: (1) the golfer-facing **customer reservation platform** (Next.js host shell + Webpack Module Federation), my main work, described below; (2) the operator-facing B2B **Business Innovation Portal** (React + single-spa business modules), where I built the golf-course addition / inventory features. The **React Native app** (iOS and Android) is the mobile version of the customer platform: the same golfer features on the same BFF.
- Rakuten GORA: a golf-course reservation platform used across Japan. I built user-facing features end to end in a large TypeScript React / React Native codebase.
- One-line framing: we didn't have to choose between an SPA and a server-rendered app. A **Next.js host shell** renders the SEO-critical pages on the server. The deep, transactional booking workflows are separate client-side **React 19 SPAs** that the shell loads at runtime with **Webpack Module Federation**. A **Kotlin + Spring Boot BFF** is the frontend-facing API.
- This is the customer-facing reservation platform and my main GORA work. In a general GORA / architecture answer, introduce both apps: the customer platform first and in full depth, then the portal after it, never at its expense; What I built is one section (customer features, then my portal work). Each app keeps its own flow and Tech stack line; never merge the portal into the customer flow or stack list.
- The Why: a pure SPA would hurt SEO and first load on weak mobile networks (golfers checking tee times on the go); pure SSR everywhere would make the booking flows and map experiences less fluid.
- Layers: Next.js shell (routing, layouts, RSC/SSR) → React micro-frontends (TypeScript, custom hooks, GRX design system on Tailwind) → state (Zustand for client state, TanStack Query for server state) → forms (React Hook Form + Zod) → Vite code splitting, Cloudflare CDN/Workers → BFF → testing (Vitest, Playwright), CI/CD (GitHub Actions), monitoring (Sentry, Datadog).
- End-to-end flow:
  ```text
  User → Next.js shell → React micro-frontend → TanStack Query → openapi-fetch client
       → Kotlin + Spring Boot BFF → backend services (in parallel)
       → aggregated UI response → React state → UI
  ```
- Business Innovation Portal (B2B, for golf-course operators): course management (inventory, pricing, turf records) in React, with single-spa mounting independently managed business modules from a root config. Talks to the backend only through REST → Kotlin BFF → Inventory / Billing / User Accounts services. My part: feature-level golf-course addition / inventory work. Its stack is React, single-spa, axios, Formik + Yup, REST and the Kotlin BFF, none of the customer platform's tools (Tailwind, GRX, Zustand, TanStack Query, React Hook Form, Zod, Vite, Next.js).
  ```text
  Business Innovation Portal (React + single-spa modules) → REST → Kotlin BFF → Inventory / Billing / User Accounts
  ```

## GORA — Next.js shell, server rendering and routing
id: gora-fe-rendering
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !next js, !nextjs, !server components, !server component, !rsc, !ssr, !server side render*, !app router, seo, ttfb, hydration, rendering, layout*, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- **Next.js (App Router)** is the global shell: global layouts, authentication guardrails, shared header and footer, structural navigation, and routing between the public and the interactive areas.
- Public, discovery-driven pages (homepage, golf-course directories, search-result lists, review pages) use **React Server Components** and server rendering.
- The Why: better SEO indexing and organic discovery, a smaller initial load and better TTFB on mobile networks, and accessible HTML from the first byte.
- Highly interactive areas (tee-time booking, player-profile management) are client-side React SPAs loaded into the shell (see micro-frontends).

## GORA — micro-frontends with Webpack Module Federation
id: gora-fe-microfrontends
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !module federation, !micro frontend*, !microfrontend*, !react router, host shell, remote*, routing, independent, client side routing, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- When a user enters an interactive area (tee-time booking, player-profile management, complex booking flows), the Next.js shell uses **Webpack Module Federation** to load an independent client-side React module at runtime, **without a full page reload**.
- Inside an active micro-frontend, **React Router DOM** handles client-side routing, so users move between screens in that domain without the parent Next.js shell reloading or changing context.
- The Why: server rendering where SEO and first load matter, a fluid SPA where interaction matters, and each interactive domain stays an independent module.
- The customer platform uses Module Federation, not single-spa; single-spa is used only in the separate B2B Business Innovation Portal.

## GORA — React components, custom hooks and the GRX design system
id: gora-fe-components
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !work at rakuten, !work at gora, !worked on at, !your role at, !role at rakuten, !grx, !gora rex, !design system, !custom hook*, !storybook, !component architecture, component*, tailwind, hooks, react 19, functional component*, reusable, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- Interactive micro-frontends use **React 19 + TypeScript** with functional components throughout; strict TypeScript interfaces sit on the business-logic boundaries.
- **Custom hooks** isolate booking-critical business logic: tee-off countdown calculations, group-size constraints, dynamic morning/evening pricing tiers.
- The Why: volatile business logic stays out of presentation components, so it's testable on its own and doesn't add render complexity.
- **GRX (Gora ReX)** is the proprietary design system: reusable React components styled with **Tailwind CSS**, e.g. calendar/date pickers, dynamic player counters, golf-course scorecard grids.
- **Storybook** to build and test components in isolation: mock states, iterate on UI behavior, validate design-system components.

## GORA — client state vs server state (Zustand, TanStack Query)
id: gora-fe-state
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !zustand, !tanstack, !react query, !state management, !manage state, !managed state, !server state, !client state, global state, state, caching, cache, refetch*, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- GORA separates **transient client state** from **asynchronous server state**.
- **Zustand** for lightweight global client state: user-session-related UI state, selected map filters, drawer state, multi-step booking progress.
- **TanStack Query (React Query)** for server state: loading and error states, query deduplication, background refetching and caching, e.g. course-availability data.
- Example: availability data stays cached when the user switches between the map view and the list view, so no duplicate network requests.
- The Why: server data has its own lifecycle (staleness, refetching, dedupe), so it doesn't belong in a UI store; keeping the store small keeps re-renders and complexity down.

## GORA — forms and validation (React Hook Form + Zod)
id: gora-fe-forms
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !react hook form, !zod, !form validation, form*, validation, validate, input*, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- Forms use **React Hook Form** for form state and **Zod** to validate and parse the form data.
- The Why: React Hook Form avoids unnecessary parent-level re-renders on every keystroke, and Zod gives strong, typed input validation.

## GORA — frontend ↔ BFF: API layer and data flow
id: gora-fe-api-bff
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !bff, !backend for frontend, !api contract, !api layer, !talk to the backend, !frontend and backend, api, apis, data fetching, fetch*, backend, communicat*, talk to, aggregat*, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
include: gora-bff, gora-auth
min: 3
- The frontend talks only to a dedicated **Kotlin + Spring Boot BFF**, which gives the UI a frontend-oriented API contract instead of exposing the underlying services to the browser.
- The BFF returns **one aggregated payload shaped for the React UI** (how it builds it is in the BFF notes); TanStack Query / the API layer fetches it and it lands in React state.
- The Why: the browser makes one request instead of many, and the React app is shielded from legacy data models and internal service boundaries. The frontend doesn't need to know each backend service.
- On the frontend side I work at this boundary: the API contract, loading/error/caching through TanStack Query, and the UI state built on the response.

## GORA — frontend performance, Vite code splitting and Cloudflare edge
id: gora-fe-performance
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !performance, !code splitting, !cloudflare, !vite, !bundle*, !lazy load*, slow network, mobile web, cdn, edge, workers, a b test*, peak, traffic, fast, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- **Vite** bundles the interactive micro-frontends with **code splitting**, so users download only the JavaScript for the current feature: someone checking a course map doesn't download payment code; booking code loads when they enter the booking flow.
- Server-rendered public pages (RSC/SSR in the Next.js shell) improve first load and TTFB; TanStack Query caching avoids duplicate requests (e.g. map ↔ list).
- **Cloudflare CDN** serves static assets and bundles close to users; **Cloudflare Workers** modify headers at the edge and use geographic / request info for region checks (e.g. routing and caching rules for traffic from inside vs outside Japan) and A/B testing before requests reach the origin. The site itself is Japanese only, so there is no language switching at the edge.
- At traffic peaks (e.g. weekend booking) the frontend side is: edge-cached assets, code splitting, TanStack Query caching and deduplication, avoiding request storms (debounce, cancellation, backoff with jitter), and graceful degradation.
- The Why: smaller initial JavaScript and edge delivery matter most on weak mobile networks.

## GORA — testing and CI/CD (Vitest, Playwright, GitHub Actions)
id: gora-fe-testing-ci
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !vitest, !playwright, !testing, !tests, !test*, !e2e, !end to end, !github actions, !ci cd, !cicd, !pipeline*, unit test*, react testing library, deploy*, quality, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- **Vitest + React Testing Library** for unit and component tests: fast runs, and tests that verify real user interactions and behavior (modal interactions, form input, state changes, user-driven UI flows).
- **Playwright** for complex end-to-end journeys: multi-step booking, cart-to-checkout, cross-domain interactions, run against staging.
- **MSW (Mock Service Worker)** mocks the BFF in Vitest and Storybook, with handlers typed from the same OpenAPI types as the API client.
- **Storybook** for developing and checking components in isolation.
- **GitHub Actions** CI/CD for the web frontend: run the automated tests and frontend quality checks, build the React application, produce deployment artifacts, and deploy successful builds.

## GORA — frontend monitoring (Sentry, Datadog)
id: gora-fe-observability
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !sentry, !datadog, !observability, !monitor*, !tracing, errors in production, production issue*, slow, debug*, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- **Sentry** captures frontend runtime errors and React rendering exceptions, so we see the client-side failures users actually hit in production.
- **Datadog** gives full-stack observability: request tracing connects a frontend performance problem to backend behavior.
  ```text
  Slow React UI → slow API request → Kotlin BFF → slow downstream service → slow database query
  ```
- The Why: performance problems are investigated across the whole request path instead of treating frontend and backend as separate systems.

## GORA — AI conversational assistant (frontend)
id: gora-fe-ai-assistant
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !ai assistant, !ai overlay, !conversational, !ai feature*, chatbot, natural language, llm, ai, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- GORA has an **AI assistant** integrated as an **isolated, lazy-loaded** component. A user can ask e.g. "Find a course near Chiba under ¥15,000."
- The assistant converts the natural-language request into parameters that go into the **existing TanStack Query / API flow**, so it reuses the normal search path.
- It keeps its own encapsulated state lifecycle instead of coupling to the rest of the frontend; lazy loading keeps it out of the initial bundle.

## GORA — subscription consistency across clients (app side)
id: gora-fe-billing
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
profiles: frontend
group: gora-fe
keys: !billing, !subscription*, !in app purchase*, !restore purchase*, receipt*, grace period, entitlement*, consistency, consistent, gora, rakuten, !proudest, !most proud, !proud of, !hardest problem, !biggest challenge, !biggest achievement, !most challenging, !hardest project, !challenging project
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, you handled, you solve*, golf, proud*, most proud, challeng*, hardest, biggest achievement
- Resume fact: the hardest cross-team problem on the product was keeping billing / subscription state consistent between the **iOS app, the Android app and the web**. Tell it as **my app-side part** in the TypeScript React / React Native codebase: the client flows, states and edge cases.
- **The backend was the single source of truth** for subscription state, reached through the BFF. The apps never decided entitlement on their own; they showed what the BFF returned and reconciled with it. Say this plainly, but the backend is what the app called, never backend code I wrote.
- App-side challenges and how we fixed them (the technical core of the story):
  1. **Receipt sync failed or was cut off**: the store purchase went through, but the app was killed or went offline before the BFF confirmed it. Fix: the app kept the pending receipt locally and re-sent it on the next launch / foreground until the BFF confirmed, and the retry was safe to repeat. Meanwhile the UI showed "confirming your purchase", never "expired".
  2. **Stale state across devices**: a renewal on the iPhone didn't show on the Android tablet or the web. Fix: subscription status is server state in **TanStack Query**, refetched on app focus / resume and invalidated right after a purchase or restore. Zustand only holds UI state, never entitlement.
  3. **Renewal grace periods**: a failed renewal charge still keeps access for a while. Fix: a clear "grace period, update your payment" state with access kept, driven by the status from the BFF, not by date math on the device.
  4. **Restore purchase on a new device or after reinstall**. Fix: a restore flow that asks the store for the user's receipts (react-native-iap `getAvailablePurchases`), sends them to the BFF, then re-reads the status, with clear success / nothing-to-restore / error states.
  5. **Web vs native**: the web has no in-app store but must agree with mobile. Fix: the web reads the same BFF status, and **shared TypeScript types** for the states (active / grace period / pending / expired) make every client render them the same way.
  6. **Double taps and duplicate purchases**. Fix: the purchase button is disabled while a purchase is pending, and receipt re-sends are idempotent.
- Also: payment and subscription data handled safely on the web and native clients; auth and session go through the BFF.
- Result: subscription state became consistent across devices and a lot more reliable for users. Don't invent metrics or incident / support-ticket counts; the only store library to name is react-native-iap.
- For "proudest project / biggest challenge": this is the main story. Tell it first and in full (the problem → my app-side part → **all six** challenges above, each with its fix → the result), never shortened to make room for anything else. Then add Speeqr as **"### Also proud of: Speeqr"**. If the question names only one project, answer just that one.

## GORA — how the Vite micro-frontends load into the Next.js host (Module Federation runtime)
id: gora-fe-mf-integration
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
min: 3
keys: !remote entry, !remoteentry, !loadremote, !load remote*, !mf manifest, !module federation runtime, !vite built, !vite remote*, !share react, !shared dependenc*, !singleton*, !twice, !pull in, !pulled in, remote*, runtime, host, vite, share*, load*, plug*, at runtime
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*, customer platform, booking
- Plausible-default detail (keep it consistent): each interactive domain (booking, player profile, …) is a **remote built with Vite + `@module-federation/vite`**. Its build publishes a `remoteEntry.js` and an `mf-manifest.json` to the Cloudflare CDN, and each remote is versioned and deployed on its own.
- The Next.js **App Router** host does not federate at build time (the old `nextjs-mf` plugin doesn't support the App Router). A `'use client'` loader component uses the **Module Federation runtime** (`@module-federation/enhanced/runtime`: `init` with the remotes' manifest URLs, then `loadRemote('booking/App')`) when the user enters that area, and mounts it in a slot of the page. Module Federation 2.0 is the bundler-agnostic successor of Webpack Module Federation; that is why a Webpack-style federation works with Vite-built remotes.
- **Shared dependencies:** react, react-dom, zustand and @tanstack/react-query are shared as **singletons** (`shared: { react: { singleton: true } }`), so there is one React and hooks / context work across the boundary.
- **Host ↔ remote contract:** the remote exposes a mount component; the host passes locale, basic session info and navigation callbacks as props. Each remote owns its QueryClient, Zustand stores and React Router routes. A remote that fails to load shows a fallback with retry (error boundary) instead of breaking the page.

## GORA — frontend API client and typed BFF contract
id: gora-fe-api-client
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
min: 3
keys: !http client, !api client, !openapi, !api types, !api layer, !fetch client, !typed, !contract, !axios, types, call the bff, swagger
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*, customer platform, booking
- Plausible-default detail: the BFF publishes an **OpenAPI** spec; **`openapi-typescript`** generates the TypeScript types and **`openapi-fetch`** is the small typed fetch client (no axios on the customer platform). Calls happen only inside TanStack Query hooks (`useQuery` / `useMutation`), with `credentials: 'include'` so the session cookie goes along.
- When the BFF contract changes, regenerating the types makes the TypeScript build fail where the UI uses an old field, so contract drift is caught in CI.

## GORA — session, login and CSRF in the browser
id: gora-fe-web-session
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal, react native, mobile app, native app, in the app
group: gora-fe
min: 3
keys: !session, !cookie*, !csrf, !httponly, !logged in, !log in, !login, !sign in, browser, token*, protect*, mutation*, auth*, gora, rakuten, website, web
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*, customer platform, booking
- Plausible-default detail (browser side of the BFF session in the auth notes): login is a redirect to **Rakuten ID (OIDC)**; the BFF completes it and sets an **HttpOnly, Secure, SameSite=Lax session cookie**. The browser never holds tokens (nothing in localStorage), so XSS can't read them.
- Mutations send a **CSRF token header** (double-submit) that the BFF checks. **Next.js middleware** checks for the session cookie and redirects protected routes (bookings, profile) to login; a `401` from the BFF in a TanStack Query call sends the user to login again.
- Together with a strict **CSP** and no `dangerouslySetInnerHTML` on user content, this is the CSP / XSS hardening on the resume.

## GORA — login and tokens in the React Native app
id: gora-fe-mobile-auth
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal, website, browser
group: gora-fe
min: 3
keys: !mobile login, !app login, !keychain, !keystore, !secure storage, !refresh token*, !access token*, !pkce, !react native app auth, !store token*, !stored token*, !token storage, !logged in, login, log in*, sign in, auth*, token*, session*, mobile, react native, app, ios, android
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*, customer platform, booking
- Plausible-default detail (keep it consistent): golfers sign in with their **Rakuten ID** in the app too. The app can't use the web's HttpOnly cookie session, so it uses the standard native-app OAuth flow: **Authorization Code + PKCE** in the **system browser** (`ASWebAuthenticationSession` on iOS, **Chrome Custom Tabs** on Android) through **`react-native-app-auth`**, never an embedded WebView. The app never sees the Rakuten ID password, and an existing Rakuten login in the browser is reused.
- Rakuten ID redirects back through a verified **universal link / Android App Link**. With `skipCodeExchange`, the app sends the code and the PKCE `code_verifier` to the **BFF**, which exchanges them with Rakuten ID and returns its own short-lived **access token** and a **refresh token**. The Rakuten ID tokens stay on the server.
- Storage: both tokens in **`react-native-keychain`** (iOS Keychain / Android Keystore), never AsyncStorage. Zustand holds only the signed-in / signed-out UI state, never tokens.
- Requests: the shared typed API client (`openapi-fetch`) gets a per-platform auth middleware. On the web it sends the cookie and the CSRF header; in the app it adds `Authorization: Bearer <access token>`. No cookie in the app means no CSRF token there.
- Expiry: on a `401` the client runs **one refresh at a time**; other requests wait for it and then retry. The BFF rotates the refresh token on every use. If the refresh fails, the app clears the Keychain, the TanStack Query cache and the Zustand stores, and shows the login screen.
- Logout: the app calls the BFF logout (session ended, refresh token revoked), unregisters the FCM push token, then clears the Keychain and caches. After login it registers the push token, and react-native-iap receipts go to the BFF with the access token, so purchases attach to the right user.
- The Why: tokens sit in hardware-backed secure storage, the password never touches the app, and short-lived access tokens with rotation limit the damage if one leaks.

## GORA — i18n and maps in the frontend
id: gora-fe-i18n-maps
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
keys: !i18n, !internationali*, !locali*, !translation*, !next intl, !locale, !english, !japanese only, !languages, !multilingual, !map library, !map view, !maps, !google maps
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*, customer platform, booking
- The GORA reservation site supports **Japanese only** (no English version). "i18n" here means: all UI copy lives in message files, **`next-intl`** in the Next.js host and **`react-i18next`** in the remotes (the host passes the locale as a prop), with `ja` as the only locale, so there are no hard-coded strings in components; dates, weekdays, times and yen prices go through `Intl` formatters. The setup would allow another language later, but none ships.
- Course maps: **Google Maps JavaScript API** through **`@vis.gl/react-google-maps`**, lazy-loaded only on the map view; the map and the list read the same TanStack Query data, so switching views doesn't refetch.

## GORA — frontend repo, tooling and deployment of the remotes
id: gora-fe-repo
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
min: 3
keys: !monorepo, !turborepo, !pnpm, !repository, !repo, !organized, !organised, !eslint, !prettier, !lint*, !deployed, !versioning, deploy*, structure*, workspace*
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*, customer platform, booking
- Plausible-default detail: a **pnpm workspaces + Turborepo** monorepo: the Next.js host, one package per remote, **GRX** as an internal design-system package, and shared TypeScript types / API client packages. Turborepo caches builds and tests so CI only rebuilds what changed.
- **ESLint + Prettier** and strict TypeScript run in CI (GitHub Actions). Each remote is built and deployed on its own: its `remoteEntry.js` / manifest goes to the CDN under a version, and the host's remote config points to the version to load, so a remote can roll back without redeploying the host.

## GORA — React Native app (frontend side)
id: gora-fe-react-native
profiles: frontend
unless: single spa, singlespa, business innovation, b2b portal, admin portal, business portal
group: gora-fe
min: 3
keys: !react native, !mobile app, !react navigation, !hermes, !react native iap, !iap, !detox, new architecture, mobile, navigation, share code, shared code, ios, android
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*, customer platform, booking
- What it is: the **mobile version of the customer reservation platform**, for golfers: the same course search, tee-time booking, subscriptions and player profile, on iOS and Android. It is not part of the B2B portal.
- App: **React Native (New Architecture, Hermes)** in TypeScript, **React Navigation** (native stack); UI components are native, not GRX web components.
- Shared with the web from the monorepo packages: **TypeScript types, the typed API client, TanStack Query hooks and Zod schemas**; Zustand for UI state, React Hook Form + Zod for forms. It talks to the same Kotlin BFF.
- Platform: **react-native-iap** (StoreKit 2 / Google Play Billing) for subscriptions; the app sends receipts to the BFF, which validates them and stays the source of truth (details in the subscription-consistency notes). Push with **@react-native-firebase/messaging** (FCM / APNs), errors in **@sentry/react-native**.
- Quality: **React Native Testing Library** for component tests, **Detox** for E2E.
