profiles: frontend, fullstack

<!-- Rakuten GORA Business Innovation Portal (B2B / admin, single-spa) — from
the user's own description. A separate frontend from the customer
reservation platform in frontend-customer.md: never mix the two architectures.
My scope here was feature-level work only. -->

## Rakuten GORA Business Innovation Portal — B2B admin portal (single-spa)
id: gora-bip-summary
group: gora-bip
include: gora-bip-inventory
keys: !business innovation portal, !business portal, !b2b portal, !admin portal, !single spa, !singlespa, !golf course operator*, admin, b2b, operators, turf, portal
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, you worked, business innovation, admin portal, b2b portal
- The **Rakuten GORA Business Innovation Portal** is a B2B platform for golf-course operators: golf-course management, inventory, pricing and turf-management operations.
- It is a **separate frontend** from the customer-facing GORA reservation platform (my main GORA work, which is the Next.js / Module Federation app). The admin portal is built on **single-spa**; the two architectures are not mixed.
- **single-spa** integrates independently developed business modules into the larger portal through its lifecycle: a module is mounted when its business area is entered and unmounted when the user leaves, while still behaving as part of one portal. This gives a clear boundary between the B2B modules and the customer application.
- The frontend talks to the backend only through **REST APIs**, never directly to databases or services:
  ```text
  React / single-spa module → REST API → Kotlin BFF → core backend services (Inventory, Billing, User Accounts)
  ```
  The Kotlin BFF is the frontend-facing API boundary; each microservice owns its business domain.
- The Why (micro-frontends): GORA has several business areas with different development needs, so independently managed frontend applications let teams work on one domain without coupling every feature to one large frontend codebase.
- The Why (single-spa): it provides the integration and lifecycle mechanism for independently developed modules on the B2B side.

## Business Innovation Portal — my work: golf-course inventory features
id: gora-bip-inventory
group: gora-bip
include: gora-bip-summary
keys: !inventory, !add golf course*, !adding golf course*, !golf course addition, !course management, !admin portal, admin, portal, form*, feature*
need: gora, rakuten, did you, have you, you used, you use, your experience, your project, you worked, business innovation, admin portal, b2b portal
- My contribution was **feature-level frontend development** in the **inventory management** area, mainly adding and managing golf courses:
  - Built and modified React UI components for golf-course addition and inventory workflows.
  - Connected those features to the existing backend APIs (through the Kotlin BFF).
  - Handled form state, user input, API loading states and error handling.
  - Worked within the existing single-spa module structure so the feature runs as part of the larger portal.
- Scope: I followed the existing component and frontend architecture; I did **not** design or own the portal or the GORA micro-frontend architecture. For details not covered here, describe following the existing patterns, never architecture decisions I made.
