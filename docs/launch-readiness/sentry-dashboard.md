# Sentry Dashboard Proof

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout observability  
Primary dashboard surface: Sentry-first  
Supplemental dashboard sources: Provider dashboards where Sentry cannot own the signal  
Current default status: IN PROGRESS — Sentry release/environment config is implemented in repo, Phase 2 chaos/load proof passed locally, and deployed Sentry intake has been proven with a synthetic production event. Full dashboard section proof, provider dashboard links, staging/production dashboard review, and alert-routing proof are still TODO.

This document defines the minimum launch dashboard required for private beta and public rollout. The dashboard must show real staging or production signals, not just planned panels.

Important distinction:

- Local tests prove route/provider behavior.
- Local load and chaos runs prove the launch-ops suite works.
- Synthetic Sentry proof proves deployed event capture works.
- Dashboard proof proves the deployed system can actually be observed during private beta/public rollout.
- Alert-routing proof proves someone will be notified when something catches fire, instead of the app quietly becoming a haunted toaster.

---

# Current Phase 2 proof baseline

| Item | Status | Evidence |
|---|---|---|
| Sentry release/environment config | IMPLEMENTED | lib/observability/sentryConfig.ts, sentry.server.config.ts, sentry.edge.config.ts, instrumentation-client.ts |
| Deployed Sentry intake | PASS | Synthetic event captured from deployed route: e56044a034cb4fb78d1b09801fb43da5 |
| Synthetic debug route | PASS | POST /api/internal/debug/sentry-test returned HTTP 200 on https://www.tovis.app |
| Chaos suite | PASSED LOCALLY | pnpm test:chaos: 6 files / 17 tests passed |
| Launch load suite | PASSED LOCALLY | pnpm test:load:launch: 8/8 launch load steps passed |
| Aggregate launch ops verification | PASSED LOCALLY | pnpm verify:launch-ops passed locally at commit 27bfa28 |
| Live Sentry dashboard sections | TODO LIVE PROOF | Need dashboard/widget/query links per section |
| Provider dashboard proof | TODO | Need Stripe/Postmark/Twilio/Supabase/Vercel/provider links where relevant |
| Synthetic alert proof | TODO | Needs one safe alert routed to Slack or documented alternate path |
| Slack alert routing | TODO / BLOCKED | Depends on Sentry plan or alternate alerting path |
| Backup owner / escalation | BLOCKED | Required before public rollout |

Local Phase 2 proof is not the same as deployed operational proof. The repo-side launch ops suite is implemented and locally green. Deployed Sentry intake has now been proven. Private beta and public rollout still require dashboard section proof, alert routing proof, and provider-dashboard evidence.

---

# Dashboard rule

A dashboard section is not complete unless it has:

- Owner
- Environment
- Signal source
- Sentry dashboard/widget link or provider dashboard link
- Threshold or expected healthy range
- Related alert
- Related runbook or follow-up
- Last verified date
- Launch decision: private beta blocker, public rollout blocker, or informational

If a signal cannot be captured in Sentry, link the provider dashboard and document why Sentry is not the source of truth.

Do not mark a dashboard section complete because a test exists. Tests prove behavior. Dashboards prove the deployed system can be observed.

---

# Dashboard status summary

| Section | Status | Owner | Evidence | Launch impact |
|---|---|---|---|---|
| Health/readiness | TODO LIVE PROOF | Tori | Health endpoints exist; live dashboard/synthetic proof TODO | Blocks private beta |
| Booking funnel | TODO LIVE PROOF | Tori | Local load proof exists; Sentry dashboard proof TODO | Blocks private beta |
| Pro session lifecycle | TODO LIVE PROOF | Tori | Local lifecycle tests exist; Sentry dashboard proof TODO | Blocks private beta |
| Media uploads | TODO LIVE PROOF | Tori | Local media load + storage chaos proof exists; dashboard/provider proof TODO | Blocks private beta |
| Payments/webhooks | TODO LIVE PROOF | Tori | Local checkout/load + Stripe storm proof exists; dashboard/provider proof TODO | Blocks private beta if payments enabled |
| Notifications | TODO LIVE PROOF | Tori | Local notification load + provider degradation proof exists; dashboard/provider proof TODO | Blocks private beta if email/SMS enabled |
| Background jobs | TODO LIVE PROOF | Tori | Local notification job load proof exists; dashboard proof TODO | Blocks public rollout if launch-critical |
| Auth/rate limits | TODO LIVE PROOF | Tori | Local signup load proof exists; rate-limit dashboard proof TODO | Blocks private beta |
| Infrastructure dependencies | PARTIAL LIVE PROOF | Tori | Deployed Sentry intake proven; provider dashboards/health proof TODO | Blocks private beta |
| SLO/error budget | TODO THRESHOLDS + LIVE PROOF | Tori | Local p50/p95/p99 load output exists; Sentry SLO dashboard TODO | Blocks public rollout |

---

# Required dashboard metadata

| Field | Value |
|---|---|
| Sentry project | TODO |
| Sentry organization | TODO |
| Environment names | SENTRY_ENVIRONMENT / NEXT_PUBLIC_SENTRY_ENVIRONMENT, falling back to Vercel/Node env values |
| Release naming format | SENTRY_RELEASE / NEXT_PUBLIC_SENTRY_RELEASE, falling back to Vercel commit SHA |
| Deployment marker strategy | Release/dist/environment metadata is set in server, edge, and client Sentry config; Sentry deploy/release view still needs dashboard verification |
| Dashboard URL | TODO |
| Staging dashboard verified | TODO |
| Production dashboard verified | PARTIAL — synthetic production event captured |
| Last local launch-ops proof | Commit 27bfa28, pnpm verify:launch-ops, PASS |
| Last deployed Sentry intake proof | 2026-06-05, event ID e56044a034cb4fb78d1b09801fb43da5, PASS |
| Last full dashboard proof | TODO |
| Verified by | Tori |

---

# Release and environment tagging

Before private beta, Sentry events must include enough metadata to identify the deploy that produced the event.

| Requirement | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Server Sentry release set | IMPLEMENTED | Tori | sentry.server.config.ts, lib/observability/sentryConfig.ts | Deployed synthetic event captured; verify release in Sentry UI. |
| Edge Sentry release set | IMPLEMENTED | Tori | sentry.edge.config.ts, lib/observability/sentryConfig.ts | Deployed edge-event proof still TODO if edge coverage is required. |
| Client Sentry release set | IMPLEMENTED | Tori | instrumentation-client.ts | Deployed browser event proof still TODO. |
| Environment value set | IMPLEMENTED | Tori | lib/observability/sentryConfig.ts, instrumentation-client.ts | Deployed event shows Sentry environment metadata in rendered page baggage; confirm in Sentry UI. |
| Deploy marker visible | PARTIAL LIVE PROOF | Tori | Synthetic event ID e56044a034cb4fb78d1b09801fb43da5 | Link Sentry event/release/deploy view after verifying in Sentry. |
| Source maps/upload behavior verified | TODO LIVE PROOF | Tori | TODO | Required if relying on Sentry stack traces. |

---

# Deployed Sentry intake proof

## Evidence: synthetic Sentry production event

Status: PASS  
Owner: Tori  
Environment: production  
Base URL: https://www.tovis.app  
Route: POST /api/internal/debug/sentry-test  
Event ID: e56044a034cb4fb78d1b09801fb43da5  
Verified from curl: 2026-06-05  
Verified by: Tori  

### Command shape

bash set -a source .env.local set +a  export STAGING_BASE_URL="https://www.tovis.app" export INTERNAL_JOB_SECRET="$CRON_SECRET"  curl -i -X POST "$STAGING_BASE_URL/api/internal/debug/sentry-test" \   -H "Authorization: Bearer $INTERNAL_JOB_SECRET" \   -H "Origin: https://www.tovis.app" \   -H "Referer: https://www.tovis.app/" 

### Observed response

text HTTP/2 200 {"ok":true,"eventId":"e56044a034cb4fb78d1b09801fb43da5","message":"Synthetic Sentry event captured."} 

### What this proves

- The deployed debug route exists.
- The internal job secret path works when CRON_SECRET is exported locally as INTERNAL_JOB_SECRET.
- Origin/referer validation passes for https://www.tovis.app.
- The deployed app successfully captures a synthetic Sentry event.
- Sentry intake is functioning for at least one deployed server-side route.

### What this does not prove yet

- It does not prove all dashboard sections exist.
- It does not prove alert routing works.
- It does not prove Slack receives P1/P2 notifications.
- It does not prove provider dashboards are linked.
- It does not prove client/browser Sentry capture.
- It does not prove edge Sentry capture.
- It does not prove source maps are uploaded and useful.
- It does not replace staging/private-beta observability review.

### Follow-up

- Search Sentry for event ID e56044a034cb4fb78d1b09801fb43da5.
- Link the event URL here.
- Confirm environment, release, timestamp, and route metadata in the Sentry UI.
- Add dashboard/widget/query links for the required dashboard sections.
- Trigger one safe alert path once alert routing exists.

---

# Console/log capture policy

| Question | Decision | Evidence/notes |
|---|---|---|
| Is console/log capture enabled? | Disabled by default | Server/edge config enables Sentry console logging only when SENTRY_ENABLE_LOGS or NEXT_PUBLIC_SENTRY_ENABLE_LOGS is truthy. |
| Which environments allow it? | Local/staging only until proven safe | Do not enable in production until redaction proof and owner review are complete. |
| What redaction boundary protects logs? | Central Sentry event scrubber | Server/edge events pass through scrubSentryEvent() in lib/observability/sentryConfig.ts, backed by redactAuditPayload(). |
| Which values must never be logged? | Listed below | Keep this list current. |
| Who owns reviewing log safety? | Tori | Required before enabling Sentry log capture in staging/production. |

Sensitive values that must never be intentionally logged:

- Raw passwords
- Session tokens
- Reset tokens
- Client action tokens
- Claim tokens
- Invite tokens
- Stripe secrets or webhook secrets
- Supabase service role keys
- PII AEAD keys
- PII HMAC lookup keys
- Full address payloads
- Raw phone/email payloads outside approved privacy/security boundaries
- Signed private media URLs
- Private storage paths
- Payment identifiers beyond approved redacted forms
- Export/delete payload internals
- Full webhook payloads containing sensitive fields

If console/log capture is enabled outside local development, this file must link to the redaction proof or policy that makes it acceptable.

---

# Dashboard sections

## 1. Health/readiness

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Sentry and health/readiness endpoint  
Supplemental source: Provider dashboards  
Related runbook: docs/runbooks/health-readiness.md  
Current proof status: Local endpoint/provider test coverage exists. Deployed Sentry intake proof exists. Live health dashboard/synthetic proof TODO.

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| App live check success/failure | Sentry or synthetic check | 99%+ success during beta smoke window | TODO LIVE PROOF | TODO |
| Readiness endpoint success/failure | Sentry or synthetic check | 99%+ success during beta smoke window | TODO LIVE PROOF | TODO |
| Database readiness | Health/readiness endpoint | Healthy or degraded with clear component status | TODO LIVE PROOF | TODO |
| Redis readiness | Health/readiness endpoint | Healthy or degraded with clear component status | TODO LIVE PROOF | TODO |
| Storage readiness | Health/readiness endpoint/provider | Healthy or degraded with clear component status | TODO LIVE PROOF | TODO |
| Stripe readiness | Health/readiness endpoint/provider | Healthy/configured if payments enabled | TODO LIVE PROOF | TODO |
| Postmark readiness | Health/readiness endpoint/provider | Healthy/configured if email enabled | TODO LIVE PROOF | TODO |
| Twilio readiness | Health/readiness endpoint/provider | Healthy/configured if SMS enabled | TODO LIVE PROOF | TODO |
| Provider-live check setting | Env/deploy config | Explicitly known per environment | TODO LIVE PROOF | TODO |

### Evidence required

- Sentry dashboard/synthetic link
- Last successful staging/production check
- Last failed-check proof if available
- Related Slack alert link
- Provider dashboard links where Sentry is not source of truth

---

## 2. Booking funnel

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Sentry events/errors/performance  
Related runbook: docs/runbooks/booking-funnel.md or TODO if not created  
Current proof status: Local load suite covers availability, holds, finalize, checkout, and media metadata. Live Sentry dashboard proof TODO.

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Availability bootstrap requests | Sentry/performance | p95 within accepted beta threshold | TODO LIVE PROOF | Local load proof exists |
| Availability bootstrap failures | Sentry/errors | No unexplained 5xx during smoke window | TODO LIVE PROOF | Local load proof exists |
| Availability day requests | Sentry/performance | p95 within accepted beta threshold | TODO LIVE PROOF | TODO |
| Hold create attempts | Sentry/app event or route performance | Expected success/409/429 mix only | TODO LIVE PROOF | Local load proof exists |
| Hold create failures | Sentry/errors | Zero unexplained 5xx during smoke window | TODO LIVE PROOF | Local load proof exists |
| Booking finalize attempts | Sentry/app event or route performance | Expected 201/409/429 mix only | TODO LIVE PROOF | Local load proof exists |
| Booking finalize failures | Sentry/errors | Zero unexplained 5xx during smoke window | TODO LIVE PROOF | Local load proof exists |
| Hold-to-finalize conversion | App metric/manual query | Defined before public rollout | TODO METRIC | TODO |
| Booking conflict/race failures | Sentry/errors/app event | Expected conflicts only; no unsafe mutation | TODO LIVE PROOF | Local concurrency/chaos proof exists |

### Evidence required

- Staging/production event/error query link
- Booking smoke-test proof link
- Load-test proof link before public rollout
- Alert link for hold/finalize failure spikes

---

## 3. Pro session lifecycle

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Sentry events/errors/performance  
Related runbook: TODO  
Current proof status: Local lifecycle/write-boundary tests exist. Live dashboard proof TODO.

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Pro session page/load errors | Sentry/errors | No unexplained 5xx/page crash during beta smoke | TODO LIVE PROOF | TODO |
| Session lifecycle action attempts | Sentry/app event | Visible per action type | TODO LIVE PROOF | TODO |
| Session lifecycle action failures | Sentry/errors | No unexplained failures during smoke | TODO LIVE PROOF | TODO |
| Illegal transition blocks | Sentry/app event | Expected blocks visible and non-noisy | TODO LIVE PROOF | Local tests exist |
| Closeout blocker events | Sentry/app event | Visible enough for support/debugging | TODO LIVE PROOF | Local tests exist |
| Closeout completion failures | Sentry/errors | Zero unexplained failures during smoke | TODO LIVE PROOF | TODO |
| Aftercare/payment/media blocker failures | Sentry/errors | Visible with safe redaction | TODO LIVE PROOF | TODO |

### Evidence required

- Lifecycle smoke/regression proof
- Dashboard section link
- Alert link for lifecycle/closeout failure spike

---

## 4. Media uploads

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Sentry errors/performance  
Supplemental source: Supabase dashboard  
Related runbooks: docs/runbooks/supabase-storage-outage.md, docs/runbooks/private-media-incident.md  
Current proof status: Local media metadata load proof and Supabase storage outage chaos proof exist. Live dashboard/provider proof TODO.

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Signed upload creation attempts | Sentry/app event | Visible if upload signing is in launch scope | TODO LIVE PROOF | TODO |
| Signed upload creation failures | Sentry/errors | Zero unexplained 5xx during smoke | TODO LIVE PROOF | TODO |
| Media metadata save attempts | Sentry/app event or route performance | Expected 200/400/409/429 only | TODO LIVE PROOF | Local load proof exists |
| Media metadata save failures | Sentry/errors | Zero unexplained 5xx during smoke | TODO LIVE PROOF | Local chaos proof exists |
| Storage provider errors | Supabase/Sentry | Provider errors visible and redacted | TODO LIVE PROOF | Local chaos proof exists |
| Rejected file type/size events | Sentry/app event | Visible if enforced at route/provider boundary | TODO LIVE PROOF | TODO |
| Private media access failures | Sentry/errors | Visible without signed URL/path leakage | TODO LIVE PROOF | Local chaos proof exists |
| Private media policy regression | Storage proof/manual check | Zero tolerance | TODO DEPLOYED PROOF | TODO |

### Evidence required

- Storage policy proof
- Upload/metadata proof
- Private media proof
- Related alert links

---

## 5. Payments/webhooks

Launch impact: Blocks private beta if payments are enabled  
Owner: Tori  
Primary source: Sentry errors/performance  
Supplemental source: Stripe dashboard  
Related runbook: docs/runbooks/stripe-degradation.md  
Current proof status: Local checkout load proof and Stripe webhook storm chaos proof exist. Live Sentry/Stripe dashboard proof TODO.

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Checkout creation attempts | Sentry/app event or route performance | Expected success/controlled failure only | TODO LIVE PROOF | Local load proof exists |
| Checkout creation failures | Sentry/errors | Zero unexplained 5xx during smoke | TODO LIVE PROOF | Local load proof exists |
| Stripe webhook received | Sentry/app event | Visible by event type | TODO LIVE PROOF | Local chaos/load proof exists |
| Stripe webhook signature failures | Sentry/errors/app event | Invalid signatures rejected, no secret leak | TODO LIVE PROOF | Local route/chaos proof exists |
| Stripe webhook processing failures | Sentry/errors | Alertable if above threshold | TODO LIVE PROOF | Local chaos proof exists |
| Webhook replay/dedupe events | Sentry/app event | Duplicate replay does not double-mutate | TODO LIVE PROOF | Local chaos/load proof exists |
| Payment state mutation failures | Sentry/errors | Zero unexplained failures during smoke | TODO LIVE PROOF | Local route proof exists |
| Stripe provider incidents | Stripe dashboard | Provider incident awareness linked | TODO PROVIDER LINK | TODO |

### Evidence required

- Checkout proof
- Signed webhook proof
- Replay/idempotency proof
- Stripe dashboard link
- P1 alert link

---

## 6. Notifications

Launch impact: Blocks private beta if email/SMS are enabled  
Owner: Tori  
Primary source: Sentry errors/performance  
Supplemental source: Postmark/Twilio dashboards  
Related runbooks: docs/runbooks/notification-backlog.md, docs/runbooks/postmark-degradation.md, docs/runbooks/twilio-degradation.md  
Current proof status: Local notification processing load proof and provider degradation chaos proof exist. Live dashboard/provider proof TODO.

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Email send attempts | Sentry/app event or provider dashboard | Visible if email enabled | TODO LIVE PROOF | Local Postmark chaos proof exists |
| Email send failures | Sentry/errors/Postmark | Retryable/final failures visible | TODO LIVE PROOF | Local Postmark chaos proof exists |
| SMS send attempts | Sentry/app event or provider dashboard | Visible if SMS enabled | TODO LIVE PROOF | Local Twilio chaos proof exists |
| SMS send failures | Sentry/errors/Twilio | Retryable/final failures visible | TODO LIVE PROOF | Local Twilio chaos proof exists |
| Notification retry count | App metric/Sentry | Threshold defined before public rollout | TODO METRIC | TODO |
| Notification backlog/dead-letter count | App metric/manual query | Threshold defined before public rollout | TODO METRIC | TODO |
| Manual follow-up required count | App metric/manual query | Threshold defined before public rollout | TODO METRIC | TODO |
| Provider degradation | Provider dashboard | Provider incident awareness linked | TODO PROVIDER LINK | TODO |

### Evidence required

- Notification proof
- Postmark dashboard link if email enabled
- Twilio dashboard link if SMS enabled
- Alert link

---

## 7. Background jobs

Launch impact: Blocks public rollout if launch-critical jobs exist  
Owner: Tori  
Primary source: Sentry errors/performance  
Related runbook: docs/runbooks/notification-backlog.md or TODO for non-notification jobs  
Current proof status: Notification processing job is covered by local load and DB degradation chaos tests. Live dashboard proof TODO.

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Job started | Sentry/app event | Visible for launch-critical jobs | TODO LIVE PROOF | TODO |
| Job completed | Sentry/app event | Visible for launch-critical jobs | TODO LIVE PROOF | TODO |
| Job failed | Sentry/errors | Alertable above threshold | TODO LIVE PROOF | Local DB chaos proof exists |
| Job duration | Sentry/performance | p95 threshold defined before public rollout | TODO LIVE PROOF | Local load proof exists |
| Stale job detection | App metric/manual query | Threshold defined before public rollout | TODO METRIC | TODO |
| Queue depth | App metric/provider | Threshold defined before public rollout | TODO METRIC | TODO |
| Dead-letter/manual follow-up | App metric/manual query | Threshold defined before public rollout | TODO METRIC | TODO |

### Evidence required

- List of beta/public-critical jobs
- Dashboard section link
- Alert link for failed/stale jobs

---

## 8. Auth/rate limits

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Sentry errors/performance  
Related runbook: docs/runbooks/redis-outage.md  
Current proof status: Signup load proof exists. Redis/rate-limit failure behavior covered locally. Live dashboard proof TODO.

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Login attempts/failures | Sentry/app event/errors | Threshold defined before beta | TODO LIVE PROOF | TODO |
| Register attempts/failures | Sentry/app event/errors | Expected 201/429 mix under smoke load | TODO LIVE PROOF | Local signup load proof exists |
| Password reset attempts/failures | Sentry/app event/errors | Threshold defined before beta | TODO LIVE PROOF | TODO |
| Phone correction attempts/failures | Sentry/app event/errors | Threshold defined before beta | TODO LIVE PROOF | TODO |
| Rate-limit block count | Sentry/app event | Visible by route/bucket | TODO LIVE PROOF | Local signup load proof exists |
| High-risk route rate-limit failures | Sentry/errors | Fail closed; no bypass | TODO LIVE PROOF | Local Redis chaos proof exists |
| Redis/rate-limit backend unavailable | Sentry/errors/health | Alertable degradation | TODO LIVE PROOF | Local Redis chaos proof exists |
| Suspicious auth spike | Sentry/app event | Threshold defined before public rollout | TODO LIVE PROOF | TODO |

### Evidence required

- Auth route proof
- Rate-limit proof
- Redis/rate-limit alert link

---

## 9. Infrastructure dependencies

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Health/readiness and provider dashboards  
Related runbooks: docs/runbooks/health-readiness.md, docs/runbooks/redis-outage.md, docs/runbooks/postgres-outage.md, docs/runbooks/supabase-storage-outage.md, docs/runbooks/stripe-degradation.md, docs/runbooks/postmark-degradation.md, docs/runbooks/twilio-degradation.md  
Current proof status: Deployed Sentry intake is proven. Local chaos tests cover Redis, Supabase Storage, Stripe, Postmark, Twilio, and DB degradation. Provider dashboard/live health proof TODO.

### Required signals

| Dependency | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Vercel/deploy environment | Vercel/Sentry | Deploy status visible | TODO PROVIDER LINK | TODO |
| Database/Postgres | Health/provider | Healthy or degraded with clear route behavior | TODO LIVE PROOF | Local DB chaos proof exists |
| Redis/rate-limit backend | Health/provider | Healthy or degraded with fail-closed behavior | TODO LIVE PROOF | Local Redis chaos proof exists |
| Supabase Storage | Health/provider | Healthy or degraded with safe media behavior | TODO LIVE PROOF | Local storage chaos proof exists |
| Stripe | Provider dashboard/Sentry | Provider incidents visible | TODO PROVIDER LINK | Local Stripe chaos/load proof exists |
| Postmark | Provider dashboard/Sentry | Provider incidents visible | TODO PROVIDER LINK | Local Postmark chaos proof exists |
| Twilio | Provider dashboard/Sentry | Provider incidents visible | TODO PROVIDER LINK | Local Twilio chaos proof exists |
| Sentry intake | Sentry dashboard | Events visible by environment/release | PARTIAL LIVE PROOF | Synthetic event ID e56044a034cb4fb78d1b09801fb43da5 |
| DNS/domain | Provider/manual check | Healthy and documented | TODO PROVIDER LINK | TODO |

### Evidence required

- Provider dashboard links
- Health/readiness proof
- Alert/runbook mapping
- Sentry event/release/deploy links

---

## 10. SLO/error budget

Launch impact: Blocks public rollout  
Owner: Tori  
Primary source: Sentry performance/errors  
Related docs: docs/launch-readiness/go-no-go.md, docs/launch-readiness/risk-register.md  
Current proof status: Local load tests emit latency summaries. Formal SLO thresholds and live Sentry dashboard proof TODO.

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| API error rate | Sentry | Define private beta and public thresholds | TODO THRESHOLD | TODO |
| Core booking route p95 latency | Sentry/load tests | Define threshold from smoke/baseline results | TODO THRESHOLD | Local load proof exists |
| Availability bootstrap p95 latency | Sentry/load tests | Define threshold from smoke/baseline results | TODO THRESHOLD | Local load proof exists |
| Booking finalize p95 latency | Sentry/load tests | Define threshold from smoke/baseline results | TODO THRESHOLD | Local load proof exists |
| Media metadata p95 latency | Sentry/load tests | Define threshold from smoke/baseline results | TODO THRESHOLD | Local load proof exists |
| Checkout p95 latency | Sentry/load tests | Define threshold from smoke/baseline results | TODO THRESHOLD | Local load proof exists |
| Stripe webhook processing p95 latency | Sentry/load tests | Define threshold from smoke/baseline results | TODO THRESHOLD | Local load proof exists |
| Notification processing latency | Sentry/load tests | Define threshold from smoke/baseline results | TODO THRESHOLD | Local load proof exists |
| Error budget burn | Sentry/manual calculation | Define before public rollout | TODO THRESHOLD | TODO |

### Evidence required

- SLO threshold decisions
- Load-test proof links
- Error-rate dashboard link
- Alert link for error budget burn

---

# Local Phase 2 evidence

## Evidence: launch ops local proof

Status: PASS  
Owner: Tori  
Environment: local app using staging-style smoke profile  
Commit: 27bfa28  
Command:

bash DATABASE_URL="postgresql://postgres:postgres@localhost:5433/tovis_test" \ DIRECT_URL="postgresql://postgres:postgres@localhost:5433/tovis_test" \ pnpm verify:launch-ops 

### What was verified

- pnpm test:chaos passed.
- Chaos result: 6 files passed, 17 tests passed.
- pnpm test:load:launch passed.
- Launch load result: 8/8 steps passed.
- Availability bootstrap passed: 30/30 successful requests.
- Hold-create passed with expected conflict/rate-limit pressure.
- Booking finalize passed.
- Checkout passed: 10/10 successful requests.
- Media metadata passed: 10/10 successful requests.
- Notification processing passed: 10/10 successful requests.
- Stripe webhook replay passed: 10/10 successful requests with duplicate replay behavior visible.
- Signup passed with expected 201/429 mix and zero real failures.

### Known gaps

- This was local/staging-config proof, not full deployed staging proof.
- Full Sentry dashboard links are still TODO.
- Synthetic alert routing is still TODO.
- Slack alert routing is still TODO or blocked by Sentry plan/alerting path.
- Provider dashboard links are still TODO.
- Public backup owner is still TODO/BLOCKED.
- Formal SLO thresholds are still TODO.

### Launch decision

Local Phase 2 code proof is complete.  
Deployed Sentry intake proof is partially complete.  
Private beta dashboard/alert proof remains incomplete.  
Public rollout remains blocked.

---

# Private beta dashboard minimum

Private beta may proceed only when these are live enough to catch launch-critical failures:

| Section | Required for private beta? | Status |
|---|---:|---|
| Health/readiness | Yes | TODO LIVE PROOF |
| Booking funnel | Yes | TODO LIVE PROOF |
| Pro session lifecycle | Yes | TODO LIVE PROOF |
| Media uploads | Yes | TODO LIVE PROOF |
| Payments/webhooks | Yes, if payments enabled | TODO LIVE PROOF |
| Notifications | Yes, if email/SMS enabled | TODO LIVE PROOF |
| Auth/rate limits | Yes | TODO LIVE PROOF |
| Infrastructure dependencies | Yes | PARTIAL LIVE PROOF |
| Background jobs | If launch-critical | TODO LIVE PROOF |
| SLO/error budget | Basic error/latency view required | TODO THRESHOLDS + LIVE PROOF |

## Private beta evidence

text Dashboard URL: Environment: Release: Last staging verification: Last production verification: Synthetic Sentry event tested: Synthetic alert tested: Known gaps: Accepted risks: Decision: 

---

# Public rollout dashboard minimum

Public rollout requires:

- All 10 dashboard sections live or explicitly accepted with owner/signoff.
- P1/P2 alerts mapped.
- P1/P2 alert routing tested.
- Named backup owner exists.
- P1 public escalation path tested.
- Load-test evidence visible or linked.
- Chaos/failure evidence visible or linked.
- Provider dashboards linked.
- Release/deploy markers visible.
- Error budget or equivalent health threshold defined.
- No private-beta-only observability gaps left unaccepted.

## Public rollout evidence

text Dashboard URL: Environment: Release: Last staging verification: Last production verification: Synthetic Sentry event tested: Synthetic alert tested: Load proof linked: Chaos proof linked: Provider dashboards linked: Known gaps: Accepted risks: Decision: 

---

# Dashboard evidence template

Use this template when marking a section complete.

md ## Evidence: <section>  Status: PASS / FAIL / BLOCKED / ACCEPTED RISK Owner: Tori Environment: staging / production Dashboard link: TODO Sentry query/widget: TODO Provider dashboard link: TODO Related alert: TODO Related runbook: TODO Threshold: TODO Last verified: TODO Verified by: Tori  ### What was verified  TODO  ### Known gaps  TODO  ### Launch decision  TODO 

---

# Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/checklist.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- docs/launch-readiness/test-proof.md
- docs/runbooks/health-readiness.md
- docs/runbooks/redis-outage.md
- docs/runbooks/postgres-outage.md
- docs/runbooks/supabase-storage-outage.md
- docs/runbooks/stripe-degradation.md
- docs/runbooks/postmark-degradation.md
- docs/runbooks/twilio-degradation.md
- docs/runbooks/notification-backlog.md
- docs/runbooks/private-media-incident.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md

---

# Maintenance rule

A dashboard section is not complete because a heading exists, a test exists, a local load/chaos run passed, or one synthetic Sentry event was captured.

A section is complete only when live evidence is linked, the owner is named, thresholds are documented, and the launch impact is clear.

Local Phase 2 proof should be linked as supporting evidence. Deployed synthetic Sentry proof should be linked as intake/release evidence. Neither one replaces full dashboard section proof, alert-routing proof, or provider dashboard proof.