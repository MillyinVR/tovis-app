# TOVIS Deployment Checklist

## Auth / trusted IP / rate-limit safety

- Verify `AUTH_TRUSTED_IP_HEADER` is set.
- Run `curl -s https://your-domain.com/api/health` and confirm rate limiting is active.
- Verify the configured trusted IP header name matches the production ingress header actually reaching TOVIS.
- Repeat a request against a rate-limited auth path from the same client and confirm repeated requests eventually receive `429` instead of bypassing throttling.

## Signup load test results

Record the prelaunch staging signup load-test result here before launch approval.

> ⚠️ **Scope of this run: LOCAL DEV-MODE proof, not deployed-staging proof.**
> This was executed against a local `next dev` server backed by a local
> Postgres container — it fills this template with real recorded numbers and
> surfaces a real finding (below), but it does **not** satisfy the deployed
> staging/dashboard requirement in
> the deployed-load-proof runbook
> ([`docs/launch-readiness/deployed-load-proof-runbook.md`](launch-readiness/deployed-load-proof-runbook.md)).
> Deployed-staging signup proof with a runtime dashboard link remains **OPEN** (tracked in [`docs/BACKLOG.md`](BACKLOG.md) §8).

- Environment tested: local-dev — `next dev` (Turbopack, `NODE_ENV=development`, single Node process) on `http://localhost:3000`, backed by local Postgres (Docker, `localhost:5434/tovis_dev`). Production DB was **not** touched (verified: signups landed in the local DB only).
- Date: 2026-06-22
- Commit: `94b71928`
- Tool used: `tests/load/signup-load-test.ts` via `pnpm test:load:signup`, `LOAD_TEST_PROFILE=baseline`, trusted-IP spread (`x-forwarded-for`, prefix `10.99`), `LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true`, disjoint US fictional (`555-01xx`) phone pool.
- Route tested: `POST /api/auth/register`
- Payload shape tested: repo-confirmed `CLIENT` signup contract
- Peak target reached: 25 rps tier (1500 requests over 60s); plus a clean sustained 10 rps tier (600 requests over 60s).
- p50: **683 ms** at 10 rps (clean tier) · 5542 ms aggregate at 25 rps (saturated tier)
- p95: **947 ms** at 10 rps (clean tier) · 15000 ms at 25 rps (request timeout ceiling hit — see finding)
- p99: **1110 ms** at 10 rps (clean tier) · 15001 ms at 25 rps (request timeout ceiling hit)
- Overall error rate: 0% at 10 rps (600/600 success). 25.1% aggregate across both tiers — but **100% of those failures are connection `NETWORK`/`TIMEOUT`** at the 25 rps tier (410 network + 118 timeout); **zero** application 4xx/5xx and **zero** unexpected `429`. Successful-request latency at 25 rps stayed bounded (p50 6.8s / p95 9.3s / p99 12.6s); the failures are dropped/timed-out connections, not bad responses.
- `429` rate: 0. The trusted-IP spread gives every synthetic request its own per-IP bucket, so the per-IP signup limiter (`auth:register:verified` = 20/hour/IP, `auth-critical` mode, Upstash-backed) is intentionally not tripped. The actual `429` throttle path is **not** exercised by this run — verifying it belongs to the "Auth / trusted IP / rate-limit safety" section against prod.
- Were expected `429`s excluded from real-failure calculations?: N/A — none occurred (see above). The harness does classify `429` separately from real failures when they do occur.
- Runtime dashboard screenshot / link: none (local dev; no Sentry/Upstash dashboard capture). **Required for deployed-staging sign-off — still outstanding.**
- Notes / follow-up:
  - **Finding (real, carry to launch sizing):** a single `next dev` instance saturates at ~20–25 rps on signup. The bottleneck is `bcryptjs` password hashing — pure-JS and CPU-blocking, so concurrent hashes serialize the Node event loop and back up until requests hit the 15s client timeout. Production runs a **compiled build on horizontally-scaled serverless functions**, so this is not a production verdict — but it confirms password hashing is the signup hot path. Action: confirm prod function concurrency/instance sizing (or consider a worker-thread/native hashing path) before opening signup to high-concurrency public traffic.
  - **App correctness under load confirmed:** phone-format validation, SMS-country support, and phone-uniqueness all enforced correctly; `ACCOUNT_EXISTS` returned idempotently on duplicate phone. (Validation runs *before* the rate-limit check.)
  - **Deployed-staging proof still required** before launch approval: rerun against a deployed staging build with isolated test data + a linked runtime dashboard, per the load-test plan.

## Sweep result

AuthVersion enforcement sweep completed against bf6dc98. Repo-confirmed authenticated app surfaces do not perform raw JWT verification or raw tovis_token reads outside auth lifecycle endpoints. DB-backed current-user validation remains centralized in lib/currentUser.ts and flows through requireUser()/requireClient()/requirePro(). Structural regression test now passes and is scoped to catch real session-bypass risks without flagging unauthenticated token-based flows like password reset confirm.