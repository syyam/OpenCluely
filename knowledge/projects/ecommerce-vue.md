topic: winkelstraat, e commerce, ecommerce, fashion marketplace, vue storefront
<!-- Frontend work on the fashion e-commerce marketplace (Vue / Nuxt / Pinia),
from the frontend resume. The company name and dates come from the active
profile's resume (only the frontend resume names it). -->

## Fashion e-commerce marketplace — Vue / Nuxt frontend
id: ecommerce-vue
group: ecommerce
keys: !winkelstraat, !e commerce, !ecommerce, !nuxt, !vue storefront, !alokai, !marketplace, fashion, storefront, checkout, cart, wishlist, dutch, netherlands
- Frontend developer on a large **designer-fashion marketplace**: shoppers browse **750+ brands from 300+ boutiques**, search and filter a large catalogue, manage cart and wishlist, and check out.
- Stack: **Vue 3 (Composition API, `<script setup>`), Nuxt 3, TypeScript, Vue Storefront (Alokai), Pinia, SSR, Cloudflare**; the app was migrated from Vue 2 / Nuxt 2 (see the migration entry).
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
- Vuex was used in the legacy Vue 2 app and **migrated to Pinia store by store** during the Vue 3 migration; the current app is Pinia only.

## Fashion e-commerce marketplace — backend, search, payments, i18n and caching
id: ecommerce-stack
profiles: frontend, fullstack
group: ecommerce
min: 3
keys: !backend, !commercetools, !mirakl, !boutiques, !boutique, !ideal, !payment method*, !vendor*, !seller*, !alokai sdk, !alokai middleware, !middleware, !algolia, !instantsearch, !search, !filter*, !payment*, !adyen, !checkout, !currenc*, !multilingual, !multi currency, !i18n, !cache*, !caching, !cms, !storyblok, !content, !banner*, !catalogue, !catalog, !cart, api, talk to, data, ssr
need: winkelstraat, e commerce, ecommerce, fashion, marketplace, storefront, vue storefront, alokai, nuxt, boutique*
- Plausible-default detail (keep it consistent). **Nuxt 3 + Alokai (Vue Storefront)**: the storefront calls the **Alokai SDK**, which talks to the **Alokai server middleware** (Node / Express). The middleware is the BFF-like layer that holds the integrations and secrets:
  ```text
  Nuxt storefront (Pinia, SSR) → Alokai SDK → Alokai middleware → commercetools (catalogue, cart, checkout, customers)
                                                                 → Storyblok (CMS content) · Algolia (search)
  Boutiques → Mirakl (marketplace: offers, stock, boutique orders) → synced into commercetools
  ```
- **commercetools** is the headless commerce platform; **Storyblok** holds editorial content (homepage, banners, brand pages); **Algolia** powers search with **`vue-instantsearch`**, whose URL routing keeps the filters in the URL (shareable and SSR-friendly), synced into the Pinia filter store.
- Marketplace: with 300+ boutiques it is a multi-vendor marketplace, so **Mirakl** is the marketplace platform where boutiques manage their offers and stock; it syncs into commercetools and receives each boutique's part of an order. The storefront only talks to the Alokai middleware.
- Payments: **Adyen** Web Drop-in inside the custom multi-step checkout, with **iDEAL** (the Dutch default) next to cards; the middleware creates the payment session and the order is confirmed in commercetools.
- i18n / currency: **`@nuxtjs/i18n`** for locale routes and translations; prices come per currency from commercetools and are formatted with `Intl.NumberFormat`; the selected language / currency live in Pinia and a cookie.
- Data fetching: `useAsyncData` in pages calls the Pinia actions, so data is fetched during SSR and hydrated on the client. Customer session: the middleware keeps the commercetools token in an HttpOnly cookie.
- Performance: Cloudflare caches the SSR HTML with short TTLs and **stale-while-revalidate**, `@nuxt/image` serves resized images. Tests: Vitest + Vue Test Utils, Cypress for E2E.

## Fashion e-commerce marketplace — Vue 2 → Vue 3 / Nuxt 3 migration
id: ecommerce-vue3-migration
profiles: frontend, fullstack
group: ecommerce
min: 3
keys: !vue 2, !vue2, !vue 3 migration, !migrat*, !upgrad*, !nuxt bridge, !nuxt 2, !vuex to pinia, !vue 2 7, !vuex, !pinia, !vue 3, vue, nuxt, store*
need: winkelstraat, e commerce, ecommerce, fashion, marketplace, storefront, vue storefront, alokai, boutique*
- Plausible-default detail (keep it consistent; no durations or numbers). The marketplace moved from **Vue 2 / Nuxt 2 / Vue Storefront 2 with Vuex** to **Vue 3 / Nuxt 3 / Alokai with Pinia**, incrementally, following the official Vue and Nuxt migration path:
  1. **Bridge step:** upgraded to **Vue 2.7** and **Nuxt Bridge**, which backport the Composition API and `<script setup>`, so new code was already written the Vue 3 way while the app still ran on Vue 2.
  2. **Stores:** **Vuex → Pinia store by store** (Pinia also runs on Vue 2.7): cart, wishlist, filters, account, language / currency; each store kept its public API, so components changed little.
  3. **Removed APIs:** the `$on` / `$off` event bus → `mitt`; filters → computed / helper functions; `.sync` → `v-model:prop`; `$listeners` merged into `$attrs`; functional-component and `v-model` changes.
  4. **Libraries:** vue-router 3 → 4, vue-i18n 8 → 9 (`@nuxtjs/i18n`), Vue Storefront 2 → Alokai, Jest + Vue Test Utils 1 → Vitest + Vue Test Utils 2.
  5. **Cut-over to Nuxt 3** once the Bridge app was clean, released behind Cloudflare with the critical flows (search, product page, cart, checkout) covered by Cypress E2E first.
- The Why: Vue 2 reached end of life on 31 Dec 2023; Nuxt 3 / Alokai give better TypeScript, the Composition API everywhere and faster SSR. Doing it in steps kept the store shippable the whole time instead of a big-bang rewrite.
