## System design playbook: Fullstack (end-to-end system round)
This round covers the whole system end to end: the client(s), the edge, the API and services, data storage, async processing and operations. Cover BOTH the frontend side (how clients render and call the system) and the backend side in proper depth; neither is a footnote.

### Clarify question bank (pick the 3-4 that matter most for this problem)
- Core features in scope (and what is explicitly out of scope)? Which clients: web, mobile, both, third-party API?
- Scale: daily / monthly active users, requests per second at peak, read / write ratio, data size and growth?
- Consistency needs: what must never be wrong (payments, double booking), what can be eventually consistent (feeds, counts)?
- Latency targets (e.g. p99 under 200 ms for reads), availability target, regions / global users?
- Real-time needs (live updates, chat, notifications)? Search? File / media uploads?
- Auth model (users, roles, SSO), compliance / privacy, existing stack or constraints?

### FR / NFR checklist (what the requirements list tracks)
- FR: the core use cases as verbs (create / book / search / notify…), per client.
- NFR: scale (users, RPS, storage per year), read/write ratio, latency (p99), availability (e.g. 99.9%), consistency vs availability (CAP) per feature, durability, security / privacy, cost, multi-region.

### Rough numbers (back-of-the-envelope, only what justifies choices)
- RPS = daily requests / ~86,400 (peak ≈ 2-5× average); storage = items per day × size × 365; bandwidth for media; cache size for the hot set (≈ 20% of items serve 80% of reads).

### Architecture layers (proper terms to say)
- **Clients**: web (rendering strategy: SSR / SSG / CSR, server-state cache like TanStack Query, typed API client), mobile apps; how they authenticate and handle errors / retries.
- **Edge**: DNS, CDN (static assets, cached GET responses), WAF, rate limiting, TLS termination.
- **Entry**: load balancer (L7), API gateway or BFF (auth, routing, aggregation, request validation).
- **Services**: start with a modular monolith or a few services split by domain (bounded contexts); stateless so they scale horizontally; say why if choosing microservices.
- **API design**: REST (resources, status codes, cursor pagination, filtering) or GraphQL; **idempotency keys** for retried writes; versioning; webhooks for third parties.
- **Auth**: OAuth 2.0 / OIDC, session cookies (web via BFF) vs JWT access + refresh tokens (mobile), RBAC, service-to-service auth.
- **Data**: SQL (Postgres: transactions, constraints, joins) vs NoSQL (DynamoDB / Cassandra / MongoDB: scale-out, flexible schema) per data type; indexes; replication (primary + read replicas); sharding / partitioning key choice; object storage (S3) for files via **presigned URLs**; search index (Elasticsearch / OpenSearch) fed by change events.
- **Cache**: Redis — cache-aside, write-through, TTLs, invalidation on writes, cache stampede protection (locking / jittered TTL); also distributed locks and rate-limit counters.
- **Async**: message queue / stream (SQS, RabbitMQ, Kafka) with workers for slow work (emails, notifications, image processing); **outbox pattern** for reliable events; retries with backoff and a dead-letter queue; at-least-once delivery + idempotent consumers.
- **Real-time**: WebSocket / SSE gateway, pub/sub (Redis / Kafka) to fan out events; push notifications (FCM / APNs).
- **Operations**: containers (Docker / Kubernetes), CI/CD, blue-green / canary deploys, feature flags; observability: structured logs, metrics (RED / USE), distributed tracing (OpenTelemetry), alerts on SLOs.

### Data model (written as tables)
- The main tables / collections with primary keys, foreign keys, the important indexes and unique constraints (e.g. `UNIQUE(slot_id)` to prevent double booking), and the partition / shard key when sharding is discussed.

### Diagram shape (Mermaid)
- **High-level architecture**: subgraphs `Clients` (web, mobile), `Edge` (CDN, WAF, rate limiting), `Gateway` (load balancer, API gateway / BFF with auth), `Services` (the API services split by domain, realtime gateway if needed), `Data` (primary DB + read replica, cache, object storage, search index), `Async` (queue / stream, workers, notification service), `Ops` (one box: logs, metrics, tracing). Mark the write path and the read path with numbered arrow labels.
- **App architecture**: the client app's layers AND one backend service's layers (below under "App architecture to draw"), as two subgraphs joined by the API call.
- **Key flow**: the main use case end to end: user action → client layers → gateway → service → cache / DB → queue → worker → the other users / devices; `alt` branches for failure (retry with the idempotency key, dead-letter queue) and offline users.
- **Must show** in a fullstack design: auth at the gateway; stateless services that scale horizontally; where data lives (source of truth) and how reads scale (cache, replicas, CDN); what is synchronous vs asynchronous; idempotency for retried writes; how failures are handled (retries, DLQ); observability.
- **Problem add-ons**:
  - **chat / messaging**: WebSocket gateway fleet (sticky by connection) + a presence service; message ids with per-conversation ordering (sequence number or Snowflake id); message store partitioned by conversation id (e.g. Cassandra / DynamoDB, or Postgres partitions); fan-out through pub/sub (Redis / Kafka) to the gateways holding the recipients; sent / delivered / read receipts; offline delivery: store, then sync on reconnect + push via FCM / APNs; media through presigned S3 uploads + a processing worker + CDN; search over messages if asked.
  - **feed / timeline**: fan-out on write into timeline caches vs fan-out on read; hybrid for accounts with huge followings; ranking service; media CDN.
  - **booking / inventory**: short holds with expiry, a unique constraint or optimistic locking against double booking, idempotency keys, payment via an outbox + saga.
  - **search**: search index fed by change data capture, autocomplete, ranking.
  - **file / media upload**: presigned direct-to-storage upload, async processing workers (thumbnails, transcoding), CDN delivery.
  - **notifications**: preferences, dedupe, rate limits per user, retries with backoff.
  - **URL shortener / counters**: key generation (base62 of an id range), cache-heavy reads, async analytics.

### Deep dives and common follow-ups
- **Concurrency / double booking**: DB transaction with a unique constraint, optimistic locking (version column), `SELECT … FOR UPDATE`, short-lived holds / reservations with expiry, a Redis lock with TTL; idempotency keys on the booking API.
- **Scaling reads**: cache-aside + read replicas + CDN; **scaling writes**: sharding, queues to smooth spikes, batching.
- **Feeds / fan-out**: fan-out on write (precomputed timelines) vs fan-out on read; hybrid for celebrity accounts.
- **Consistency**: strong vs eventual per feature, distributed transactions avoided with sagas / outbox, read-your-writes.
- **Reliability**: no single point of failure (multi-AZ, replicas, health checks), timeouts + retries with jitter + circuit breakers, graceful degradation, backups and disaster recovery (RPO / RTO).
- **Rate limiting**: token bucket / sliding window at the gateway, per user / IP.
- **Search, uploads, notifications**: index sync via events; presigned direct-to-S3 uploads + async processing; notification service with user preferences and dedupe.
- **Frontend side**: how the web app renders each page (SSR for SEO pages, CSR for dashboards), server-state caching and optimistic updates, real-time merge into the UI, error / retry states, auth via HttpOnly cookie through the BFF.

### Failure modes and trade-offs
- Single points of failure, retry storms (backoff + jitter, circuit breakers), cache stampede, hot partitions / hot keys, queue backlogs, replica lag (read-your-writes issues), thundering herd after an outage.
- Trade-offs to name: SQL vs NoSQL, monolith vs microservices, strong vs eventual consistency, push vs pull, cache freshness vs load, cost vs latency.

### Real project examples
- Use my documented work where it truly fits (e.g. GORA: Next.js customer platform → BFF → Ruby on Rails scheduling / booking services, Cloudflare Workers at the edge; Speeqr: REST + JWT to the Rails API, Action Cable signaling, WebRTC media, FCM push) — documented facts only, never invented metrics.
