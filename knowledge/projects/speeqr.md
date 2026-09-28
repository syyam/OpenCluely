<!-- Speeqr project knowledge (source: "# Speeqr — VoIP Application
Project.txt" + resume). Every profile. Sections are sent only when their keys
match. Confirmed facts only: no invented frameworks, protocols, numbers or
responsibilities. -->

## Speeqr — overview and how to explain it
id: speeqr-summary
group: speeqr
keys: !speeqr, !voip, calling app, call app, afiniti
- Speeqr is a production VoIP calling app, which I built at Afiniti. Resume facts: built from scratch in **React Native** and shipped in **8 months**; **99.5% call success rate**; WebRTC audio + data channels, custom WebSocket signaling, UDP/TCP/RTP socket handling in the native module, **failover and auto-reconnect**; cut call setup time by **~50%** by tuning signaling and ICE candidate handling; kept calls alive in the background (foreground services, threading, wake locks).
- Platform: an Android client + a React / TypeScript web client → Rails API + Action Cable / AnyCable signaling → WebRTC media (STUN / TURN, P2P, Janus SFU for groups) → PostgreSQL / Redis → Sidekiq / event stream → Kubernetes + observability. Live media, signaling, API and background work are separated so each scales and fails independently.
- Explain in layers: `React / Android clients → Rails API / Action Cable → WebRTC / TURN / Janus → PostgreSQL / Redis → Sidekiq / Kafka → Kubernetes / Observability`.
- Always separate **signaling = Action Cable / WebSocket** from **media = WebRTC**.

## Speeqr — web client (React + TypeScript)
id: speeqr-web
group: speeqr
keys: !react query, speeqr, web client, spa, vite, react router, actioncable
- React + TypeScript SPA (Vite, React Router) for scheduling, directory and call history.
- JSON to the Rails API with the same JWT auth and `operator_id` tenant model.
- **React Query** for server state; an Action Cable consumer receives live invite / response updates.

## Speeqr — signaling vs media, STUN/TURN, P2P, Janus SFU
id: speeqr-media
group: speeqr
keys: !webrtc, !turn, !stun, !sfu, !janus, !signaling, !ice, speeqr, p2p, peer to peer, group call*, media, data channel, nat
- **Signaling** (Action Cable over WSS: offer, answer, ICE candidates, ring, hangup) is separate from **media** (WebRTC, DTLS-SRTP). `libwebrtc` handles audio + the in-call data channel (chat / control).
- **STUN** discovers the public address for a direct connection; **TURN** relays when a direct path fails (about 1 in 6 calls). TURN credentials are short-lived **HMAC-signed**, from a small stateless service, never hardcoded.
- 1-to-1 calls are **P2P** once ICE finds a route: low latency, no media server.
- **Group calls** use the **Janus SFU**: each device uploads one stream and Janus forwards it (a mesh doesn't scale beyond a few participants). Janus is also the recording point; a per-operator setting can route even 1-to-1 calls through the SFU for recording.

## Speeqr — background calls, push, reconnect and failover
id: speeqr-reconnect
group: speeqr
keys: !reconnect*, !failover, !background*, !foreground service, !wake lock*, !push notification*, speeqr, fcm, call setup, app closed, network change
- Android can freeze backgrounded apps, so an active call runs in a **foreground service** with an ongoing notification. A partial **WakeLock** keeps the CPU up with the screen off, and a dedicated thread keeps socket I/O off the UI thread. WorkManager handles deferrable sync, and **ConnectivityManager** network callbacks drive reconnects.
- If the callee's app is closed: `PushDispatchJob` sends a high-priority **FCM** data push → Android wakes the app → starts `CallService` → reconnects to Action Cable → fetches the pending invite → rings.
- Reliability story: **connection failure → detection → reconnect / failover → background recovery → user experience**. Results: 99.5% call success, ~50% faster setup from tuning signaling / ICE.

## Speeqr — auth (JWT) and multi-tenancy
id: speeqr-auth
group: speeqr
keys: !jwt, !tenant*, !multi tenant, !operator id, !devise, !pundit, speeqr, refresh token, revocation, jti
- Login returns a **short-lived JWT access token + long-lived refresh token**. Every request is checked at the Rack level (signature, expiry, revocation); revoked tokens go in a `jti` denylist in Redis; a `401` makes the client refresh. Devise / devise-jwt; authorization is separate, with **Pundit**.
- Multi-tenant by `operator_id` (inside the JWT): set per request, tenant models use `default_scope` so queries can't cross operators, Pundit returns `403`. Per-operator config + Flipper feature flags.

## Speeqr — backend: Rails API, Action Cable / AnyCable scale, Sidekiq, data
id: speeqr-backend
group: speeqr
keys: !rails, !action cable, !anycable, !sidekiq, !pgbouncer, speeqr, modular monolith, sockets, scale, postgres*, redis, background job*
- **Rails API** (modular monolith, thin controllers, service objects; Puma behind Nginx / AWS ALB) handles everything except live media: device auth, directory, per-operator config, call history, push tokens, scheduled calls, TURN credentials.
- **Action Cable** `CallChannel` keeps a socket per online device; per-user channels deliver events like `scheduled_call.invited`. In production **AnyCable-Go handles ~100k sockets**, with Redis pub/sub routing messages to the pod that owns the socket.
- **Sidekiq** handles slow / retryable work, enqueued after commit, with priority queues (`realtime`, `default`, `analytics`): push dispatch, `CallRecordReconcileJob` (merges both clients' reports into billable minutes), history sync, quality events, reminders.
- **PostgreSQL** (PgBouncer, a read replica) with DB-level constraints: unique `(operator_id, phone)`, FKs, optimistic locking on `Call`, exclusion constraints against overlapping scheduled slots. **Redis** handles cache, pub/sub, Sidekiq queues, presence, rate limiting and `jti` revocation.
- Small extracted services that scale differently: TURN credentials, presence, media orchestrator (least-loaded Janus), and config / feature flags.

## Speeqr — call-quality analytics, deployment and observability
id: speeqr-ops
group: speeqr
keys: !call quality, !clickhouse, !bigquery, speeqr, analytics, kubernetes, argo cd, observability, monitoring, sentry, crashlytics, pagerduty, grafana
- Call-quality events (setup time by phase, winning ICE type, packet loss, jitter, disconnect reason) go to a replayable event stream (Kafka / Kinesis), not PostgreSQL, and are aggregated into ClickHouse / BigQuery dashboards (success rate, setup-time percentiles).
- Kubernetes (EKS) runs web, cable, Sidekiq and services separately. GitHub Actions CI (RSpec, RuboCop, Brakeman, migration-safety checks) → Argo CD / Helm GitOps.
- Monitoring: Prometheus, Grafana, OpenTelemetry, Sentry, Sidekiq queue-latency alerts, PagerDuty; clients report through Crashlytics, Sentry and call-quality events.
