# Staging environment setup (T0.1) — the launch critical path

> One environment unblocks five launch-gate boxes: deployed load (#11), staging E2E (#9), deployed
> chaos (#12), live health/alerts (#13), live dashboards (#14). Build this first.
>
> **Goal:** a deployed copy of TOVIS, isolated from production, that the load/E2E/chaos harnesses can
> hammer freely (test-mode third parties, throwaway DB, ample seed data).

## 0. Decisions to make first
- **DB:** Supabase *staging branch* (cheap, fast, shares project config) **vs** a *separate Supabase
  project* (stronger isolation). Recommend a **separate project** so a load run can never touch prod data.
- **Domain:** `staging.tovis.app` (recommended) or a Vercel preview URL.

## 1. Deploy the app
- New Vercel project (or a protected `staging` branch / dedicated environment) pointing at the repo.
- Bind `staging.tovis.app`.
- **Mark it noindex** (`X-Robots-Tag: noindex`) so staging never gets crawled.
- Protect it (Vercel password / IP allowlist) so only the team + load harness reach it.

## 2. Provision a throwaway staging DB
- Create the staging Postgres (separate Supabase project recommended).
- Apply schema: `prisma migrate deploy` (or `prisma db push`) against the staging `DATABASE_URL`/`DIRECT_URL`.
- **Seed richly** — the dev seed gives 1 pro / 12 slots, which is too thin for the load harness
  (`hold-create` needs ~450 distinct slots). Seed: several pros, broad working hours over the next
  14+ days, a catalog of services, multiple clients, and a handful of existing bookings (so the
  `checkout` and `media-metadata` load steps have real booking ids). Confirm a `tovis-root` tenant row
  exists (`prisma/seed.cjs` upserts it).

## 3. Wire test-mode third parties (so load runs cost nothing / send nothing real)
Set on the **deployed app's** environment (Vercel), not just locally:
- **Stripe:** `sk_test_…` + the matching test `STRIPE_WEBHOOK_SECRET`. (The webhook-replay load step
  fails unless the harness signs with the *same* secret the deployed app verifies — this bit us in the
  local run.)
- **Postmark:** a test/sandbox stream (or a throwaway server token) so 1000s of signup emails go nowhere.
- **Twilio:** test credentials / magic test numbers so no real SMS is sent.
- **Turnstile:** a test site key + `TURNSTILE_TEST_TOKEN` the deployed app accepts (so the signup load
  step passes the CAPTCHA).

## 4. Populate `.env.staging.local` (for running the harness *at* staging)
The load orchestrator (`tests/load/run-launch-load-suite.ts`) requires these. Today this file is empty —
fill it:
```
STAGING_BASE_URL=https://staging.tovis.app
LOAD_TEST_ENVIRONMENT=staging
LOAD_TEST_PROFESSIONAL_ID=<a seeded pro id>
LOAD_TEST_SERVICE_ID=<a service of that pro>
LOAD_TEST_CHECKOUT_BOOKING_ID=<a seeded booking id>
LOAD_TEST_MEDIA_BOOKING_ID=<a seeded booking id with media>
STRIPE_WEBHOOK_SECRET=<the staging app's test webhook secret>
TURNSTILE_TEST_TOKEN=<accepted by staging>
LOAD_TEST_CLIENT_COOKIE=<minted, see §5>
LOAD_TEST_PRO_COOKIE=<minted, see §5>
```
Get seeded ids straight from the staging DB, e.g.:
`SELECT pp.id, u.email FROM "ProfessionalProfile" pp JOIN "User" u ON u.id = pp."userId" LIMIT 5;`

## 5. Mint session cookies (the non-obvious bit)
Login sets a `tovis_token` cookie **and requires an `Origin` header** (CSRF guard) — without it you get
403. Recipe (verified locally this session):
```bash
base=https://staging.tovis.app
jar=$(mktemp)
curl -s -o /dev/null -c "$jar" -X POST "$base/api/auth/login" \
  -H 'Content-Type: application/json' -H "Origin: $base" -H "Referer: $base/login" \
  --data '{"email":"<seeded client email>","password":"<seed password>"}'
echo "tovis_token=$(grep tovis_token "$jar" | awk '{print $7}')"   # -> LOAD_TEST_CLIENT_COOKIE
```
Repeat with a seeded **pro** email for `LOAD_TEST_PRO_COOKIE`. Cookies expire — re-mint before a run.

## 6. Smoke + first real proof
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://staging.tovis.app/api/health        # 200
dotenv -e .env.staging.local -- pnpm test:load:availability                           # 200s
LOAD_TEST_SKIP_MISSING_ENV=1 dotenv -e .env.staging.local -- pnpm test:load:launch    # full suite, skips unconfigured steps
```
Record per-route p95/p99 in `load-test-plan.md` + `deployed-smoke-proof.md` (commit SHA + env + output).

## Acceptance (T0.1 done)
- `pnpm test:load:availability` returns 200s against `staging.tovis.app`.
- This runbook is reproducible (someone else can rebuild staging from it).
- No production resource is reachable from any load/chaos run (separate DB + test-mode keys verified).

## Notes / gotchas (from the local dry-run)
- A single instance saturates ~100 rps with socket exhaustion — that's a box limit, not a code bug;
  staging behind the Supabase pooler should go much further. Verify the pooler is in front of staging reads/writes.
- `next dev` gives meaningless latency numbers; staging must run a production build (`next build` + `next start`, which is what Vercel does).
- Keep staging seed data refreshable — load runs create junk (holds, signups, bookings); add a re-seed/reset step.
