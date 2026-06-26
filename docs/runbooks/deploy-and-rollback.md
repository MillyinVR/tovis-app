# Runbook: Deploy & Rollback

How to ship Tovis to production and how to back out fast when a deploy goes bad.
Pairs with `docs/deployment-checklist.md` (pre-launch verification) and the
incident runbooks in this directory.

## Facts about this deployment

- **Host:** Vercel. Production region is pinned to `pdx1` (`vercel.json`).
- **Auto-deploy is DISABLED** (`vercel.json` → `git.deploymentEnabled: false`).
  A push to `main` does **not** deploy. Deploys are always manual.
- **Migrations run on deploy.** The build command runs
  `prisma migrate deploy` only when `VERCEL_ENV=production`, then `next build`.
  A migration that is committed will apply to the prod DB on the next prod
  deploy — there is no separate migrate step to forget, but also no dry run.
- **Prod database = Supabase** (project `tovis-dev`). The app connects via the
  pooled `DATABASE_URL`; Prisma migrate uses the unpooled `DIRECT_URL`
  (session pooler). NEVER run `prisma db push` against prod — see
  `scripts/prisma-guard.cjs` and the prod-DB memory notes.
- **Env vars** live in the Vercel project settings. Secrets marked *Sensitive*
  (PII keyrings, tokens) cannot be pulled back (`vercel env pull` returns blank
  for them). The production boot is fail-closed: a missing Sentry DSN, internal
  job/cron secret, or Postmark config crashes startup
  (`lib/observability/startupEnvValidation.ts`).

## Database connection pooling (Supabase)

Three connection vars, each with a distinct job. Misconfiguring them degrades
prod silently, so boot emits warnings (not fail-closed) for the two footguns
below — watch the deploy logs.

- **`DATABASE_URL` → pooler endpoint, with an explicit `?connection_limit=N`.**
  On serverless every instance opens its own Prisma pool (default
  `num_cpus*2+1`); under fan-out that overruns the pooler's max connections and
  reads start failing with "too many connections" (the deployed signup load
  proof hit the free-tier pooler `EMAXCONN` ceiling). Size `connection_limit` to
  `floor(pooler_max / expected_concurrent_instances)`. Boot warns
  `database_url_no_connection_limit` when the param is absent.
- **`DIRECT_URL` → direct or *session* pooler endpoint, port `5432`.** Prisma
  migrate takes a **session-scoped advisory lock**, which the **transaction**
  pooler (port `6543` / `pgbouncer=true`) cannot hold — `migrate deploy` hangs.
  Use `db.<ref>.supabase.co:5432` (direct) or the session pooler on `5432`; never
  the `:6543` transaction pooler. Boot warns `direct_url_on_transaction_pooler`
  if it sees `:6543` / `pgbouncer=true`.
- **`DATABASE_URL_READ` → read replica (optional).** Hot read paths (discover,
  availability, public profile) use `lib/prisma.ts` `prismaRead`; when this is
  set they hit the replica instead of the primary pool, preserving the primary's
  connection budget for writes. Unset → reads fall back to the primary client
  (correct, just no offload). Replica lag is 1–5s, so read-after-write paths stay
  on the primary `prisma` client by design.

## Pre-deploy checklist (every deploy)

```bash
npm run typecheck && npm run lint && npm run check:static-guards
npx vitest run            # full suite; the pre-push hook runs this too
```

- Confirm `main` is green in CI for the commit you're shipping.
- If the commit adds a Prisma migration, review the generated SQL and confirm it
  is **expand-phase safe** (additive / backwards-compatible) — the currently
  running build and the new one briefly share the DB.
- Skim `docs/deployment-checklist.md` for any launch-gated items.

## Deploy to production

```bash
# from a clean checkout of the commit you intend to ship
npx vercel@latest --prod
```

Vercel builds remotely: `prisma migrate deploy` → `next build`. Watch the build
logs for the migrate step and the build result.

### Post-deploy smoke (do not skip)

```bash
curl -s https://<prod-domain>/api/health        # expect ok / not degraded
curl -s https://<prod-domain>/api/health/ready  # readiness
```

- Verify a critical path manually (sign in, load a pro profile, open a booking).
- Watch Sentry for a spike in new issues for ~10 minutes.
- If the deploy added a cron, confirm it runs (Vercel → Cron) and returns 200,
  not 401 (would mean the job secret is missing) or 500.

## Rollback

A Vercel rollback re-promotes a previous **build** — it does **not** revert the
database. Migrations are forward-only.

### Fast path — promote the last good deployment

```bash
vercel ls --prod                 # find the previous good deployment URL
vercel promote <deployment-url>  # make it the production alias again
# or, most recent previous prod deploy:
vercel rollback
```

This swaps the alias back in seconds. Use it the moment a deploy is clearly bad.

### When the bad deploy included a migration

Code rolls back instantly; the schema does not. Because migrations are required
to be additive/expand-phase, the previous build keeps working against the new
schema in almost all cases — **prefer promoting the old build and leaving the
schema in place**. Only consider a down-migration if the new column/constraint
actively breaks the old code, and then:

1. Promote the previous good build first (stop the bleeding).
2. Write and apply a forward "fix" migration via `DIRECT_URL` — do **not** hand-
   edit prod tables ad hoc. If `_prisma_migrations` is wedged, the recovery
   procedure is in the prod-DB memory notes (update `finished_at` via the
   Supabase console).

### If startup is crash-looping

A fail-closed env crash (missing required var) presents as every request 500ing
right after deploy. Fix the env var in Vercel settings and redeploy, or roll back
to the previous build while you correct it.

## After any rollback

- Open an incident note: what shipped, what broke, what you promoted back to.
- Get `main` back to a known-good state before the next deploy attempt.
- If a migration is implicated, reconcile `_prisma_migrations` vs. the intended
  schema before deploying again.
