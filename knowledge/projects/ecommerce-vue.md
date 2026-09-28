<!-- Frontend work on the fashion e-commerce marketplace (Vue / Nuxt / Pinia),
from the frontend resume. The resume doesn't name the company, so neither do
these notes. -->

## Fashion e-commerce marketplace — Vue / Nuxt frontend
id: ecommerce-vue
group: ecommerce
keys: !e commerce, !ecommerce, !nuxt, !vue storefront, !alokai, !marketplace, fashion, storefront, checkout, cart, wishlist, dutch, netherlands
- Frontend developer on a large **designer-fashion marketplace**: shoppers browse **750+ brands from 300+ boutiques**, search and filter a large catalogue, manage cart and wishlist, and check out. Refer to it as a large European fashion e-commerce marketplace; don't invent a company name.
- Stack: **Vue, Nuxt, TypeScript, Vue Storefront (Alokai), Pinia, Composition API, SSR, Cloudflare**.
- I built features with reusable components and **Pinia** for application state: **cart, filters, wishlist, account, language, and currency**.
- I improved performance and UX with **server-side rendering, code splitting, link prefetching, URL-based search filters, a custom multi-step checkout, and multilingual / multi-currency support**.

## Fashion e-commerce marketplace — Pinia / Vuex experience
id: ecommerce-pinia
group: ecommerce
keys: !pinia, !vuex, vue store, state management in vue, store, stores
- How Pinia was used (reasonable detail consistent with the resume):
  - Separate **Pinia stores** per domain: cart, wishlist, filters, account / session, language and currency.
  - Setup-style stores with the Composition API and TypeScript types for state and actions.
  - Getters for derived data (cart totals in the selected currency, active filter count).
  - Actions that call the commerce API and handle loading / errors.
- Nuxt SSR specifics: Pinia state is created per request on the server and **hydrated** on the client (no shared state between users). Search filters were **URL-based**: the URL is the source of truth, synced into the store, so results are shareable and SSR-friendly. The multi-step checkout kept its state in a store.
- The resume shows **Pinia** in production. Present Vuex as known (Pinia's predecessor; the concepts and migration are familiar), and don't claim extensive production Vuex use.
