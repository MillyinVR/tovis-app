// ⚠️ Do NOT add `import 'server-only'` here. It is the obvious guard against
// the leak this module caused (the `@/lib/time` barrel pulled it into 124
// client components), and it does not work in this repo: `server-only` is not
// an installed package — Next aliases it internally, vitest aliases it to
// test/mocks/server-only.ts, and NOTHING else resolves it. 14 CLI entry points
// import this module (scripts/backfill-*, scripts/create-super-admin,
// prisma/seeds/*), and under `tsx` the specifier either fails to resolve or,
// if the real package were installed, throws on import — its `main` is a bare
// `throw`, and only the `react-server` export condition maps to the empty
// module. Tried it: `pnpm run backfill:search-index` dies with
// "Cannot find module 'server-only'" before the script's first line.
//
// Re-confirmed 2026-08-28 by running it, not by reading this comment: adding
// the import here makes `npx tsx scripts/backfill-search-index.ts --dry-run`
// die with MODULE_NOT_FOUND before its first line. Still true.
//
// `prisma/scripts/_serverOnlyCjsHook.cjs` DOES shim the specifier (three
// scripts already run under it), and with every entry point rewired to
// `NODE_OPTIONS="--import tsx --require ./prisma/scripts/_serverOnlyCjsHook.cjs"`
// an `import 'server-only'` here works — verified. That was not adopted: it only
// covers invocations that go through the hooked npm script: a direct
// `npx tsx scripts/<name>.ts`, which is how these are normally driven, would
// still break, and a guard that depends on how you launched a process is not a
// guard.
//
// The boundary is enforced instead by keeping server-only concerns in
// server-only modules (see lib/booking/timeZoneTruth.ts), by not letting a
// client-safe barrel re-export anything that reaches here, and — since #1027
// was found by accident and nothing would have reported the next one — by
// `tools/check-no-client-prisma-import.mjs`, which fails the build if any
// client component can reach this module through a value import.
import { PrismaClient } from '@prisma/client'
import { globalRegistry } from './typed'

const globalForPrisma = globalRegistry<{
  prisma: PrismaClient
  prismaRead: PrismaClient
}>()

const PRISMA_LOG: ('query' | 'error' | 'warn')[] =
  process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: PRISMA_LOG })

// Read-replica client — used by hot read routes (discover, availability,
// public profile, openings) to keep the primary's connection budget for
// writes.
//
// When `DATABASE_URL_READ` is unset (dev, test, single-instance prod) this
// falls back to the primary client. Code that uses `prismaRead` works in
// both environments without conditional logic at the call site.
//
// Read-after-write caveat: replica lag is typically 1–5s on managed
// Postgres. Routes that read state the user just wrote should stay on
// the primary `prisma` client. See lib/cache/versionedCache.ts for the
// cache layer that goes in front of `prismaRead`.
const READ_URL = process.env.DATABASE_URL_READ?.trim() || ''

export const prismaRead: PrismaClient =
  globalForPrisma.prismaRead ??
  (READ_URL
    ? new PrismaClient({ log: PRISMA_LOG, datasourceUrl: READ_URL })
    : prisma)

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  if (prismaRead !== prisma) {
    globalForPrisma.prismaRead = prismaRead
  }
}

export default prisma
