# Deployed load proof — runbook

The launch load suite (`pnpm test:load:launch` / `pnpm verify:launch-ops`) already
passes **locally**. The remaining launch gate is running it against a **deployed**
environment and recording the result. This is operational, not a code change.

> ⚠️ Run against **staging** (a deploy backed by a NON-prod database). Do **not**
> load-test production without explicit sign-off — see `load-test-plan.md`
> (data isolation, Stripe/provider costs, rollback).

## The four env values — exactly where each comes from

| Var | What it is | Where to get it |
|---|---|---|
| `STAGING_BASE_URL` | The deployed app you're testing | Your Vercel **staging/preview** deployment URL, e.g. `https://tovis-app-git-<branch>-toris-projects-c92425d3.vercel.app` (Vercel dashboard → Deployments, or `vercel ls`). Must point at a non-prod DB. |
| `LOAD_TEST_PROFESSIONAL_ID` | The seeded pro's `ProfessionalProfile.id` | **Auto-derived** by `pnpm loadproof:fixtures` (looks up the seeded pro, handle `tovis-test-pro`). |
| `LOAD_TEST_SERVICE_ID` | A `Service.id` the pro offers | **Auto-derived** by `pnpm loadproof:fixtures` (the pro's first active offering). |
| `LOAD_TEST_CLIENT_COOKIE` | A logged-in client session cookie | **Auto-minted** by `pnpm loadproof:fixtures` as `tovis_token=<jwt>` for the seeded client (`client@tovis.app`), signed with the target's `JWT_SECRET`. |

Only `STAGING_BASE_URL` is manual — it's inherently your deployment URL. The other
three are produced for you by the fixtures script (no DB queries, no browser
cookie hunting). Manual fallbacks, if you ever need them:

- `LOAD_TEST_PROFESSIONAL_ID`: `SELECT id FROM "ProfessionalProfile" WHERE handle = 'tovis-test-pro';`
- `LOAD_TEST_SERVICE_ID`: a `serviceId` from `SELECT "serviceId" FROM "ProfessionalServiceOffering" WHERE "professionalId" = '<that id>' LIMIT 1;`
- `LOAD_TEST_CLIENT_COOKIE`: log in as a client on staging → DevTools → Application → Cookies → copy the **`tovis_token`** cookie as `tovis_token=<value>`.

## One-time setup

1. **Provision an isolated staging DB** — a separate Supabase project (NOT the prod
   pooler). ⚠️ As of 2026-06-22 `.env.staging.local` points `DATABASE_URL` at the
   **prod** project (`postgres.rqhhvuaoksuvbvlypztn`) and carries the **live** Twilio
   account — running a load proof against it would mutate prod and bill real SMS.
   This must be fixed before a deployed proof.
2. **Deploy a staging build** (Vercel *preview*) pointed at that non-prod DB, with
   **`LOAD_TEST_DISABLE_REAL_DELIVERY=1`** set in the preview env. The kill switch
   engages on preview (not production), so signup load sends **zero** real SMS/email
   — no Twilio sub-account or Postmark sandbox needed for the signup proof. (Real
   delivery is covered by the separate deployed *smoke* proof.)
3. **Seed that DB**: run `pnpm seed` with the staging `DATABASE_URL` loaded (creates
   the `tovis-test-pro` pro, the `client@tovis.app` client, and offerings).

When you run the harness, set `LOAD_TEST_DELIVERY_SAFE=1` (the preflight requires it)
— justified because the preview deploy suppresses real delivery.

## Run it

```sh
# 1. Derive the fixtures (run with the STAGING DATABASE_URL + JWT_SECRET loaded,
#    so the minted cookie validates against staging):
dotenv -e .env.staging.local -- pnpm loadproof:fixtures
#    → prints LOAD_TEST_PROFESSIONAL_ID / LOAD_TEST_SERVICE_ID / LOAD_TEST_CLIENT_COOKIE

# 2. Put those + STAGING_BASE_URL into .env.staging.local (or export them):
#    STAGING_BASE_URL=https://<your-staging-deploy>.vercel.app
#    LOAD_TEST_PROFESSIONAL_ID=...
#    LOAD_TEST_SERVICE_ID=...
#    LOAD_TEST_CLIENT_COOKIE=tovis_token=...

# 3. Run the launch suite against staging:
dotenv -e .env.staging.local -- pnpm verify:launch-ops
#    (or just: dotenv -e .env.staging.local -- pnpm test:load:launch)
```

`loadproof:fixtures` accepts `--export` to print shell `export ` lines, and honors
`LOAD_TEST_PRO_HANDLE` / `LOAD_TEST_CLIENT_EMAIL` overrides if your seed differs.

## "Complete" criteria

- All **8** launch load steps report **passed / 0 failed / 0 skipped** against staging.
- Hit the launch traffic profile (per `load-test-plan.md`: **10 → 50 → 100 RPS** for
  60s each; stress 150–250 RPS for hardening), with no real errors and acceptable
  p95/p99 (the scripts compute percentiles).
- **Record the run** in `docs/launch-readiness/test-proof.md` (commit SHA + results),
  matching the existing local-proof record. That recorded staging run is the proof.
