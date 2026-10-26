topic: speeqr, speaker app, speaker, speakr, speeker, speaqr
<!-- Speeqr project knowledge (source: "# Speeqr — VoIP Application
Project.txt" + resume). Every profile. Sections are sent only when their keys
match. Confirmed facts only: no invented frameworks, protocols, numbers or
responsibilities. -->

## Speeqr — overview and how to explain it
id: speeqr-summary
group: speeqr
keys: !speeqr, !voip, !speaker app, !speakr, !speeker, !speaqr, calling app, call app, afiniti
- Speeqr is a production VoIP calling app, which I built at Afiniti. Resume facts: built from scratch in **React Native** and shipped in **8 months**; **99.5% call success rate**; WebRTC audio + data channels, custom WebSocket signaling, UDP/TCP/RTP socket handling in the native module, **failover and auto-reconnect**; cut call setup time by **~50%** by tuning signaling and ICE candidate handling; kept calls alive in the background (foreground services, threading, wake locks).
- Platform: a mobile client (React Native in the frontend story, native Android in the Android story) + a React / TypeScript web client → Rails API + Action Cable / AnyCable signaling → WebRTC media (STUN / TURN, P2P, Janus SFU for groups) → PostgreSQL / Redis → Sidekiq / event stream → Kubernetes + observability. Live media, signaling, API and background work are separated so each scales and fails independently.
- Explain in layers: `React / Android clients → Rails API / Action Cable → WebRTC / TURN / Janus → PostgreSQL / Redis → Sidekiq / Kafka → Kubernetes / Observability`.
- Always separate **signaling = Action Cable / WebSocket** from **media = WebRTC**.

## Speeqr — architecture and how the app talks to the backend (React Native client)
id: speeqr-architecture-fe
profiles: frontend
group: speeqr
keys: !speeqr, !speaker app, !architecture, !talk to the backend, !talk to backend, !tech stack, !data flow, !native module*, backend, rest api*, frontend, linked, link*, connect*, communicat*, overall, total, how does it work, how it works, bridge, react native, navigation, structure*, tell me about, walk me through, your work, work on
min: 3
need: speeqr, speaker app, speaker, calling app, call app, voip
- Not micro-frontends: Speeqr has no Next.js, single-spa or Module Federation (those are Rakuten GORA). It is a **React Native mobile app** (my work, TypeScript) plus a separate React / TypeScript **Vite SPA** for the web, both on the same backend.
- Flow: `RN app → REST (HTTPS / JSON) → Rails API` · `RN app ↔ Action Cable (WSS) → signaling` · `RN app ↔ WebRTC media → peer (P2P / TURN relay / Janus SFU)` · `FCM push → wakes the app`.
- **Inside the app, two layers.** The JS layer: screens with React Navigation, a call-state store driving the call state machine (idle → ringing → connecting → connected → reconnecting → ended / failed), React Query for server data. The **native module** (Kotlin on Android): `react-native-webrtc` / `libwebrtc` for audio and the data channel, UDP / TCP / RTP socket handling, the foreground service, the wake lock and network-change callbacks; it emits events to JS over the bridge. Real-time work stays native because the JS thread can't keep sockets alive in the background.
- **How it talks to the backend: three channels.**
  1. **REST to the Rails API**: login returns a short-lived JWT access token + refresh token; an API client interceptor adds the token and refreshes it on a `401`, and the access token is refreshed in the background so a call never fails on expiry. Used for the directory, per-operator config and feature flags, call history, push-token registration, scheduled calls, and **fresh TURN credentials at call start**.
  2. **Action Cable over WSS**: `CallChannel` carries call setup only (invite, offer, answer, ICE candidates, ring, hangup), plus per-user events such as a scheduled-call invite. The socket stays open while the app is foregrounded.
  3. **Media never goes through Rails**: WebRTC audio goes P2P once ICE finds a path, via TURN when it can't, or through Janus for group / recorded calls.
- **App closed**: an FCM data push wakes the app → the native side starts the call service → reconnects Action Cable → fetches the pending invite → rings.
- No numbers beyond the resume's 99.5% call success and ~50% faster setup.

## Speeqr — architecture and how the app talks to the backend (Android client)
id: speeqr-architecture-android
profiles: android
group: speeqr
keys: !speeqr, !speaker app, !architecture, !talk to the backend, !talk to backend, !tech stack, !data flow, backend, rest api*, frontend, linked, link*, connect*, communicat*, overall, total, how does it work, how it works, retrofit, okhttp, structure*, layer*, tell me about, walk me through, your work, work on
min: 3
need: speeqr, speaker app, speaker, calling app, call app, voip
- The Android client (Kotlin, MVVM, `libwebrtc`) is one of the clients; a React / TypeScript web SPA uses the same backend.
- Flow: `Android app → REST (HTTPS / JSON) → Rails API` · `app ↔ Action Cable (WSS) → signaling` · `app ↔ WebRTC media → peer (P2P / TURN relay / Janus SFU)` · `FCM push → wakes the app`.
- **Inside the app**: UI → ViewModel with the call state machine (idle → ringing → connecting → connected → reconnecting → ended / failed) → repositories. Retrofit + OkHttp for REST, an OkHttp WebSocket for Action Cable on a dedicated thread, `libwebrtc` for audio and the data channel, and a foreground `CallService` with a partial WakeLock and ConnectivityManager callbacks.
- **How it talks to the backend: three channels.**
  1. **REST to the Rails API**: JWT access + refresh tokens; an OkHttp interceptor adds the token and an authenticator refreshes it on a `401`, and the token is refreshed in the background so a call never fails on expiry. Used for the directory, per-operator config and feature flags, call history, push-token registration, scheduled calls, and **fresh TURN credentials at call start**.
  2. **Action Cable over WSS**: `CallChannel` carries call setup only (invite, offer, answer, ICE candidates, ring, hangup) plus per-user events; open while the app is foregrounded.
  3. **Media never goes through Rails**: P2P once ICE finds a path, TURN when it can't, Janus for group / recorded calls.
- **App closed**: FCM data push → `CallService` starts → reconnects Action Cable → fetches the pending invite → rings.
- No numbers beyond the resume's 99.5% call success and ~50% faster setup.

## Speeqr — architecture and how the clients talk to the backend (backend side)
id: speeqr-architecture-backend
profiles: fullstack
group: speeqr
keys: !speeqr, !speaker app, !architecture, !talk to the backend, !talk to backend, !tech stack, !data flow, backend, rest api*, frontend, linked, link*, connect*, communicat*, overall, total, how does it work, how it works, structure*, layer*, tell me about, walk me through, your work, work on
min: 3
need: speeqr, speaker app, speaker, calling app, call app, voip
- Clients: the mobile app and a React / TypeScript Vite SPA. Each client talks to the backend over three channels, each owned by a different part of the platform so they scale and fail independently.
- Flow: `clients → REST (HTTPS / JSON) → Rails API → PostgreSQL / Redis / Sidekiq` · `clients ↔ Action Cable / AnyCable-Go (WSS) → signaling` · `clients ↔ WebRTC media → peer (P2P / TURN / Janus SFU)` · `Sidekiq PushDispatchJob → FCM → wakes the app`.
  1. **REST to the Rails API**: JWT access + refresh tokens checked at the Rack level (signature, expiry, `jti` denylist in Redis), `operator_id` tenant scoping, Pundit for authorization. It serves the directory, per-operator config and flags, call history, push tokens, scheduled calls and short-lived HMAC-signed **TURN credentials**.
  2. **Action Cable** `CallChannel` (AnyCable-Go in production, Redis pub/sub to the pod that owns the socket) relays call setup only: invite, offer, answer, ICE candidates, ring, hangup, plus per-user events.
  3. **Media never goes through Rails**: P2P, TURN relay, or Janus (the media orchestrator picks the least-loaded one) for group / recorded calls.
- Async side: Sidekiq sends pushes, reconciles the call record from both sides' reports, and syncs history; call-quality events go to the event stream.
- No numbers beyond the documented ones (99.5%, ~50%, ~100k sockets).

## Speeqr — web client (React + TypeScript)
id: speeqr-web
group: speeqr
keys: !react query, speeqr, web client, spa, vite, react router, actioncable
- React + TypeScript SPA (Vite, React Router) for scheduling, directory and call history.
- JSON to the Rails API with the same JWT auth and `operator_id` tenant model.
- **React Query** for server state; an Action Cable consumer (`@rails/actioncable`) receives live invite / response updates.

## Speeqr — signaling vs media, STUN/TURN, P2P, Janus SFU
id: speeqr-media
group: speeqr
keys: !webrtc, !turn, !stun, !sfu, !janus, !signaling, !ice, speeqr, p2p, peer to peer, group call*, media, data channel, nat
- **Signaling** (Action Cable, JSON over WSS) carries **call setup only**: call-invite, offer, answer, ICE candidates, ring, hangup. It is separate from **media** (WebRTC, DTLS-SRTP). Once the media connects, signaling can go quiet; the **WebRTC data channel** on the media connection carries in-call chat and control. `libwebrtc` handles audio + the data channel.
- **STUN** discovers the public address for a direct connection; **TURN** relays when a direct path fails (about 1 in 6 calls). TURN credentials are short-lived **HMAC-signed**, fetched fresh from the Rails API at call start (backed by a small stateless credentials service), never shipped in the app.
- 1-to-1 calls are **P2P** once ICE finds a route: low latency, no media server.
- **Group calls** use the **Janus SFU**: each device uploads one stream and Janus forwards it (a mesh doesn't scale beyond a few participants). Janus is also the recording point; a per-operator setting can route even 1-to-1 calls through the SFU for recording.

## Speeqr — background calls, push, reconnect and failover
id: speeqr-reconnect
group: speeqr
keys: !reconnect*, !failover, !background*, !foreground service, !wake lock*, !push notification*, !ice restart, speeqr, fcm, app closed, network change
- Android can freeze backgrounded apps, so an active call runs in a **foreground service** with an ongoing notification. A partial **WakeLock** keeps the CPU up with the screen off, and a dedicated thread keeps socket I/O off the UI thread. WorkManager handles deferrable sync, and **ConnectivityManager** network callbacks drive reconnects: on a network change the client does an **ICE restart** on the existing call instead of placing a fresh call, so the call and its state stay alive (see trade-offs).
- If the callee's app is closed: `PushDispatchJob` sends a high-priority **FCM** data push → Android wakes the app → starts `CallService` → reconnects to Action Cable → fetches the pending invite → rings.
- Reliability story: **connection failure → detection → reconnect / failover → background recovery → user experience**. Results: 99.5% call success, ~50% faster setup from tuning signaling / ICE.

## Speeqr — auth (JWT) and multi-tenancy
id: speeqr-auth
group: speeqr
keys: !jwt, !tenant*, !multi tenant, !operator id, !devise, !pundit, speeqr, refresh token, revocation, jti
- Login returns a **short-lived JWT access token + long-lived refresh token**. Every request is checked at the Rack level (signature, expiry, revocation); revoked tokens go in a `jti` denylist in Redis; a `401` makes the client refresh. Auth is continuous: the client refreshes the access token on the REST API in the background, so a call never fails on an expired token. Devise / devise-jwt; authorization is separate, with **Pundit**.
- Multi-tenant by `operator_id` (inside the JWT): set per request, tenant models use `default_scope` so queries can't cross operators, Pundit returns `403`. Per-operator config + Flipper feature flags.

## Speeqr — backend: Rails API, Action Cable / AnyCable scale, Sidekiq, data
id: speeqr-backend
group: speeqr
keys: !rails, !action cable, !anycable, !sidekiq, !pgbouncer, speeqr, modular monolith, sockets, scale, postgres*, redis, background job*
- **Rails API** (modular monolith, thin controllers, service objects; Puma behind Nginx / AWS ALB) handles everything except live media: device auth, directory, per-operator config, call history, push tokens, scheduled calls, TURN credentials.
- **Action Cable** `CallChannel` keeps a socket per online device; per-user channels deliver events like `scheduled_call.invited`. In production **AnyCable-Go handles ~100k sockets**, with Redis pub/sub routing messages to the pod that owns the socket.
- **Sidekiq** handles slow / retryable work, enqueued after commit, with priority queues (`realtime`, `default`, `analytics`): push dispatch (`PushDispatchJob` calls the FCM HTTP v1 API with a service account; Firebase is used only for push, not as a backend), `CallRecordReconcileJob` (the call record is the source of truth for history and billing minutes: reconciled server-side from both sides' reports, never trusted from one client), history sync, quality events, reminders.
- **PostgreSQL** (PgBouncer, a read replica) with DB-level constraints: unique `(operator_id, phone)`, FKs, optimistic locking on `Call`, exclusion constraints against overlapping scheduled slots. **Redis** handles cache, pub/sub, Sidekiq queues, presence, rate limiting and `jti` revocation.
- Small extracted services that scale differently: TURN credentials, presence, media orchestrator (least-loaded Janus), and config / feature flags.

## Speeqr — call-quality analytics, deployment and observability
id: speeqr-ops
group: speeqr
keys: !call quality, !clickhouse, !bigquery, speeqr, analytics, kubernetes, argo cd, observability, monitoring, sentry, crashlytics, pagerduty, grafana
- Call-quality events (setup time by phase, winning ICE type, packet loss, jitter, disconnect reason) go to a replayable event stream (Kafka / Kinesis), not PostgreSQL, and are aggregated into ClickHouse / BigQuery dashboards (success rate, setup-time percentiles).
- Kubernetes (EKS) runs web, cable, Sidekiq and services separately. GitHub Actions CI (RSpec, RuboCop, Brakeman, migration-safety checks) → Argo CD / Helm GitOps.
- Monitoring: Prometheus, Grafana, OpenTelemetry, Sentry, Sidekiq queue-latency alerts, PagerDuty; clients report through Crashlytics, Sentry and call-quality events.

## Speeqr — how we cut call setup time ~50% (React Native client)
id: speeqr-setup-time-fe
profiles: frontend
group: speeqr
keys: !call setup, !setup time, !trickle ice, !faster call*, !connect faster, !cut setup, !50, !success rate, !call success, speeqr, latency, faster, optimi*, improve*, improvement*, tuning, ice, stun, turn, timeout*
need: speeqr, calling app, call app, voip, call setup, setup time, trickle ice, call success
- Four changes in the **React Native client** cut setup time by **~50%**:
  1. **Signaling socket already connected**: the client keeps the Action Cable WebSocket open while the app is foregrounded, so there is no cold connect at call time.
  2. **Trickle ICE**: the client sends ICE candidates as they arrive instead of waiting for gathering to finish.
  3. **Pre-allocated TURN session**: ready in case the direct path fails.
  4. **Tighter STUN retransmit timers and fewer candidate types**, so ICE finishes sooner.
- Success rate: fewer calls fail because fewer time out during a long setup. This was the **single biggest lever on the 99.5% call success rate**.
- Supporting pieces: the client fetches fresh TURN credentials from the Rails API at call start (never shipped in the app) and refreshes the access token in the background, so a call never fails on an expired token.
- Don't add other numbers (per-change savings, timer values).

## Speeqr — how we cut call setup time ~50% (Android client)
id: speeqr-setup-time-android
profiles: android
group: speeqr
keys: !call setup, !setup time, !trickle ice, !faster call*, !connect faster, !cut setup, !50, !success rate, !call success, speeqr, latency, faster, optimi*, improve*, improvement*, tuning, ice, stun, turn, timeout*
need: speeqr, calling app, call app, voip, call setup, setup time, trickle ice, call success
- Four changes in the **native Android client** (Kotlin, `libwebrtc`) cut setup time by **~50%**:
  1. **Signaling socket already connected**: the client keeps the Action Cable WebSocket open while the app is foregrounded, with socket I/O on a dedicated thread, so there is no cold connect at call time.
  2. **Trickle ICE**: `libwebrtc` candidates are sent over signaling as they arrive instead of waiting for gathering to finish.
  3. **Pre-allocated TURN session**: ready in case the direct path fails.
  4. **Tighter STUN retransmit timers and fewer candidate types**, so ICE finishes sooner.
- Success rate: fewer calls fail because fewer time out during a long setup. This was the **single biggest lever on the 99.5% call success rate**.
- Supporting pieces: the app fetches fresh TURN credentials from the Rails API at call start (never shipped in the APK) and refreshes the access token in the background, so a call never fails on an expired token.
- Don't add other numbers (per-change savings, timer values).

## Speeqr — how we cut call setup time ~50% (backend side)
id: speeqr-setup-time-backend
profiles: fullstack
group: speeqr
keys: !call setup, !setup time, !trickle ice, !faster call*, !connect faster, !cut setup, !50, !success rate, !call success, speeqr, latency, faster, optimi*, improve*, improvement*, tuning, ice, stun, turn, timeout*
need: speeqr, calling app, call app, voip, call setup, setup time, trickle ice, call success
- The same four changes cut setup time by **~50%**. Each one had a backend part:
  1. **Always-connected signaling socket**: the Android client keeps its Action Cable WebSocket open while foregrounded, so the server holds a socket per online device. **AnyCable-Go** carries ~100k of them, with Redis pub/sub routing each message to the pod that owns the socket.
  2. **Trickle ICE**: `CallChannel` relays each ICE candidate the moment it arrives instead of waiting for a full gathering.
  3. **Pre-allocated TURN session**: at the start of every call the client fetches a fresh set of short-lived HMAC-signed TURN credentials from the Rails API (never shipped in the app) and allocates the TURN session right away, in parallel with the direct-path checks, so a relay is already ready if the direct path fails.
  4. **Tighter STUN retransmit timers and fewer candidate types** on the client, so ICE finishes sooner.
- Success rate: fewer calls fail because fewer time out during a long setup. This was the **single biggest lever on the 99.5% call success rate**.
- Supporting pieces: access tokens are refreshed on the REST API in the background, so a call never fails on an expired token; the call record is reconciled server-side from both sides' reports.
- Don't add other numbers (per-change savings, timer values).

## Speeqr — trade-offs we chose (React Native client)
id: speeqr-tradeoffs-fe
profiles: frontend
group: speeqr
keys: !trade off*, !tradeoff*, !design decision*, !why p2p, !why not sip, !sip, !why action cable, !ice restart, !always on, !peer to peer vs, !p2p vs, speeqr, why, decision*, alternative*, choose, chose, instead
need: speeqr, calling app, call app, voip, sip, webrtc, sfu, p2p, peer to peer, ice restart
- **P2P for 1-to-1, SFU only where required.** P2P has the lowest latency and no media-server cost. The Janus SFU is switched on per operator when compliance recording is needed (group calls always use it).
- **Action Cable (JSON over WSS) for signaling, not SIP.** We built signaling on the framework we already ran: one codebase, one auth path, one deploy. It's lighter on mobile, easier to evolve and simpler to debug than SIP. The cost is no interop with telco equipment, which the product doesn't need.
- **Signaling socket always on while the app is foregrounded.** It costs a little battery and data but is the biggest single setup-time win. Mitigation: the React Native client drops it after a long idle period and revives it via push.
- **ICE restart instead of a fresh call on network change.** When the phone switches between Wi-Fi and mobile data, the React Native client restarts ICE on the same call, so the call and its state stay alive. The cost is a few seconds of "reconnecting" UI and more complex client call state (connected → reconnecting → connected again, or failed).
- Answer shape: each decision as the choice → why → what it cost.

## Speeqr — trade-offs we chose (Android client)
id: speeqr-tradeoffs-android
profiles: android
group: speeqr
keys: !trade off*, !tradeoff*, !design decision*, !why p2p, !why not sip, !sip, !why action cable, !ice restart, !always on, !peer to peer vs, !p2p vs, speeqr, why, decision*, alternative*, choose, chose, instead
need: speeqr, calling app, call app, voip, sip, webrtc, sfu, p2p, peer to peer, ice restart
- **P2P for 1-to-1, SFU only where required.** P2P has the lowest latency and no media-server cost. The Janus SFU is switched on per operator when compliance recording is needed (group calls always use it).
- **Action Cable (JSON over WSS) for signaling, not SIP.** We built signaling on the framework we already ran: one codebase, one auth path, one deploy. It's lighter on mobile (no SIP stack in the app), easier to evolve and simpler to debug than SIP. The cost is no interop with telco equipment, which the product doesn't need.
- **Signaling socket always on while the app is foregrounded.** It costs a little battery and data but is the biggest single setup-time win. Mitigation: the Android client drops it after a long idle period and revives it via an FCM push.
- **ICE restart instead of a fresh call on network change.** ConnectivityManager network callbacks tell the Android client the network changed (Wi-Fi ↔ mobile data), and it restarts ICE on the same call while the foreground service keeps the call running, so the call and its state stay alive. The cost is a few seconds of "reconnecting" UI and more complex client call state (connected → reconnecting → connected again, or failed).
- Answer shape: each decision as the choice → why → what it cost.

## Speeqr — trade-offs we chose (backend side)
id: speeqr-tradeoffs-backend
profiles: fullstack
group: speeqr
keys: !trade off*, !tradeoff*, !design decision*, !why p2p, !why not sip, !sip, !why action cable, !ice restart, !always on, !peer to peer vs, !p2p vs, speeqr, why, decision*, alternative*, choose, chose, instead
need: speeqr, calling app, call app, voip, sip, webrtc, sfu, p2p, peer to peer, ice restart
- **P2P for 1-to-1, SFU only where required.** P2P has the lowest latency and no media-server cost. The Janus SFU is switched on per operator (a per-operator setting) when compliance recording is needed, with the media orchestrator picking the least-loaded Janus; group calls always use it.
- **Action Cable (JSON over WSS) for signaling, not SIP.** We built signaling on the Rails framework we already ran: one codebase, one auth path (the same JWT), one deploy. It's lighter on mobile, easier to evolve and simpler to debug than SIP. The cost is no interop with telco equipment, which the product doesn't need. To carry ~100k connections we swapped the Ruby socket server for **AnyCable-Go**.
- **Signaling socket always on while the app is foregrounded.** It is the biggest single setup-time win; the cost is a little client battery and data, and many open sockets on the server (hence AnyCable-Go). Mitigation: clients drop it after a long idle period, and `PushDispatchJob` sends an FCM push to revive it for an incoming call.
- **ICE restart instead of a fresh call on network change.** The call and its server-side state (the same call record, no second call) stay alive; signaling just relays the new offer / candidates. The cost is a few seconds of "reconnecting" UI and more complex client call state (connected → reconnecting → connected again, or failed).
- Answer shape: each decision as the choice → why → what it cost.

## Speeqr — proudest-project story (React Native client)
id: speeqr-proud-fe
profiles: frontend
group: speeqr
keys: !proudest, !most proud, !proud of, !hardest problem, !biggest challenge, !biggest achievement, !most challenging, !hardest project, !challenging project, speeqr
- Speeqr, a production VoIP calling app at Afiniti. We built the **React Native client from scratch**.
- The problem: calls had to connect fast and stay up on real mobile networks: NATs, Wi-Fi ↔ mobile data switches, and the app going to the background or being closed.
- What I did (app side):
  - **WebRTC** audio + data channels (in-call chat / control), with **signaling** (custom WebSocket: offer, answer, ICE candidates, ring, hangup) kept separate from **media**.
  - UDP / TCP / RTP socket handling in the **native module**.
  - **STUN** for a direct peer-to-peer path, **TURN** as the relay when a direct path fails (about 1 in 6 calls), with short-lived credentials fetched at call time.
  - **Failover and auto-reconnect**: network-change callbacks trigger a reconnect of signaling and the call instead of dropping it.
  - **Background calls**: a foreground service with an ongoing notification, a partial wake lock, and a dedicated thread so socket I/O stays off the UI thread.
  - Cut call setup time ~50% with four changes: the signaling socket stays connected while the app is foregrounded, trickle ICE, a pre-allocated TURN session, and tighter STUN retransmit timers with fewer candidate types. Fewer calls timing out during setup was also the biggest lever on the success rate.
  - Feel free to think how a usuall calling app would work for technical detils related questions if its not covered from my side.
- Result: **99.5% call success rate** and **~50% faster call setup**.
- Keep it on the client; don't go into the server side (Rails, Sidekiq, databases) unless asked.
- In a "proudest project / biggest challenge" answer, Speeqr comes after the full GORA story, as "### Also proud of: Speeqr", unless the question names Speeqr.

## Speeqr — proudest-project story (Android client)
id: speeqr-proud
profiles: android, fullstack
group: speeqr
keys: !proudest, !most proud, !proud of, !hardest problem, !biggest challenge, !biggest achievement, !most challenging, !hardest project, !challenging project, speeqr
- Speeqr, a production VoIP calling app at Afiniti. I wrote the **Android client from scratch and shipped it in 8 months**.
- The problem: calls had to connect fast and stay up on real mobile networks: NATs, Wi-Fi ↔ mobile data switches, and Android freezing or killing backgrounded apps.
- What I did:
  - **WebRTC** audio + data channels, with **signaling** (custom WebSocket / Action Cable: offer, answer, ICE candidates, ring, hangup) kept separate from **media**.
  - UDP / TCP / RTP socket handling.
  - **STUN** for a direct path, **TURN** relay when that fails (about 1 in 6 calls), with short-lived HMAC-signed credentials.
  - **Failover and auto-reconnect** driven by ConnectivityManager network callbacks; FCM data push wakes the app for an incoming call when it's closed.
  - **Background calls**: foreground service, partial WakeLock, a dedicated thread for socket I/O.
  - Cut call setup time ~50% with four changes: the signaling socket stays connected while the app is foregrounded, trickle ICE, a pre-allocated TURN session, and tighter STUN retransmit timers with fewer candidate types. Fewer calls timing out during setup was also the biggest lever on the success rate.
- Result: **99.5% call success rate** and **~50% faster call setup**.
- In a "proudest project / biggest challenge" answer, Speeqr comes after the full GORA story, as "### Also proud of: Speeqr", unless the question names Speeqr.

## Speeqr — React Native libraries: signaling client, push, incoming-call UI, audio, token storage
id: speeqr-rn-libs-fe
profiles: frontend
group: speeqr
keys: !actioncable, !action cable client, !callkeep, !connectionservice, !connection service, !incoming call*, !ring*, !app was closed, !app closed, !audio rout*, !earpiece, !bluetooth, !speakerphone, !keychain, !keystore, !token storage, !store the auth, !stored the auth, !push notification*, !firebase, !fcm, !ios, !iphone, !library, !libraries, !call screen, audio, token*, push, closed, ship*, screen, native
min: 3
need: speeqr, speaker app, calling app, call app, voip
- Plausible-default detail (keep it consistent). Speeqr's React Native app shipped on **Android only** (no iOS app, so no CallKit / PushKit).
- Signaling: the **`@rails/actioncable`** JS client (the same one the web SPA uses) connects to Action Cable over WSS and subscribes to `CallChannel`.
- Push: **`@react-native-firebase/messaging`** receives the high-priority FCM data push; a headless background handler starts the native call service even when the app is closed.
- Why Firebase with a Rails backend: Firebase is used **only for FCM push (and Crashlytics)**, not as a backend, because FCM is the only reliable way to wake a closed Android app; the Rails side sends the push from the Sidekiq `PushDispatchJob` via the **FCM HTTP v1 API** with a service account (`googleauth`).
- Incoming-call UI: **`react-native-callkeep`** on top of Android's Telecom **ConnectionService**, so the call rings with the system incoming-call screen and works with the lock screen and Bluetooth headsets.
- Audio routing: **`react-native-incall-manager`** switches earpiece / speakerphone / Bluetooth / wired headset, turns on the proximity sensor and handles audio focus.
- Tokens: the refresh token in **`react-native-keychain`** (Android Keystore-backed), the short-lived access token only in memory; never AsyncStorage.
- Tests and builds: Jest + React Native Testing Library; **Fastlane** builds and distributes the Android app.

## Speeqr — Android client libraries: push, incoming-call UI, audio, token storage
id: speeqr-android-libs
profiles: android
group: speeqr
keys: !callkeep, !connectionservice, !connection service, !incoming call*, !ring*, !app was closed, !app closed, !audio rout*, !earpiece, !bluetooth, !speakerphone, !keystore, !token storage, !store the auth, !stored the auth, !push notification*, !firebase, !fcm, !firebasemessagingservice, !library, !libraries, audio, token*, push, closed
min: 3
need: speeqr, speaker app, calling app, call app, voip
- Plausible-default detail (keep it consistent). Push: a **`FirebaseMessagingService`** receives the high-priority FCM data push and starts the foreground `CallService`, even when the app is closed.
- Why Firebase with a Rails backend: Firebase is used **only for FCM push (and Crashlytics)**, not as a backend, because FCM is the only reliable way to wake a closed Android app; the Rails side sends the push from the Sidekiq `PushDispatchJob` via the **FCM HTTP v1 API** with a service account (`googleauth`).
- Incoming-call UI: a self-managed Telecom **`ConnectionService`** (`PhoneAccount`, `Connection`), so the call rings with the system incoming-call screen, on the lock screen and with Bluetooth headsets.
- Audio routing: **`AudioManager`** in communication mode (`setCommunicationDevice` on Android 12+), switching earpiece / speaker / Bluetooth, with audio focus and the proximity wake lock.
- Tokens: refresh token in **EncryptedSharedPreferences** (Android Keystore key); access token only in memory.
