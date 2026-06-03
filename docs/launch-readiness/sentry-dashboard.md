# Sentry Dashboard Proof

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout observability  
Primary dashboard surface: Sentry-first  
Supplemental dashboard sources: Provider dashboards where Sentry cannot own the signal  
Current default status: TODO — dashboard proof not complete until live staging evidence is linked

This document defines the minimum launch dashboard required for private beta and public rollout. The dashboard must show real staging or production signals, not just planned panels.

## Dashboard rule

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

## Dashboard status summary

| Section | Status | Owner | Evidence | Launch impact |
|---|---|---|---|---|
| Health/readiness | TODO | Tori | TODO | Blocks private beta |
| Booking funnel | TODO | Tori | TODO | Blocks private beta |
| Pro session lifecycle | TODO | Tori | TODO | Blocks private beta |
| Media uploads | TODO | Tori | TODO | Blocks private beta |
| Payments/webhooks | TODO | Tori | TODO | Blocks private beta |
| Notifications | TODO | Tori | TODO | Blocks private beta if email/SMS enabled |
| Background jobs | TODO | Tori | TODO | Blocks public rollout if launch-critical |
| Auth/rate limits | TODO | Tori | TODO | Blocks private beta |
| Infrastructure dependencies | TODO | Tori | TODO | Blocks private beta |
| SLO/error budget | TODO | Tori | TODO | Blocks public rollout |

## Required dashboard metadata

| Field | Value |
|---|---|
| Sentry project | TODO |
| Sentry organization | TODO |
| Environment names | TODO |
| Release naming format | TODO |
| Deployment marker strategy | TODO |
| Dashboard URL | TODO |
| Staging dashboard verified | TODO |
| Production dashboard verified | TODO |
| Last verified | TODO |
| Verified by | Tori |

## Release and environment tagging

Before private beta, Sentry events must include enough metadata to identify the deploy that produced the event.

| Requirement | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Server Sentry release set | TODO | Tori | TODO | Check sentry.server.config.ts. |
| Edge Sentry release set | TODO | Tori | TODO | Check sentry.edge.config.ts. |
| Client Sentry release set | TODO | Tori | TODO | Check instrumentation-client.ts. |
| Environment value set | TODO | Tori | TODO | Example: staging, production. |
| Deploy marker visible | TODO | Tori | TODO | Link Sentry deploy/release view if available. |
| Source maps/upload behavior verified | TODO | Tori | TODO | Required if relying on Sentry stack traces. |

## Console/log capture policy

| Question | Decision | Evidence/notes |
|---|---|---|
| Is console/log capture enabled? | TODO | TODO |
| Which environments allow it? | TODO | TODO |
| What redaction boundary protects logs? | TODO | TODO |
| Which values must never be logged? | TODO | TODO |
| Who owns reviewing log safety? | Tori | TODO |

Sensitive values that must never be intentionally logged:

- Raw passwords
- Session tokens
- Reset tokens
- Client action tokens
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

If console/log capture remains enabled, this file must link to the redaction proof or policy that makes it acceptable.

---

# Dashboard sections

## 1. Health/readiness

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Sentry and health/readiness endpoint  
Supplemental source: Provider dashboards  
Related runbook: docs/runbooks/health-readiness.md

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| App live check success/failure | Sentry or synthetic check | TODO | TODO | TODO |
| Readiness endpoint success/failure | Sentry or synthetic check | TODO | TODO | TODO |
| Database readiness | Health/readiness endpoint | TODO | TODO | TODO |
| Redis readiness | Health/readiness endpoint | TODO | TODO | TODO |
| Storage readiness | Health/readiness endpoint/provider | TODO | TODO | TODO |
| Stripe readiness | Health/readiness endpoint/provider | TODO | TODO | TODO |
| Postmark readiness | Health/readiness endpoint/provider | TODO | TODO | TODO |
| Twilio readiness | Health/readiness endpoint/provider | TODO | TODO | TODO |
| Provider-live check setting | Env/deploy config | TODO | TODO | TODO |

### Evidence required

- Dashboard/synthetic link
- Last successful staging check
- Last failed-check proof if available
- Related Slack alert link

---

## 2. Booking funnel

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Sentry events/errors/performance  
Related runbook: TODO

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Availability bootstrap requests | Sentry/performance | TODO | TODO | TODO |
| Availability bootstrap failures | Sentry/errors | TODO | TODO | TODO |
| Availability day requests | Sentry/performance | TODO | TODO | TODO |
| Hold create attempts | Sentry/app event | TODO | TODO | TODO |
| Hold create failures | Sentry/errors | TODO | TODO | TODO |
| Booking finalize attempts | Sentry/app event | TODO | TODO | TODO |
| Booking finalize failures | Sentry/errors | TODO | TODO | TODO |
| Hold-to-finalize conversion | App metric/manual query | TODO | TODO | TODO |
| Booking conflict/race failures | Sentry/errors | TODO | TODO | TODO |

### Evidence required

- Staging event/error query link
- Booking smoke-test proof link
- Load-test proof link before public rollout
- Alert link for hold/finalize failure spikes

---

## 3. Pro session lifecycle

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Sentry events/errors/performance  
Related runbook: TODO

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Pro session page/load errors | Sentry/errors | TODO | TODO | TODO |
| Session lifecycle action attempts | Sentry/app event | TODO | TODO | TODO |
| Session lifecycle action failures | Sentry/errors | TODO | TODO | TODO |
| Illegal transition blocks | Sentry/app event | TODO | TODO | TODO |
| Closeout blocker events | Sentry/app event | TODO | TODO | TODO |
| Closeout completion failures | Sentry/errors | TODO | TODO | TODO |
| Aftercare/payment/media blocker failures | Sentry/errors | TODO | TODO | TODO |

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

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Signed upload creation attempts | Sentry/app event | TODO | TODO | TODO |
| Signed upload creation failures | Sentry/errors | TODO | TODO | TODO |
| Media metadata save attempts | Sentry/app event | TODO | TODO | TODO |
| Media metadata save failures | Sentry/errors | TODO | TODO | TODO |
| Storage provider errors | Supabase/Sentry | TODO | TODO | TODO |
| Rejected file type/size events | Sentry/app event | TODO | TODO | TODO |
| Private media access failures | Sentry/errors | TODO | TODO | TODO |
| Private media policy regression | Storage proof/manual check | Zero tolerance | TODO | TODO |

### Evidence required

- Storage policy proof
- Upload/metadata proof
- Private media proof
- Related alert links

---

## 5. Payments/webhooks

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Sentry errors/performance  
Supplemental source: Stripe dashboard  
Related runbook: docs/runbooks/stripe-degradation.md

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Checkout creation attempts | Sentry/app event | TODO | TODO | TODO |
| Checkout creation failures | Sentry/errors | TODO | TODO | TODO |
| Stripe webhook received | Sentry/app event | TODO | TODO | TODO |
| Stripe webhook signature failures | Sentry/errors | TODO | TODO | TODO |
| Stripe webhook processing failures | Sentry/errors | TODO | TODO | TODO |
| Webhook replay/dedupe events | Sentry/app event | TODO | TODO | TODO |
| Payment state mutation failures | Sentry/errors | TODO | TODO | TODO |
| Stripe provider incidents | Stripe dashboard | TODO | TODO | TODO |

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

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Email send attempts | Sentry/app event | TODO | TODO | TODO |
| Email send failures | Sentry/errors/Postmark | TODO | TODO | TODO |
| SMS send attempts | Sentry/app event | TODO | TODO | TODO |
| SMS send failures | Sentry/errors/Twilio | TODO | TODO | TODO |
| Notification retry count | App metric/Sentry | TODO | TODO | TODO |
| Notification backlog/dead-letter count | App metric/manual query | TODO | TODO | TODO |
| Manual follow-up required count | App metric/manual query | TODO | TODO | TODO |
| Provider degradation | Provider dashboard | TODO | TODO | TODO |

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
Related runbook: TODO

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Job started | Sentry/app event | TODO | TODO | TODO |
| Job completed | Sentry/app event | TODO | TODO | TODO |
| Job failed | Sentry/errors | TODO | TODO | TODO |
| Job duration | Sentry/performance | TODO | TODO | TODO |
| Stale job detection | App metric/manual query | TODO | TODO | TODO |
| Queue depth | App metric/provider | TODO | TODO | TODO |
| Dead-letter/manual follow-up | App metric/manual query | TODO | TODO | TODO |

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

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Login attempts/failures | Sentry/app event/errors | TODO | TODO | TODO |
| Register attempts/failures | Sentry/app event/errors | TODO | TODO | TODO |
| Password reset attempts/failures | Sentry/app event/errors | TODO | TODO | TODO |
| Phone correction attempts/failures | Sentry/app event/errors | TODO | TODO | TODO |
| Rate-limit block count | Sentry/app event | TODO | TODO | TODO |
| High-risk route rate-limit failures | Sentry/errors | TODO | TODO | TODO |
| Redis/rate-limit backend unavailable | Sentry/errors/health | TODO | TODO | TODO |
| Suspicious auth spike | Sentry/app event | TODO | TODO | TODO |

### Evidence required

- Auth route proof
- Rate-limit proof
- Redis/rate-limit alert link

---

## 9. Infrastructure dependencies

Launch impact: Blocks private beta  
Owner: Tori  
Primary source: Health/readiness and provider dashboards  
Related runbooks: health/readiness, Redis, Postgres, Supabase Storage, Stripe, Postmark, Twilio

### Required signals

| Dependency | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| Vercel/deploy environment | Vercel/Sentry | TODO | TODO | TODO |
| Database/Postgres | Health/provider | TODO | TODO | TODO |
| Redis/rate-limit backend | Health/provider | TODO | TODO | TODO |
| Supabase Storage | Health/provider | TODO | TODO | TODO |
| Stripe | Provider dashboard/Sentry | TODO | TODO | TODO |
| Postmark | Provider dashboard/Sentry | TODO | TODO | TODO |
| Twilio | Provider dashboard/Sentry | TODO | TODO | TODO |
| Sentry intake | Sentry dashboard | TODO | TODO | TODO |
| DNS/domain | Provider/manual check | TODO | TODO | TODO |

### Evidence required

- Provider dashboard links
- Health/readiness proof
- Alert/runbook mapping

---

## 10. SLO/error budget

Launch impact: Blocks public rollout  
Owner: Tori  
Primary source: Sentry performance/errors  
Related docs: docs/launch-readiness/go-no-go.md, docs/launch-readiness/risk-register.md

### Required signals

| Signal | Source | Threshold | Status | Evidence |
|---|---|---|---|---|
| API error rate | Sentry | TODO | TODO | TODO |
| Core booking route p95 latency | Sentry/load tests | TODO | TODO | TODO |
| Availability bootstrap p95 latency | Sentry/load tests | TODO | TODO | TODO |
| Booking finalize p95 latency | Sentry/load tests | TODO | TODO | TODO |
| Media metadata p95 latency | Sentry/load tests | TODO | TODO | TODO |
| Checkout p95 latency | Sentry/load tests | TODO | TODO | TODO |
| Stripe webhook processing p95 latency | Sentry/load tests | TODO | TODO | TODO |
| Notification processing latency | Sentry/load tests | TODO | TODO | TODO |
| Error budget burn | Sentry/manual calculation | TODO | TODO | TODO |

### Evidence required

- SLO threshold decisions
- Load-test proof links
- Error-rate dashboard link
- Alert link for error budget burn

---

# Private beta dashboard minimum

Private beta may proceed only when these are live enough to catch launch-critical failures:

| Section | Required for private beta? | Status |
|---|---:|---|
| Health/readiness | Yes | TODO |
| Booking funnel | Yes | TODO |
| Pro session lifecycle | Yes | TODO |
| Media uploads | Yes | TODO |
| Payments/webhooks | Yes | TODO |
| Notifications | Yes, if enabled | TODO |
| Auth/rate limits | Yes | TODO |
| Infrastructure dependencies | Yes | TODO |
| Background jobs | If launch-critical | TODO |
| SLO/error budget | Basic error/latency view required | TODO |

## Private beta evidence

text Dashboard URL: Environment: Release: Last staging verification: Synthetic alert tested: Known gaps: Accepted risks: Decision: 

---

# Public rollout dashboard minimum

Public rollout requires:

- All 10 dashboard sections live.
- P1/P2 alerts mapped.
- Load-test evidence visible or linked.
- Chaos/failure evidence visible or linked.
- Provider dashboards linked.
- Release/deploy markers visible.
- Error budget or equivalent health threshold defined.
- No private-beta-only observability gaps left unaccepted.

## Public rollout evidence

text Dashboard URL: Environment: Release: Last staging verification: Last production verification: Synthetic alert tested: Load proof linked: Chaos proof linked: Provider dashboards linked: Known gaps: Accepted risks: Decision: 

---

# Dashboard evidence template

Use this template when marking a section complete.

md ## Evidence: <section>  Status: PASS / FAIL / BLOCKED / ACCEPTED RISK   Owner: Tori   Environment: staging / production   Dashboard link: TODO   Sentry query/widget: TODO   Provider dashboard link: TODO   Related alert: TODO   Related runbook: TODO   Threshold: TODO   Last verified: TODO   Verified by: Tori    ### What was verified  TODO  ### Known gaps  TODO  ### Launch decision  TODO 

## Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/checklist.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md

## Maintenance rule

A dashboard section is not complete because a heading exists. It is complete only when live evidence is linked, the owner is named, thresholds are documented, and the launch impact is clear.