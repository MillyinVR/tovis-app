// tests/integration/media-asset-crop-undo-window.test.ts
//
// Real-Postgres coverage for the re-frame UNDO WINDOW (capture chain item 4).
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/media-asset-crop-undo-window.test.ts \
//     --config vitest.integration.config.mts
//
// The rule itself (lib/media/cropUndoWindow.ts) is unit-tested against mocks and
// the route is tested against a mocked Prisma. A mocked client will happily
// "store" a column that does not exist, so what only a real database answers:
//
//   1. The migration created cropUndoBound{X,Y,W,H} / cropUndoExpiresAt /
//      cropUndoViewBaseline with the types the generated client believes in. A
//      schema that drifted from its migration typechecks perfectly and then
//      throws "column does not exist" the first time a pro re-frames anything.
//   2. `cropUndoExpiresAt` round-trips as a real instant. The window is decided
//      by comparing it against `now`; a column that came back as a date-only or
//      in the wrong zone would open or shut the window by hours.
//   3. The bound survives the float8 round-trip byte-for-byte, for the same
//      reason the rect has to (tests/integration/media-asset-crop-rect.test.ts):
//      the whole consent decision is an inequality against these numbers.
//
// Every existing row has a NULL expiry, which reads as "no window open" — the
// pre-item-4 behaviour exactly.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MediaPhase,
  MediaType,
  MediaVisibility,
  Prisma,
  PrismaClient,
  Role,
  VerificationStatus,
} from '@prisma/client'

import { cropConsentBound, isCropUndoWindowOpen } from '@/lib/media/cropUndoWindow'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with the test DB harness.')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `mundo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

let professionalId = ''
let serviceId = ''

async function cleanup() {
  await db.mediaAsset.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.professionalProfile.deleteMany({ where: { businessName: `${TAG} Studio` } })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.service.deleteMany({ where: { name: `${TAG} Svc` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${TAG}-category` } })
}

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Undo',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })
  professionalId = professional.id

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Category`, slug: `${TAG}-category`, isActive: true },
    select: { id: true },
  })
  const service = await db.service.create({
    data: {
      name: `${TAG} Svc`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })
  serviceId = service.id
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

const UNDO_SELECT = {
  id: true,
  cropX: true,
  cropY: true,
  cropW: true,
  cropH: true,
  cropUndoBoundX: true,
  cropUndoBoundY: true,
  cropUndoBoundW: true,
  cropUndoBoundH: true,
  cropUndoExpiresAt: true,
  cropUndoViewBaseline: true,
} as const

async function createAsset(
  suffix: string,
  data: Partial<Prisma.MediaAssetUncheckedCreateInput> = {},
) {
  return db.mediaAsset.create({
    data: {
      professionalId,
      primaryServiceId: serviceId,
      storageBucket: 'media-public',
      storagePath: `pro/${professionalId}/${TAG}_${suffix}.jpg`,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PUBLIC,
      phase: MediaPhase.OTHER,
      ...data,
    },
    select: UNDO_SELECT,
  })
}

describe('MediaAsset crop undo-window columns', () => {
  it('created every undo column with the type the client believes in', async () => {
    const columns = await db.$queryRaw<
      Array<{ column_name: string; data_type: string; is_nullable: string }>
    >(Prisma.sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'MediaAsset' AND column_name LIKE 'cropUndo%'
      ORDER BY column_name
    `)

    expect(columns).toEqual([
      { column_name: 'cropUndoBoundH', data_type: 'double precision', is_nullable: 'YES' },
      { column_name: 'cropUndoBoundW', data_type: 'double precision', is_nullable: 'YES' },
      { column_name: 'cropUndoBoundX', data_type: 'double precision', is_nullable: 'YES' },
      { column_name: 'cropUndoBoundY', data_type: 'double precision', is_nullable: 'YES' },
      {
        column_name: 'cropUndoExpiresAt',
        data_type: 'timestamp without time zone',
        is_nullable: 'YES',
      },
      { column_name: 'cropUndoViewBaseline', data_type: 'integer', is_nullable: 'YES' },
    ])
  })

  it('leaves a legacy row with no window — the pre-item-4 behaviour exactly', async () => {
    const asset = await createAsset('legacy')

    expect(asset.cropUndoExpiresAt).toBeNull()
    expect(asset.cropUndoViewBaseline).toBeNull()
    expect(
      isCropUndoWindowOpen(asset, { now: new Date(), viewCountTotal: 0 }),
    ).toBe(false)
  })

  it('round-trips the bound and the expiry well enough to decide on them', async () => {
    // 🔴 The whole consent decision is an inequality against these numbers and a
    // comparison against this instant. A float that shifted by an ULP or a
    // timestamp that came back in the wrong zone would move the bound or open
    // the window by hours, with nothing on screen to show for it.
    const expiresAt = new Date('2026-09-03T12:34:56.789Z')
    const asset = await createAsset('window', {
      cropX: 0.4,
      cropY: 0.4,
      cropW: 0.2,
      cropH: 0.2,
      cropUndoBoundX: 0.1,
      cropUndoBoundY: 0.15,
      cropUndoBoundW: 0.8,
      cropUndoBoundH: 0.7,
      cropUndoExpiresAt: expiresAt,
      cropUndoViewBaseline: 3,
    })

    const reread = await db.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
      select: UNDO_SELECT,
    })

    expect(reread.cropUndoBoundX).toBe(0.1)
    expect(reread.cropUndoBoundY).toBe(0.15)
    expect(reread.cropUndoBoundW).toBe(0.8)
    expect(reread.cropUndoBoundH).toBe(0.7)
    expect(reread.cropUndoExpiresAt?.toISOString()).toBe(expiresAt.toISOString())
    expect(reread.cropUndoViewBaseline).toBe(3)

    // Before the expiry, with no new views: the bound is the PRE-NARROWING frame.
    expect(
      cropConsentBound(reread, reread, {
        now: new Date('2026-09-03T00:00:00.000Z'),
        viewCountTotal: 3,
      }),
    ).toEqual({ x: 0.1, y: 0.15, w: 0.8, h: 0.7 })

    // After it: the stored rect, which is the one-way ratchet.
    expect(
      cropConsentBound(reread, reread, {
        now: new Date('2026-09-04T00:00:00.000Z'),
        viewCountTotal: 3,
      }),
    ).toEqual({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 })

    // And one view since the window opened shuts it just as hard as the clock.
    expect(
      cropConsentBound(reread, reread, {
        now: new Date('2026-09-03T00:00:00.000Z'),
        viewCountTotal: 4,
      }),
    ).toEqual({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 })
  })

  it('inherits the table RLS that a new column cannot be granted separately', async () => {
    // Same claim the crop-rect migration made: RLS here is a TABLE-level
    // property, so new COLUMNS on an already-covered table inherit it and it is
    // a new TABLE that needs its own grant. Asserted, not argued.
    const rls = await db.$queryRaw<Array<{ relrowsecurity: boolean }>>(Prisma.sql`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'MediaAsset'
    `)

    expect(rls).toEqual([{ relrowsecurity: true }])
  })
})
