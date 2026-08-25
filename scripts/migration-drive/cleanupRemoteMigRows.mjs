// scripts/migration-drive/cleanupRemoteMigRows.mjs
//
// One-time cleanup owed from earlier seed runs that hit the REMOTE dev
// Supabase DB (.env.local's pooler URL beats .env.development.local under tsx).
// Deletes the two stray mig_* User rows — ONLY those two.
//
// Safety: SELECTs every User with email LIKE 'mig\_%' first; if the set is not
// EXACTLY {mig_mt8zxrqa@example.com, mig_mt90cdcz@example.com}, prints what it
// found and exits non-zero WITHOUT deleting anything.

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const EXPECTED = new Set(['mig_mt8zxrqa@example.com', 'mig_mt90cdcz@example.com'])

// Point Prisma's datasource at the REMOTE pooler URL from .env.local, whatever
// the ambient env says.
for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*DATABASE_URL="?([^"\r\n]+)"?\s*$/)
  if (m) {
    process.env.DATABASE_URL = m[1]
    break
  }
}

const prisma = new PrismaClient()

const found = await prisma.user.findMany({
  where: { email: { startsWith: 'mig_' } },
  select: { id: true, email: true, role: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})
console.log('FOUND:', JSON.stringify(found, null, 2))

const exactMatch =
  found.length === EXPECTED.size && found.every((r) => EXPECTED.has(r.email))

if (!exactMatch) {
  console.error('ABORT: found rows are NOT exactly the two expected mig_* rows. Nothing deleted.')
  await prisma.$disconnect()
  process.exit(1)
}

const userIds = found.map((r) => r.id)
const profiles = await prisma.professionalProfile.findMany({
  where: { userId: { in: userIds } },
  select: { id: true },
})
if (profiles.length > 0) {
  const profileIds = profiles.map((p) => p.id)
  const locs = await prisma.professionalLocation.deleteMany({
    where: { professionalId: { in: profileIds } },
  })
  console.log('deleted ProfessionalLocation rows:', locs.count)
  const profs = await prisma.professionalProfile.deleteMany({
    where: { id: { in: profileIds } },
  })
  console.log('deleted ProfessionalProfile rows:', profs.count)
}

const del = await prisma.user.deleteMany({ where: { id: { in: userIds } } })
console.log('DELETED user rows:', del.count)

const after = await prisma.user.count({ where: { email: { startsWith: 'mig_' } } })
console.log('remaining mig_* users:', after)

await prisma.$disconnect()
