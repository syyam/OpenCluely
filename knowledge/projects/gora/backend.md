<!-- Rakuten GORA backend, platform and mobile knowledge (sources: "Rakuten
GORA — Full-Stack and Frontend.txt" + "# Rakuten GORA — Frontend
Architect.txt"). Owns the BFF (server side), auth, services, data, infra,
backend observability, billing and traffic peaks. Web frontend facts live only
in frontend-customer.md and frontend-business-portal.md; don't repeat them
here. Entries without their own profiles line apply to every profile. -->

## Rakuten GORA — platform overview (backend and mobile)
id: gora-summary
profiles: android, fullstack
group: gora
keys: !gora, !rakuten, golf, reservation platform, architecture of, walk me through, current project, last project, backend, platform
- Rakuten GORA: a golf-course reservation platform used by millions of people across Japan. I built user-facing features end to end in a large TypeScript React / React Native codebase; the mobile apps are also native Kotlin Android with Kotlin Multiplatform code shared with iOS, built and distributed on Bitrise.
- Platform: the web frontends (the customer reservation platform and the B2B Business Innovation Portal) → **Kotlin + Spring Boot BFF** → Spring Boot microservices with **one database per service**; Kafka events, Debezium CDC, Redis, Elasticsearch, S3 for images, circuit-breaker adapters, Kubernetes + Helm + Argo CD (GitOps), Testcontainers; backend logs/metrics in ELK and Prometheus + Grafana.
- Explanation flow, from the user inward: `Web frontends → BFF → Microservices → Service-owned databases`, then `Service write → Kafka event → downstream consumers`, then `Redis + Elasticsearch + S3/CDN + Kubernetes + Observability`. Explain **why each piece exists and what problem it solves**, not a list of tools.

## GORA — BFF (Backend for Frontend), server side
id: gora-bff
group: gora
keys: !bff, !backend for frontend, !wso2, gora, gateway, api gateway, one request, aggregate, spring boot, kotlin
- The **BFF** is a dedicated **Kotlin + Spring Boot** service that gives the web frontend a UI-oriented API contract. It calls several downstream services **in parallel** (golf-course inventory, live weather, Rakuten Points) and **merges them into one payload** for the React UI, so the browser doesn't depend on internal service boundaries or legacy data models.
- It is also the security boundary (see authentication).
- Deployment: containerized with Docker, deployed on **Kubernetes across multiple zones**, and **horizontally scaled** for high-volume periods such as weekend booking traffic.
- **WSO2 API Manager** is a *separate* entry point for **outside callers** (other Rakuten systems, external developers, B2B partners via the Rakuten Web Service Portal): OAuth 2.0, per-partner quotas, billing, audit trails. It isn't the browser path.

## GORA — authentication: Rakuten ID SSO, BFF sessions, OAuth 2.0
id: gora-auth
group: gora
keys: !sso, !oauth, !rakuten id, !session*, gora, login, sign in, authentication, auth, auth flow, security boundary, secrets
- No separate GORA password; users sign in with their **Rakuten ID (SSO)**.
- The **BFF is the security boundary**: it validates the Rakuten ID / SSO credentials, handles the secure session (active sessions live in **Redis**), and does the **OAuth 2.0** token handling towards downstream services. The user's identity is passed downstream (e.g. `X-User-Id`), never a password.
- The Why: internal corporate API secrets and downstream service credentials never reach the browser, so the frontend doesn't manage sensitive credentials.

## GORA — microservices, database per service, Kafka, Debezium, Spring Batch
id: gora-data
group: gora
keys: !kafka, !debezium, !database per service, !spring batch, !change data capture, gora, microservice*, spring boot, event*, cdc, event driven
- Spring Boot microservices with REST APIs. **Each service owns its PostgreSQL / MySQL database**; others go through APIs or events, never the DB directly, so one team can change its schema without breaking another.
- **Kafka** is the async event bus: after a write, a service publishes e.g. `reservation.confirmed`, and interested services consume it independently. It gives ordered, **replayable** streams and independent consumers.
- **Debezium CDC** watches database change logs and turns row changes into Kafka events, keeping search indexes and caches in sync without hand-publishing every change.
- **Spring Batch** handles large inventory / price-file imports in chunks, restartable from the failure point, run as Kubernetes CronJobs.

## GORA — Redis, Elasticsearch, S3 + CDN
id: gora-cache-search
group: gora
keys: !redis, !elasticsearch, !cdn, gora, cache, caching, search, s3, rate limit*, booking lock
- **Redis** is a fast shared store for non-critical work: hot search results, course pages, a short-lived **booking lock**, and rate-limit counters. It is **not the source of truth**, so losing it degrades speed, not data.
- **Elasticsearch** handles searches too expensive for SQL (e.g. "courses near Tokyo, under ¥10,000, free Saturday morning"), kept approximately in sync through the CDC / event pipeline.
- **S3** stores course images.

## GORA — resilience: circuit-breaker adapters for external services
id: gora-resilience
group: gora
keys: !circuit breaker*, !rakuten pay, !rakuten points, gora, external service*, dependency, timeout*, retries, fails, failure isolation
- SSO, **Rakuten Pay** and **Rakuten Points** sit behind adapters with **timeouts, retries and circuit breakers**, so a failing external dependency doesn't take down the booking flow.
- Example: if Rakuten Points is down, the booking still completes, and the points operation is handled later through Kafka.

## GORA — Kubernetes, Helm + Argo CD (GitOps), Testcontainers
id: gora-infra
group: gora
min: 3
keys: !kubernetes, !argo cd, !argocd, !helm, !gitops, !testcontainers, gora, deploy*, rollback, scaling, ci, integration test*, k8s
- **Kubernetes** runs the containers: Deployments, restarting failed containers, scaling replicas, CronJobs.
- **GitOps**: the desired state lives in Git (Helm charts) and **Argo CD** keeps the cluster in sync: `Git commit/merge → Argo CD → Kubernetes`. Rollback = revert the Git change, not a manual deploy.
- **Testcontainers** in CI start a real PostgreSQL and Kafka for integration tests, so tests exercise the real engines instead of only mocks.
- Mobile CI/CD: **Bitrise** for the mobile apps (build, test, lint, app distribution); I also take part in the release on-call rotation.

## GORA — backend observability: ELK, Prometheus, Grafana
id: gora-observability
group: gora
keys: !elk, !prometheus, !grafana, gora, logs, logging, metrics, dashboard*, on call, alert*
- **ELK** centralizes logs, so one user action can be searched and correlated across many services.
- **Prometheus** collects request rate, error rate, latency percentiles and queue depth; **Grafana** provides dashboards and alerts, e.g. `Search p99 > 500 ms for 5 minutes → alert on-call`.
- Mobile crash reporting: Crashlytics.

## GORA — billing and subscription consistency (iOS, Android, backend)
id: gora-billing
group: gora
keys: !work at rakuten, !work at gora, !worked on at, !your role at, !role at rakuten, !billing, !subscription*, !proudest, !most proud, !proud of, gora, ios, android, consistency, receipt*, restore purchase, grace period, !hardest problem, !biggest challenge, !biggest achievement, !most challenging project
- I owned keeping billing / subscription state consistent between the **iOS app, the Android app and the backend**. It was the hardest cross-team problem on the product.
- Resume facts: handling **receipt sync failures, renewal grace periods and restore-purchase edge cases**.
- Key points: the platforms behave differently on the client, so the **backend is the reliable source of the business state**. I worked across the client and backend boundaries (not as an isolated mobile issue), and the goal was **detecting and resolving inconsistencies before they affected users**.
- Story order: cross-platform consistency problem → backend ownership of business state → synchronization problems → detecting / resolving inconsistencies → end-user reliability.
- Stay at this level of detail. Don't invent specific payment-provider APIs, webhook flows, schemas, sync mechanisms (e.g. how receipts were sent, what storage was replaced), incidents, or measured results; the outcome to state is simply more reliable, consistent subscription state for users across platforms.

## GORA — traffic peaks and scale
id: gora-peak-traffic
group: gora
keys: !peak, !high traffic, !load at peak, !scale, !scalab*, gora, traffic, concurrent users, requests per second, how many users, load, weekend
- Confirmed fact: GORA is used by **millions of people across Japan**. Do **not** invent exact RPS / QPS or user counts; if pressed, say you'd rather not quote a number from memory and describe how peaks were handled.
- How peaks (e.g. weekend booking traffic) were handled on the backend: the BFF aggregates calls so one screen = one request and scales horizontally on Kubernetes across zones; **Redis** caches hot search results / course pages and does rate limiting; **Elasticsearch** for heavy search; **circuit breakers** isolate external services; Kafka moves non-critical work (e.g. points) off the request path; Prometheus / Grafana alerts on latency.
