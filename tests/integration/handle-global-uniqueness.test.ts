// tests/integration/handle-global-uniqueness.test.ts
//
// Real-Postgres proof that a public `@handle` is unique across the WHOLE app,
// not just within one table.
//
//   pnpm test:integration
//
// Why this needs a real database: the bug is the ABSENCE of a constraint.
// `ProfessionalProfile.handleNormalized` and `ClientProfile.handleNormalized`
// each carry their own `@unique`, which makes a handle unique *within* a table
// and says nothing across them. A mocked prisma cannot fail this test — only a
// real index can.
//
// Why it matters: `app/(main)/looks/_components/LookOverlays.tsx` renders
//   posterName = clientAuthor ? `@${clientAuthor.handle}` : proDisplayName
// so a client-authored look and a pro-authored look appear in ONE feed as the
// same `@handle` with no type marker. A client claiming a well-known pro's
// handle is an impersonation vector, not a cosmetic collision.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient, Role, VerificationStatus } from '@prisma/client'

import { claimHandle, releaseHandle } from '@/lib/handles/registry'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `handleuniq_${Date.now()}`
const HANDLE = `${TAG}-shared`.toLowerCase().slice(0, 24)

let tenantId = ''
let professionalId = ''
let clientProfileId = ''

async function seed() {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS' },
    select: { id: true },
  })
  tenantId = tenant.id

  const proUser = await db.user.create({
    data: {
      email: `${TAG}-pro@example.test`,
      password: 'x',
      role: Role.PRO,
      professionalProfile: {
        create: {
          homeTenantId: tenantId,
          verificationStatus: VerificationStatus.APPROVED,
        },
      },
    },
    select: { professionalProfile: { select: { id: true } } },
  })
  professionalId = proUser.professionalProfile!.id

  const clientUser = await db.user.create({
    data: {
      email: `${TAG}-client@example.test`,
      password: 'x',
      role: Role.CLIENT,
      clientProfile: { create: { homeTenantId: tenantId } },
    },
    select: { clientProfile: { select: { id: true } } },
  })
  clientProfileId = clientUser.clientProfile!.id
}

async function cleanup() {
  // Profiles first: ProfessionalProfile.user carries no onDelete, so deleting
  // the User straight off violates ProfessionalProfile_userId_fkey. Scoped by
  // TAG rather than by the id variables so a run that failed mid-seed still
  // clears its own rows instead of confounding the next one.
  const users = await db.user.findMany({
    where: { email: { startsWith: TAG } },
    select: { id: true },
  })
  const userIds = users.map((user) => user.id)
  if (userIds.length === 0) return

  await db.professionalProfile.deleteMany({ where: { userId: { in: userIds } } })
  await db.clientProfile.deleteMany({ where: { userId: { in: userIds } } })
  await db.user.deleteMany({ where: { id: { in: userIds } } })
}

beforeEach(async () => {
  await cleanup()
  await seed()
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('global handle namespace', () => {
  it('refuses a client claiming a handle a pro already holds', async () => {
    await claimHandle(db, HANDLE, { kind: 'PRO', professionalId })

    // THE BUG: before HandleRegistration existed this resolved happily, because
    // ClientProfile's own unique index knows nothing about ProfessionalProfile.
    await expect(
      claimHandle(db, HANDLE, { kind: 'CLIENT', clientProfileId }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const holder = await db.handleRegistration.findUnique({
      where: { handleNormalized: HANDLE },
      select: { professionalId: true, clientProfileId: true },
    })
    expect(holder).toEqual({ professionalId, clientProfileId: null })
  })

  it('refuses a pro claiming a handle a client already holds', async () => {
    await claimHandle(db, HANDLE, { kind: 'CLIENT', clientProfileId })

    await expect(
      claimHandle(db, HANDLE, { kind: 'PRO', professionalId }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('lets an owner re-claim the handle it already holds (idempotent save)', async () => {
    await claimHandle(db, HANDLE, { kind: 'PRO', professionalId })
    await expect(
      claimHandle(db, HANDLE, { kind: 'PRO', professionalId }),
    ).resolves.toBeUndefined()
  })

  it('frees the handle for anyone else once released', async () => {
    await claimHandle(db, HANDLE, { kind: 'PRO', professionalId })
    await releaseHandle(db, { kind: 'PRO', professionalId })

    await expect(
      claimHandle(db, HANDLE, { kind: 'CLIENT', clientProfileId }),
    ).resolves.toBeUndefined()
  })

  it('holds ONE handle per owner — claiming a new one drops the old', async () => {
    const second = `${HANDLE}2`.slice(0, 24)
    await claimHandle(db, HANDLE, { kind: 'PRO', professionalId })
    await claimHandle(db, second, { kind: 'PRO', professionalId })

    const rows = await db.handleRegistration.findMany({
      where: { professionalId },
      select: { handleNormalized: true },
    })
    expect(rows).toEqual([{ handleNormalized: second }])
  })

  it('refuses a registration owned by nobody, and one owned by both', async () => {
    // The CHECK constraint: exactly one owner column may be set. Without it a
    // stray row could squat a handle with no way to reach or release it.
    await expect(
      db.handleRegistration.create({ data: { handleNormalized: `${TAG}-orphan`.slice(0, 24) } }),
    ).rejects.toThrow()

    await expect(
      db.handleRegistration.create({
        data: { handleNormalized: `${TAG}-both`.slice(0, 24), professionalId, clientProfileId },
      }),
    ).rejects.toThrow()
  })
})
