// tests/integration/media-asset-crop-rect.test.ts
//
// Real-Postgres coverage for the non-destructive publish crop (capture chain
// item 2).
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/media-asset-crop-rect.test.ts \
//     --config vitest.integration.config.mts
//
// This one HAS to run against real Postgres. Everything else about the crop —
// the geometry, the consent bound, the DTO threading — is unit-tested against
// mocks, and a mocked Prisma client will happily "store" a column that does not
// exist. What only a real database can answer:
//
//   1. The migration actually created cropX/cropY/cropW/cropH, as nullable
//      double precision, and the generated client agrees with them. A schema
//      that drifted from its migration typechecks perfectly and then throws
//      "The column MediaAsset.cropX does not exist" the first time a route runs.
//   2. A rect survives the float8 round-trip byte-for-byte. The re-frame route
//      puts the previously-stored rect in its updateMany WHERE as an equality
//      guard against a concurrent widening — if a stored double came back even
//      one ULP different, that guard would silently never match and every
//      re-frame would 409.
//   3. RLS. A NEW TABLE needs its own grant and nothing but the integration
//      suite catches a missing one; a new COLUMN on a table that already has
//      RLS inherits it. This asserts that rather than assuming it, so the
//      claim in the migration's header is checked and not merely argued.
//
// Legacy rows stay NULL = "the full stored frame", which is what makes this
// change invisible until something writes a rect.

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

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with the test DB harness.')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `mcrop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

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
      firstName: 'Crop',
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

const CROP_SELECT = {
  id: true,
  cropX: true,
  cropY: true,
  cropW: true,
  cropH: true,
} as const

async function createAsset(
  suffix: string,
  crop?: { cropX: number; cropY: number; cropW: number; cropH: number },
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
      ...(crop ?? {}),
    },
    select: CROP_SELECT,
  })
}

describe('MediaAsset crop rect columns', () => {
  it('defaults to NULL — the full stored frame, so legacy rows are unchanged', async () => {
    const asset = await createAsset('nocrop')

    expect(asset.cropX).toBeNull()
    expect(asset.cropY).toBeNull()
    expect(asset.cropW).toBeNull()
    expect(asset.cropH).toBeNull()
  })

  it('stores and reads back a rect through the generated client', async () => {
    const asset = await createAsset('withcrop', {
      cropX: 0.25,
      cropY: 0.1,
      cropW: 0.5,
      cropH: 0.4,
    })

    const read = await db.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
      select: CROP_SELECT,
    })

    expect(read).toEqual({
      id: asset.id,
      cropX: 0.25,
      cropY: 0.1,
      cropW: 0.5,
      cropH: 0.4,
    })
  })

  // 🔴 The re-frame route guards against a concurrent widening by putting the
  // rect it read into the updateMany WHERE. That is an EQUALITY comparison on a
  // float8, so a value that did not survive the round-trip exactly would make
  // the guard match nothing and 409 every honest re-frame. This is that
  // round-trip, with a coordinate that has no exact binary representation.
  it('round-trips a float8 rect exactly, so the concurrency guard can match on it', async () => {
    const rect = { cropX: 0.1, cropY: 0.7, cropW: 0.3, cropH: 0.15 }
    const asset = await createAsset('float', rect)

    const matched = await db.mediaAsset.updateMany({
      where: { id: asset.id, ...rect },
      data: { cropW: 0.2 },
    })

    expect(matched.count).toBe(1)
  })

  // The other half of that guard: a stale rect must match NOTHING, which is what
  // turns a lost race into a 409 instead of a silent overwrite.
  it('matches nothing when the WHERE carries a rect the row no longer holds', async () => {
    const asset = await createAsset('stale', {
      cropX: 0.2,
      cropY: 0.2,
      cropW: 0.6,
      cropH: 0.6,
    })

    const matched = await db.mediaAsset.updateMany({
      where: { id: asset.id, cropX: 0.2, cropY: 0.2, cropW: 0.5, cropH: 0.6 },
      data: { cropW: 0.1 },
    })

    expect(matched.count).toBe(0)
  })

  // A never-re-framed row is guarded by `crop* IS NULL`, not by an equality —
  // Prisma turns a literal `null` filter into IS NULL, and if it ever dropped it
  // as "no filter" instead, the first re-frame would lose its guard entirely.
  it('guards a never-re-framed row with IS NULL rather than dropping the filter', async () => {
    const target = await createAsset('null-guard')
    const other = await createAsset('null-guard-other', {
      cropX: 0.2,
      cropY: 0.2,
      cropW: 0.6,
      cropH: 0.6,
    })

    const matched = await db.mediaAsset.updateMany({
      where: {
        id: { in: [target.id, other.id] },
        cropX: null,
        cropY: null,
        cropW: null,
        cropH: null,
      },
      data: { cropX: 0, cropY: 0, cropW: 1, cropH: 1 },
    })

    // Only the crop-less row. If the null filters were dropped, both would match.
    expect(matched.count).toBe(1)
  })

  // The migration adds COLUMNS to a table that already has RLS. RLS is a
  // table-level property in this database (enabled with no policies = deny-all,
  // the app connects as a BYPASSRLS role), so the new columns inherit it and no
  // new grant is needed — the focal-point migration added none either. Asserted
  // rather than argued.
  it('inherits the table RLS that a new column cannot be granted separately', async () => {
    const rls = await db.$queryRaw<Array<{ relrowsecurity: boolean }>>(Prisma.sql`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'MediaAsset'
    `)

    expect(rls).toEqual([{ relrowsecurity: true }])
  })

  // ⚠️ Named explicitly rather than `LIKE 'crop%'`. The undo window (item 4)
  // added cropUndoBoundX/Y/W/H, cropUndoExpiresAt and cropUndoViewBaseline, which
  // a prefix match swept in — turning a precise claim about the RECT into a list
  // that has to be edited every time any crop-ish column is added, and failing
  // for a reason that has nothing to do with what this test is about. Those
  // columns have their own file.
  it('created all four RECT columns as nullable double precision', async () => {
    const columns = await db.$queryRaw<
      Array<{ column_name: string; data_type: string; is_nullable: string }>
    >(Prisma.sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'MediaAsset'
        AND column_name IN ('cropX', 'cropY', 'cropW', 'cropH')
      ORDER BY column_name
    `)

    expect(columns).toEqual([
      { column_name: 'cropH', data_type: 'double precision', is_nullable: 'YES' },
      { column_name: 'cropW', data_type: 'double precision', is_nullable: 'YES' },
      { column_name: 'cropX', data_type: 'double precision', is_nullable: 'YES' },
      { column_name: 'cropY', data_type: 'double precision', is_nullable: 'YES' },
    ])
  })
})
