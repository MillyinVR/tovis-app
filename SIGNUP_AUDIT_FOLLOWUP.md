# TOVIS — Signup & Verification: Follow-up Audit
**Scope:** Re-verify every finding from `SIGNUP_AUDIT.md` (2026-04-15), identify what shipped, what is still open, and surface new observations.
**Mode:** Read-only. No code changed.
**Date:** 2026-04-15 (follow-up)

---

## Headline

The signup flow has moved meaningfully toward enterprise readiness since the first audit. Every HIGH finding has been either fully remediated or addressed with a defensible tradeoff. The remaining gaps are mostly MEDIUM (scale/ops concerns) and one structural item — MFA — that is a fast-follow rather than a launch-blocker only if paired with the right monitoring.

At a glance:

- Six of six HIGH findings: **fixed**, most with additional depth (local-bucket fallback, per-phone SMS quotas, attempt counters, constant-time compares, structured observability).
- All but one MEDIUM finding: **fixed** (verification-session middleware enforcement, post-email-send observability, link-scanner pre-fetch protection, UX cooldown, phone-change flow, TOCTOU race).
- The password-policy asymmetry I flagged during the login/reset audit (policy existed in reset, not signup) is **resolved** — register now calls `validatePassword`, and the policy itself was upgraded from 8 chars + 3-entry blocklist to 10 chars + 33-entry blocklist.
- Remaining launch-blocker class items: `AUTH_TRUSTED_IP_HEADER` env var must be set in prod, and the synchronous external-call tail in register still risks long p95 under vendor latency.

---

## 1. Scorecard vs. the original audit

### HIGH findings — status

**Redis fail-open on Redis error → FIXED.**
`app/api/_utils/rateLimit.ts` now distinguishes `redis-only` from `auth-critical` buckets. Auth-critical buckets (`auth:login`, `auth:register`, `auth:register:verified`, `auth:password-reset-*`, `auth:sms-phone-hour`, `auth:sms-phone-day`) run a local in-memory token bucket first and only consult Redis if local passes. A 30-second circuit breaker opens on Redis errors so we don't hammer a failing cluster. Non-auth buckets still fail open — that's the right tradeoff (don't take the app down for a like button).

Residual note: the local token bucket is per-instance. On a multi-instance deployment (Vercel serverless), an attacker routed to different instances can get more tokens than the cfg limit until Redis returns. This is an acceptable fallback behavior, not a bug — but it's why the Redis circuit breaker window (30s) should stay tight.

**No password strength requirement → FIXED.**
`lib/passwordPolicy.ts`:

- Minimum raised from 8 → 10 characters.
- Blocklist expanded from 3 → 33 entries (includes common ones plus platform-specific like `tovis`, `loginlogin`, etc.).
- `normalizeForDenyList` lowercases and strips whitespace before comparing.

`app/api/auth/register/route.ts:696` now calls `validatePassword` and returns `WEAK_PASSWORD` on failure. Password-reset confirm also calls the same function — policies now match across flows.

Residual gap: still no HIBP Pwned Passwords k-anonymity check. A 33-entry static list will miss most real-world breached passwords. Adding the k-anonymity API is ~50 lines and adds <200 ms to signup.

**Email/phone enumeration → FIXED.**
Distinct `EMAIL_IN_USE` / `PHONE_IN_USE` codes are gone from the register route. The pre-check `findFirst` is gone entirely. The code now relies on the DB unique constraint and a unified catch that returns:

> "An account already exists with those details." — code `ACCOUNT_EXISTS`

Handle conflicts still return `HANDLE_IN_USE` — appropriate since handles are public anyway.

This fix also incidentally closes the TOCTOU race (MEDIUM finding #7). One change, two issues resolved.

**SMS pumping / toll-fraud exposure → FIXED.**
Three reinforcing defenses now in place:

1. `lib/smsCountryPolicy.ts` — parses with `libphonenumber-js`, rejects anything outside `SMS_ALLOWED_COUNTRIES` (default `US`). Any non-US phone gets `SMS_COUNTRY_UNSUPPORTED`.
2. New rate-limit buckets keyed on the phone number itself: `auth:sms-phone-hour` (3/hr) and `auth:sms-phone-day` (6/day). Called from register, phone/send, and phone/correct. This is the important one — it's a global quota that stops a botnet from spraying signups at one phone number across many IPs.
3. Runtime flag `sms_disabled` — emergency kill switch via Redis key.

**No OTP attempt counter → FIXED.**
`PhoneVerification.attempts` and `EmailVerificationToken.attempts` columns added. Both verify endpoints enforce `MAX_VERIFY_ATTEMPTS = 5` with optimistic concurrency control (`where: { id, usedAt: null, attempts: record.attempts }`). On the 5th wrong attempt the record is marked used (lockout) and a `CODE_LOCKED` / `TOKEN_LOCKED` 429 with `resendRequired: true` is returned so the UI can drive a resend.

Constant-time comparison via `timingSafeEqualHex` replaces plain string equality — closes a timing side-channel I didn't even flag in round one.

An extra Redis-backed layer sits on top: `enforceVerificationVerifyThrottle` (10 attempts per 10 minutes per subject per IP).

**Rate limit keyed on raw `x-forwarded-for` → FIXED (with deployment dependency).**
`lib/trustedClientIp.ts` reads from the `AUTH_TRUSTED_IP_HEADER` env var in production (dev falls back to `x-forwarded-for` / `x-real-ip`).

Launch-blocker caveat: if `AUTH_TRUSTED_IP_HEADER` is not set at go-live, `getTrustedClientIpFromNextHeaders` returns null in production, which makes `rateLimitIdentity(null)` return null, which makes `enforceRateLimit({identity: null})` return null — **no rate limit applied**. Add a boot-time assertion or a deployment checklist item: `AUTH_TRUSTED_IP_HEADER=x-vercel-forwarded-for` (on Vercel) must be set before signup goes live.

### MEDIUM findings — status

**TOCTOU race on uniqueness check → FIXED** (covered above — pre-check removed).

**`emailVerificationSent: false` silent for ops → FIXED.**
`lib/observability/authEvents.ts` provides `logAuthEvent` and `captureAuthException`. Both hash PII (email, phone, userId → first 12 chars of sha256), auto-redact meta keys containing `password`/`token`/`code`, and route exceptions to Sentry with appropriate tags. Email-send failure in register is now captured as `auth.email.send.failed`.

**Register response embeds flags in cookie-less JWT / VERIFICATION enforcement → FIXED.**
`middleware.ts` is the single enforcement point now. `verifyMiddlewareToken` checks signature/exp/sessionKind at the edge, and when `sessionKind === 'VERIFICATION'` the middleware restricts access to a fixed allowlist of pages (`/verify-phone`, `/verify-email`) and APIs (phone/email send+verify, verification/status, logout). Non-allowed API paths return 403 `VERIFICATION_REQUIRED`; pages redirect to `/verify-phone`.

One structural note (carry-over from login audit): the middleware runs in the Edge runtime and can't check `authVersion` against the DB. `authVersion` is verified against the DB only in `lib/currentUser.ts:84` via `getCurrentUser`, which is called inside `requireUser`. So every authenticated server component should go through `getCurrentUser` to pick up session revocation. Worth a defensive test to confirm no protected page bypasses this.

**bcrypt cost = 10 → UNCHANGED.**
Still 10 rounds. At a day-one peak of ~200 signups/sec this is ~20 seconds of CPU per second in aggregate just on bcrypt. Hasn't been addressed, but also hasn't been *worsened*. Before launch, load-test signup at your target concurrency and decide whether to (a) keep 10 and size the runtime, or (b) move bcrypt to a worker. Do not lower the cost.

**Signup is synchronous across 4–5 external calls → UNCHANGED.**
Register still serially awaits: rate-limit Redis → DCA BreEZe → DB transaction → Twilio SMS → Postmark email → Redis tap-intent consume. There is an `app/api/internal/jobs/` folder, but it's scoped to client reminders, last-minute bookings, and notifications — not signup tail.

At 100k users on day one, the tail risk is: Postmark or DCA latency spike → every register request stalls → perceived signup outage. Twilio has already-visible fail-soft behavior (`phoneVerificationSent: false` in the response; the UI surfaces a retry). Postmark similarly is in try/catch. DCA is the nastiest because it's **before** account creation and gates PRO signup.

Recommended plan: keep DCA in-line (it's a business gate), push Twilio SMS and Postmark email to a short-lived background task (fire-and-log), and push `consumeTapIntent` to the same. Target: register returns in <300ms p95 regardless of vendor latency.

**Email verify clickable by anyone / link-scanner pre-fetch → FIXED.**
`app/(auth)/verify-email/page.tsx` is client-side and requires the user to click a "Confirm" button that POSTs to `/api/auth/email/verify`. A GET pre-fetch by a corporate email scanner hits the page, not the endpoint, so the token is not consumed. This is the right fix.

### LOW findings — status

**No disposable-email / disposable-phone block → UNCHANGED.**
Turnstile CAPTCHA now helps at the form level (`lib/auth/turnstile.ts` + `lib/turnstileClient.ts`). That's a meaningful bot barrier on its own. If Turnstile goes down, it fails open — the register bucket drops from 12/hr to 5/hr (see `captcha.failOpen` handling in register route) and the event is logged as `auth.register.captcha_fail_open`. Worth a Sentry/Datadog alert on that event so you notice a prolonged Cloudflare outage.

Adding a disposable-email MX check and a disposable-phone list is optional once Turnstile is in place; data-quality cleanup more than a security gap.

**`licenseRawJson` stored in DB → UNCHANGED.**
Still storing the full DCA payload. Low-risk but worth a one-time review of a real response to confirm nothing unexpectedly-sensitive ends up persisted.

**Cookie domain falls through to host-only on non-prod hosts → UNCHANGED.**
`resolveCookieDomain` still hardcoded to `.tovis.app` / `.tovis.me`. Staging cookies will still be host-only. Not a bug, but means QA on staging won't exercise cross-subdomain cookie behavior.

**Handle validation has no reserved-word list → UNCHANGED.**
`admin`, `root`, `tovis`, `support`, `api`, `www`, `mail`, `help`, `billing`, `auth`, `login`, `signup`, `verify` are all still claimable. `normalizeHandleInput` just does `toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24)`. Reserve the obvious ones before public signup opens.

**License-document upload path too loose → FIXED.**
`validateLicenseDocUrl` now requires either `https?://` or `supabase://{BUCKETS.mediaPrivate}/...`. Anything else is rejected as `LICENSE_DOC_INVALID`.

### UX findings — status

**No client-side cooldown → FIXED.**
`app/(auth)/verify-phone/page.tsx`:`RESEND_COOLDOWN_SECONDS = 60`. Both phone and email resend buttons disable and show a countdown ("Resend code in 0:59"). 429 responses are mapped to the cooldown, not surfaced as raw errors. Tests in `page.test.tsx` exercise the cooldown and the rate-limit→cooldown mapping specifically.

**No phone-change flow during verification → FIXED.**
`/api/auth/phone/correct` endpoint + "Update number and resend" button in the verify page UI. The endpoint enforces the SMS country policy, per-phone quota, and `enforcePhoneVerificationOtpLimits` before updating.

**No voice-call fallback, no skip-for-now → UNCHANGED.**
Still phone + email hard requirements. If Twilio drops an SMS on T-Mobile, user still has to contact support. Skip-for-now is a policy decision — fine if you're sure; revisit if your support ticket volume around verification spikes.

**Email resend limits too permissive → IMPROVED, not fully verified.**
Per-phone SMS quotas now in place. Email send path I didn't re-read end-to-end in this pass — worth a spot-check that email-resend is similarly tightened (5 per hour per user still, or lower).

**`licenseDocumentUrl` unused in UI but accepted by API → NOW USED.**
The DCA-unavailable fallback branch in register (line ~938) does use `body.licenseDocumentUrl` to accept a manual doc reference when DCA is down. No longer a dead parameter.

---

## 2. New observations I didn't catch the first time

### `phoneRateLimitIdentity` input normalization — correct
The new phone-keyed rate limit uses the *normalized* phone (E.164) as the identity key. The code orders: `validateSmsDestinationCountry(phone)` → `phoneRateLimitIdentity(smsCountry.phone)`. Good — an attacker can't bypass the per-phone quota by varying formatting.

### `auth:register:verified` vs `auth:register` per-IP — likely too strict for shared NAT
Successful Turnstile → 12/hr per IP. Failed/unavailable Turnstile → 5/hr per IP. 12/hr is reasonable for a home user but tight for a salon office with carrier-grade NAT (multiple pros signing up from the same IP). At enterprise launch you may want either per-IP + ASN bucketing, or bump the verified bucket to 20-30/hr.

### `authVersion` in middleware is signature-checked but not DB-checked
Middleware can extract `authVersion` from the token but cannot verify it hasn't been bumped (Edge runtime, no DB). `getCurrentUser` does the DB check. Pages that skip `getCurrentUser` (e.g., purely static server components) will not see a user's session invalidation. In practice, every authed route should hit `getCurrentUser` — worth an explicit test to prove it.

### Captcha fail-open needs alerting
When Turnstile is unavailable and the request fails open, the register rate limit automatically tightens AND the event is logged as `auth.register.captcha_fail_open`. This is good engineering, but operationally you need an alert on that event firing at elevated rate — it's your signal that Cloudflare is degraded and abuse attempts will proportionally increase.

### Phone-correct endpoint `PHONE_IN_USE` response is a minor enumeration vector
`/api/auth/phone/correct` catches P2002 and returns `PHONE_IN_USE`. A user with a throwaway account can swap phones to probe for existing numbers. Minor because it requires a signed-in session, but the fix is one line: return a generic "We couldn't set that phone number right now" message.

### `logAuthEvent` hashes PII before writing — good
Emails, phones, userIds are stored in logs as first-12-chars-of-sha256. That's enough to correlate across events for debugging while keeping the log store compliant with GDPR/CCPA data-handling expectations. Meta keys containing `password`/`token`/`code` are auto-redacted. This is the cleanest part of the observability layer.

### TOS version is captured on signup (`tosAcceptedAt`, `tosVersion`)
Not something I flagged before but worth noting: schema captures both fields. When TOS bumps, you'll want a mid-session re-prompt flow (out of this audit's scope but becomes a compliance item before launch).

---

## 3. Remaining launch-blockers (revised)

Ranked by impact at 100k users on day one. Compare against the original 10-item P0 list.

1. ~~Redis fail-open~~ → done.
2. ~~Password strength~~ → done (minus HIBP, which I'd now call MEDIUM, not P0).
3. ~~Email/phone enumeration~~ → done.
4. ~~SMS pumping~~ → done.
5. ~~Verify-attempt counter~~ → done.
6. ~~Rate-limit identity~~ → done *if* `AUTH_TRUSTED_IP_HEADER` is set in prod. **Verify as deployment checklist item.**
7. **Async signup tail.** Register still serially awaits DCA, Twilio, Postmark, Redis tap-intent consume. Still the most likely source of a "signup feels broken" outage on day one.
8. **Observability alerts.** Pipes exist (Sentry + structured logs). Add concrete alerts for: `auth.email.send.failed` rate, `auth.phone.send.failed` rate, `auth.register.captcha_fail_open` rate, DCA non-OK rate, Twilio specific error codes.
9. ~~Resend cooldown + phone-change + voice-fallback~~ → cooldown done, phone-change done, voice-fallback **still missing**.
10. ~~Invariant test for VERIFICATION session~~ → middleware enforces it universally now. Would still add a test that iterates all authenticated routes and confirms a VERIFICATION token yields 403/redirect on each.

New additions to the list, not in the original:

11. **bcrypt CPU headroom.** Load-test register at target concurrency with real bcrypt cost. Don't lower cost to mask slowness.
12. **Reserved-handle list.** Five-minute task; grab `admin`, `root`, `tovis`, `support`, `help`, `api`, `www`, `mail`, `billing`, `auth`, `login`, `signup`, `verify` before public signup opens.
13. **HIBP Pwned Passwords k-anonymity check.** Upgrade from 33-entry static list to real breach-check. Free, ~100-200 ms, ~50 lines.
14. **`phone/correct` response generalization.** Drop `PHONE_IN_USE`, return a generic message. One-line fix.

---

## 4. Enterprise-readiness verdict

**Signup is meaningfully closer to enterprise-ready than it was at the start of this audit cycle.** The class of issues you had last week — Redis outage = no rate limit, timing-spoofable IP, trivially enumerable account base, unbounded OTP brute-force — are closed. The items that remain are operational (async tail, alerts, load tests) and a small amount of polish (reserved handles, HIBP, phone-correct error message).

I would **ship this flow** with the following preconditions:

1. `AUTH_TRUSTED_IP_HEADER` set in production (boot assertion or deployment check).
2. Turnstile secret configured; Cloudflare outage alert wired on `auth.register.captcha_fail_open`.
3. Sentry receiving `auth.*` exceptions; dashboards on DCA, Twilio, Postmark failure rates.
4. Reserved-handle list in place.
5. Load test at target peak signup concurrency to validate bcrypt + DB + serial-external-call latency budget (p95 < 3s is my bar).

If all five are green, this flow is enterprise-ready for a 100k day-one launch. Items 7 (async tail) and 13 (HIBP) can ship as fast-follows post-launch rather than blocking go-live, *provided* monitoring on items 2 and 3 is in place so you'll see degradation before users do.

The remaining structural item — MFA — is still absent, and it's still the single largest gap versus peer platforms at this scale. It's not a signup-flow launch-blocker per se (your competitors also launched without it), but it should land in the first month post-launch, especially given PRO accounts will eventually touch payouts.

---

## 5. Items still worth auditing before go-live

- `/api/auth/email/send` — not re-read end-to-end in this pass.
- `/api/auth/verification/status` — referenced by middleware and verify-phone page; check it enforces session ownership.
- Google Places / Geocode / Timezone proxies — called pre-auth from signup; verify their own rate limits and key-handling.
- Every authenticated page route — confirm each calls `getCurrentUser` (for `authVersion` invalidation).
- ToS re-prompt flow on version bump.
- Abuse monitoring wiring: are `auth.*` logs actually reaching a SIEM, or dying at `console.info`?

---

*End of follow-up audit.*
