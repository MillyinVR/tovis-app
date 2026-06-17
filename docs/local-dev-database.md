# Local development database

**Local development runs against a Dockerized Postgres on your machine — never
the production database.** This document explains the setup and why it exists.

## Why

`DATABASE_URL` in `.env.local` points at the **production** Supabase project
(`tovis-dev`, ref `rqhhvuaoksuvbvlypztn`). There is no separate "dev" database —
the Supabase project named "dev" *is* prod and holds real users and bookings.

That means an ordinary `prisma db push`, `prisma migrate dev`, or even
`prisma studio` would mutate production. On 2026-06-17 a stray `db push` during
feature work added enum values to prod out-of-band, which then collided with
`prisma migrate deploy` on the next deploy and **blocked all production deploys**
until the migration history was hand-repaired.

To make that class of mistake impossible, local dev uses an isolated Postgres.

## How it works

Two mechanisms keep local Prisma/Next off prod:

1. **`.env.development.local`** (git-ignored, on your machine only) defines
   `DATABASE_URL`/`DIRECT_URL` pointing at `localhost:5434/tovis_dev`.
   - Next.js loads `.env.development.local` **above** `.env.local` in dev, so
     `next dev` uses the local DB.
   - `prisma.config.ts` loads it **first** for Prisma CLI commands. (Node's
     `process.loadEnvFile` doesn't override already-set vars, so first-loaded
     wins — the local DB beats the prod `.env.local`.)

2. **A guard in `prisma.config.ts`** refuses any DB-touching Prisma CLI command
   (`db push|pull|execute|seed`, `migrate`, `studio`) when `DATABASE_URL` or
   `DIRECT_URL` points at the prod ref — unless you're on Vercel or pass
   `ALLOW_PROD_DB=1`. `prisma generate` is never blocked (it doesn't connect).

On Vercel the dev file doesn't exist and is skipped, so production migrations
(`prisma migrate deploy`) still run normally on deploy.

## One-time setup

Requires Docker Desktop running.

```bash
pnpm db:dev:up      # start the local Postgres container (port 5434, db tovis_dev)
pnpm db:dev:setup   # wait for it, push the schema, seed dev data
```

Then just:

```bash
pnpm dev            # runs against the local DB
```

`.env.development.local` is created automatically the first time this is set up;
if it's missing, create it with:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/tovis_dev"
DIRECT_URL="postgresql://postgres:postgres@localhost:5434/tovis_dev"
```

## Day-to-day commands

| Command | What it does |
| --- | --- |
| `pnpm db:dev:up` | Create + start the dev Postgres container |
| `pnpm db:dev:start` / `pnpm db:dev:stop` | Start/stop the existing container |
| `pnpm db:dev:down` | Remove the container (wipes the dev DB) |
| `pnpm db:dev:push` | Sync `schema.prisma` to the local DB (`prisma db push`) |
| `pnpm db:dev:seed` | Seed local dev data |
| `pnpm db:dev:setup` | `wait → push → seed` (full bring-up) |
| `pnpm db:dev:studio` | Prisma Studio against the local DB |

The test database (`db:test:*`, port 5433, `tovis_test`) is separate and
unchanged — integration tests keep using it.

## When you actually need prod

Routine schema changes reach prod automatically: commit a migration, merge, and
the production deploy runs `prisma migrate deploy`.

For deliberate, exceptional prod DB access from the CLI, set `ALLOW_PROD_DB=1`
explicitly (and prefer the Supabase MCP / dashboard for one-off fixes). Never
run `prisma db push` against prod — it bypasses migration history and is what
caused the 2026-06-17 incident.
