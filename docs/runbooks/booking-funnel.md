# Booking Funnel Runbook

## Status

Phase: Phase 2 — Launch ops proof  
Incident area: Booking funnel  
Primary owner: Tori  
Backup owner: TODO — required before public rollout  
Severity: High / Critical depending on failure mode  
Last reviewed: 2026-06-07

This runbook covers failures in the client booking funnel from availability lookup through hold creation and booking finalization.

Use this runbook when booking conversion drops, availability bootstrap fails, hold creation fails, booking finalize fails, conflict/rate-limit behavior spikes, or users report they cannot complete booking.

---

## Covered surfaces

| Area | Route / workflow | Expected behavior |
|---|---|---|
| Availability bootstrap | GET /api/availability/bootstrap | Returns available services/slots/context for a professional/service. |
| Hold create | POST /api/holds | Creates temporary booking hold or returns expected conflict/rate-limit response. |
| Booking finalize | POST /api/bookings/finalize | Converts valid hold into booking exactly once. |
| Checkout-adjacent state | Booking payment/checkout transition | Does not duplicate booking/payment state. |
| Client booking UX | Client booking flow | User can select service, time, location, hold slot, and finalize. |
| Pro lifecycle dependency | Pro schedule/service/location data | Valid pro/service/location setup produces bookable slots. |

---

## Alert triggers

Use this runbook for these alert categories:

| Alert | Severity | Initial threshold |
|---|---|---|
| Availability bootstrap error spike | P2 / P1 if widespread | TODO — define in docs/launch-readiness/slack-alerts.md |
| Availability bootstrap p95 latency spike | P2 | TODO |
| Hold create 5xx spike | P1/P2 | TODO |
| Hold create conflict spike above expected baseline | P2 | TODO |
| Booking finalize 5xx spike | P1 | TODO |
| Booking finalize duplicate/integrity failure | P1 | Any confirmed case |
| Booking funnel conversion drop | P2 | TODO |
| Booking route rate-limit anomaly | P2 | TODO |
| Booking dashboard no-data / observability gap | P2 | TODO |

---

## Related dashboards

| Dashboard section | Link |
|---|---|
| Booking funnel | TODO — docs/launch-readiness/sentry-dashboard.md |
| Health/readiness | TODO |
| Auth/rate limits | TODO |
| Payments/webhooks | TODO |
| Infrastructure dependencies | TODO |
| SLO/error budget | TODO |

If dashboard links are missing, this incident is harder to triage and should remain a launch-readiness gap. Delightful, obviously.

---

## Related docs

- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/oncall.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- docs/launch-readiness/test-proof.md
- docs/launch-readiness/risk-register.md
- docs/runbooks/health-readiness.md
- docs/runbooks/postgres-outage.md
- docs/runbooks/redis-outage.md
- docs/runbooks/stripe-degradation.md

---

## First response checklist

When a booking funnel alert fires:

1. Acknowledge the alert.
2. Identify affected area:
   - availability bootstrap
   - hold create
   - booking finalize
   - payment/checkout-adjacent state
   - auth/session/rate-limit dependency
   - database/Redis/provider dependency
3. Check whether the issue is isolated to:
   - one professional
   - one service
   - one location type
   - all booking flows
   - authenticated clients only
   - mobile/client-address flows
4. Check recent deploys.
5. Check error rate, latency, status codes, and response codes.
6. Check whether failures are expected conflicts/rate limits or real failures.
7. Check logs/Sentry for redacted error payloads.
8. Check database/Redis health if failures look systemic.
9. Decide severity.
10. Start mitigation or rollback if user booking completion is materially broken.

---

## Severity guide

| Severity | Condition |
|---|---|
| P1 | Booking finalize is broadly failing, duplicate bookings are possible, payment/booking state may be corrupted, or users cannot book at all. |
| P2 | One booking step has elevated failures or latency, but users can still complete bookings with retries or limited scope. |
| P3 | Isolated pro/service/location issue, small UX issue, or expected conflict/rate-limit behavior that needs tuning but is not blocking booking. |

Escalate to P1 immediately for any suspected duplicate booking, stale hold finalization, private data leak, payment state corruption, or widespread 5xx spike.

---

## Triage: availability bootstrap failures

Symptoms:

- Users cannot see available times.
- Availability page loads slowly.
- GET /api/availability/bootstrap returns 5xx.
- Slots are unexpectedly empty.
- Availability dashboard shows elevated latency or errors.

Check:

bash # Replace with deployed/staging base URL as appropriate. curl -i "$STAGING_BASE_URL/api/health/live" curl -i "$STAGING_BASE_URL/api/health/ready" 

Then inspect:

- Sentry issues for GET /api/availability/bootstrap
- dashboard p95/p99 latency
- status code distribution
- recent deploys
- database health
- Redis/rate-limit health
- seeded pro/service/location data
- service duration, working hours, blackout dates, location rules, add-ons, and lead-time settings

Expected safe behavior:

- Real server failures should return controlled errors.
- Empty slots should be explainable by schedule/service/location rules.
- No private user/client data should appear in logs.
- Expected rate limits should be classified separately from real failures.

Mitigation:

- Roll back recent deploy if errors started after deploy.
- Disable or hide affected service/pro if issue is isolated.
- Reduce traffic/cohort if private beta.
- If DB/Redis is degraded, follow the matching dependency runbook.
- If only seed/config data is wrong, correct pro/service/location setup and re-test.

---

## Triage: hold create failures

Symptoms:

- Users select a slot but cannot reserve it.
- POST /api/holds returns 5xx.
- Conflict responses spike.
- Rate limits spike unexpectedly.
- Holds are created but users cannot continue.

Check:

- Sentry issues for POST /api/holds
- hold create status codes:
  - 201 successful hold
  - 409 expected conflict / time booked
  - 429 expected rate limit
  - 5xx real failure
- Redis/rate-limit status
- DB status
- whether slots are being reused intentionally during load tests
- whether hold TTL/expiration behavior is working
- whether current deploy changed availability or conflict logic

Expected safe behavior:

- Double holds for the same slot must not be created.
- Expected conflicts must not be counted as real failures.
- Rate limits should protect high-risk paths without blocking normal user behavior.
- If hold creation fails, it must fail safely without creating inconsistent state.

Mitigation:

- If conflict spike is caused by real user contention, monitor and consider UX messaging.
- If conflict spike is caused by stale slot data, investigate availability cache/data path.
- If 5xx spike is caused by DB/Redis degradation, follow dependency runbooks.
- If a deploy introduced conflict logic regression, roll back.
- If isolated to test data, repair seeded pro/service/location/slot setup.

---

## Triage: booking finalize failures

Symptoms:

- User has a hold but cannot complete booking.
- POST /api/bookings/finalize returns 5xx.
- Duplicate booking reports.
- Booking exists but payment/session/lifecycle state is inconsistent.
- Finalize replay/idempotency behavior is suspicious.

Check immediately:

- Sentry issues for POST /api/bookings/finalize
- booking finalize status codes
- duplicate booking reports
- DB constraint/conflict errors
- hold validity/expiration
- idempotency key behavior
- payment/checkout dependency state if relevant
- recent deploys touching booking, holds, checkout, service/location, or auth

Expected safe behavior:

- A valid hold finalizes at most once.
- Expired/invalid/stale holds do not finalize.
- Duplicate finalize attempts do not create duplicate bookings.
- Payment/webhook side effects do not double-mutate state.
- Errors do not expose internal DB details, raw tokens, addresses, or payment secrets.

Mitigation:

- Treat confirmed duplicate booking risk as P1.
- Pause/disable affected booking path if duplicate or corrupt state is suspected.
- Roll back recent deploy if correlated.
- If DB is degraded, follow docs/runbooks/postgres-outage.md.
- If payment state is involved, follow docs/runbooks/stripe-degradation.md.
- Manually review affected booking IDs before making data corrections.
- Record affected users/bookings in incident notes.

Do not manually delete or mutate booking/payment state without recording the reason and expected final state. Tiny manual DB “fixes” become haunted furniture later.

---

## Triage: booking funnel conversion drop

Symptoms:

- Traffic exists but bookings drop.
- Availability views are normal but holds/finalizes drop.
- Users report confusion or abandonment.
- No obvious 5xx spike.

Check:

- availability views
- hold create attempts
- successful holds
- finalize attempts
- successful finalizations
- conflict/rate-limit counts
- auth/login/register issues
- checkout/payment errors
- front-end client errors
- recent UX/deploy changes
- cohort/pro/service/location concentration

Possible causes:

- availability returns too few slots
- selected pro/service misconfigured
- client auth/session issue
- location requirement mismatch
- payment/checkout dependency issue
- rate limits too aggressive
- front-end validation error
- deployment changed route contract

Mitigation:

- Reproduce the funnel manually with a test client.
- Compare current dashboard to previous healthy window.
- If isolated to one pro/service, temporarily remove from beta cohort or repair setup.
- If widespread, roll back or pause beta traffic.
- Add support note if users may retry safely.

---

## Dependency checks

| Dependency | When to check | Runbook |
|---|---|---|
| Database/Postgres | 5xx, slow queries, write/read failures, finalize errors | docs/runbooks/postgres-outage.md |
| Redis/rate limits | 429 spikes, rate-limit anomalies, hold/auth throttling issues | docs/runbooks/redis-outage.md |
| Stripe | checkout/payment/webhook-adjacent booking issues | docs/runbooks/stripe-degradation.md |
| Sentry | missing errors, dashboard no-data, alert missing | docs/launch-readiness/sentry-dashboard.md |
| Auth/session | authenticated booking path fails | docs/runbooks/auth-session.md |

---

## Privacy and log safety

During triage, do not paste or expose:

- raw session cookies
- auth tokens
- client action tokens
- reset tokens
- invite tokens
- Stripe secrets
- webhook secrets
- full addresses
- raw phone/email values
- signed media URLs
- private storage paths
- full request/response payloads with user data

When recording examples, use IDs and redacted summaries.

Acceptable:

text bookingId: <id> professionalId: <id> serviceId: <id> statusCode: 409 code: TIME_BOOKED 

Not acceptable:

text full cookie header raw auth token full address full request body with phone/email Stripe secret or webhook signature 

---

## Rollback criteria

Rollback or disable the affected path if any of these are true:

- booking finalize 5xx spike is widespread
- duplicate booking or double mutation is suspected
- stale/expired holds can finalize
- payment state can be corrupted
- private data appears in logs or responses
- users broadly cannot complete bookings
- recent deploy is strongly correlated and no safer mitigation exists

Rollback decision owner: Tori  
Backup rollback owner: TODO — required before public rollout

---

## User/support response

Use calm, specific language. Do not blame providers unless confirmed.

Suggested support response:

text We are investigating an issue that may affect booking completion. If you were trying to book and saw an error, please do not retry repeatedly. We will confirm whether your booking was created and follow up with next steps. 

If duplicate booking/payment state is suspected:

text We are reviewing your booking status before making any changes. Please avoid creating another booking for the same time until we confirm the current state. 

If availability only is affected:

text Some availability may not be loading correctly right now. We are checking the schedule data and will update you when booking times are visible again. 

---

## Recovery validation

Before resolving the incident:

1. Health/readiness is green.
2. Availability bootstrap returns expected slots for test pro/service.
3. Hold create succeeds for a valid slot.
4. Duplicate/conflicting hold returns expected safe response.
5. Booking finalize succeeds for one valid test hold.
6. Duplicate finalize does not create a duplicate booking.
7. Dashboard error/latency rates return to normal.
8. Sentry has no new high-severity booking errors.
9. Any affected real bookings/users are reviewed.
10. Incident notes include cause, mitigation, and follow-up.

Suggested smoke command sequence:

bash pnpm typecheck pnpm test:chaos 

For staged load validation, use the load plan:

bash LOAD_TEST_PROFILE=smoke pnpm test:load:launch 

Only run staging load tests with safe seeded data and approved provider/test credentials.

---

## Evidence to record

Record incident or launch-proof evidence in:

- docs/launch-readiness/test-proof.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/slack-alerts.md
- this runbook, if the procedure changes

Evidence should include:

text Date: Commit: Environment: Dashboard link: Alert link: Route/workflow: Failure mode: Impact: Mitigation: Validation: Decision: Follow-up: 

---

## Open launch-readiness gaps

| Gap | Launch impact |
|---|---|
| Booking funnel dashboard link missing | Blocks full dashboard proof. |
| Booking funnel alert threshold TODO | Blocks alert proof. |
| Backup owner TODO | Blocks public rollout. |
| Synthetic booking alert not tested | Blocks public rollout and likely private beta unless accepted. |
| Deployed staging load proof missing | Blocks public rollout. |

---

## Maintenance rule

Do not mark booking funnel operationally ready until dashboard, alert, and runbook links are wired together and at least one booking-funnel proof run is recorded.

Local tests prove code behavior. Dashboards and alerts prove you can see the fire before the furniture is ash.