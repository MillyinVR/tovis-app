# Deployed Smoke Proof Checklist

Phase: Phase 2 — Launch ops proof  
Scope: Private beta target environment and public-rollout staging evidence  
Current status: TEMPLATE READY / EXECUTION TODO  
Owner: Tori  

This checklist defines exactly what must be proven against the target deployed environment before private beta. It does not claim the proof has run.

Use this file when recording deployed or staging smoke evidence in `docs/launch-readiness/test-proof.md`, `docs/launch-readiness/go-no-go.md`, and `docs/launch-readiness/private-beta-checklist.md`.

---

# Evidence Rules

Every deployed smoke proof must record:

| Field | Required value |
|---|---|
| Date | Calendar date of proof run |
| Commit | `git rev-parse HEAD` or deployment commit shown by provider |
| Environment | staging, production, or accepted launch-equivalent environment |
| Base URL | Public or private deployed URL without secrets |
| Actor | Test user or role, never raw cookies/tokens |
| Command or manual path | Exact command shape or browser path used |
| Result | PASS, FAIL, BLOCKED, or ACCEPTED RISK |
| Evidence link | Sentry event, dashboard link, provider dashboard, or proof doc section |
| Known limitations | Anything local-only, synthetic, seeded, disabled, or manually prepared |

Do not paste secrets, cookies, bearer tokens, signed URLs, raw PII, private media paths, provider secret keys, or webhook secrets.

---

# Required Private-Beta Smoke Matrix

| Area | Required proof | Current status | Blocks private beta |
|---|---|---|---|
| Health/readiness | `/api/health/live`, `/api/health`, and `/api/health/ready` return controlled successful responses in the deployed target environment. | PASS DEPLOYED / DASHBOARD LINK TODO | No, unless it regresses |
| Booking lifecycle | Known client can discover availability, create hold, finalize booking, and known Pro can start/progress session lifecycle safely. | PASS LOCALLY / DEPLOYED PROOF TODO | Yes |
| Payment/Stripe | Checkout/payment path and signed webhook replay/idempotency are proven in deployed target environment or explicitly disabled for beta. | PASS LOCALLY / DEPLOYED PROVIDER PROOF TODO | Yes, if payments enabled |
| Media/private media | Media metadata/upload path works and private media cannot be publicly accessed in deployed storage policy. | PASS LOCALLY / DEPLOYED POLICY PROOF TODO | Yes, if media enabled |
| Notifications | Notification job route/provider path sends or fails safely, and manual follow-up path is documented. | PASS LOCALLY / PROVIDER PROOF TODO | Yes, if notifications enabled |
| Export/delete auth | Internal privacy export/delete routes remain SUPER_ADMIN-gated on final beta commit. | PASS LOCALLY / FINAL COMMIT RERUN TODO | Yes |
| Alert route | At least one production-safe app-generated alert reaches `#tovis-ops-alerts`. | PASS / RUNBOOK LINK TODO | Follow-up required unless accepted |
| Dashboard visibility | Launch-critical dashboard sections have live links and usable signals. | TODO LIVE PROOF | Yes |
| Rollback/pause | Owner, pause criteria, last-known-good deploy, and post-rollback smoke checklist are recorded. | TEMPLATE READY / DECISION TODO | Yes |
| Support path | Support channel, hours, bug intake, payment/refund path, and privacy escalation are recorded. | TEMPLATE READY / DECISION TODO | Yes |

---

# Smoke Proof Steps

## 1. Health and readiness

Status: PASS DEPLOYED / DASHBOARD LINK TODO  
Existing evidence: `docs/launch-readiness/test-proof.md`, `docs/launch-readiness/sentry-dashboard.md`

Command shape:

```bash
curl -i "$BASE_URL/api/health/live"
curl -i "$BASE_URL/api/health"
curl -i "$BASE_URL/api/health/ready"
```

Pass criteria:

- `/api/health/live` returns HTTP 200 and controlled JSON.
- `/api/health` returns HTTP 200 and controlled JSON.
- `/api/health/ready` returns HTTP 200 with readiness status `ok`.
- Provider-live checks are either intentionally disabled and documented, or enabled and passing.
- Sentry dashboard or synthetic monitor link is recorded.

## 2. Booking lifecycle

Status: DEPLOYED PROOF TODO  
Local evidence: `docs/launch-readiness/test-proof.md`

Required proof:

1. Known client account can load availability for a known Pro/service/location.
2. Client can create a hold.
3. Client can finalize a booking.
4. Known Pro can see the booking.
5. Pro can start the session when the start-window rule allows it.
6. Illegal session transitions remain blocked.
7. Closeout blockers are visible or documented.

Pass criteria:

- No real failures in the deployed target environment.
- Expected conflicts/rate limits are classified separately from real failures.
- Sentry dashboard can identify any failures by route/release/environment.

## 3. Payment and Stripe webhook

Status: DEPLOYED PROVIDER PROOF TODO  
Local evidence: `docs/launch-readiness/test-proof.md`

Required proof if payments are enabled:

1. Checkout route creates or updates payment state in the deployed target environment.
2. Stripe signed webhook verification works.
3. Duplicate webhook replay is idempotent.
4. Booking/payment state remains consistent after replay.
5. Stripe provider dashboard link is recorded.

Pass criteria:

- Signed webhook proof is recorded.
- Duplicate webhook does not create duplicate side effects.
- Failed webhook count and provider dashboard are visible.

If payments are disabled for private beta, record that decision in `go-no-go.md`, `private-beta-checklist.md`, and the risk register.

## 4. Media and private-media policy

Status: DEPLOYED POLICY PROOF TODO  
Local evidence: `docs/launch-readiness/test-proof.md`, `docs/launch-readiness/storage-policy-proof.md`

Required proof if media is enabled:

1. Media metadata route works in the deployed target environment.
2. Upload/signing path works or is explicitly out of beta scope.
3. Private media cannot be fetched anonymously.
4. Authenticated access is limited to expected client/Pro/admin boundaries.
5. Supabase Storage dashboard or policy proof link is recorded.

Pass criteria:

- No private media leak.
- No orphan/unsafe media state.
- Storage policy evidence is linked.

## 5. Notifications

Status: PROVIDER PROOF TODO  
Local evidence: `docs/launch-readiness/test-proof.md`

Required proof if notifications are enabled:

1. Notification processor route is reachable only with internal authorization.
2. Email/SMS provider delivery works or fails safely.
3. Notification backlog visibility exists.
4. Manual follow-up path is recorded for failed critical notifications.
5. Postmark/Twilio dashboard links are recorded where relevant.

Pass criteria:

- Critical notification types are either delivered or have documented manual follow-up.
- Provider failure does not break booking/payment/session correctness.

## 6. Export/delete authorization

Status: FINAL COMMIT RERUN TODO  
Local evidence: `pnpm verify:privacy-phase1`, `docs/privacy/phase-1-privacy-proof.md`

Required proof:

```bash
pnpm verify:privacy-phase1
```

Pass criteria:

- Internal privacy export/delete route tests pass.
- SUPER_ADMIN gating remains enforced.
- No suspected privacy-boundary regression is open.

## 7. Alert route and acknowledgement

Status: PASS / FOLLOW-UPS TODO  
Existing evidence: `docs/launch-readiness/slack-alerts.md`, `docs/launch-readiness/oncall.md`, `docs/launch-readiness/test-proof.md`

Required follow-up:

1. Add runbook link to the Slack alert message or record accepted private-beta follow-up.
2. Trigger an alert and record formal acknowledgement timing.
3. Confirm route-specific P1/P2 thresholds are represented in Sentry/provider alert rules.

## 8. Dashboard visibility

Status: TODO LIVE PROOF  
Source of truth: `docs/launch-readiness/sentry-dashboard.md`

Required proof:

- Health/readiness
- Booking funnel
- Pro session lifecycle
- Media uploads/private media
- Payments/webhooks
- Notifications/background jobs
- Auth/rate limits
- Infrastructure dependencies
- SLO/error budget

Pass criteria:

- Each section has owner, environment, signal source, link, threshold, related alert, related runbook, last verified date, and launch impact.

---

# Evidence Record Template

```md
## Proof run — deployed <area> smoke proof

- Checklist item:
- Owner: Tori Morales
- Date:
- Commit:
- Environment:
- Base URL:
- Status: PASS / FAIL / BLOCKED / ACCEPTED RISK
- Launch decision impact:

### Test summary

### Command or browser path

### Observed result

### What was verified

### What was not verified

### Known limitations

### Follow-up
```

