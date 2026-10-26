## System design playbook: Frontend (web architecture round)
This round is about the web client's architecture: rendering, components, state, data fetching, performance and delivery. The backend appears as the API / BFF the frontend calls (its contract, caching and auth), not its internal services, unless the interviewer asks.

### Clarify question bank (pick the 3-4 that matter most for this problem)
- Which pages / user flows are in scope? Logged-in app, public pages, or both (does SEO matter)?
- Devices and browsers: mobile web, desktop, low-end devices, slow networks?
- How many users and how much data per page (long lists, infinite scroll, large tables)?
- Real-time needs: live updates, collaboration, notifications?
- Existing stack and team setup: one app or several teams (micro-frontends), design system, framework already chosen?
- Accessibility, i18n / localization, offline support, analytics / A-B testing?

### FR / NFR checklist (what the requirements list tracks)
- FR: pages and flows, the actions on each, what data each page shows.
- NFR: SEO, Core Web Vitals targets (LCP, INP, CLS), time to first render on slow 3G / low-end devices, real-time freshness, accessibility (WCAG AA), i18n, browser support, security (XSS, CSRF), team / deploy independence.

### Architecture layers (proper terms to say)
- **Rendering strategy**: CSR (SPA), SSR, SSG, ISR, streaming SSR / React Server Components; pick per page (marketing = SSG / ISR, dashboard = CSR or SSR) and say why (SEO, first paint, cost).
- **Delivery**: CDN for static assets and cached HTML, edge functions / middleware (auth redirects, A/B tests, geo), cache headers (`Cache-Control`, stale-while-revalidate, immutable hashed assets).
- **App shell and routing**: layouts, nested routes, route-based code splitting, lazy loading, prefetching.
- **Component architecture**: design system / shared UI library, container vs presentational components, composition, feature folders.
- **State**: server state (TanStack Query / SWR: cache, dedupe, background refetch, optimistic updates) vs client / UI state (useState, Zustand / Pinia / Redux) vs URL state (filters, pagination in the query string) vs form state (React Hook Form + Zod).
- **API layer**: REST or GraphQL, a BFF (backend-for-frontend) that aggregates services and holds tokens, a typed client (OpenAPI-generated types), error handling and retries.
- **Micro-frontends (when teams need independent deploys)**: Module Federation or single-spa, shared singletons (react, router, state), contracts between apps, CSS isolation.

### Data model (written as TypeScript in a code block)
- The API response types / interfaces, the normalized client cache shape (entities by id + ordered id lists), and the query keys. Show what is server state vs local state.

### Diagram shape (Mermaid)
- **High-level architecture**: subgraphs `Browser` (the app shell / pages, client store, data-access layer with its cache, service worker if offline), `Edge` (CDN, edge middleware / functions), `BFF / API` (the endpoints and realtime channel the frontend uses), `Services` (backend services as plain boxes — a black box unless the question needs it).
- **App architecture**: the framework's layers (below under "App architecture to draw") as subgraphs `View`, `State / ViewModel`, `Data access`, `Server`: named components → hooks / composables → store and query cache → API client → REST / WebSocket.
- **Key flow**: the user's action through the component → store / query cache (optimistic update) → API client → BFF → the response or realtime event → cache update → re-render; `alt` branches for failure (roll back, retry) and slow networks (skeleton, stale data).
- **Must show** in a frontend design: the rendering strategy per page (SSR / SSG / CSR) and where HTML is cached; server state vs client state vs URL state; the data-access layer that isolates fetching and caching; realtime transport and reconnection; auth (cookie via BFF); loading / error states; performance (code splitting, virtualization, images).
- **Problem add-ons**: chat / live updates → WebSocket or SSE client with reconnect and backoff, merging events into the query cache, optimistic send with a client id; feed → infinite scroll with cursor pagination and virtualization; search / autocomplete → debounce, cancel stale requests (`AbortController`), result cache; forms / checkout → schema validation, optimistic UI, idempotent submit; dashboards → polling vs push, chart virtualization; micro-frontends → shell, remotes, shared singletons.

### Deep dives and common follow-ups
- **Performance**: code splitting, tree shaking, image optimization (responsive `srcset`, lazy loading, modern formats), font loading, list virtualization, memoization (`useMemo`, `memo`, computed), avoiding layout shift, bundle budgets, Lighthouse / Web Vitals monitoring.
- **Caching**: HTTP cache, CDN, query-cache stale times, service-worker cache (offline / PWA), cache invalidation after mutations.
- **Real-time**: WebSocket vs SSE vs polling; reconnect with backoff; merging live events into the query cache.
- **Forms and validation**: schema validation shared with the API, optimistic UI, error and loading states.
- **Auth**: HttpOnly secure session cookie (via BFF) vs tokens in memory; CSRF protection; route guards; silent refresh.
- **Security**: XSS (escaping, no `dangerouslySetInnerHTML` / `v-html` with user data, CSP), CSRF, clickjacking (frame-ancestors), dependency audit.
- **Accessibility and i18n**: semantic HTML, keyboard navigation, ARIA only where needed, focus management; message files, `Intl` formatting, RTL.
- **Testing and observability**: unit (Vitest / Jest), component (Testing Library), E2E (Playwright), API mocking (MSW); error tracking (Sentry), RUM / Web Vitals, feature flags.

### Failure modes and trade-offs
- Slow / failed API → skeletons, retries, error boundaries, partial rendering; stale cache → invalidation rules; huge lists → virtualization; big bundles → splitting.
- Trade-offs to name: SSR (SEO, faster first paint, server cost) vs CSR (simple hosting, slower first paint); GraphQL (flexible) vs REST (simple caching); micro-frontends (team independence) vs a monolith (simpler, faster); global store vs server-state cache.

### Real project examples
- Use my documented frontend work where it truly fits (e.g. the GORA customer platform's Next.js App Router host with Module Federation remotes and TanStack Query; the B2B portal on single-spa; the Winkelstraat.nl Nuxt storefront with Cloudflare caching) — documented facts only, never invented metrics.
