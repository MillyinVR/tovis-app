// prisma.config.ts
import { defineConfig } from 'prisma/config'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Prisma does not automatically load .env.local when prisma.config.ts is used,
 * so we load the local env files here for Prisma CLI commands (db push, migrate,
 * studio, generate).
 *
 * IMPORTANT — `process.loadEnvFile` does NOT override variables that are already
 * set, so the FIRST file to define a var wins. We exploit that to keep the Prisma
 * CLI off production:
 *
 *   1. Parent process env vars (CI / explicit `DATABASE_URL=… npx prisma …`)
 *   2. .env.development.local   ← local dev DB (loaded first → wins on local machines)
 *   3. .env.local               ← points at the PRODUCTION Supabase DB
 *   4. .env
 *
 * Because .env.development.local is loaded before .env.local, a developer who has
 * brought up the local DB never has a Prisma CLI command touch prod. On Vercel the
 * dev file doesn't exist (and we skip it anyway), so production migrations still run.
 *
 * Full workflow: docs/local-dev-database.md
 */
const parentDatabaseUrl = process.env.DATABASE_URL
const parentDirectUrl = process.env.DIRECT_URL

const envFiles = process.env.VERCEL
  ? (['.env', '.env.local'] as const)
  : (['.env.development.local', '.env', '.env.local'] as const)

for (const filename of envFiles) {
  const envPath = path.join(process.cwd(), filename)

  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

if (parentDatabaseUrl !== undefined) {
  process.env.DATABASE_URL = parentDatabaseUrl
}

if (parentDirectUrl !== undefined) {
  process.env.DIRECT_URL = parentDirectUrl
}

/**
 * Safety net: refuse to run a SCHEMA-MUTATING / connecting Prisma CLI command
 * against the production database by accident. This is the guard that would have
 * prevented the 2026-06-17 incident (a stray `prisma db push` against prod).
 *
 * Only fires for db-touching commands (push/pull/execute/migrate/studio) — never
 * for `prisma generate` (postinstall), which doesn't connect to the DB. Allowed on
 * Vercel (where production migrations legitimately run) and with an explicit
 * `ALLOW_PROD_DB=1` opt-in.
 */
const PROD_DB_REF = 'rqhhvuaoksuvbvlypztn'
const cliTokens = process.argv.slice(2)
const isDbTouchingCommand =
  cliTokens.includes('migrate') ||
  cliTokens.includes('studio') ||
  (cliTokens.includes('db') &&
    cliTokens.some((t) => ['push', 'pull', 'execute', 'seed'].includes(t)))

// Check BOTH urls: `migrate`/`db push` connect via DIRECT_URL, the app via DATABASE_URL.
const targetsProd =
  (process.env.DATABASE_URL ?? '').includes(PROD_DB_REF) ||
  (process.env.DIRECT_URL ?? '').includes(PROD_DB_REF)

if (
  isDbTouchingCommand &&
  targetsProd &&
  !process.env.VERCEL &&
  process.env.ALLOW_PROD_DB !== '1'
) {
  throw new Error(
    [
      '',
      '⛔ Refusing to run a Prisma CLI command against the PRODUCTION database.',
      `   DATABASE_URL/DIRECT_URL points at the prod Supabase project (${PROD_DB_REF}).`,
      '',
      '   For local work, use the isolated local dev DB instead:',
      '     pnpm db:dev:up && pnpm db:dev:setup     # one-time bring-up',
      '   With .env.development.local present this is automatic.',
      '',
      '   If you REALLY intend to target prod, re-run with ALLOW_PROD_DB=1.',
      '',
    ].join('\n'),
  )
}

export default defineConfig({
  schema: './prisma/schema.prisma',
})
