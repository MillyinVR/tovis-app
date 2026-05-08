import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaRead?: PrismaClient
}

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
