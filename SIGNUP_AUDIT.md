# TOVIS — Signup & Verification Audit
**Scope:** How users become CLIENT or PRO, and the email + phone verification flows that follow.
**Goal:** Enterprise readiness for 100,000 users on day one.
**Mode:** Read-only. No code changed.
**Date:** 2026-04-15

---

## 1. All the ways a user can become a CLIENT or a PRO

I traced every call site of `prisma.user.create` / `tx.user.create` across the repo. **There is exactly one path that creates user accounts: `POST /api/auth/register`** (`app/api/auth/register/route.ts`). Every entry point below funnels into that same endpoint.

### CLIENT signup entry points
1. **Direct form** — `/signup/client` → `SignupClientClient.tsx` → `POST /api/auth/register` with `role: 'CLIENT'`.
2. **Tap / NFC intent** — pages under `/t`, `/c`, `/nfc`, `/p/[handle]` can pass a `tapIntentId` query param to `/signup/client`. On successful register, `consumeTapIntent()` (line 871 of register route) links the new client to the intent and returns a `nextUrl`.
3. **Invite link** — `inviteToken` and `intent` query params are threaded through the signup page and forwarded to the register endpoint, then on to `issueAndSendEmailVerification` so the verification email can be customized. *Note:* the `inviteToken` is accepted but is not validated or required anywhere in `route.ts` — it is opaque passthrough.
4. **Book-first flow** — booking pages redirect unauthenticated clients into `/signup/client?next=/booking/...`. The `next` parameter is sanitized (internal paths only, lines 119–125).

### PRO signup entry points
1. **Direct form** — `/signup/pro` → `SignupProClient.tsx` → `POST /api/auth/register` with `role: 'PRO'`.
2. **Claim flow** — `/claim/[token]` pages (exists in repo, details not deeply audited) likely redirect into `/signup/pro` with a pre-populated handle / business. Same register endpoint.
3. **Tap intent** — same as client; a pro can be linked to a tap intent on signup.

### What does NOT exist (good news)
- **No Google / OAuth signup.** Grep for `prisma.user.create` returns only the register route and a test seed file. No passwordless / social signup creates users. The attack surface is a single endpoint.
- **No admin "create user" tool** exposed to the web API.
- **No waitlist auto-promotion** that creates users.

Because the attack surface funnels through one file, most of this audit is about that file.

---

## 2. What's right — the good foundation

These are real strengths. They are the reason the signup flow is not starting from zero.

- **Codes and tokens are hashed at rest.** SMS codes go in as `sha256(code)` (`codeHash`), email links go in as `sha256(token)` (`tokenHash`). A DB leak does not expose working codes.
- **Token entropy is sufficient.** Email tokens are 32 bytes of `crypto.randomBytes` (64 hex chars ≈ 256 bits). SMS codes use `crypto.randomInt` (CSPRNG), not `Math.random`.
- **Verify operations are transactional.** Both phone-verify and email-verify wrap "mark code used + mark user verified + update profile" in `prisma.$transaction`. No dangling half-verified state.
- **Replay prevention.** `PhoneVerification.usedAt` and `EmailVerificationToken.usedAt` are checked on verify; used codes cannot be re-used.
- **Expiry is enforced on verify, not just display.** Phone = 10 min, email = 24 h, both checked server-side with `gt: now`.
- **Unique email + unique phone enforced at the DB level.** Even with the race window in the application check (see §3), the DB unique constraint would reject a duplicate; `isPrismaUniqueError` catches `P2002` and returns `DUPLICATE_ACCOUNT`.
- **Cookie hardening mostly right.** `httpOnly: true`, `sameSite: 'lax'`, `secure` is derived from `x-forwarded-proto`, and there is a deliberate domain-scoping function for `.tovis.app` / `.tovis.me`.
- **Email/SMS failure is non-fatal to signup.** If Twilio or Postmark is down, the user still gets an account and the UI can offer resend. Correct choice — the alternative is a complete outage on day one if either vendor has an incident.
- **Phone is E.164-normalized server-side.** `cleanPhone()` (lines 132–146) rejects <10 digits and prepends `+1` for bare US numbers. Consistent storage.
- **Per-role validation is explicit.** A PRO must have a `PRO_SALON` / `PRO_MOBILE` location; a CLIENT must have `CLIENT_ZIP`. Cross-role location payloads are rejected.
- **CA BBC license verification is real.** `verifyCaBbcLicense()` hits the CA DCA BreEZe API, requires `CURRENT` status, caches the license-type map for 6 h. If the state API is down, signup falls back to manual upload and `verificationStatus = PENDING` — not a silent pass. Professions that don't need a license (`MAKEUP_ARTIST`) skip this gate cleanly.

---

## 3. What's not safe — security findings, ranked

Ordered by severity for 100k users. "High" means I would not launch with these open. "Medium" is launch-acceptable with monitoring. "Low" is backlog.

### HIGH — Rate limiter fails open on Redis error
`app/api/_utils/rateLimit.ts` line 113–117:
> "Fail-open: if Redis is missing/down, don't take your API down."

If Redis hiccups at launch (exactly when it's under the most load), **every rate limit silently disappears** — signup, login, password-reset, holds, message-send, everything. A single Redis outage turns the whole app into an open relay for 5-minutes-to-forever. At 100k users on day one, you should assume Redis will be stressed.

### HIGH — No password strength requirement anywhere
Register route line 549: `const password = pickString(body.password)` — then straight to bcrypt. I cannot find any length, complexity, or breach-list check in `lib/auth.ts` or the signup forms. A user can sign up with password `a`. Given credential-stuffing against any public launch, this is the single biggest account-takeover risk in the flow.

### HIGH — Email enumeration via `EMAIL_IN_USE` / `PHONE_IN_USE`
Register route lines 707–708 return distinct errors for "email already exists" and "phone already exists" before the transaction. An attacker can submit bulk POSTs and trivially determine which emails / phone numbers already have accounts. This is a GDPR-relevant disclosure and also leaks the pro/client base to competitors.

### HIGH — SMS pumping / toll-fraud exposure
Combined picture:
- No blocklist on phone number country / carrier / premium-rate ranges.
- No disposable-phone check.
- Registration rate limit is 5 per IP per hour. A botnet with 1000 IPs = 5000 signups/hour = 5000 SMS/hour at Twilio's international rate.
- Phone-resend (`/api/auth/phone/send`) allows another 5 SMS per account per hour on a **separate** bucket.
- Email-resend is on yet another separate bucket.

SMS pumping is one of the top-5 most commonly exploited SaaS flows in 2025 and the attacker's payout (revenue share with a complicit carrier) is real. At 100k users on day one you will be noticed. Twilio offers "SMS pumping protection" as a feature — turn it on and add an allow-list for destination countries you actually serve.

### HIGH — No attempt counter on phone-verify or email-verify
`PhoneVerification` and `EmailVerificationToken` schemas do not have an `attempts` column. Wrong-code attempts are not counted, logged, or locked out. The only thing stopping brute-force on a 6-digit SMS code is the per-IP rate limit on the *send* endpoint — but the *verify* endpoint itself has no limit in the code I read. A distributed attacker can keep trying codes against a live SMS (10-minute window) across many IPs. 6-digit space = 1,000,000, 10-minute window = would need ~1700 tries/sec for full coverage; with code reuse and birthday-ish guessing, a targeted account takeover is feasible enough to matter.

### HIGH — Rate limit keyed on raw `x-forwarded-for`
`getClientIpFromHeaders()` trusts whatever the client sends in `x-forwarded-for` or `x-real-ip`. If Vercel / the edge proxy is configured to *append* rather than *overwrite*, or if any route is reachable without passing through the trusted proxy, a one-line header injection bypasses rate limits entirely. This needs to be pinned to the real client-IP header your specific edge provider guarantees (`x-vercel-forwarded-for` on Vercel) and that header needs a trust boundary.

### MEDIUM — TOCTOU race on uniqueness check
Lines 703–716 do `findFirst` → transaction `create`. Between the two, a concurrent request with the same email/phone can slip in. The DB unique constraint catches it and `isPrismaUniqueError` returns a friendly 400, so the data is safe, but the second caller sees a different, less informative error, and in high-concurrency scenarios you may briefly create *half* a row (user record + failed profile) before rollback. Not dangerous. Clean up by relying only on the DB constraint and moving the friendly-error mapping into the catch.

### MEDIUM — `emailVerificationSent: false` is silent for ops
If Postmark env vars are missing or Postmark returns an error, the signup succeeds and the client just sees a flag. There is `console.error('[email-verification] failed to send', ...)` but no counter, alert, or metric I can find. At 100k users you need a Datadog / Sentry / structured-log signal on this — otherwise an outage at the email provider hides as "low conversion."

### MEDIUM — Register response embeds role/verification flags in cookie-less JWT
`createVerificationToken` is called *before* the user has verified anything, and its value is dropped into the `tovis_token` cookie. Until the user verifies, whatever middleware trusts that JWT must distinguish VERIFICATION from ACTIVE sessions. The downstream `phone/verify` and `email/verify` routes do handle this (`allowVerificationSession: true`), but I did not see a test-level or audit-level assurance that *every* protected API also refuses VERIFICATION sessions. This is an invariant that needs a single middleware-layer enforcement, not scattered checks.

### MEDIUM — Email-verify clickable by anyone
`/verify-email?token=…` does not require the user to be logged in. This is an intentional UX decision (so users on a different device can verify), but it means:
- A stolen link = account verified, even if the attacker is not the user.
- Links end up in browser history, referrer headers, and mail-scanner preview requests. Corporate email scanners routinely pre-fetch links and will consume single-use tokens, causing legitimate users to hit "link already used" errors. This is a known industry problem — the fix is to require a GET-then-confirm click, or to use `Postmark Link Tracking = disabled` and also require the link to hit a page that asks for confirmation.

### MEDIUM — bcrypt cost = 10 under a 100k-user stampede
`hashPassword` (lib/auth.ts) uses 10 rounds. That's ~80–120 ms per hash on a typical serverless runtime. At a day-one peak of, say, 200 signups/sec you're spending ~20 seconds of CPU per second just on bcrypt, and each signup also does DB I/O, Twilio, Postmark, and CA DCA. The bottleneck may not be Redis or Postgres — it may be CPU. Either raise concurrency limits, or move bcrypt to a background worker (not ideal for signup), or verify you are on a runtime with enough cores. Don't *lower* bcrypt cost to mask the problem.

### MEDIUM — Signup is synchronous across 4–5 external calls
In a single request:
1. Redis (rate limit)
2. Postgres (uniqueness check + transaction + phoneVerification insert)
3. CA DCA BreEZe API (if PRO with license)
4. Twilio (SMS send)
5. Postmark (email send)
6. Redis again (consumeTapIntent)

Each has its own timeout. A slow DCA response (I have seen them go to 30 s+) directly delays the user's "Create Pro Account" button. At 100k users you want the register endpoint to **commit the user + issue tokens**, then push SMS / email / license-verify into a background job (Inngest, Trigger.dev, or a simple queue). Today, if Postmark latency spikes to 10 s, every pro signup feels broken.

### LOW — No disposable-email / disposable-phone block
A long tail of fake signups is inevitable without either a Cloudflare Turnstile / hCaptcha at the form, or a disposable-domain blocklist. This is not a security issue so much as a cost and data-quality issue.

### LOW — `licenseRawJson` stored in the DB
The full BreEZe API response is stored on the profile. If BreEZe returns PII you didn't expect (address history, DOB), you're now storing it. Worth a 10-minute review of a real response.

### LOW — Cookie domain silently falls through to host-only on non-prod hosts
`resolveCookieDomain` returns `undefined` for anything that is not `tovis.app` / `tovis.me`. A staging env on, say, `tovis-staging.vercel.app` will issue host-only cookies — fine for function, but your staging QA will not catch cross-subdomain cookie bugs.

### LOW — Handle validation has no reserved-word list
`normalizeHandleInput` accepts `admin`, `root`, `tovis`, `support`, `api`, etc. Reserve them before someone grabs `@admin`.

### LOW — License-document upload path accepts any URL under `/`
`looksLikeLicenseDocRef` accepts any string starting with `/` as a valid reference. That's loose. At minimum it should require a path under `/uploads/` or `/media/` and be validated against the storage layer.

---

## 4. Email & phone verification — is the UX "easy and intuitive from the very first step"?

**Good:**
- After signup, the client is redirected to `/verify-phone` with query params (`email=retry`, `sms=retry`) that tell the page whether the initial send actually succeeded. This is a thoughtful detail.
- The verify page polls `/api/auth/verification/status` so it auto-advances when the other channel completes. Users who verify email on their laptop will see phone-verify unlock on mobile.
- Session type is split (`VERIFICATION` vs `ACTIVE`). A user cannot enter the main app until both channels are verified.
- Error messages on verify are generic ("Incorrect or expired code"), which is right.

**Not good:**
- **No client-side cooldown.** The verify page does not disable the "Resend" button for 60 seconds — it just lets the user click, then shows a 429 from the server. That feels broken. Add a visible countdown.
- **No "I didn't get the code" escape hatch.** If Twilio silently drops an SMS (it happens — especially to T-Mobile users in 2026 after the 10DLC tightening), the user has no way to switch to a voice call or change their phone number. At 100k users this is a support-ticket firehose.
- **No phone-change flow during verification.** A user who typed the wrong phone number on signup can *only* fix it by contacting support.
- **No skip-for-now.** Phone and email are both hard requirements to use the app. That's a policy decision — fine if you're sure, but it means a single broken provider = 100% of new users bounce.
- **Email resend limits are permissive.** 5 per hour per user and 1-per-60-second cooldown means an attacker can send 5 verification emails per hour to a target's inbox. With 100k accounts, this is free email-flood ammunition. Tighten to 3/hour, 5-minute cooldown. Also consider "number of distinct *target addresses* per account per hour."
- **Email verify does not detect "link already used by mail scanner."** When corporate link-scanners pre-fetch, the user sees "link invalid" on the real click and has to re-request. Known mitigation: require a POST-on-click via a small confirmation page so GET requests are a no-op.
- **`licenseDocumentUrl` in the register body is unused in the UI but accepted by the API.** Either wire it in or drop it. Dead parameters become confused attack vectors.

---

## 5. 100k-user readiness — a launch-blocker punch list

These are the items I would not ship with open at 100k:

1. **Redis fail-open** → either fail-closed on critical auth buckets, or run Redis with a hot standby + circuit breaker. This is the single biggest scale-day risk.
2. **Password strength** → minimum 10 chars, blocklist top 10k breached passwords (HaveIBeenPwned Pwned Passwords k-anonymity API is free and fast).
3. **Email / phone enumeration** → collapse the `EMAIL_IN_USE` / `PHONE_IN_USE` responses into a single neutral message; still let the form show field-level validation on the client without exposing DB state.
4. **SMS pumping protection** → enable Twilio's native feature, allow-list destination countries, and add per-phone-number global quotas (not just per-account).
5. **Verify-attempt counter** → add an `attempts` column to `PhoneVerification`, lock after 5 wrong guesses, rotate the code on lockout.
6. **Rate limit identity** → move off raw `x-forwarded-for`; use the edge provider's trusted header.
7. **Async signup tail** → move SMS, email, DCA, and `consumeTapIntent` into a background job so the request returns in <300 ms regardless of vendor latency.
8. **Observability** → structured metrics on `emailVerificationSent`, `phoneVerificationSent`, DCA failure rate, and Twilio error codes. Without these, you will not notice a partial outage until the support queue explodes.
9. **Client-side resend cooldown + phone-change flow + voice-call fallback** on `/verify-phone`. This is the UX-impact multiplier at scale.
10. **A test for the invariant "VERIFICATION session cannot reach any authed API except verify-*"**. One unit test, one middleware check, done — but critical.

---

## 6. Items to verify beyond this audit

The following were not covered here and deserve their own pass:
- The `/claim/[token]` flow end-to-end (create vs link vs takeover semantics).
- Google Places / geocode / timezone proxies (`app/api/google/*`) — the signup form calls them un-authenticated. Check their own rate limits and whether they leak API keys.
- `/api/auth/login`, `/api/auth/password-reset` — same codebase, same primitives, likely same class of issues.
- How `middleware.ts` handles `VERIFICATION` vs `ACTIVE` sessions when the user tries to reach `/pro`, `/client`, `/booking`. I spot-checked but didn't exhaustively map every protected path.
- Abuse monitoring: is there a SIEM / Datadog / Sentry receiving these logs at all, or do they die at `console.error`?

---

*End of audit.*
