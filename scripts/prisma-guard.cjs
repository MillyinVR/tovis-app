#!/usr/bin/env node
//
// prisma-guard — a thin wrapper around the Prisma CLI that refuses to run
// schema-destructive commands against a production-looking database.
//
// WHY THIS EXISTS
// ---------------
// `.env.local` points at the PRODUCTION Supabase database. That makes a
// muscle-memory `prisma db push` / `prisma migrate dev` / `prisma migrate reset`
// from the repo root a one-keystroke way to mutate or wipe production. The
// existing `_safe-script-guard.cjs` only protects our own `.cjs` scripts
// (seed, repair-*) — it never sees the Prisma CLI. This wrapper closes that gap
// for every path that routes through `npm run db:push` / `migrate:dev` /
// `migrate:reset` (and the generic `npm run db:guard -- <args>`).
//
// PRIMARY GUARD IS `prisma.config.ts`: it is loaded by the Prisma CLI itself,
// so it catches even a raw `npx prisma db push` typed directly — it loads
// `.env.development.local` (local dev DB) above `.env.local`, and refuses any
// db-touching command that targets the prod ref unless `ALLOW_PROD_DB=1`. See
// `docs/local-dev-database.md`. This `.cjs` wrapper is a complementary
// defense-in-depth layer for the npm-script paths; the host-based check below
// still adds value when someone runs `npm run db:push` with a prod URL in env.
//
// `migrate deploy` is intentionally NOT guarded — it is the sanctioned
// production migration path invoked by the Vercel build, and it only applies
// already-committed migrations.

const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  databaseLooksProduction,
  describeDatabaseHost,
} = require('./_safe-script-guard.cjs')

// Prisma subcommands that can mutate schema or destroy data on the target DB.
const DESTRUCTIVE_COMMANDS = new Set([
  'db push',
  'db execute',
  'migrate dev',
  'migrate reset',
])

// Map the CLI args to a "command subcommand" key, or null if it isn't one of
// the destructive commands we guard. Only the leading positional (non-flag)
// tokens matter — `migrate dev --name x` → "migrate dev".
function destructiveKey(args) {
  const positional = args.filter((token) => !token.startsWith('-'))
  if (positional.length === 0) return null
  const [command, subcommand] = positional
  const key = subcommand ? `${command} ${subcommand}` : command
  return DESTRUCTIVE_COMMANDS.has(key) ? key : null
}

function resolvePrismaBin() {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = require(pkgPath)
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), binRel)
}

function main() {
  const args = process.argv.slice(2)
  const destructive = destructiveKey(args)

  if (destructive && databaseLooksProduction()) {
    const override = process.env.PRISMA_GUARD_ALLOW_PROD === '1'
    process.stderr.write(
      `\n✋ prisma-guard: \`prisma ${destructive}\` targets a PRODUCTION-looking database.\n` +
        `   DATABASE_URL host: ${describeDatabaseHost()}\n` +
        `   This command is destructive and dev/prod currently share a database.\n` +
        `   → Use a local DB instead:  npm run db:dev:setup  (then point DATABASE_URL at localhost)\n` +
        `   → Override only if you are CERTAIN of the target:  PRISMA_GUARD_ALLOW_PROD=1\n\n`,
    )
    if (!override) {
      process.exit(1)
    }
    process.stderr.write('   PRISMA_GUARD_ALLOW_PROD=1 set — proceeding against production target.\n\n')
  }

  const result = spawnSync(process.execPath, [resolvePrismaBin(), ...args], {
    stdio: 'inherit',
  })
  if (result.error) {
    process.stderr.write(`prisma-guard: failed to launch prisma: ${result.error.message}\n`)
    process.exit(1)
  }
  process.exit(result.status ?? 0)
}

if (require.main === module) {
  main()
}

module.exports = { destructiveKey, DESTRUCTIVE_COMMANDS }
