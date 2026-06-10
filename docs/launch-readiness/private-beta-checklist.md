# Private Beta Checklist

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Controlled private beta only  
Current default decision: NO-GO until required evidence is linked or explicitly accepted  
Primary owner: Tori  
Backup owner: NONE — solo operator; accepted private-beta risk (2026-06-09, RISK-001); required before public rollout  
Alerting path: Slack-first through paid Sentry issue alerts routed to `#tovis-ops-alerts`; production-safe app-generated synthetic alert routed successfully on 2026-06-08; runbook-link-in-message and formal acknowledgement timing still TODO  
Dashboard surface: Sentry-first, with provider dashboards linked where needed

This checklist defines the minimum requirements before TOVIS can enter private beta with a limited group of users. Private beta is not public launch. It is a controlled release with known users, explicit support coverage, operational visibility, and fast rollback.

Important distinction: local Phase 2 code proof is now green, deployed Sentry intake is proven, a saved Sentry issue-alert rule can deliver notifications to `#tovis-ops-alerts`, and a production-safe app-generated synthetic alert routed to Slack successfully. That does not mean private beta is ready. Private beta still requires live dashboard proof, runbook-link-in-message or accepted follow-up, formal acknowledgement timing or accepted follow-up, deployed flow proof, support path proof, rollback decisions, and risk review.

---

# Private beta purpose

Private beta exists to prove:

- Real users can complete the core booking flow.
- Pros can manage session lifecycle without unsafe state transitions.
- Payments and webhooks behave correctly.
- Media upload and private-media boundaries hold.
- Notifications send or fail safely.
- Privacy/export/delete foundations remain protected.
- Launch dashboards and alerts provide enough operational visibility.
- Support and rollback paths are clear before the app is exposed more broadly.

---

# Current proof baseline

| Item | Status | Evidence |
|---|---|---|
| Phase 2 local chaos suite | PASS | pnpm test:chaos: 6 files / 17 tests passed |
| Phase 2 local launch load suite | PASS | pnpm test:load:launch: 8/8 launch load steps passed |
| Aggregate launch ops verification | PASS LOCALLY | `pnpm verify:launch-ops` passed locally against audited code commit `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`; fresh local rerun recorded in `docs/launch-readiness/test-proof.md` |
| Sentry release/environment config | IMPLEMENTED | lib/observability/sentryConfig.ts, sentry.server.config.ts, sentry.edge.config.ts, instrumentation-client.ts |
| Deployed Sentry intake | PASS | Synthetic event captured: e56044a034cb4fb78d1b09801fb43da5 |
| Live Sentry dashboard proof | TODO | Dashboard sections still need links/evidence |
| Synthetic alert routing | PASS / RUNBOOK LINK TODO | Production-safe app-generated synthetic Sentry alert routed to `#tovis-ops-alerts` on 2026-06-08 at 6:31 PM local. Event ID `f7a0d19cb4a040a3a21f4679086f166f`; alert key `launch-readiness.synthetic-sentry-alert.v2`; Slack short ID `TOVIS-APP-K`. Runbook link in Slack message and formal acknowledgement timing still TODO. |
| Slack alert routing | PASS / RUNBOOK LINK TODO | Paid Sentry plan enabled; Sentry app added to `#tovis-ops-alerts`; saved Sentry issue-alert rule delivered a test notification to Slack; production-safe app-generated synthetic alert routed to Slack on 2026-06-08. |
| Backup owner | ACCEPTED RISK (PRIVATE BETA) | Solo operator; single-owner risk accepted 2026-06-09 (go-no-go.md, RISK-001); named backup required before public rollout |
| Private beta support path | TODO | Required before private beta |

---

# Private beta decision

| Field | Value |
|---|---|
| Decision | TODO |
| Target start date | TODO |
| Target end date | TODO |
| Commit | TODO |
| Environment | TODO |
| Owner | Tori |
| Backup | TODO |
| Support channel | TODO |
| Slack ops channel | `#tovis-ops-alerts` — PASS / RUNBOOK LINK TODO |
| Alternate alert path | NOT SELECTED — Sentry-to-Slack is the selected private-beta alert path |
| Sentry dashboard URL | TODO |
| Sentry synthetic event proof | e56044a034cb4fb78d1b09801fb43da5 |
| Slack routing proof | PASS / FOLLOW-UPS TODO — production-safe app-generated synthetic alert routed to `#tovis-ops-alerts`; event ID `f7a0d19cb4a040a3a21f4679086f166f`; Slack short ID `TOVIS-APP-K`; runbook-link-in-message and formal acknowledgement timing still TODO |
| Accepted risks | TODO |
| Blocking risks | Dashboard proof, deployed smoke proof, support path, rollback proof, risk review, runbook-link-in-message/formal acknowledgement timing unless accepted as follow-ups |

Decision values:

| Decision | Meaning |
|---|---|
| GO | All required private-beta gates are green. |
| GO WITH ACCEPTED RISKS | Required gates are green, but known private-beta risks are documented and accepted. |
| NO-GO | One or more private-beta blockers are open. |
| DEFER | Decision is postponed because evidence is incomplete. |

---

# Beta cohort

| Item | Status | Owner | Evidence/notes |
|---|---|---|---|
| Max beta user count defined | TODO | Tori | TODO |
| Beta invite list created | TODO | Tori | TODO |
| Beta pro list created | TODO | Tori | TODO |
| Beta client list created | TODO | Tori | TODO |
| Test/service geography defined | TODO | Tori | TODO |
| Support expectations communicated | TODO | Tori | TODO |
| Known limitations communicated | TODO | Tori | TODO |
| Feedback collection path defined | TODO | Tori | TODO |
| Bug escalation path defined | TODO | Tori | TODO |

Recommended starting limit:

```text
Private beta should start with a small known cohort before expanding. Do not begin with public signup traffic.
```

---

# Required pre-beta proof

| Gate | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Local branch matches intended beta commit | TODO | Tori | TODO | Record git rev-parse HEAD. |
| Local worktree is clean | TODO | Tori | TODO | Record git status --short. |
| pnpm typecheck passes | TODO | Tori | TODO | Required. |
| pnpm verify:privacy-phase1 passes | TODO | Tori | TODO | Required. |
| pnpm test passes or focused equivalent is documented | TODO | Tori | TODO | Full suite preferred. |
| Phase 2 local launch ops proof exists | PASS | Tori | `docs/launch-readiness/test-proof.md`; `pnpm verify:launch-ops` passed locally against audited code commit `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29` | Local load/chaos proof is green. Production-safe app-generated alert routing is proven. Deployed staging/dashboard proof still TODO. |
| Staging/deployed app is reachable | TODO | Tori | TODO | Link deployed URL/version. |
| Sentry release/environment tagging exists | PASS | Tori | Sentry metadata visible in deployed response; event ID e56044a034cb4fb78d1b09801fb43da5 | Required for meaningful beta debugging. |
| Sentry intake works in deployed environment | PASS | Tori | Synthetic event ID `e56044a034cb4fb78d1b09801fb43da5`; app-generated alert event ID `f7a0d19cb4a040a3a21f4679086f166f` | Proves deployed Sentry intake. Separately, saved Sentry issue-alert delivery and production-safe app-generated alert routing to Slack are proven. |
| Sentry dashboard sections exist and are useful | TODO LIVE PROOF | Tori | docs/launch-readiness/sentry-dashboard.md | Needs live dashboard links/evidence. |
| Synthetic alert routing works | PASS / FORMAL ACK TIMING TODO | Tori | docs/launch-readiness/slack-alerts.md; docs/launch-readiness/oncall.md; docs/launch-readiness/go-no-go.md; docs/launch-readiness/test-proof.md | Production-safe app-generated synthetic Sentry alert routed to `#tovis-ops-alerts`; event ID `f7a0d19cb4a040a3a21f4679086f166f`; alert key `launch-readiness.synthetic-sentry-alert.v2`; Slack short ID `TOVIS-APP-K`. Runbook-link-in-message and formal acknowledgement timing still TODO. |
| Health/readiness proof exists | TODO | Tori | TODO | Must include deployed environment. |
| Booking lifecycle smoke proof exists | TODO | Tori | TODO | Client booking + pro session path. |
| Payment/Stripe webhook proof exists | TODO | Tori | TODO | Signed webhook + idempotency/replay behavior. |
| Media upload proof exists | TODO | Tori | TODO | Upload path and metadata persistence. |
| Private media policy proof exists | TODO | Tori | TODO | Private media cannot be publicly accessed. |
| Notifications proof exists | TODO | Tori | TODO | Email/SMS behavior or safe failure path. |
| Export/delete route authorization proof exists | TODO | Tori | TODO | SUPER_ADMIN only. |
| Privacy request runbook exists | TODO | Tori | docs/runbooks/privacy-request.md | Confirm current. |
| Phase 1 remaining work reviewed | TODO | Tori | docs/privacy/phase-1-remaining-work.md | Confirm no private-beta blocker remains. |

---

# Required docs

| Document | Status | Owner | Notes |
|---|---|---|---|
| docs/launch-readiness/oncall.md | IN PROGRESS / SYNTHETIC ALERT ROUTING PASS | Tori | Primary owner named; saved Sentry issue-alert delivery and production-safe app-generated alert routing to Slack proven; backup owner still TODO for public rollout. |
| docs/launch-readiness/go-no-go.md | IN PROGRESS | Tori | Must contain current private beta gate. |
| docs/launch-readiness/private-beta-checklist.md | IN PROGRESS | Tori | This file. |
| docs/launch-readiness/risk-register.md | IN PROGRESS | Tori | Required before GO decision. |
| docs/launch-readiness/sentry-dashboard.md | IN PROGRESS | Tori | Sentry intake proven; dashboard proof still TODO. |
| docs/launch-readiness/slack-alerts.md | IN PROGRESS / SYNTHETIC ALERT ROUTING PASS | Tori | Saved Sentry issue-alert rule delivered to `#tovis-ops-alerts`; production-safe app-generated synthetic alert routed to Slack; runbook-link-in-message/formal acknowledgement timing still TODO. |
| docs/launch-readiness/load-test-plan.md | IN PROGRESS / LOCAL PROOF EXISTS | Tori | Local load suite is green; deployed staging proof still TODO. |
| docs/launch-readiness/chaos-test-plan.md | IN PROGRESS / LOCAL PROOF EXISTS | Tori | Local chaos suite is green and documented; operational alert/dashboard proof still TODO. |

---

# Required dashboard sections

Before private beta, the Sentry/dashboard proof must cover at least:

| Section | Status | Evidence | Notes |
|---|---|---|---|
| Health/readiness | TODO LIVE PROOF | TODO | Required. |
| Booking funnel | TODO LIVE PROOF | TODO | Required. |
| Pro session lifecycle | TODO LIVE PROOF | TODO | Required. |
| Media uploads | TODO LIVE PROOF | TODO | Required if media is enabled. |
| Payments/webhooks | TODO LIVE PROOF | TODO | Required if payments are enabled. |
| Notifications | TODO LIVE PROOF | TODO | Required if email/SMS/in-app notifications are enabled. |
| Background jobs | TODO LIVE PROOF | TODO | Required if any beta-critical jobs exist. |
| Auth/rate limits | TODO LIVE PROOF | TODO | Required. |
| Infrastructure dependencies | TODO LIVE PROOF | TODO | Provider dashboards may be linked. |
| SLO/error budget | TODO THRESHOLD + LIVE PROOF | TODO | At minimum: error rate and p95 latency. |

Sentry intake proof is not the same as dashboard proof. The event ID proves events can arrive. The dashboard proof must show that launch-critical signals are visible, grouped, and usable.

---

# Required private-beta alerts

Private beta does not require PagerDuty/Opsgenie, but it does require a tested alert path for critical signals. Slack is the selected private-beta path. Basic Sentry-to-Slack delivery is proven through a saved Sentry issue-alert rule, and production-safe app-generated synthetic alert routing to `#tovis-ops-alerts` is proven. Route-specific P1/P2 thresholds, runbook-link-in-message, and formal acknowledgement timing still need completion or explicit acceptance before private beta.

| Alert area | Severity | Status | Runbook | Notes |
|---|---|---|---|---|
| Readiness failing | P1 | TODO REAL ALERT PROOF | docs/runbooks/health-readiness.md | Required. |
| Database/Postgres outage | P1 | TODO REAL ALERT PROOF | docs/runbooks/postgres-outage.md | Required. |
| Redis/rate-limit safety issue | P1 | TODO REAL ALERT PROOF | docs/runbooks/redis-outage.md | Required. |
| Booking finalize failure spike | P1 | TODO REAL ALERT PROOF | docs/runbooks/booking-funnel.md | Required. |
| Hold create failure spike | P2 | TODO REAL ALERT PROOF | docs/runbooks/booking-funnel.md | Required. |
| Auth failure spike | P1 | TODO REAL ALERT PROOF | docs/runbooks/auth-session.md | Required. |
| Availability bootstrap error/latency spike | P2 | TODO REAL ALERT PROOF | docs/runbooks/booking-funnel.md | Required. |
| Stripe webhook verification/processing failure | P1 | TODO REAL ALERT PROOF | docs/runbooks/stripe-degradation.md | Required if payments enabled. |
| Media upload/storage failure | P2 | TODO REAL ALERT PROOF | docs/runbooks/supabase-storage-outage.md | Required if media enabled. |
| Private media policy regression | P1 | TODO REAL ALERT PROOF | docs/runbooks/private-media-incident.md | Required if media enabled. |
| Notification backlog/delivery failure | P2 | TODO REAL ALERT PROOF | docs/runbooks/notification-backlog.md | Required if notifications enabled. |
| Postmark degradation | P2 | TODO REAL ALERT PROOF | docs/runbooks/postmark-degradation.md | Required if email is beta-critical. |
| Twilio degradation | P2 | TODO REAL ALERT PROOF | docs/runbooks/twilio-degradation.md | Required if SMS is beta-critical. |
| Rate-limit anomaly | P2 | TODO REAL ALERT PROOF | docs/runbooks/redis-outage.md | Required. |

Every alert must have an owner, destination, threshold, runbook, and first-response instruction in docs/launch-readiness/slack-alerts.md.

---

# Alert routing path

Sentry-to-Slack is the selected private-beta alert path.

| Option | Status | Notes |
|---|---|---|
| Paid Sentry + Slack integration | SELECTED / SYNTHETIC ALERT ROUTING PASS | Paid Sentry plan enabled. Sentry app added to `#tovis-ops-alerts`. Saved Sentry issue-alert rule delivered a test notification to Slack. Production-safe app-generated synthetic alert routed to Slack on 2026-06-08. |
| Use Sentry email alerts to owner inbox | NOT SELECTED | May remain supplemental, but is not the primary private-beta alert path. |
| Use Vercel/provider alert emails plus manual Slack posting | NOT SELECTED | Supplemental only; not enough for launch-critical app alerts. |
| Build temporary internal alert endpoint/job | NOT SELECTED | Avoid unless Sentry-to-Slack cannot support required proof. |
| Keep private beta blocked | CURRENT DEFAULT UNTIL REMAINING GATES COMPLETE | Private beta remains NO-GO until dashboard proof, deployed smoke proof, support path, rollback path, risk review, and runbook-link/acknowledgement follow-ups are complete or explicitly accepted. |

Accepted private-beta alert path:

```text
Alert path: Paid Sentry issue alerts routed to #tovis-ops-alerts
Saved-rule test date: 2026-06-07
App-generated synthetic test date: 2026-06-08
Tested by: Tori
Signals tested:
- Saved Sentry issue-alert rule test notification
- Production-safe app-generated synthetic Sentry alert
Result: PASS / FOLLOW-UPS TODO — saved Sentry issue-alert rule delivered to Slack, and production-safe app-generated synthetic alert routed to Slack.
App-generated event ID: f7a0d19cb4a040a3a21f4679086f166f
Slack short ID: TOVIS-APP-K
Known limitation: Runbook-link-in-message, formal acknowledgement timing, route-specific thresholds, dashboard proof, support path, rollback path, and risk review remain TODO.
Accepted risk: TODO — remaining follow-ups must be resolved or explicitly accepted in go-no-go.md before private beta.
```

---

# Support coverage

| Item | Status | Owner | Notes |
|---|---|---|---|
| Private beta support hours defined | TODO | Tori | TODO |
| Support contact/channel chosen | TODO | Tori | TODO |
| Bug intake path defined | TODO | Tori | TODO |
| User-impact message template drafted | TODO | Tori | TODO |
| Payment issue escalation path defined | TODO | Tori | TODO |
| Privacy request escalation path defined | TODO | Tori | TODO |
| Refund/manual payment handling decision documented | TODO | Tori | TODO |
| Beta participant expectations documented | TODO | Tori | TODO |
| Incident owner during support window named | TODO | Tori | Usually Tori for private beta. |
| Off-hours behavior documented | TODO | Tori | Needed even if beta is support-hours only. |

---

# Feature scope

Private beta should include only the flows required to prove launch readiness.

| Feature/flow | Included in beta? | Status | Notes |
|---|---:|---|---|
| Client signup/login | TODO | TODO | TODO |
| Pro signup/login | TODO | TODO | TODO |
| Pro onboarding/readiness | TODO | TODO | TODO |
| Search/discovery | TODO | TODO | TODO |
| Availability bootstrap/day availability | TODO | LOCAL LOAD PROOF EXISTS | Deployed proof still TODO. |
| Hold create | TODO | LOCAL LOAD PROOF EXISTS | Deployed proof still TODO. |
| Booking finalize | TODO | LOCAL LOAD PROOF EXISTS | Deployed proof still TODO. |
| Checkout/payment | TODO | LOCAL LOAD PROOF EXISTS | Deployed proof still TODO. |
| Stripe webhook processing | TODO | LOCAL LOAD/CHAOS PROOF EXISTS | Deployed/provider proof still TODO. |
| Pro session lifecycle | TODO | LOCAL TEST PROOF EXISTS | Deployed proof still TODO. |
| Aftercare/rebook | TODO | LOCAL TEST PROOF EXISTS | Deployed proof still TODO. |
| Media upload | TODO | LOCAL MEDIA LOAD/STORAGE CHAOS PROOF EXISTS | Deployed storage/media proof still TODO. |
| Notifications | TODO | LOCAL LOAD/CHAOS PROOF EXISTS | Provider/dashboard proof still TODO. |
| Export/delete admin routes | Admin-only proof | TODO | Not beta user-facing. |
| White-label/tenant features | No | TODO | Not ready for beta unless explicitly scoped. |

---

# Kill switch and rollback

Private beta requires a clear rollback path.

| Item | Status | Owner | Evidence/notes |
|---|---|---|---|
| Rollback owner named | TODO | Tori | TODO |
| Last known good commit identified | TODO | Tori | TODO |
| Deploy rollback process documented | TODO | Tori | TODO |
| Feature disable/kill switch strategy documented | TODO | Tori | TODO |
| Payment/webhook safe rollback note documented | TODO | Tori | TODO |
| Media/storage rollback note documented | TODO | Tori | TODO |
| Notification disable strategy documented | TODO | Tori | TODO |
| User communication path documented | TODO | Tori | TODO |
| Private beta pause criteria documented | TODO | Tori | TODO |

Rollback triggers:

- Booking finalize failure spike.
- Payment/webhook correctness issue.
- Private media access regression.
- PII/logging/audit-redaction concern.
- Auth/session instability.
- Provider degradation that blocks core flow.
- Any high-severity issue without an owner.
- Alerting/dashboard visibility failure during active beta.
- Support path failure during active beta.

---

# Data and privacy checks

| Check | Status | Owner | Evidence/notes |
|---|---|---|---|
| Phase 1 privacy verification passed on beta commit | TODO | Tori | TODO |
| PII baseline reviewed | TODO | Tori | 471 known baseline entries accepted for Phase 1. |
| Audit redaction remains enabled | TODO | Tori | TODO |
| Export safety deny-list remains enforced | TODO | Tori | TODO |
| SUPER_ADMIN gating verified for export/delete | TODO | Tori | TODO |
| HMAC v2 launch-env rerun decision documented | TODO | Tori | TODO |
| AEAD address launch-env rerun decision documented | TODO | Tori | TODO |
| Privacy request runbook confirmed current | TODO | Tori | docs/runbooks/privacy-request.md |
| Sentry/log redaction policy reviewed | TODO | Tori | Required if logs are enabled outside local. |
| Synthetic Sentry event contains no sensitive data | PASS | Tori | Event ID e56044a034cb4fb78d1b09801fb43da5 reviewed in Sentry; no sensitive data observed. |

---

# Provider readiness

| Provider/dependency | Status | Owner | Evidence/notes |
|---|---|---|---|
| Vercel/deploy environment | TODO | Tori | TODO |
| Database/Postgres | TODO | Tori | Local DB degradation chaos proof exists; deployed readiness proof TODO. |
| Redis/rate-limit backend | TODO | Tori | Local Redis chaos proof exists; deployed readiness proof TODO. |
| Supabase Storage | TODO | Tori | Local storage chaos proof exists; deployed/provider proof TODO. |
| Stripe | TODO | Tori | Local checkout/webhook load + chaos proof exists; provider proof TODO. |
| Postmark | TODO | Tori | Local provider degradation proof exists; provider proof TODO. |
| Twilio | TODO | Tori | Local provider degradation proof exists; provider proof TODO. |
| Sentry | PASS / DASHBOARD TODO | Tori | Deployed intake works; saved Sentry issue-alert delivery to Slack works; production-safe app-generated synthetic alert routed to Slack. Dashboard proof, runbook-link-in-message, formal acknowledgement timing, and route-specific thresholds still TODO. |
| Domain/DNS | TODO | Tori | https://www.tovis.app resolves; formal proof TODO. |
| Secrets/env vars | TODO | Tori | Must verify presence without recording values. |

Minimum env/secrets check:

- App base URL
- Database URL
- Redis/rate-limit credentials
- Supabase URL and service role key
- Stripe secret and webhook secret
- Postmark token
- Twilio credentials
- Sentry DSN/environment/release
- PII AEAD key config
- PII HMAC lookup key config
- Turnstile/CAPTCHA config if enabled
- CRON_SECRET or INTERNAL_JOB_SECRET for internal jobs

Do not paste secret values into this file. Record only present, missing, or verified by deploy environment.

---

# Daily beta review

During private beta, review this daily.

| Review item | Status | Notes |
|---|---|---|
| New P1/P2 incidents | TODO | TODO |
| Booking funnel failures | TODO | TODO |
| Payment/webhook failures | TODO | TODO |
| Media upload failures | TODO | TODO |
| Notification failures | TODO | TODO |
| Auth/session failures | TODO | TODO |
| Privacy/security concerns | TODO | TODO |
| Support tickets/feedback | TODO | TODO |
| Open bugs by severity | TODO | TODO |
| New risks added to risk register | TODO | TODO |
| Dashboard visibility still working | TODO | TODO |
| Alert path still working | TODO | TODO |
| Continue beta / pause / rollback decision | TODO | TODO |

---

# Exit criteria from private beta

Private beta can move toward public rollout only when:

- No unresolved P1 issues remain.
- No unowned P2 issues remain.
- Booking flow is stable for the beta cohort.
- Payment/webhook processing is stable.
- Media/private-media behavior is stable.
- Notifications are stable or safe failure paths are documented.
- Support process is working.
- Sentry dashboard has useful real data.
- Alert path has been exercised with production-safe app-generated alert proof; acknowledgement timing and runbook evidence are complete or explicitly accepted as follow-ups.
- Load tests exist and pass against deployed staging or accepted launch-equivalent environment.
- Chaos tests exist and pass.
- Provider dashboards/proof are linked.
- Backup owner and public-launch escalation path are named.
- Public rollout checklist is complete.
- Risk register has no unowned high-severity risks.

---

# Automatic private-beta NO-GO

Private beta is automatically blocked if any of the following are true:

- pnpm typecheck fails.
- pnpm verify:privacy-phase1 fails.
- Health/readiness proof is missing.
- Booking lifecycle smoke proof is missing.
- Stripe webhook verification proof is missing when payments are enabled.
- Storage/private-media proof is missing when media is enabled.
- Sentry intake is broken.
- Dashboard visibility is missing for launch-critical routes.
- Slack alert destination is missing or Sentry-to-Slack delivery to `#tovis-ops-alerts` is broken during the beta window.
- Production-safe app-generated synthetic alert routing to `#tovis-ops-alerts` is missing or broken unless explicitly accepted as a private-beta risk.
- No P1 owner is assigned.
- Export/delete route authorization proof fails.
- A suspected PII leak or privacy-boundary regression is open.
- A high-severity risk has no owner.
- Rollback owner/path is missing.
- Support channel/path is missing.

---

# Current private-beta blockers

| Blocker | Status | Owner | Required action |
|---|---|---|---|
| Live Sentry dashboard proof | TODO | Tori | Link dashboard sections and verify live data. |
| Alert routing proof | PASS / FOLLOW-UPS TODO | Tori | Production-safe app-generated synthetic Sentry alert routed to `#tovis-ops-alerts`; event ID `f7a0d19cb4a040a3a21f4679086f166f`; Slack short ID `TOVIS-APP-K`. Runbook-link-in-message and formal acknowledgement timing still TODO or must be explicitly accepted. |
| Slack/private-beta ops destination | DONE / SYNTHETIC ALERT ROUTING PASS | Tori | `#tovis-ops-alerts` selected; Sentry app added; saved Sentry issue-alert rule delivered test notification; production-safe app-generated synthetic alert routed to Slack. |
| Support channel/path | TODO | Tori | Define support and bug intake path. |
| Health/readiness deployed proof | TODO | Tori | Verify deployed endpoint and provider-live settings. |
| Booking lifecycle deployed proof | TODO | Tori | Run smoke proof against target environment. |
| Payment/webhook deployed proof | TODO | Tori | Verify signed webhook/replay behavior. |
| Storage/private-media deployed proof | TODO | Tori | Verify policy/access behavior. |
| Rollback path | TODO | Tori | Document owner, trigger, and deploy rollback process. |
| Risk register review | TODO | Tori | Confirm no unowned high-severity blocker. |

---

# Sign-off

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product/owner | Tori | TODO | TODO | TODO |
| Engineering | Tori | TODO | TODO | TODO |
| Privacy/security | Tori | TODO | TODO | TODO |
| Support/comms | Tori | TODO | TODO | TODO |

Final private beta decision:

```text
Decision: TODO
Commit: TODO
Environment: TODO
Start date: TODO
Max beta users: TODO
Sentry event proof: e56044a034cb4fb78d1b09801fb43da5
Dashboard proof: TODO
Alert routing proof: PASS / FOLLOW-UPS TODO — production-safe app-generated synthetic alert routed to #tovis-ops-alerts; event ID f7a0d19cb4a040a3a21f4679086f166f; Slack short ID TOVIS-APP-K; runbook-link-in-message and formal acknowledgement timing TODO
Support channel: TODO
Accepted risks: TODO
Blocking risks: TODO
Rollback trigger: TODO
Notes: TODO
```

---

# Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/checklist.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- docs/launch-readiness/test-proof.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md
- docs/runbooks/privacy-request.md
- docs/runbooks/health-readiness.md
- docs/runbooks/redis-outage.md
- docs/runbooks/postgres-outage.md
- docs/runbooks/supabase-storage-outage.md
- docs/runbooks/stripe-degradation.md
- docs/runbooks/postmark-degradation.md
- docs/runbooks/twilio-degradation.md
- docs/runbooks/notification-backlog.md
- docs/runbooks/private-media-incident.md
- docs/runbooks/booking-funnel.md
- docs/runbooks/auth-session.md
- docs/runbooks/pro-session-lifecycle.md
- docs/runbooks/slo-error-budget.md

---

# Maintenance rule

Do not mark private beta as GO unless the required proof exists and is linked. Private beta is allowed to be small and imperfect; it is not allowed to be blind.

Local Phase 2 proof, deployed Sentry intake proof, saved Sentry issue-alert delivery proof, and production-safe app-generated synthetic alert proof should be linked as supporting evidence. They do not replace deployed dashboard proof, route-specific thresholds, runbook-link-in-message, formal acknowledgement timing, support readiness, risk review, or rollback proof.
