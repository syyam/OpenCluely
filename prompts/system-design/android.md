## System design playbook: Android (mobile architecture round)
This round is about the Android app's architecture, from the client down. Go deep on the app's layers, lifecycle and data flow; the backend appears only as the API and push service the app talks to (its contract, not its internals), unless the interviewer asks about it.

### Clarify question bank (pick the 3-4 that matter most for this problem)
- Which screens / core user flows are in scope (e.g. list → detail → action)? Phone only, or tablet / foldable too?
- Must it work offline? Which actions must work without a network, and how fresh does data need to be?
- Real-time needs: live updates (WebSocket), push notifications (FCM), or refresh on open?
- Scale on the device: how many items per list (pagination), media size (images / video), how often data changes?
- Min SDK, Compose or Views, and existing modules / DI the app already uses?
- Auth (login, token refresh), background work (uploads, sync), battery / data budget, accessibility, localization?

### FR / NFR checklist (what the requirements list tracks)
- FR: the user flows and screens; actions per screen; what is shown offline.
- NFR: offline-first vs online-only, freshness, list size, startup time, smooth scrolling (60/120 fps, no jank), battery / data usage, process-death safety, security of tokens and local data, min SDK.

### Architecture layers (proper terms to say)
- **UI layer**: Jetpack Compose screens (or Activity / Fragment), state hoisting, a single immutable `UiState` per screen, one-off events via `Channel` / `SharedFlow`, Navigation (Compose Navigation, type-safe routes).
- **ViewModel**: holds `StateFlow<UiState>`, survives configuration changes, `viewModelScope` for coroutines, `SavedStateHandle` for process death, unidirectional data flow (UDF: events up, state down).
- **Domain layer (optional)**: UseCases for logic shared by several ViewModels; pure Kotlin, easy to unit test.
- **Data layer**: Repository as the **single source of truth** (usually Room), exposing `Flow`; data sources: Room DAO (local), DataStore (settings), Retrofit + OkHttp service (remote); mappers between DTO, Entity and domain model.
- **DI**: Hilt (`@HiltViewModel`, modules, scopes such as `@Singleton`). **Modularization**: `:app`, `:feature:*`, `:core:data`, `:core:network`, `:core:database`, `:core:ui`.
- **Background**: WorkManager (constraints, retries with backoff, unique work) for sync / uploads; a foreground service only for user-visible long work (calls, media, navigation).

### Lifecycle (go deep when asked)
- Activity / Fragment lifecycle (onCreate → onStart → onResume → onPause → onStop → onDestroy); configuration changes recreate the Activity, the ViewModel survives them.
- **Process death**: the system kills the app in the background; restore with `SavedStateHandle` / `rememberSaveable` and reload from Room.
- Lifecycle-aware collection: `collectAsStateWithLifecycle()` in Compose, `repeatOnLifecycle(STARTED)` in Views, so flows stop in the background (battery, no leaks).
- Coroutine scopes: `viewModelScope`, `lifecycleScope`; structured concurrency, cancellation, `Dispatchers.IO` for disk / network work.

### Data model (written as Kotlin in a code block)
- Show the three model types: a network DTO (`@Serializable` / Moshi), a Room `@Entity` (with primary key and indices), and a domain `data class`, plus the mapper between them. Add a sealed `UiState` (`Loading` / `Success` / `Error`) when it helps.
- Data classes are immutable (`val`), so state changes create new objects and Compose recomposes correctly (stability).

### Diagram shape (Mermaid)
- **High-level architecture**: subgraphs `Device` (the app as one box per layer group: UI, ViewModel, Repository, local DB, sync worker), `Backend` (API gateway, the services the app calls, realtime gateway), `Push` (FCM). The backend is shown from the app's side: the endpoints and channels it talks to, not internal servers.
- **App architecture**: the full MVVM stack as subgraphs `UI`, `Presentation`, `Domain` (if used), `Data`, `Remote`: screen → ViewModel → UseCase → Repository → Room DAO / DataStore and Retrofit / WebSocket; FCM service → Repository; WorkManager worker → Repository; Hilt modules as a note or a side box.
- **Key flow**: the user's action through Screen → ViewModel → Repository → Room (write first, UI updates from the DB `Flow`) → network → the server's reply → Room → back to the UI; an `alt` branch for offline (queued in WorkManager) and for failure (retry / error state).
- **Must show** in an Android design: single source of truth in Room with the UI observing it; where state survives configuration changes and process death; the offline queue / sync worker; how the token is attached and refreshed (OkHttp Interceptor + Authenticator); push wake-up; pagination when there are lists; image / file handling when there is media.
- **Problem add-ons**: chat → message status (sending / sent / delivered / read) kept in Room, client-generated message id for dedupe, WebSocket while in the foreground + FCM in the background, ordered by server sequence number, media uploaded with WorkManager + progress; feed → Paging 3 `RemoteMediator`, image caching (Coil); offline notes / forms → outbox table + conflict resolution; location / tracking → foreground service with a notification, batching to save battery.

### Deep dives and common follow-ups
- **Offline-first sync**: Room as the source of truth, a pending-changes (outbox) table, WorkManager sync with constraints, conflict resolution (last-write-wins, server version / ETag, merge).
- **Pagination**: Paging 3 (`PagingSource`, `RemoteMediator` for network + Room), placeholders, `LazyColumn` keys.
- **Networking**: OkHttp interceptors (auth header, logging), `Authenticator` for token refresh (single refresh with a mutex), timeouts, retries with exponential backoff, HTTP cache.
- **Real-time**: WebSocket (OkHttp) while in the foreground, FCM to wake up / notify in the background; reconnection with backoff.
- **Images / media**: Coil (memory + disk cache, downsampling), upload via WorkManager with progress.
- **Performance**: Compose recomposition and stability (`@Immutable`, stable keys, `derivedStateOf`, `remember`), startup (Baseline Profiles, lazy init, App Startup), jank (Macrobenchmark), memory leaks (LeakCanary).
- **Security**: tokens in Keystore-backed encrypted storage (EncryptedSharedPreferences / Tink + DataStore), certificate pinning, R8 obfuscation, no secrets in the APK.
- **Testing**: unit tests for ViewModel / UseCase / Repository (fakes, `runTest`, Turbine for flows), Room in-memory tests, Compose UI tests; **observability**: Crashlytics, analytics events, ANR / crash monitoring.

### Failure modes and trade-offs
- Flaky network → offline cache + retries; stale data → freshness rules / pull-to-refresh; process death → saved state; background limits (Doze, app standby) → WorkManager instead of raw services.
- Trade-offs to name: offline-first (complex sync) vs online-only (simple, worse UX); Compose vs Views; UseCase layer (cleaner) vs fewer layers (faster to build); WebSocket (real-time, battery) vs push + refresh.

### Real project examples
- Use my documented Android work where it truly fits (e.g. the native Android side of Speeqr: FCM wake-up, ConnectionService, Retrofit / OkHttp; GORA Android login with AppAuth, encrypted DataStore and an OkHttp Authenticator) — documented facts only, never invented metrics.
