// scripts/dev/mint-dev-jwt.ts
//
// Mint a session JWT for a LOCAL dev user and print it to stdout.
//
// ## Why this exists
// Local sign-in is broken by design, not by bug: `POST /api/v1/auth/login` looks a
// user up by `emailHashV2` — a PII-keyring HMAC — so the seeded `client@tovis.app`
// 401s `INVALID_CREDENTIALS` under a different `PII_LOOKUP_HMAC_KEYS_JSON`, and
// resetting the password does NOT help (the lookup fails before the password
// compare). `getCurrentUser`, though, accepts any correctly-signed bearer token —
// so minting one sidesteps the broken lookup entirely.
//
// That unblocks driving an authed route with curl, and — the reason this exists —
// the iOS simulator, whose Keychain-backed bearer auth has no other way in. See
// `tovis-ios/scripts/sim-login.sh` and `TovisKit`'s `DebugSessionSeed`.
//
// ## Usage
//   pnpm dev:mint-jwt                          # client@tovis.app (the seeded client)
//   pnpm dev:mint-jwt --email pro@tovis.app
//   pnpm dev:mint-jwt --user-id usr_123
//   pnpm dev:mint-jwt --role PRO               # acting role claim (default: the user's own)
//
// Only the token goes to stdout, so `TOKEN="$(pnpm -s dev:mint-jwt)"` works; every
// human-readable line goes to stderr.
//
// ## Safety
// This mints a real credential, so it HARD-REFUSES any database that isn't local
// — no override env var, unlike the destructive-script guard. A token is only ever
// as dangerous as the data it addresses; pinning to localhost keeps it worthless.
import { createRequire } from 'node:module'
import { URL } from 'node:url'

import { loadEnvConfig } from '@next/env'

const require = createRequire(import.meta.url)

type SafeScriptGuard = {
  requireSafeScriptRun: (options: { scriptName: string }) => void
}

const SCRIPT_NAME = 'mint-dev-jwt'

/** Hosts a dev database can legitimately live on. */
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

function fail(message: string): never {
  console.error(`[${SCRIPT_NAME}] ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]): {
  email?: string
  userId?: string
  role?: string
} {
  const args: { email?: string; userId?: string; role?: string } = {}

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]

    switch (flag) {
      case '--email':
        if (!value) fail('--email needs a value.')
        args.email = value
        i += 1
        break
      case '--user-id':
        if (!value) fail('--user-id needs a value.')
        args.userId = value
        i += 1
        break
      case '--role':
        if (!value) fail('--role needs a value.')
        args.role = value.toUpperCase()
        i += 1
        break
      case '--help':
      case '-h':
        console.error(
          [
            'Mint a session JWT for a local dev user.',
            '',
            '  pnpm dev:mint-jwt                     # client@tovis.app',
            '  pnpm dev:mint-jwt --email a@b.com',
            '  pnpm dev:mint-jwt --user-id usr_123',
            '  pnpm dev:mint-jwt --role PRO',
            '',
            'Prints ONLY the token to stdout. Local databases only.',
          ].join('\n'),
        )
        process.exit(0)
        break
      default:
        fail(`Unknown argument "${flag}". Try --help.`)
    }
  }

  return args
}

/**
 * Refuse anything but a local database. Minting a credential for a shared or
 * production DB is a privilege-escalation tool, so this is an ALLOW-list (a
 * denylist of "production-looking" hosts fails open on anything it hasn't heard
 * of) and there is deliberately no override.
 */
function requireLocalDatabase(): void {
  const raw = process.env.DATABASE_URL
  if (!raw) fail('DATABASE_URL is missing — is .env.development.local present?')

  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    fail('DATABASE_URL is not a parseable URL.')
  }

  if (!LOCAL_DB_HOSTS.has(host)) {
    fail(
      `Refusing to mint a token against non-local database host "${host}".\n` +
        `  This script only ever runs against a local dev DB (${[...LOCAL_DB_HOSTS].join(', ')}).\n` +
        `  If you meant to target local dev, check which env file DATABASE_URL came from:\n` +
        `  .env.local holds the PROD Supabase URL — only .env.development.local is localhost.`,
    )
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  // `dev: true` forces Next's development precedence (.env.development.local >
  // .env.local) — the same files `pnpm dev` reads. Without it, .env.local's PROD
  // Supabase DATABASE_URL could win and the guard below would (correctly) refuse.
  loadEnvConfig(process.cwd(), true)

  const { requireSafeScriptRun } = require('../_safe-script-guard.cjs') as SafeScriptGuard
  requireSafeScriptRun({ scriptName: SCRIPT_NAME })
  requireLocalDatabase()

  // Imported AFTER loadEnvConfig: lib/auth throws at module scope when
  // JWT_SECRET is unset, so a static import would crash before env is loaded.
  const { createActiveToken } = await import('@/lib/auth')
  const { PrismaClient } = await import('@prisma/client')

  const prisma = new PrismaClient()

  try {
    const email = args.userId ? undefined : (args.email ?? 'client@tovis.app')

    const user = await prisma.user.findFirst({
      where: args.userId ? { id: args.userId } : { email },
      select: { id: true, role: true, authVersion: true },
    })

    if (!user) {
      fail(
        `No user matching ${args.userId ? `id "${args.userId}"` : `email "${email}"`}.\n` +
          `  Seed one first: pnpm exec node scripts/seed-e2e-client.mjs`,
      )
    }

    // Reuse the app's own signer rather than hand-rolling jwt.sign — that keeps
    // the claims, secret, and 7d expiry identical to a real login, so a minted
    // token can't drift from what the backend actually accepts.
    const token = createActiveToken({
      userId: user.id,
      role: args.role ? (args.role as typeof user.role) : user.role,
      authVersion: user.authVersion,
    })

    console.error(
      `[${SCRIPT_NAME}] minted for user ${user.id} (role ${args.role ?? user.role}), valid 7d`,
    )
    // stdout = the token ONLY, so command substitution works.
    console.log(token)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(`[${SCRIPT_NAME}]`, error instanceof Error ? error.message : error)
  process.exit(1)
})
