# Runbook: Database Backup & Restore

How to recover the production Postgres after data loss — an accidental
destructive migration, a bad bulk write, a dropped table, or corruption.
Pairs with `docs/runbooks/postgres-outage.md` (availability incidents — when the
DB is *up but unreachable*) and `docs/runbooks/deploy-and-rollback.md`.

> **Scope.** This runbook is about *getting data back*. If the database is
> merely unreachable or degraded, use `postgres-outage.md` first — a restore is
> a last resort, not a reachability fix.

## Facts about this database

- **Prod database = Supabase** project `tovis-dev`, ref `rqhhvuaoksuvbvlypztn`,
  region `us-west-2`. The app connects via the pooled `DATABASE_URL`; Prisma
  migrate uses `DIRECT_URL`.
- **dev/prod isolation (already in place).** Local dev runs against a Dockerized
  Postgres (`localhost:5434/tovis_dev`) via `.env.development.local`, which Next
  and the Prisma CLI load *above* `.env.local`. `prisma.config.ts` additionally
  refuses any db-touching Prisma CLI command (`db push/pull/execute/seed`,
  `migrate`, `studio`) that targets the prod ref unless `ALLOW_PROD_DB=1`. See
  `docs/local-dev-database.md`. **This makes accidental destruction unlikely —
  but not impossible** (a deliberate `ALLOW_PROD_DB=1`, a Supabase-console
  action, or an app-level bulk bug can still lose data), which is why this
  runbook exists.

## Backup posture (verify this is true — see "Operator setup" below)

| Layer | Mechanism | Recovery window | Granularity |
| --- | --- | --- | --- |
| **PITR** | Supabase Point-in-Time Recovery (WAL) | retention window (e.g. 7 days) | any second within window |
| **Daily backups** | Supabase automated daily snapshot | last N days | whole-DB, per-day |
| **Pre-migration logical dump** | `pg_dump` taken by the operator before a risky change | the moment it was taken | whole-DB or per-table |

PITR is the primary tool: it restores to a *new* project/branch at a chosen
timestamp without overwriting the live DB, so you can diff before cutting over.

## Decision tree

```
Data loss confirmed?
├─ Known bad timestamp (when did it happen)?
│   ├─ Within PITR retention  → RESTORE A: PITR to a branch, verify, cut over
│   └─ Older than retention   → RESTORE B: latest daily snapshot + replay
├─ Only a few rows / one table?
│   └─ RESTORE C: surgical restore from a PITR branch or dump (no full cutover)
└─ Have a pre-change pg_dump?
    └─ RESTORE D: logical restore of the affected objects
```

**Always restore to a NON-PROD target first** (a Supabase branch or a scratch
project), verify, then promote/cut over. Never restore in place as the first
move — it destroys the forensic state and any chance of a partial recovery.

## RESTORE A — PITR to a branch (preferred)

1. **Freeze writes if loss is ongoing.** If a bad job/loop is still corrupting
   data, stop it: disable the offending cron in `vercel.json` (deploy) or
   roll back the app per `deploy-and-rollback.md`. Note the *last-known-good*
   timestamp (UTC).
2. **Create a restore target via Supabase** (dashboard → Database → Backups →
   Point in Time, or the Supabase MCP / CLI): restore to the last-known-good
   timestamp into a **new branch/project**, not over prod.
3. **Verify the restored data.** Connect to the restored target and sanity-check
   the affected tables — row counts, the specific records that were lost,
   `_prisma_migrations` head matches the deployed code's expected migration.
   ```bash
   # against the RESTORED target's connection string
   ALLOW_PROD_DB=1 DATABASE_URL=<restored-url> DIRECT_URL=<restored-url> \
     npx prisma migrate status
   ```
4. **Reconcile the gap.** Anything written to prod *after* the restore point is
   not in the restored copy. Decide: (a) accept the loss of that window, or
   (b) export those rows from live prod and re-apply them onto the restored copy
   before cutover. Booking/payment rows in the gap need special care — see
   "Payment & booking consistency" below.
5. **Cut over.** Repoint the app's `DATABASE_URL`/`DIRECT_URL` (Vercel env) to
   the restored target, or promote the branch per Supabase's promote flow.
   Redeploy. Confirm `/api/health/ready` is green.
6. **Post-cutover:** re-enable any frozen crons, verify Stripe/Twilio/Postmark
   webhooks still resolve bookings (they key by Stripe id / token, not row id,
   so they survive a restore), and run the Stripe reconciliation cron once
   manually to heal any payment drift introduced by the gap.

## RESTORE B — Daily snapshot (loss older than PITR window)

Same shape as RESTORE A but the recovery point is a whole-day snapshot, so the
gap is larger. Restore the latest snapshot before the loss to a branch, verify,
reconcile the (bigger) gap, cut over.

## RESTORE C — Surgical (a few rows / one table)

Don't cut over the whole DB for a small loss.

1. Restore a PITR branch (RESTORE A steps 1–3) to a scratch target.
2. `pg_dump` only the affected table(s) from the scratch target:
   ```bash
   pg_dump --data-only --table='"Booking"' "<restored-url>" > booking_recovered.sql
   ```
3. Re-apply onto live prod **carefully** — prefer `INSERT ... ON CONFLICT DO
   NOTHING` / a targeted `UPDATE`, never a blind `TRUNCATE`+load. Run inside a
   transaction and `SELECT` to confirm before `COMMIT`. Use the Supabase MCP /
   SQL editor (audited) for prod writes rather than a local CLI.

## RESTORE D — From a pre-change logical dump

If an operator took `pg_dump` before a risky change:
```bash
# restore the whole dump to a scratch DB, then cherry-pick per RESTORE C
pg_restore --no-owner --dbname="<scratch-url>" pre_change.dump
```
Never `pg_restore` directly over prod.

## Payment & booking consistency after a restore

A restore can resurrect or drop rows that Stripe already moved money against.
After any cutover:

1. Run the **Stripe reconciliation cron** (`/api/internal/jobs/stripe-reconciliation`)
   manually — it pulls each booking's PaymentIntent and heals captured/refunded
   drift against local state.
2. Run **orphan recovery** (`/api/internal/jobs/stripe-orphan-recovery`) — it
   re-applies any `payment_intent.succeeded` that the restored DB is missing.
3. Replay failed webhook events (`/api/internal/jobs/stripe-webhook-requeue`).
4. Spot-check that no booking in the restore gap shows `SUCCEEDED` locally while
   Stripe shows refunded/disputed, or vice-versa.

## Operator setup (do this BEFORE you need it)

These are the prerequisites that make the above possible. **Confirm each is
true; this runbook is only as good as the backups behind it.**

- [ ] **PITR is enabled** on the prod project and the retention window is known
      and documented here: ______ days. (Supabase dashboard → Database →
      Backups. PITR is a paid add-on — confirm it's actually on, not just
      daily backups.)
- [ ] **Daily backups** are enabled and retention is known: ______ days.
- [ ] A **restore drill has been run** at least once (restore to a branch,
      verify row counts, tear down) and the wall-clock time it took is recorded
      here: ______. An untested backup is a hope, not a plan.
- [ ] The **Supabase project owner** and the break-glass access path are known
      (who can trigger a restore at 3am).
- [ ] Before any *deliberate* risky prod change (manual migration, bulk
      backfill, `ALLOW_PROD_DB=1` work), take a **pre-change `pg_dump`** and keep
      it until the change is proven safe.

## Related

- `docs/runbooks/postgres-outage.md` — DB up but unreachable (do this first).
- `docs/runbooks/deploy-and-rollback.md` — backing out a bad deploy / freezing writes.
- `docs/local-dev-database.md` — why local dev can't touch prod.
- `docs/runbooks/stripe-degradation.md` — payment reconciliation detail.
