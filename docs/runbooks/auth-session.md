# Auth / Session Incident Runbook

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout auth/session incident response  
Primary owner: Tori  
Backup owner: NONE — solo operator; accepted private-beta risk (2026-06-09, RISK-001); public rollout blocker  
Related alert map: docs/launch-readiness/slack-alerts.md  
Related dashboard: docs/launch-readiness/sentry-dashboard.md  
Related launch gate: docs/launch-readiness/go-no-go.md  
Current status: READY AS RUNBOOK / ALERT ROUTING STILL OPEN

This runbook covers incidents affecting authentication, registration, password reset, phone correction, session handling, and high-risk auth-adjacent rate-limit behavior.

Use this when users cannot register, log in, reset passwords, correct phone/auth data, or maintain sessions reliably.

---

# Incident scope

This runbook applies to:

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/password-reset/request
- POST /api/auth/password-reset/confirm, if present
- POST /api/auth/phone/correct
- Session creation, validation, expiration, and logout behavior
- Auth route rate-limit failures
- Redis/rate-limit degradation affecting auth/session safety
- Contact lookup, HMAC/hash lookup, and privacy-safe auth events
- Turnstile/CAPTCHA validation failures
- Auth-related Sentry errors, latency spikes, or unusual failure rates

This runbook does not replace the Redis outage runbook. If the primary failure is Redis/rate-limit infrastructure, use this runbook together with docs/runbooks/redis-outage.md.

---

# Severity guide

## P1 — Launch-stopping auth/session incident

Treat as P1 if any of these are true:

- Users broadly cannot register.
- Users broadly cannot log in.
- Password reset is failing for most users.
- Session validation is broken across the app.
- Auth routes return repeated 5xx errors.
- High-risk auth routes appear to fail open under Redis/rate-limit degradation.
- A privacy/security boundary is suspected to be broken.
- Tokens, secrets, raw phone numbers, raw emails, passwords, or session data appear in logs.
- Bot/abuse traffic is bypassing intended rate limits.
- A recent deploy caused widespread auth/session breakage.

## P2 — Degraded auth/session flow

Treat as P2 if:

- One auth route is degraded but not fully down.
- Auth latency is high but users can still complete flows.
- Some users are unexpectedly rate-limited.
- Turnstile/CAPTCHA is rejecting valid users.
- Password reset or phone correction is failing intermittently.
- Session expiration/logout behavior is inconsistent.
- Provider or Redis degradation is causing safe but noisy failures.

## P3 — Warning or follow-up

Treat as P3 if:

- Auth errors are elevated but below threshold.
- A dashboard panel is stale or missing data.
- Rate-limit blocks are higher than normal but expected.
- A non-critical auth test or synthetic check fails once and recovers.
- Documentation or threshold tuning is needed.

---

# First response checklist

1. Acknowledge the alert in the approved alert destination.
2. State severity: P1, P2, or P3.
3. Confirm affected environment: local, staging, production, or private beta.
4. Open the auth/rate-limit dashboard section.
5. Check Sentry for recent auth/session errors.
6. Check recent deploys and commits.
7. Identify affected route or flow.
8. Confirm whether this is:
   - app logic failure
   - database failure
   - Redis/rate-limit failure
   - Turnstile/CAPTCHA failure
   - session/cookie failure
   - privacy/contact lookup failure
   - bot/abuse traffic
   - provider/config issue
9. Decide immediate action:
   - monitor
   - pause launch
   - roll back
   - disable risky flow
   - raise rate-limit threshold only if safe
   - escalate provider/dependency issue
10. Record follow-up in docs/launch-readiness/risk-register.md if launch readiness is affected.

---

# Dashboards and signals to check

## Sentry

Check:

- Auth/register errors
- Auth/login errors
- Password reset request errors
- Phone correction errors
- Session validation errors
- 4xx versus 5xx ratio
- Rate-limit error volume
- Top auth transactions by latency
- Recent release/environment metadata
- Spike timing versus deploy timing

Required dashboard section:

- docs/launch-readiness/sentry-dashboard.md → Auth/rate limits

## App health

Check:

- /api/health/live
- readiness endpoint, if configured
- database component status
- Redis/rate-limit component status
- provider-live check setting for the current environment

Related runbook:

- docs/runbooks/health-readiness.md

## Redis / rate-limit backend

If rate limits, sessions, or safety checks look suspicious:

- Check Redis/provider dashboard.
- Check app readiness result for Redis.
- Confirm high-risk routes fail closed or degrade safely.
- Use docs/runbooks/redis-outage.md.

## Database

If auth data reads/writes are failing:

- Check Postgres/database provider dashboard.
- Check Prisma/database errors in Sentry.
- Confirm whether reads, writes, or both are affected.
- Use docs/runbooks/postgres-outage.md.

---

# Common symptoms and likely causes

| Symptom | Likely causes | First action |
|---|---|---|
| Register returns 5xx | DB issue, validation regression, Turnstile issue, deploy regression | Check Sentry route errors and recent deploy |
| Register returns many 429s | Rate-limit threshold, shared IP, synthetic test traffic, Redis behavior | Check rate-limit dashboard and trusted IP handling |
| Register returns ACCOUNT_EXISTS | Reused test data or real duplicate account | Confirm test phone/email pool freshness |
| Login fails broadly | Session/auth regression, password verification issue, DB issue | Check login route errors and DB status |
| Password reset fails | Token creation issue, email provider issue, DB write issue | Check password reset route and Postmark if email is involved |
| Phone correction fails | contact normalization/HMAC lookup issue, validation regression, SMS issue | Check phone correction route errors |
| Users get logged out unexpectedly | cookie/session config, domain mismatch, deploy/env issue | Check session cookie settings and recent deploy |
| Auth route latency spikes | DB/Redis/provider latency, cold starts, abuse traffic | Check Sentry performance and provider dashboards |
| High-risk route fails open | rate-limit guard bug or Redis degradation policy regression | Treat as P1 and pause launch |

---

# Immediate mitigations

Use the least risky mitigation that restores safety.

## If registration is failing

1. Confirm whether existing users can still log in.
2. Check /api/auth/register errors by release.
3. Check Turnstile/CAPTCHA configuration.
4. Check database writes.
5. Check rate-limit behavior.
6. If caused by recent deploy, roll back.
7. If only new signups are affected, pause signup campaigns or beta invites.
8. Record user-facing support note if beta users are affected.

## If login/session is failing

1. Check session validation and cookie/domain config.
2. Confirm whether failure is browser-specific or global.
3. Check recent auth/session code changes.
4. Roll back if recent deploy caused broad login failure.
5. Do not ask users to repeatedly reset passwords unless password reset is confirmed healthy. That’s not support; that’s cardio.

## If password reset is failing

1. Check password reset route errors.
2. Check token generation/storage.
3. Check email provider status if email delivery is involved.
4. Confirm no reset tokens are logged.
5. If email provider is degraded, use docs/runbooks/postmark-degradation.md.
6. Provide manual support path only if identity verification policy is clear.

## If rate limits are blocking valid users

1. Confirm whether this is expected traffic, shared IP, bot traffic, or test traffic.
2. Check Redis/rate-limit health.
3. Check whether trusted IP headers are configured only in safe environments.
4. Do not loosen high-risk auth limits broadly without abuse review.
5. For private beta, consider allowlisting known beta tester flows only if safe and documented.
6. Record the change and reversal plan.

## If Redis/rate-limit safety is degraded

1. Use docs/runbooks/redis-outage.md.
2. Confirm high-risk routes fail closed or safely degrade.
3. Pause launch if auth/session routes fail open.
4. Keep user-facing errors generic.
5. Do not bypass auth/session/rate-limit guards to “get through launch.” That is how gremlins get admin panels.

---

# Privacy and log safety

Never log or paste these into Slack, GitHub, Sentry comments, docs, or support messages:

- Raw passwords
- Session tokens
- Reset tokens
- Client action tokens
- Invite tokens
- Claim tokens
- Raw authorization headers
- Raw cookies
- Raw Turnstile/CAPTCHA tokens
- PII AEAD keys
- PII HMAC lookup keys
- Full phone numbers unless explicitly approved for a support workflow
- Full email payloads outside approved support/privacy boundaries
- Full address payloads
- Full auth request/response bodies
- Database URLs or provider secrets

Safe diagnostic examples:

- route name
- status code
- redacted user ID
- redacted email/phone hash
- error code
- Sentry event ID
- release/commit
- environment
- request ID
- timestamp
- provider status

If a suspected PII/log leak occurs, treat it as P1 and update:

- docs/launch-readiness/risk-register.md
- docs/launch-readiness/go-no-go.md
- relevant privacy proof docs

---

# Verification commands

Run these locally before marking auth/session changes safe:

bash pnpm typecheck pnpm verify:privacy-phase1 pnpm vitest run \   app/api/auth/register/route.test.ts \   app/api/auth/login/route.test.ts \   app/api/auth/password-reset/request/route.test.ts \   app/api/auth/phone/correct/route.test.ts \   lib/observability/authEvents.test.ts \   lib/security/contactNormalization.test.ts \   lib/security/contactLookup.test.ts \   lib/security/crypto/hashLookup.test.ts 

For launch-readiness proof, also run:

bash pnpm test:chaos pnpm test:load:signup 

If testing strict signup success coverage, use a fresh test phone pool and synthetic trusted IP headers only in a safe local/staging environment.

Example local command shape:

bash LOAD_TEST_TRUSTED_IP_HEADER_NAME=x-forwarded-for \ LOAD_TEST_TRUSTED_IP_PREFIX=10.251 \ LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true \ pnpm test:load:signup 

Record command output in:

- docs/launch-readiness/test-proof.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/load-test-plan.md, if load behavior changed
- docs/launch-readiness/risk-register.md, if risk posture changed

---

# Staging-safe verification

Before private beta, verify at least one auth/session smoke path in staging:

| Check | Required before private beta? | Evidence |
|---|---:|---|
| Register test user succeeds or expected rate-limit behavior is documented | Yes | TODO |
| Login test user succeeds | Yes | TODO |
| Password reset request returns safe response | Yes | TODO |
| Phone correction route returns safe response or documented controlled failure | If enabled | TODO |
| Sentry captures auth/session errors with release/environment metadata | Yes | TODO |
| Auth/rate-limit dashboard section has live data | Yes | TODO |
| Auth/session alert route is tested or accepted as private-beta risk | Yes | TODO / BLOCKED |

Use only test accounts, test phone numbers, and test/sink messaging providers.

---

# Rollback guidance

Rollback if:

- Auth/register or login is broadly broken.
- Session validation fails across the app.
- Password reset exposes sensitive data or token behavior is unsafe.
- Auth errors spike immediately after deploy and cannot be mitigated quickly.
- Rate-limit behavior fails open for high-risk routes.
- Privacy/security regression is suspected.

Rollback steps:

1. Identify last known good commit or deployment.
2. Roll back deploy through the deployment provider.
3. Confirm /api/health/live and readiness recover.
4. Run focused auth smoke checks.
5. Confirm Sentry error rate drops.
6. Record rollback in docs/launch-readiness/go-no-go.md.
7. Add follow-up risk or incident note.

---

# User/support communication

Use plain language. Do not mention internals, secrets, provider keys, or exploit details.

## Registration issue

> Some users may be unable to create an account right now. We’re investigating and will update you when signup is available again.

## Login/session issue

> Some users may have trouble logging in or staying signed in. We’re working on it and will share an update once access is stable.

## Password reset issue

> Password reset may be temporarily unavailable. Please avoid repeated reset attempts while we investigate.

## Rate-limit issue

> Some valid users may be seeing temporary access limits. We’re reviewing the issue and will adjust safely.

---

# Recovery validation

Before resolving the incident, confirm:

- Affected route returns expected status.
- No unexplained 5xx errors remain.
- Valid users can complete the affected flow.
- Invalid/abusive requests remain blocked.
- Rate limits still behave safely.
- Sentry shows recovery.
- No sensitive values were logged.
- Any user-facing support note is updated.
- Any launch gate impact is reflected in go-no-go.md.

---

# Launch impact

## Private beta

Private beta is blocked if:

- register/login proof is missing
- auth/rate-limit dashboard proof is missing
- alert routing or accepted alternate alert path is missing
- privacy guard checks fail
- auth/session errors are unresolved
- high-risk auth routes fail open

Private beta may proceed only if:

- current proof is linked
- known auth/session risks are accepted or mitigated
- support path is documented
- rollback path is documented
- Tori is actively monitoring during beta support hours

## Public rollout

Public rollout is blocked if:

- no backup owner exists
- P1 escalation is untested
- auth/session alert routing is untested
- auth/session runbook is not linked from alerts
- provider capacity/rate-limit posture is unknown
- high-severity auth/session risks are unowned
- rollback path is incomplete

---

# Evidence template

Use this when auth/session proof is completed.

md ## Auth/session evidence: <scenario>  Status: PASS / FAIL / BLOCKED / ACCEPTED RISK   Owner: Tori   Backup: TODO   Environment: local / staging / production   Date: TODO   Commit: TODO   Command or check: TODO   Dashboard link: TODO   Sentry event/query link: TODO   Alert link: TODO    ### What was verified  TODO  ### Observed behavior  TODO  ### Privacy/log safety  TODO  ### Known gaps  TODO  ### Launch decision  TODO 

---

# Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/test-proof.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- docs/runbooks/health-readiness.md
- docs/runbooks/redis-outage.md
- docs/runbooks/postgres-outage.md
- docs/runbooks/postmark-degradation.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md

---

# Maintenance rule

Do not mark auth/session readiness complete because this runbook exists.

This runbook is complete as documentation only when auth/session alerts link here, dashboard proof exists, staging smoke proof is recorded, and alert routing is tested or explicitly accepted for private beta.

A login page that works once on your laptop is not auth readiness. It is merely a login page having a good hair day.