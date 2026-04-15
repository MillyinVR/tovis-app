# TOVIS — Login, Logout, Password Reset & Session Audit
**Scope:** `/api/auth/login`, `/api/auth/logout`, `/api/auth/password-reset/request`, `/api/auth/password-reset/confirm`, JWT handling, session model, login UX.
**Goal:** Enterprise readiness for 100,000 users on day one.
**Mode:** Read-only. No code changed.
**Date:** 2026-04-15

This builds on the earlier `SIGNUP_AUDIT.md`. Some findings in that document recur here — the login and reset flows share primitives with signup, so if a primitive is broken, it's broken everywhere.

---

## 1. Headline: the password-strength bug is worse than I thought

In the signup audit I said "there is no password strength enforcement anywhere in the code." That was half right. Here's what's actually happening:

- `lib/passwordPolicy.ts` **exists**. It exports `validatePassword()` with a minimum length of 8 and a blocklist of three obvious passwords (`password`, `password123`, `12345678`).
- `app/api/auth/password-reset/confirm/route.ts` line 7 **imports it** and calls it on line 35.
- `app/api/auth/register/route.ts` **does not import it**. Signup bypasses password validation entirely.

So the rule "you can sign up with password `a`" is true, and the rule "but when you reset your password you must have at least 8 characters" is also true. A compromised account that goes through reset ends up *stronger* than a brand-new account. This is trivially fixable (one import + one line in register), but the fact that it exists means nobody has exercised the two flows side-by-side. That's a process signal, not just a bug.

The policy itself is also too weak: 8 characters with a 3-entry blocklist would not have blocked `hunter2`, `iloveyou`, `qwerty12`, `letmein1`, or any of the top 1,000 passwords from the RockYou leak. It needs to become a real policy in both places — the Step 1 fix in your remediation plan is the right destination.

---

## 2. Login — what's right

- **Rate-limited before the DB lookup.** `enforceRateLimit` is called on line 80 *before* `findUnique`, so a flood of login attempts does not flood Postgres. Good ordering.
- **Identical error message for "user not found" and "wrong password."** Both return `401 INVALID_CREDENTIALS` with the same text. The string-level enumeration is blocked.
- **`isFullyVerified` gating.** Login returns a `VERIFICATION` session token if either phone or email is unverified, and only upgrades to `ACTIVE` when both are confirmed. This is the correct primitive.
- **Cookie hardening.** `httpOnly`, `sameSite: 'lax'`, and `secure` derived from `x-forwarded-proto` — same (good-enough) pattern as signup.
- **JWT signature is actually verified.** `lib/auth.ts` uses `jwt.verify(token, JWT_SECRET)` with proper payload-shape validation. Not a "decode and trust" setup.
- **`authVersion` is a real concept.** The JWT payload includes `authVersion`, `lib/currentUser.ts` line 81 rejects the token if the DB row's version doesn't match, and the password-reset confirm route does `authVersion: { increment: 1 }`. If a user resets their password, every outstanding JWT for them becomes invalid on the next `getCurrentUser()` call. This is one of the most important session-security primitives in the whole codebase and it is wired correctly.

---

## 3. Login — what's not safe

### HIGH — Timing-attack user enumeration
The login route looks up the user (`findUnique`, ~5–50 ms), and *only if a user is returned* does it call `bcrypt.compare` (~80–120 ms on cost 10). A non-existent email returns in roughly a tenth the time of an existing email with a wrong password. At 100 requests the signal is clean enough to enumerate. The standard fix is to call `bcrypt.compare(password, DUMMY_HASH)` when the user is not found, so the wall-clock time is constant. It's ~10 lines. I'd add it.

### HIGH — No per-account lockout; only per-IP
The rate limit is `10 per IP per 15 minutes`. A botnet with 1,000 IPs can try 10,000 passwords per 15 minutes against a single target email. 1 million attempts per day is more than enough to hit the top-1M password list on any account that used a weak password during signup (and signup has no strength rule — see above).

There is **no `LoginAttempt` table, no `failedLoginCount` field on user, no account lockout**. Grep is clean: the concept does not exist in the schema.

The fix pattern for 100k scale is: per-account counter in Redis with a 24-hour TTL; after N failures (say 10), require a CAPTCHA on the next attempt for that email; after M failures (say 25), lock the account and require a password reset (or an email-confirmed unlock).

### HIGH — `expectedRole` mismatch leaks account existence
Lines 121–131:
```ts
if (expectedRole && user.role !== expectedRole) {
  return jsonFail(403, `That account is not a ${expectedRole.toLowerCase()} account.`,
    { code: 'ROLE_MISMATCH', expectedRole, actualRole: user.role })
}
```
If an attacker hits `/login?intent=pro` with a victim's email + correct password, they get back: (a) the account exists, (b) the account is a CLIENT not a PRO, and (c) the actual role in the JSON body. This is a post-authentication disclosure — you need the password — so it's not an open enumeration vector, but it still leaks role and existence to anyone with credentials, including phishing-harvested ones. Return `401 INVALID_CREDENTIALS` instead; users don't need to know whether they used the wrong login page.

### MEDIUM — Login is a fine place to refresh cookies but doesn't
Log in with an old-but-valid JWT and `authVersion` bump after a reset — the old cookie stays in the browser until it expires, because login doesn't check for a stale cookie and refresh it. Minor; the request-level check in `getCurrentUser` catches it anyway. Worth a line in the remediation plan's session-hygiene step.

### MEDIUM — No CAPTCHA escalation after failures
Even without full MFA, a CAPTCHA after N failed logins (same as your Step 23) removes the botnet economics. Without CAPTCHA + without per-account lockout, the `auth:login` bucket is the only thing preventing distributed credential stuffing at scale. One line of defense is not enough at 100k.

### MEDIUM — `consumeTapIntent` runs inside the login request
Same pattern as signup: the `tapIntentId` is consumed synchronously before the response is returned. Same downside: a slow Redis means slow logins.

### LOW — No "remember me" / short-session option
All logins get a 7-day cookie. There's no "log me in for 30 days" for personal devices and no "1 hour for shared devices" for shared devices. Privacy-conscious users on public computers have no way to ask for a shorter session. Industry-standard but missing.

---

## 4. Session model — the biggest structural gap

The session model is **pure JWT in an httpOnly cookie**. There is no `Session` table, no `RefreshToken` model, no Redis session store. `prisma/schema.prisma` contains nothing of that shape. The only server-side state is the `User.authVersion` counter.

This has two consequences at 100k scale that the code does not handle today:

### HIGH — No "sign out everywhere" without a password reset
`app/api/auth/logout/route.ts` only clears the client-side cookie. It does not touch `authVersion`. If a user loses their phone, the only way they can invalidate that device's session today is to reset their password — there is no self-service "sign out all devices" and no admin way to do it short of a manual DB update. At 100k users you will get this ticket, at a guess, hundreds of times in the first month. Add a `POST /api/auth/sign-out-everywhere` that calls `authVersion: { increment: 1 }` on the current user.

### HIGH — `authVersion` check is not universal
`authVersion` is only compared when `getCurrentUser()` is called. `middleware.ts` today does not do this; it only handles vanity-domain rewrites. Any API route that decodes the JWT directly (via `verifyToken` without calling `getCurrentUser`) will happily accept a stale token for up to 7 days. I did not audit every API route — you need a one-time sweep to confirm that every authenticated route goes through `getCurrentUser` (or an equivalent that checks `authVersion` against the DB). This is a correctness issue, not a theoretical one: once you start bumping `authVersion` on password resets, any non-compliant route becomes a session-revocation bypass.

### MEDIUM — 7-day cookie is long in a revocation-weak system
If you're going to rely on `authVersion` alone to revoke sessions (no Redis blocklist, no server-side session store), the 7-day lifetime is generous. Consider 24 hours for `ACTIVE` + a short-lived refresh token, *or* keep 7 days but commit to the `authVersion` check running on every single authenticated request and add a Redis cache for the user's current `authVersion` to avoid hammering Postgres.

### LOW — `JWT_SECRET` is a single env var with no rotation plan
If the secret ever leaks (CI log, env dump, etc.) you have to bump everybody's `authVersion` and rotate the secret at the same time, which is a stop-the-world operation. JWTs support a `kid` header for key versioning. Not P0, but worth a design doc.

---

## 5. Password reset — request endpoint

File: `app/api/auth/password-reset/request/route.ts`

### What's right
- Rate-limited on `auth:password-reset-request` (5 per IP per 15 minutes). Good.
- Response body is always `{ ok: true }` regardless of whether the email exists. The string-level enumeration is blocked.
- Tokens are 32 bytes of `crypto.randomBytes` → 256 bits → strong.
- Tokens are hashed with SHA-256 before storage (`tokenHash`). A DB leak does not expose working reset tokens.
- Old outstanding reset tokens for the same user are invalidated when a new one is issued (`updateMany … usedAt: now`).
- `PasswordResetToken` captures the requester's IP and user-agent, which is genuinely useful for forensics.
- 30-minute expiry. Reasonable.

### HIGH — Timing-based enumeration
This is the same shape as the login timing issue but worse, because the request endpoint sits outside any authentication wall. The route:
1. Looks up the user (fast if not found)
2. **Only if found**, generates a token, writes it to the DB, and calls Postmark (~200–1500 ms)

A non-existent email returns in ~20 ms; an existing one returns in ~400 ms. The response body is identical, but the clock isn't. At 100k users a bulk scan from 1,000 IPs (each allowed 5 resets per 15 min = 20,000 probes per 15 min) can enumerate your entire user base in a few hours.

Fix pattern: either queue the email send and return immediately *always*, or insert a deliberate `setTimeout`-equivalent (async delay) so existing and non-existing requests return in the same time window. The queue option is strictly better because it also gives you retries and async observability — which you wanted from the async-signup-tail step anyway.

### HIGH — No per-email / per-target-address rate limit
The only limit is "5 per IP per 15 minutes." Since the attacker controls the IP but the victim controls the email, there is nothing that stops an attacker with 1,000 IPs from triggering 5,000 reset emails at a single target's inbox in 15 minutes. This is an inbox-flood / gaslighting / phishing-cover attack vector. Add a second bucket: `auth:pw-reset:email` keyed on `sha256(email)`, limit 3 per hour.

### MEDIUM — Authenticated users can trigger their own reset
Nothing stops a logged-in user from hitting the request endpoint for their own email (or anyone else's). It's not a security vulnerability so much as a UX trap — a user who types their password wrong once will go to "forgot password," get the reset email, and end up with *two* valid login paths until one is consumed. Mostly fine, but worth being aware of: if you ever add "sign out everywhere on password reset," that flow will surprise an authenticated user who just wanted to try a password change.

---

## 6. Password reset — confirm endpoint

File: `app/api/auth/password-reset/confirm/route.ts`

### What's right
- Calls `validatePassword()` (even though register doesn't — see headline finding).
- Verifies `tokenHash` against the DB.
- Checks `usedAt` and `expiresAt` before accepting.
- Runs the update in a `$transaction`: set new password, bump `authVersion`, mark token used.
- Bumping `authVersion` invalidates every outstanding JWT for that user. This is the right behavior after a password reset and it is correctly implemented.

### HIGH — No per-token attempt counter
The `PasswordResetToken` model has no `attempts` column. Within the 30-minute window, an attacker who somehow acquired a reset-URL fragment (shoulder-surf, mail scanner preview pane, SSRF of a proxy log, forwarded email) can POST to `/api/auth/password-reset/confirm` with the full token — and since the confirm bucket allows 10/IP/15min, you get *plenty* of room from a botnet. The one saving grace is that the token is 256 bits so blind brute force is infeasible; but any leak is a direct account-takeover. Add an attempts counter, lock on 5 wrong submissions, and invalidate the token on lock. Same pattern as the OTP attempts counter in your plan.

### HIGH — Outstanding tokens are NOT invalidated on successful reset
They're invalidated *when a new token is issued* (the `updateMany` I mentioned earlier), but **not when a password reset actually succeeds**. Scenario:
1. Attacker phishes the user, gets Token A.
2. User realises something's wrong, hits "forgot password" again, gets Token B (which marks Token A used — good).
3. Attacker still has Token A on their screen, but it's now `usedAt` → rejected. Good.
4. User resets with Token B. Attacker, who also controls the user's email (remember, they phished), requests *Token C* after the reset completes. User has no idea. Token C is valid for the next 30 minutes.

The fix is: on successful confirm, also invalidate every other unused reset token for that user. It's two extra lines in the same transaction. Belt-and-braces but important when an attacker might hold the email account.

### HIGH — Password reset does not force re-verification of email
If an attacker resets a victim's password, and then the attacker logs in, they get a full `ACTIVE` session (assuming the victim's email and phone were already verified). Nothing makes them re-prove either. Given that the reset email went to the email account, if the email account is compromised you already have a big problem — but defense in depth says: on password reset, clear `emailVerifiedAt` (or at least require a fresh phone OTP on next login) so a compromised email alone is not sufficient to complete a takeover. This gets thorny because it creates support load when legitimate users reset their password. Middle ground: require phone OTP on the first login after a password reset.

### HIGH — Confirm endpoint does not set a session or refresh the cookie
After a successful reset, the endpoint returns `{ ok: true }` and the page says "you can now sign in." That means the user goes to `/login`, types their new password, and goes through the whole login flow again. This is the correct choice from a security perspective — it makes the attacker type the password they just set, which is a tiny second-factor — but it's inconsistent with the user's mental model. I'd leave it as-is and improve the UX (big "Go to login" button, auto-redirect after 3 s).

Wait — upgrading the response to also log the user in would also re-grant a session to an attacker who just reset via a leaked token. **Leave it alone. This is safer.** I only mention it because both audit agents flagged it as a UX gap; it isn't.

### MEDIUM — No CSRF token on confirm
The confirm endpoint trusts that any POST with a valid `token` is legitimate. `sameSite: lax` on the cookie doesn't apply because the endpoint doesn't require a cookie. The token *itself* acts as a one-time secret, which is the reason most reset endpoints skip CSRF. But: an attacker who controls `evil.tovis.me` (or any subdomain wildcard) can submit a cross-site form to `app.tovis.app/api/auth/password-reset/confirm` with a token they phished and the victim's current browser will POST it. Not a realistic attack vector unless you have a subdomain takeover problem — but worth a line in the plan.

### MEDIUM — Token is in the URL path, not the body
`/reset-password/{token}` — the token is in the URL path, not the query string. That's better than `?token=` (less referrer leakage), but the token still ends up in browser history, push-notification previews, and any browser-extension that reads the URL bar. And the email scanner prefetch concern is partly mitigated because the page is a React component that POSTs on button click — a GET-only scanner won't consume the token. Still, a one-time "click to confirm" pattern on the page is a good idea.

### LOW — SHA-256 is not bcrypt
The token hash is SHA-256, not bcrypt. Since the token itself is 256 bits, bcrypt adds nothing (you can't rainbow-table a uniformly random 256-bit input). SHA-256 is correct here. One of the audit agents flagged this; I'm disagreeing. Leave it.

---

## 7. Logout

File: `app/api/auth/logout/route.ts` — single responsibility: clears the `tovis_token` cookie.

### What's right
- Cookie is cleared with matching `domain`, `path`, `sameSite`, and `secure` attributes. A mismatched clear (e.g. forgetting the `domain`) silently leaves the cookie in place. This one is correct.

### MEDIUM — Server-side is untouched
Logout is client-side only. The JWT is still valid until it expires. A stolen cookie survives a logout. The fix is either:
1. The "sign out everywhere" endpoint that bumps `authVersion` (but that signs out *every* device, not just this one), or
2. A real session store with a "revoked token" blocklist in Redis, keyed on the JWT's `jti`. Neither exists today.

### LOW — No audit trail
There is no record of the logout. For 100k users with compliance requirements (SOC 2, HIPAA-adjacent if you ever touch medical-professional data), a login/logout audit log is expected. See §10 below.

---

## 8. MFA — completely absent

Grep for `mfa`, `totp`, `twoFactor`, `2fa` returns nothing in the app code. There is no MFA scaffolding, no TOTP seed on user, no recovery codes, no WebAuthn.

For 100k users on a platform that holds PRO payment information and client booking data, this is the single biggest structural gap in the auth stack. MFA is not "nice to have" at this scale; it is table stakes for anyone using the word "enterprise." The bare minimum I would ship before calling this enterprise-ready:

- **TOTP for all PRO and ADMIN accounts.** Use `otplib` or similar. Add a `UserTotpSecret` table with encrypted seed, backup codes (hashed), and an `enabledAt` timestamp.
- **Optional TOTP for CLIENT accounts.** Strongly recommended at setup.
- **Step-up auth on sensitive actions.** Changing payout info, deleting an account, adding a staff member — re-prompt for a fresh TOTP code.
- **Recovery codes**, not SMS fallback. SMS MFA is widely considered inadequate in 2026 and is a second SMS-pumping vector.
- **WebAuthn / passkeys as a longer-term target.** Opt-in, but the infra is standard.

MFA is a separate project — maybe 2–4 weeks of focused work — and it's fine to launch without it if you're honest with users that the PRO/ADMIN surface is "single-factor today, MFA landing in Q2." But that sentence has to be in your security page, because enterprise customers will ask.

---

## 9. Password reset — concrete UX issues

From reading `forgot-password/page.tsx` and `reset-password/[token]/page.tsx` via the agents:

- **No countdown on the "Resend email" button** — same pattern as the verify-phone page in the signup audit. Users will spam-click.
- **No indication that the reset email was sent to `t***@example.com`** — showing the obscured target address is both reassurance (user knows it worked) and phishing-resistance (forwarded links become visibly wrong to the recipient).
- **Success page says "You can now sign in"** but does not auto-redirect and does not have a login button. A tired user at the end of a recovery flow is exactly who should *not* be asked to "figure it out."
- **No "sign out all devices as part of this reset?" checkbox.** Today the `authVersion` bump does this automatically, but only on servers that call `getCurrentUser()` — see §4. The user has no indication that anything is being invalidated.

---

## 10. Observability — the same gap as signup

The login and reset routes log to `console.error` on failure and nothing on success. There is no:

- `AuthEvent` table for login / logout / reset / `authVersion` bumps. For SOC 2 Type II you will need this.
- Per-IP / per-account failure metric.
- Alert threshold on login-failure rate (a brute-force attack should page someone at the 10x-over-baseline mark).
- Dashboard showing password-reset volume (a sudden spike is an attack signal even without a per-user lockout).

Everything I said about observability in the signup audit applies equally here. Log once, correctly, with structured JSON — there's no need to duplicate it per flow.

---

## 11. Cross-cutting: findings that are the same as signup, and therefore still open

These don't need to be re-fixed, just confirmed that the fix covers all flows:

| Finding | Signup | Login | Reset |
|---|---|---|---|
| Password strength not enforced | yes | n/a (verifies existing hash) | partially — 8-char min + 3 blocked words |
| Rate limit fails open on Redis error | yes | yes | yes |
| Rate limit keyed on raw `x-forwarded-for` | yes | yes | yes |
| Cookie domain fragile outside `.tovis.app` / `.tovis.me` | yes | yes | n/a (confirm sets no cookie) |
| Synchronous external calls in the request path | yes (Twilio, Postmark, DCA) | yes (consumeTapIntent) | yes (Postmark) |
| Observability is `console.error` only | yes | yes | yes |
| No CAPTCHA | yes | yes | yes |

The remediation plan you wrote already covers the first five in the "shared primitives" steps. The last two (observability and CAPTCHA) I argued should be in P0. None of that changes.

---

## 12. New launch-blocker additions specific to login / reset

Adding to your existing 12-item P0 list from my prior review:

**13. Dummy bcrypt on failed login user-lookup.** Ten lines. Closes the timing-based user-enumeration vector on `/api/auth/login` and `/api/auth/password-reset/request`. Implementation note: precompute `DUMMY_HASH = bcrypt.hash('never-matches', 10)` once at module load and `bcrypt.compare(password, DUMMY_HASH)` when the user is not found. Must actually `await` it — discarding the promise defeats the purpose.

**14. Per-account login lockout in Redis.** `loginAttempts:{sha256(email)}` → increment on failure, reset on success, ceiling at (say) 25 in 24 hours. Forces the botnet to spread across emails rather than concentrate on one target.

**15. Collapse `ROLE_MISMATCH` into `INVALID_CREDENTIALS`.** Two-line change, closes the post-auth role/existence disclosure.

**16. Fix the register-route password validation gap.** `import { validatePassword } from '@/lib/passwordPolicy'` plus one call. This is separate from Step 1 of your plan (which was "build a real policy"): this is *"wire the existing weak policy into the flow that's currently skipping it, on day one, as a 5-minute hotfix, before you do the real Step 1."*

**17. Per-email rate limit on password-reset request and resend email.** New Redis bucket keyed on `sha256(email)`, 3 per hour. Closes the inbox-flood / gaslighting vector.

**18. `POST /api/auth/sign-out-everywhere` endpoint.** One handler, calls `authVersion: { increment: 1 }` on the current user, clears the current cookie. You need this on day one or your support team will spend launch week running manual DB updates.

**19. Confirm every authenticated API route uses `getCurrentUser()` and thus checks `authVersion`.** This is the sweep I mentioned in §4. It's audit work, not implementation work — a couple of hours with ripgrep and a checklist. Without it, every session-revocation primitive you already built is load-bearing on assumptions nobody has verified.

**20. Reset-token attempts counter + invalidate-siblings-on-success.** Same pattern as your Step 5 for OTPs. `PasswordResetToken.attempts Int @default(0)`, increment on each failed confirm, lock at 5.

**21. Require phone OTP on first login after a password reset.** Not auto-clearing `emailVerifiedAt`, but a soft step-up: one SMS on the first post-reset login. Defense in depth against a phished email account. This one I'm more willing to negotiate on for launch — it's MEDIUM not HIGH. But it's the kind of thing you want to add before you discover you need it.

Items that should *not* be in P0 but that I want on the roadmap before the end of Q2:

- MFA (TOTP + recovery codes) for PRO and ADMIN.
- `AuthEvent` table + basic dashboard.
- Session store with per-`jti` revocation in Redis, so you can kill a *specific* device without logging the user out everywhere.
- Key rotation plan for `JWT_SECRET`.

---

## 13. One thing that made me happier than the signup audit did

The `authVersion` primitive and its integration with password reset is the single cleanest piece of auth engineering in the codebase. It is the thing that lets "sign out everywhere" be a one-line feature instead of a month-long project. Whoever built it understood the bigger picture. The rest of this audit is mostly "you built a good foundation and then left a few windows open on the ground floor" — not "you built on sand." That's recoverable in the P0 timeline. Signup is in worse shape than login/reset, and signup is the flow with the tightest deadline; I'd keep the fix order biased toward signup first and treat login/reset as week-1-and-2 work on the P0 timeline.

---

*End of audit.*
