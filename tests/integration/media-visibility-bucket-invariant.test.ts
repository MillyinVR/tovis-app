// tests/integration/media-visibility-bucket-invariant.test.ts
//
// Real-Postgres coverage for the MediaAsset bucket/visibility invariant on the
// RETRACT paths.
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/media-visibility-bucket-invariant.test.ts \
//     --config vitest.integration.config.mts
//
// 🔴 Why this has to drive the real route handlers.
//
// `lib/media/recordMediaAsset.ts` has always refused `visibility = PRO_CLIENT`
// in the world-readable `media-public` bucket — on CREATE. Both retract paths
// UPDATE, and neither went through it: they each had a private
// `featured || looks ? PUBLIC : PRO_CLIENT` with no bucket in the calculation.
// So the invariant was unit-tested, green, and false in production: 3 rows with
// `visibility = PRO_CLIENT` over objects an unauthenticated GET returns in full
// (found 2026-09-01).
//
// A unit test of the resolver cannot catch that class of defect, because the
// defect was never in the resolver — it was in the route not calling one. What
// this asserts is the end state of the actual handler against a real database:
// retract a public-bucket asset, then read the row back and check the bucket
// and the column together.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

const TAG = `mvis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

let professionalId = ''
let serviceId = ''

// requirePro() is the only thing standing between the test and the handler;
// everything else in these routes is real (Prisma, the publication reconcile,
// the visibility boundary).
const mockRequirePro = vi.fn()

vi.mock('@/app/api/_utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/_utils')>()
  return { ...actual, requirePro: () => mockRequirePro() }
})

// Signing/rendering talks to Supabase storage; not what is under test here, and
// it would need a service-role key the test harness deliberately strips.
vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: async () => ({ renderUrl: null, renderThumbUrl: null }),
  renderMediaUrlsBatch: async (rows: unknown[]) =>
    rows.map(() => ({ renderUrl: null, renderThumbUrl: null })),
}))

// True retraction moves the BYTES, so the storage layer has to be present for
// the handler to complete a retract. This double records what was written and
// removed, which is how the tests below prove the public original was actually
// deleted rather than merely relabelled. `failEverything` drives the degraded
// path, where storage is unhealthy and the unpublish must still succeed.
const storage = vi.hoisted(() => ({
  uploaded: [] as Array<{ bucket: string; path: string }>,
  removed: [] as Array<{ bucket: string; path: string }>,
  failEverything: false,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: (bucket: string) => ({
        download: async () => {
          if (storage.failEverything) {
            return { data: null, error: { message: 'storage unavailable' } }
          }
          return {
            data: new Blob([new Uint8Array([1, 2, 3, 4])], {
              type: 'image/jpeg',
            }),
            error: null,
          }
        },
        upload: async (path: string) => {
          storage.uploaded.push({ bucket, path })
          return { error: null }
        },
        list: async (_dir: string, opts: { search: string }) => ({
          data: [{ name: opts.search, metadata: { size: 4 } }],
          error: null,
        }),
        remove: async (paths: string[]) => {
          for (const path of paths) storage.removed.push({ bucket, path })
          return { error: null }
        },
      }),
    },
  }),
}))

const { DELETE: removeFromPortfolio } = await import(
  '@/app/api/v1/pro/media/[id]/portfolio/route'
)
const { PATCH: patchMedia } = await import('@/app/api/v1/pro/media/[id]/route')

async function cleanup() {
  await db.lookPost.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.mediaAsset.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${TAG} Studio` },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.service.deleteMany({ where: { name: `${TAG} Svc` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${TAG}-category` } })
}

beforeAll(async () => {
  await cleanup()

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
      firstName: 'Vis',
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

beforeEach(() => {
  mockRequirePro.mockReturnValue({ ok: true, professionalId })

  // 🔴 File scope, deliberately: `failEverything` is sticky, and a leak into a
  // later describe silently turns a real retraction assertion into a no-op.
  storage.uploaded.length = 0
  storage.removed.length = 0
  storage.failEverything = false
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

/**
 * A published pro upload, exactly as `POST /api/v1/pro/media` writes one for a
 * `LOOKS_PUBLIC` / `PORTFOLIO_PUBLIC` signing kind: the pro's own work, in the
 * public bucket, no booking and no review.
 */
async function createPublishedPublicAsset(suffix: string) {
  const asset = await db.mediaAsset.create({
    data: {
      professionalId,
      primaryServiceId: serviceId,
      storageBucket: 'media-public',
      storagePath: `pro/${professionalId}/looks_public/${TAG}_${suffix}.jpg`,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PUBLIC,
      phase: MediaPhase.OTHER,
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
      services: { create: [{ serviceId }] },
    },
    select: { id: true },
  })

  return asset.id
}

async function createPrivateSessionAsset(suffix: string) {
  const asset = await db.mediaAsset.create({
    data: {
      professionalId,
      primaryServiceId: serviceId,
      storageBucket: 'media-private',
      storagePath: `bookings/${TAG}_${suffix}/after/x.jpg`,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PRO_CLIENT,
      phase: MediaPhase.AFTER,
      uploadedByRole: Role.PRO,
      services: { create: [{ serviceId }] },
    },
    select: { id: true },
  })

  return asset.id
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function readBack(id: string) {
  return db.mediaAsset.findUniqueOrThrow({
    where: { id },
    select: {
      storageBucket: true,
      storagePath: true,
      visibility: true,
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
      retractedFromPublicAt: true,
    },
  })
}

describe('retracting a public-bucket asset', () => {
  it('🔴 DELETE /portfolio WITHDRAWS the bytes, so the old URL stops resolving', async () => {
    const id = await createPublishedPublicAsset('del')
    const before = await readBack(id)

    const res = await removeFromPortfolio(
      new Request('http://t/x', { method: 'DELETE' }) as never,
      routeCtx(id) as never,
    )
    expect(res.status).toBe(200)

    const row = await readBack(id)

    // 🔴 The point of true retraction: the object LEFT the world-readable
    // bucket. Relabelling alone left it fetchable by anyone holding the URL.
    expect(row.storageBucket).toBe('media-private')
    expect(row.visibility).toBe(MediaVisibility.PRO_CLIENT)
    expect(row.retractedFromPublicAt).toBeInstanceOf(Date)

    // The public original was really deleted — not just re-pointed away from.
    expect(storage.removed).toContainEqual({
      bucket: 'media-public',
      path: before.storagePath,
    })
    // …and the copy landed before that delete.
    expect(storage.uploaded[0]?.bucket).toBe('media-private')

    // The flags half must not regress.
    expect(row.isFeaturedInPortfolio).toBe(false)
    expect(row.isEligibleForLooks).toBe(false)
  })

  it('🔴 PATCH un-ticking both flags does the same', async () => {
    const id = await createPublishedPublicAsset('patch')
    const before = await readBack(id)

    const res = await patchMedia(
      new Request('http://t/x', {
        method: 'PATCH',
        body: JSON.stringify({
          isEligibleForLooks: false,
          isFeaturedInPortfolio: false,
        }),
      }),
      routeCtx(id) as never,
    )
    // Notably NOT 403: the consent gate must not fire on a retract.
    expect(res.status).toBe(200)

    const row = await readBack(id)
    expect(row.storageBucket).toBe('media-private')
    expect(row.visibility).toBe(MediaVisibility.PRO_CLIENT)
    expect(row.retractedFromPublicAt).toBeInstanceOf(Date)
    expect(storage.removed).toContainEqual({
      bucket: 'media-public',
      path: before.storagePath,
    })
    expect(row.isFeaturedInPortfolio).toBe(false)
    expect(row.isEligibleForLooks).toBe(false)
  })

  it('still unpublishes when storage is unhealthy, and leaves the row VALID', async () => {
    // 🔴 The degraded path. The photo is already off every surface by the time
    // the bytes are touched, so a storage outage must not turn the pro's
    // unpublish into a 500 — it must leave a row that is still correct and
    // still renderable, for the sweep script to finish later.
    storage.failEverything = true

    const id = await createPublishedPublicAsset('degraded')
    const before = await readBack(id)

    const res = await removeFromPortfolio(
      new Request('http://t/x', { method: 'DELETE' }) as never,
      routeCtx(id) as never,
    )
    expect(res.status).toBe(200)

    const row = await readBack(id)

    // Off every surface…
    expect(row.isFeaturedInPortfolio).toBe(false)
    expect(row.isEligibleForLooks).toBe(false)

    // …and the row still truthfully describes bytes that really are still
    // public. Nothing was deleted, and nothing is stranded.
    expect(row.storageBucket).toBe('media-public')
    expect(row.storagePath).toBe(before.storagePath)
    expect(row.visibility).toBe(MediaVisibility.PUBLIC)
    expect(row.retractedFromPublicAt).toBeNull()
    expect(storage.removed).toEqual([])
  })
})

describe('the pointer backfill (the only update that rewrites a bucket)', () => {
  // 🔴 The third door, found in the self-review sweep rather than the first
  // pass. `backfillPointersIfMissing` resolves a legacy row's storage pointers
  // out of its old `url`, and it is the ONLY update in the codebase that writes
  // `storageBucket`. Learning that the bytes are in `media-public` changes what
  // visibility is legal, so the two have to move together — otherwise the
  // backfill itself recreates the defect from the other direction.
  //
  // Latent, not live: 0 of 96 production rows have an empty bucket (measured
  // 2026-09-01). Guarded here behaviourally because the write is textually
  // identical to a read being forwarded, so the static guard cannot see it.
  // 🔴 THE DISCRIMINATING CASE. The public-bucket test below asserts the right
  // outcome but cannot catch a regression on its own: an empty bucket resolves
  // to PUBLIC whether or not the resolved value is threaded through, so it stays
  // green even with the fix reverted (verified — that is why this test exists).
  // A legacy row pointing at media-private is what separates them:
  //   fixed  → effective bucket 'media-private' → PRO_CLIENT
  //   broken → stale ''                          → PUBLIC, marking a client's
  //            private session photo public.
  it('🔴 resolving a PRIVATE-bucket pointer must not mark it PUBLIC', async () => {
    const path = `bookings/${TAG}_legacypriv/after/x.jpg`

    const asset = await db.mediaAsset.create({
      data: {
        professionalId,
        primaryServiceId: serviceId,
        storageBucket: '',
        storagePath: '',
        url: `https://example.supabase.co/storage/v1/object/sign/media-private/${path}`,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PRO_CLIENT,
        phase: MediaPhase.AFTER,
        uploadedByRole: Role.PRO,
        isFeaturedInPortfolio: true,
        services: { create: [{ serviceId }] },
      },
      select: { id: true },
    })

    const res = await removeFromPortfolio(
      new Request('http://t/x', { method: 'DELETE' }) as never,
      routeCtx(asset.id) as never,
    )
    expect(res.status).toBe(200)

    const row = await readBack(asset.id)
    expect(row.storageBucket).toBe('media-private')
    expect(row.visibility).toBe(MediaVisibility.PRO_CLIENT)
  })

  it('resolving a public-bucket pointer never leaves the row PRO_CLIENT', async () => {
    const path = `pro/${professionalId}/looks_public/${TAG}_legacy.jpg`

    const asset = await db.mediaAsset.create({
      data: {
        professionalId,
        primaryServiceId: serviceId,
        // The legacy shape: no canonical pointers, only the old url.
        storageBucket: '',
        storagePath: '',
        url: `https://example.supabase.co/storage/v1/object/public/media-public/${path}`,
        mediaType: MediaType.IMAGE,
        visibility: MediaVisibility.PRO_CLIENT,
        phase: MediaPhase.OTHER,
        isFeaturedInPortfolio: true,
        services: { create: [{ serviceId }] },
      },
      select: { id: true },
    })

    const res = await removeFromPortfolio(
      new Request('http://t/x', { method: 'DELETE' }) as never,
      routeCtx(asset.id) as never,
    )
    expect(res.status).toBe(200)

    const row = await readBack(asset.id)

    // The backfill learned the bucket was media-public, and the visibility was
    // judged against THAT rather than the stale empty string the handler had
    // loaded before the backfill ran — which is what this test exists to pin.
    //
    // Because the row is now shown by nothing, true retraction then withdraws
    // the bytes it just learned about, so the row lands private. The defect
    // being guarded against would instead leave `PRO_CLIENT` over a
    // `media-public` object; both halves of that pair are asserted here.
    expect(row.storageBucket).toBe('media-private')
    expect(row.visibility).toBe(MediaVisibility.PRO_CLIENT)
    expect(row.retractedFromPublicAt).toBeInstanceOf(Date)
    expect(storage.removed).toContainEqual({
      bucket: 'media-public',
      path,
    })
  })
})

describe('private-bucket media is untouched by the change', () => {
  it('a retracted private session photo is still PRO_CLIENT', async () => {
    const id = await createPrivateSessionAsset('priv')

    const res = await removeFromPortfolio(
      new Request('http://t/x', { method: 'DELETE' }) as never,
      routeCtx(id) as never,
    )
    expect(res.status).toBe(200)

    const row = await readBack(id)
    expect(row.storageBucket).toBe('media-private')
    expect(row.visibility).toBe(MediaVisibility.PRO_CLIENT)
  })
})

describe('the invariant holds after every path this suite drove', () => {
  it('leaves no PRO_CLIENT row in the public bucket', async () => {
    // The exact query that found the production defect, re-run as a standing
    // assertion — scoped to this run's own professional so it stays
    // deterministic on the shared integration database (the suite runs with
    // parallel workers; a whole-table count would race with them).
    //
    // Catching a THIRD bucket-blind write path is the static guard's job
    // (`check:media-visibility-boundary`), which reads all of the source rather
    // than whatever state one test run happened to produce.
    const offenders = await db.mediaAsset.count({
      where: {
        professionalId,
        storageBucket: 'media-public',
        visibility: { not: MediaVisibility.PUBLIC },
      },
    })

    expect(offenders).toBe(0)
  })
})
