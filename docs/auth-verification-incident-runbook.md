# TOVIS Auth Verification Incident Runbook

## When to use this

Use this runbook when TOVIS auth verification is degraded or failing in production-like environments, including any of the following:

- signup succeeds but verification SMS does not arrive
- signup succeeds but verification email does not arrive
- resend flows fail
- verification endpoints return unexpected 5xx responses
- Redis-backed auth controls are degraded
- runtime kill switches were enabled and need review
- Sentry shows a spike in auth verification failures
- Twilio or Postmark dashboards show delivery/config issues

This runbook is intentionally narrow.

It covers:
- auth verification observability
- health checks
- kill-switch visibility
- Twilio checks
- Postmark checks
- short-term recovery steps

It does **not** cover:
- broader marketplace outages
- product analytics
- full platform incident management
- long-term dashboard/Datadog work

---

## First 10 minutes

1. Confirm whether the incident is:
   - SMS-only
   - email-only
   - both channels
   - auth API failures
   - Redis degradation affecting auth controls

2. Open the health endpoint:
   - `GET /api/health`

3. Open the admin runtime flags page:
   - `/admin/runtime-flags`

4. Check current kill-switch state:
   - `signup_disabled`
   - `sms_disabled`

5. Check Sentry for new auth issues:
   - filter for auth routes
   - look for spikes in verification send/verify failures
   - look for Redis degradation warnings
   - look for provider configuration failures

6. Decide whether this is:
   - safe to leave live while investigating
   - an SMS-only provider problem
   - an email-only provider problem
   - severe enough to disable signup temporarily

7. Start an incident note immediately:
   - start time
   - who noticed it
   - affected flow
   - current flag state
   - current `/api/health` result

---

## Health + kill-switch checks

## 1. Health endpoint

Check:

- `GET /api/health`

Expected healthy shape:

- app status is healthy
- Redis status is healthy

Expected degraded shape:

- app is up
- Redis is degraded/unavailable
- overall status may be degraded

Interpretation:

- If app is healthy and Redis is degraded:
  - auth verification APIs may still partly work
  - runtime flags may be unreadable or effectively stuck off
  - Redis-backed throttles may be degraded
  - treat this as an operational issue, not necessarily a full auth outage

- If health endpoint itself fails:
  - treat this as broader app instability
  - escalate outside this runbook

## 2. Admin runtime flags

Open:

- `/admin/runtime-flags`

Review:

- `signup_disabled`
- `sms_disabled`
- any Redis/backend warning shown on the page

Rules:

- If `signup_disabled = true`, new signups are intentionally blocked.
- If `sms_disabled = true`, SMS verification sends are intentionally blocked.
- If Redis backend is unavailable, flag state may be effectively unreadable/unwritable from admin.

## 3. Kill-switch decisions

Use these only as temporary controls.

### Enable `sms_disabled` when:
- Twilio is failing or rate-limiting hard
- OTP sends are looping or causing abuse risk
- sender configuration is broken
- SMS traffic must be stopped immediately

### Enable `signup_disabled` when:
- signup is creating accounts that cannot realistically verify
- both verification channels are broken
- auth is unstable enough that new-user intake should stop

### Do not enable kill switches just because:
- one user made a typo
- one device is delayed
- there is a minor dashboard warning without real send failures

---

## Twilio checks

Use this section when phone verification SMS is delayed, failing, or missing.

## 1. Configuration checks

Confirm the runtime environment has the expected Twilio values configured:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

If any are missing or wrong:
- auth phone verification send will fail
- treat as configuration incident
- fix env/config first

## 2. Sender checks

In Twilio, confirm:

- the sender number is active
- the sender supports SMS
- the sender is approved for the destinations TOVIS currently supports
- the account is not restricted, suspended, or out of balance
- geographic permissions are enabled for the expected destinations

## 3. Delivery checks

In the Twilio dashboard, inspect recent auth verification sends and confirm:

- request accepted by Twilio
- messages are not failing immediately
- there is no recurring provider error code
- destination country is allowed
- sender registration/compliance is not blocking sends

## 4. TOVIS-specific decisions

- If Twilio is down or misconfigured but email verification still works:
  - consider enabling `sms_disabled`
  - keep `signup_disabled` off only if the product decision is that pending users may wait safely
- If Twilio failure makes signup unusable:
  - enable `signup_disabled`
  - record why

## 5. Recovery verification

After remediation:

- trigger a real signup or resend flow
- confirm OTP send succeeds
- confirm code can be verified successfully
- confirm Sentry error volume drops back toward baseline

---

## Postmark checks

Use this section when verification email or password reset email is delayed, failing, or missing.

## 1. Configuration checks

Confirm the runtime environment has the expected Postmark values configured:

- `POSTMARK_SERVER_TOKEN`
- `POSTMARK_FROM_EMAIL`

Optional but still important when used:

- `POSTMARK_MESSAGE_STREAM`

If auth email webhooks are used operationally, also confirm:

- `POSTMARK_WEBHOOK_SECRET` or `POSTMARK_WEBHOOK_TOKEN`

## 2. Sender/domain checks

In Postmark, confirm:

- the sender signature or domain used by `POSTMARK_FROM_EMAIL` is verified
- DKIM is valid
- SPF is valid
- the domain is still active and not misconfigured
- the message stream, if configured, is the intended auth stream

## 3. Activity checks

Inspect recent events for:

- accepted sends
- bounces
- inactive recipient issues
- sender signature/domain errors
- stream mismatch
- suppression or complaint problems

## 4. Deliverability baseline

Confirm the domain has all three basics in place:

- SPF
- DKIM
- DMARC

Minimum expectations:

- SPF publishes one valid policy for the sending hostname/domain
- DKIM is enabled and passing for the Postmark sender/domain
- DMARC exists and routes reports somewhere monitored

## 5. TOVIS-specific decisions

- If Postmark is failing but SMS works:
  - do **not** pretend auth is healthy
  - users may still be blocked from becoming fully verified
  - treat this as a real auth incident, not “just email”
- If Postmark failures are broad and persistent:
  - consider `signup_disabled`
  - especially if new accounts cannot complete verification safely

## 6. Recovery verification

After remediation:

- trigger a real verification email send
- trigger a real password reset request
- confirm emails are accepted and delivered
- confirm verification and reset links work end-to-end
- confirm Sentry error volume drops

---

## Turnstile / CAPTCHA degradation

Use this section when the alert for `auth.register.captcha_fail_open` fires or when signup abuse risk rises during Turnstile instability.

## What this signal means

- TOVIS register is failing open on Turnstile verification.
- Signup is still being allowed, but the route logs `auth.register.captcha_fail_open`.
- Current built-in mitigation is already present:
  - Turnstile-verified traffic uses `auth:register:verified` (20/hour per IP).
  - Fail-open traffic drops to `auth:register` (5/hour per IP).
  - Per-phone SMS quotas still remain active.
- This is a degradation signal, not proof of abuse by itself.

## How to confirm

1. Check recent structured auth logs for repeated `auth.register.captcha_fail_open`.
2. Confirm recent events include:
   - `route = auth.register`
   - `captchaEvent`
   - `reason`
   - `role`
3. Confirm whether Turnstile is timing out or unavailable.
4. Check current signup request volume and 429 behavior for `/api/auth/register`.
5. Check whether abuse indicators are rising at the same time:
   - unusual signup spikes
   - repeated phone targets
   - unusual IP concentration
   - elevated downstream SMS activity

## Immediate mitigation options

- Keep signup live only if event volume is limited and abuse indicators remain normal.
- Watch auth register volume and 429 behavior while the alert is active.
- Remember that TOVIS already falls back to the tighter `auth:register` bucket automatically.
- There is no repo-confirmed runtime flag for changing `auth:register` limits live. Tightening that bucket requires a code/config change and redeploy.
- If abuse is detected, or if fail-open volume becomes unsafe before a redeploy is available, enable `signup_disabled`.

## When to consider `signup_disabled`

Enable `signup_disabled` if any of the following are true:

- `auth.register.captcha_fail_open` stays elevated and Turnstile remains unavailable
- signup abuse indicators are rising
- current 429 behavior is not containing traffic well enough
- operators cannot safely distinguish legitimate signup traffic from attack traffic during the outage

## Evidence to capture

Record all of the following before closing:

- first alert time
- recent `auth.register.captcha_fail_open` samples
- `captchaEvent` and `reason` values from those samples
- current signup volume
- current 429 behavior
- Turnstile status / timeout evidence
- whether `signup_disabled` was enabled
- whether a tighter `auth:register` change/redeploy was requested
- incident timeline and operator notes

## Recovery decision tree

## Case 1: Redis degraded, app still up

Symptoms:
- `/api/health` shows degraded Redis
- runtime flags page may warn about backend availability
- auth may partially function
- throttling/logging may degrade

Action:
1. Treat as degraded ops state.
2. Do not assume flags are writable.
3. Check whether real sends/verifies are still working.
4. If auth behavior is becoming unsafe, use the admin surface only if it is still functional.
5. Escalate Redis restoration.

## Case 2: SMS broken, email working

Symptoms:
- Twilio failures
- verification email works
- phone verify flow blocked

Action:
1. Confirm Twilio config/account/sender state.
2. Enable `sms_disabled` if sends should stop immediately.
3. Decide whether signup remains open or must be paused.
4. Restore Twilio path.
5. Test resend + verify.

## Case 3: Email broken, SMS working

Symptoms:
- Postmark failures
- SMS works
- users cannot complete full verification

Action:
1. Confirm Postmark env, sender/domain, stream, and activity.
2. Decide whether signup can remain open.
3. If users will pile up in broken partial verification, enable `signup_disabled`.
4. Restore Postmark path.
5. Test verification email + password reset.

## Case 4: Both channels broken

Symptoms:
- OTP send failing
- verification email failing
- new accounts cannot verify

Action:
1. Enable `signup_disabled`.
2. Record flag-change time and operator.
3. Stabilize Twilio and/or Postmark.
4. Confirm `/api/health`.
5. Run end-to-end auth verification test.
6. Reopen signup only after both required paths are healthy.

## Case 5: Auth route exceptions spiking in Sentry

Symptoms:
- Sentry spike on auth send/verify routes
- provider or config errors
- possible regressions after deploy

Action:
1. Identify failing route and first bad deploy/change.
2. Confirm whether issue is config, provider, or code regression.
3. If signups are unsafe, enable `signup_disabled`.
4. Roll forward or roll back as appropriate.
5. Verify with live end-to-end tests before closing incident.

---

## Verification after recovery

Do not close the incident until all relevant checks pass.

## Minimum verification checklist

### Health
- `/api/health` returns healthy app status
- Redis check is healthy or clearly understood if still degraded

### Admin
- runtime flags are in the intended state
- temporary kill switches are removed if no longer needed

### SMS
- verification SMS send succeeds
- verification code arrives
- verification code can be redeemed successfully

### Email
- verification email send succeeds
- verification link works
- password reset email send succeeds
- password reset link works

### Observability
- structured auth events appear as expected
- Sentry receives real exceptions when forced
- Sentry noise level returns toward normal after remediation

### User impact
- signup can complete
- partially verified users can finish verification
- login for existing verified users is unaffected

---

## Evidence to record

Record all of the following before closing:

- incident start time
- incident end time
- person who triaged
- affected flow:
  - signup
  - SMS verification
  - email verification
  - password reset
  - Redis degradation
- `/api/health` result at start
- `/api/health` result at recovery
- runtime flag state at start
- runtime flag state after recovery
- Sentry issue links or screenshots
- Twilio dashboard findings
- Postmark dashboard findings
- root cause
- remediation taken
- whether signup was disabled
- whether SMS was disabled
- follow-up work needed

---

## Closure rule

Do not close the incident because the dashboard “looks better.”

Close it only when:

- the failing provider/config/code issue is understood
- health checks are acceptable
- required kill switches are back to the intended state
- end-to-end verification has been tested successfully
- evidence is recorded
- follow-up items are assigned if anything still smells suspicious