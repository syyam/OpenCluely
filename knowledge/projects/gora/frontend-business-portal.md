topic: business innovation, b2b portal, admin portal, business portal
profiles: frontend, fullstack
app: business innovation, b2b, admin*, business portal, portal, single spa, singlespa, operator*, back office
sibling: gora-fe

<!-- Rakuten GORA Business Innovation Portal (B2B / admin, single-spa), from
the user's own notes (2026-09-30). A separate frontend from the customer
reservation platform in frontend-customer.md: never mix the two architectures.
My scope here was feature-level work only. The four entries include each
other so a BIP question gets the whole picture; together they must stay under
the 7000-char notes cap (check with scripts/test-knowledge.js). -->

## Rakuten GORA Business Innovation Portal — B2B admin portal (single-spa)
id: gora-bip-summary
group: gora-bip
include: gora-bip-inventory, gora-bip-frontend, gora-bip-architecture
keys: !business innovation portal, !business portal, !b2b portal, !admin portal, !single spa, !singlespa, !golf course operator*, admin, b2b, operators, turf, portal
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, you worked, business innovation, admin portal, b2b portal
- Product: part of GORA's **golf-course-facing B2B ecosystem**, used by **golf-course operators**. It helps courses run more efficiently with IT and data: digitised daily course-management records, fertilizer / pesticide application records (turf management), revenue management and pricing, marketing, and analysis for longer-term course-management decisions. Inventory / course management is one of these operational areas.
- The golfer-facing side of GORA (course search and reservations) is the separate customer platform; the B2B portal serves the operators' business needs.
- Overall architecture: two separate frontends, both talking to the backend only through APIs:
  ```text
  Customer portal (Next.js + React, Module Federation) ─┐
  B2B portal (React + single-spa, business modules) ────┴─ REST APIs → Kotlin BFF → Inventory / Billing / User Accounts services
  ```
- Documented B2B portal stack: **React**, **single-spa**, **REST APIs**, **Kotlin BFF** (Inventory / Billing / User Accounts behind it). Its own glue libraries are single-spa-react, SystemJS import maps, axios and Formik + Yup (see the portal libraries entry). Never list the customer platform's tools (Tailwind, GRX, Zustand, TanStack Query, React Hook Form, Zod, Vite) as its stack.
- Terminology: **micro-frontend** = the architectural pattern, **React SPA** = the application type, **single-spa** = the framework that integrates this B2B side. Never describe all of GORA as a single-spa app.
- Answer order for "tell me about your work on the single-spa app": what the B2B portal is and who uses it → where the single-spa module fits → what the frontend talks to (REST → Kotlin BFF) → the features I built → their technical details (forms, state, API, errors) → why the portal uses independently managed modules. Don't open with backend technologies; for a frontend interviewer the path is React → single-spa → components / module → forms / state → REST → Kotlin BFF → Inventory service → UI response.

## Business Innovation Portal — single-spa module architecture and lifecycle
id: gora-bip-architecture
group: gora-bip
include: gora-bip-summary
keys: !single spa lifecycle, !module lifecycle, !mount*, !unmount*, !bootstrap*, !root config, !host app*, lifecycle, micro frontend*, microfrontend*, module*, architecture
need: business innovation, admin portal, b2b portal, b2b, single spa, singlespa, business portal
- The B2B host (root application) integrates independent business modules, e.g. `B2B host → Module A / Inventory module / Module C / Module D`. Each module owns its frontend feature implementation and still feels like one operator portal.
- Module lifecycle:
  ```text
  operator navigates to a B2B area → root app picks the module → single-spa loads it
  → React app bootstraps → module mounts → operator uses inventory / admin features
  → REST API → Kotlin BFF → backend service → response → React state / UI update
  → module stays active until navigation → single-spa unmounts it
  ```
- The Why: the B2B side has several business domains and operational workflows, so independently managed modules let each area evolve without coupling every feature to one large frontend codebase; single-spa provides the integration and lifecycle mechanism for them.

## Business Innovation Portal — my work: golf-course addition and inventory features
id: gora-bip-inventory
group: gora-bip
include: gora-bip-summary
keys: !inventory, !add golf course*, !adding golf course*, !golf course addition, !course management, !admin portal, admin, portal, form*, feature*
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, you worked, business innovation, admin portal, b2b portal
- My contribution was **feature-level frontend development** in the **inventory** module, mainly golf-course addition and related inventory workflows:
  - built and modified React UI components for these workflows
  - implemented the form interactions, form state and client-side validation
  - connected the features to the existing REST APIs (through the Kotlin BFF)
  - handled loading, validation and error states
  - integrated the feature into the existing single-spa module, following the portal's frontend patterns
- "Add Golf Course" as a request lifecycle:
  ```text
  operator opens "Add Golf Course" → React renders the form → operator enters course info
  → client-side validation → submit → REST API → Kotlin BFF → Inventory service
  (business validation / persistence) → response → React state update → success or error feedback
  ```
- Split of responsibility: the frontend owns user interaction, form state, validation, API integration and UI state; the backend owns business rules and persistence.
- Scope: I did **not** design or own the portal or the GORA micro-frontend architecture. For details not covered here, describe following the existing patterns, never architecture decisions I made.

## Business Innovation Portal — frontend ↔ BFF boundary, state and error handling
id: gora-bip-frontend
group: gora-bip
include: gora-bip-summary
keys: !talk to the backend, !api boundary, !bff, !rest api*, !error handling, !state separation, api*, backend, communicat*, state, error*, validation, component*
need: business innovation, admin portal, b2b portal, b2b, single spa, singlespa, business portal
- The frontend never touches databases or internal services: `React module → REST API → Kotlin BFF → Inventory / Billing / User Accounts`. The Why: the BFF gives a frontend-oriented API contract and hides service boundaries and implementation details from the browser.
- Componentization: reusable React components keep the inventory and admin UI modular. Feature isolation: business areas are separate modules.
- State separation: local UI / form state in the component, asynchronous API (server) state for requests, and persistent business state owned by the backend.
- Error handling: the UI tells apart validation errors (fix the field), request failures (retry), backend business-rule errors (show the server's message) and a successful submission.

## Business Innovation Portal — operator login, session and roles
id: gora-bip-auth
group: gora-bip
min: 3
keys: !login, !log in*, !logged in, !sign in, !auth*, !session*, !permission*, !role*, !rbac, !access control, token*, operator*, access, secure*, security, business innovation, portal, b2b
need: business innovation, admin portal, b2b portal, b2b, single spa, singlespa, business portal, portal
- Plausible-default detail (keep it consistent): operators sign in with their **Rakuten ID**, with the same BFF session pattern as the customer site: an HttpOnly session cookie plus a CSRF header. The **root config** checks the session once before mounting any module and redirects to login when there is none, so the modules never handle login themselves.
- The shared utility module's axios client sends the cookie (`withCredentials: true`) and the CSRF header. An interceptor sends a `401` back to login and turns a `403` into a "no access" message.
- Roles and scope: the User Accounts service links the Rakuten ID to an operator account (which golf course(s), which role, e.g. admin or staff), and the BFF checks role and course on every request. The root config passes the current operator (courses, role) to the modules as single-spa **custom props**; the UI hides actions a role can't use, but the BFF is what enforces it.
- My part: I didn't build the login. In the inventory module I followed this pattern: the Add Golf Course / edit actions show only for roles that may use them, and the 401 / 403 states are handled in the UI.

## Business Innovation Portal — libraries: module loading, API client, forms, module messages
id: gora-bip-tech
group: gora-bip
keys: !import map*, !systemjs, !single spa react, !root config, !formik, !yup, !axios, !http client, !utility module, !custom event*, !each other, !forms, !validation, !talk to each other, communicat*, loaded, load*, hook*, lifecycle, modules, call the bff
need: business innovation, admin portal, b2b portal, b2b, single spa, singlespa, business portal, portal
- Plausible-default detail (keep it consistent): each React module wraps its `bootstrap` / `mount` / `unmount` lifecycles with **`single-spa-react`**. The root config registers the modules with their route prefixes (`registerApplication` / `activeWhen`) and loads them from an **import map with SystemJS**; `import-map-overrides` points one module at a local dev server. Modules are built with webpack from the `create-single-spa` config, and React / ReactDOM come once from the import map.
- A shared **utility module** (also in the import map) holds the **axios** API client: base URL of the Kotlin BFF, the session cookie (`withCredentials: true`) and CSRF header, and error mapping (validation vs request vs business-rule errors).
- Modules don't import each other: they communicate through **custom browser events** (`window.dispatchEvent(new CustomEvent(...))`) and the shared utility module, so each module can be deployed on its own.
- Forms: **Formik** for form state with **Yup** schemas for client-side validation (e.g. the Add Golf Course form); server-side business-rule errors from the BFF are mapped back onto the fields. Why Formik: it was the portal's existing form pattern (it predates React Hook Form's popularity), so new modules kept it for consistency instead of mixing two form libraries.
