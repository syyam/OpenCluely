profiles: frontend, fullstack

<!-- Rakuten GORA web frontend knowledge (source: "# Rakuten GORA — Frontend
Architect.txt"). The single place for GORA customer-platform frontend facts;
the B2B portal is in frontend-business-portal.md and backend/platform/mobile
facts are in backend.md. Sections are sent only when their keys
match. -->

## Rakuten GORA — frontend architecture overview
id: gora-fe-summary
group: gora-fe
keys: !gora, !rakuten, golf, reservation platform, tee time*, architecture, walk me through, current project, last project, tech stack, frontend architecture
- Rakuten GORA: a golf-course reservation platform used by millions of people across Japan. I built user-facing features end to end in a large TypeScript React / React Native codebase.
- One-line framing: the architecture doesn't force a compromise between an SPA and a server-rendered app. A **Next.js host shell** server-renders the SEO-critical pages, and **Webpack Module Federation** streams in independent client-side **React 19 SPAs** for the deep, transactional booking workflows. A **Kotlin + Spring Boot BFF** is the frontend-facing API.
- This is the customer-facing reservation platform and my main GORA work. The separate B2B **Business Innovation Portal** (admin side, single-spa) is a different frontend, where my part was feature-level golf-course addition / inventory work; never mix the two architectures.
- The Why: a pure SPA would hurt SEO and first load on weak mobile networks (golfers checking tee times on the go); pure SSR everywhere would make the booking flows and map experiences less fluid.
- Layers: Next.js shell (routing, layouts, RSC/SSR) → React micro-frontends (TypeScript, custom hooks, GRX design system on Tailwind) → state (Zustand for client state, TanStack Query for server state) → forms (React Hook Form + Zod) → Vite code splitting, Cloudflare CDN/Workers → BFF → testing (Vitest, Playwright), CI/CD (GitHub Actions), monitoring (Sentry, Datadog).
- End-to-end flow:
  ```text
  User → Next.js shell → React micro-frontend → TanStack Query / API layer
       → Kotlin + Spring Boot BFF → backend services (in parallel)
       → aggregated UI response → React state → UI
  ```

## GORA — Next.js shell, server rendering and routing
id: gora-fe-rendering
group: gora-fe
keys: !next js, !nextjs, !server components, !server component, !rsc, !ssr, !server side render*, !app router, seo, ttfb, hydration, rendering, layout*, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- **Next.js (App Router)** is the global shell: global layouts, authentication guardrails, shared header and footer, structural navigation, and routing between the public and the interactive areas.
- Public, discovery-driven pages (homepage, golf-course directories, search-result lists, review pages) use **React Server Components** and server rendering.
- The Why: better SEO indexing and organic discovery, a smaller initial load and better TTFB on mobile networks, and accessible HTML from the first byte.
- Highly interactive areas (tee-time booking, player-profile management) are client-side React SPAs loaded into the shell (see micro-frontends).

## GORA — micro-frontends with Webpack Module Federation
id: gora-fe-microfrontends
group: gora-fe
keys: !module federation, !micro frontend*, !microfrontend*, !react router, host shell, remote*, routing, independent, client side routing, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- When a user enters an interactive area (tee-time booking, player-profile management, complex booking flows), the Next.js shell uses **Webpack Module Federation** to load an independent client-side React module at runtime, **without a full page reload**.
- Inside an active micro-frontend, **React Router DOM** handles client-side routing, so users move between screens in that domain without the parent Next.js shell reloading or changing context.
- The Why: server rendering where SEO and first load matter, a fluid SPA where interaction matters, and each interactive domain stays an independent module.
- The customer platform uses Module Federation, not single-spa; single-spa is used only in the separate B2B Business Innovation Portal.

## GORA — React components, custom hooks and the GRX design system
id: gora-fe-components
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
group: gora-fe
keys: !react hook form, !zod, !form validation, form*, validation, validate, input*, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- Forms use **React Hook Form** for form state and **Zod** to validate and parse the form data.
- The Why: React Hook Form avoids unnecessary parent-level re-renders on every keystroke, and Zod gives strong, typed input validation.

## GORA — frontend ↔ BFF: API layer and data flow
id: gora-fe-api-bff
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
group: gora-fe
keys: !performance, !code splitting, !cloudflare, !vite, !bundle*, !lazy load*, slow network, mobile web, cdn, edge, workers, a b test*, peak, traffic, fast, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- **Vite** bundles the interactive micro-frontends with **code splitting**, so users download only the JavaScript for the current feature: someone checking a course map doesn't download payment code; booking code loads when they enter the booking flow.
- Server-rendered public pages (RSC/SSR in the Next.js shell) improve first load and TTFB; TanStack Query caching avoids duplicate requests (e.g. map ↔ list).
- **Cloudflare CDN** serves static assets and bundles close to users; **Cloudflare Workers** modify headers at the edge and use geographic info for localization / language checks and A/B testing before requests reach the origin.
- At traffic peaks (e.g. weekend booking) the frontend side is: edge-cached assets, code splitting, TanStack Query caching and deduplication, avoiding request storms (debounce, cancellation, backoff with jitter), and graceful degradation.
- The Why: smaller initial JavaScript and edge delivery matter most on weak mobile networks.

## GORA — testing and CI/CD (Vitest, Playwright, GitHub Actions)
id: gora-fe-testing-ci
group: gora-fe
keys: !vitest, !playwright, !testing, !tests, !test*, !e2e, !end to end, !github actions, !ci cd, !cicd, !pipeline*, unit test*, react testing library, deploy*, quality, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- **Vitest + React Testing Library** for unit and component tests: fast runs, and tests that verify real user interactions and behavior (modal interactions, form input, state changes, user-driven UI flows).
- **Playwright** for complex end-to-end journeys: multi-step booking, cart-to-checkout, cross-domain interactions.
- **Storybook** for developing and checking components in isolation.
- **GitHub Actions** CI/CD for the web frontend: run the automated tests and frontend quality checks, build the React application, produce deployment artifacts, and deploy successful builds.

## GORA — frontend monitoring (Sentry, Datadog)
id: gora-fe-observability
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
group: gora-fe
keys: !ai assistant, !ai overlay, !conversational, !ai feature*, chatbot, natural language, llm, ai, gora, rakuten
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, your team, you worked, golf, tee time*
- GORA has an **AI assistant** integrated as an **isolated, lazy-loaded** component. A user can ask e.g. "Find a course near Chiba under ¥15,000."
- The assistant converts the natural-language request into parameters that go into the **existing TanStack Query / API flow**, so it reuses the normal search path.
- It keeps its own encapsulated state lifecycle instead of coupling to the rest of the frontend; lazy loading keeps it out of the initial bundle.
