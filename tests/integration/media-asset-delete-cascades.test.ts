// tests/integration/media-asset-delete-cascades.test.ts
//
// Real-Postgres coverage for deleting a MediaAsset.
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/media-asset-delete-cascades.test.ts \
//     --config vitest.integration.config.mts
//
// This one HAS to run against real Postgres: the entire subject is the FK
// referential actions, which live in the database and nowhere else. A mocked
// client cannot see a RESTRICT and cannot see a CASCADE, so it would pass
// happily against the exact schema that shipped the bug these tests pin.
//
// The bug: every relation below was RESTRICT, and `POST /api/v1/pro/media`
// REQUIRES at least one service tag — so every MediaAsset a pro could create was
// undeletable. `DELETE /api/v1/pro/media/{id}` 500'd every time, and
// `lib/privacy/deleteUserData` (which deletes ALL of a pro's media) failed the
// same way. Nothing caught it because nothing had ever deleted a tagged asset
// against a real database.
//
// Each test builds its own asset under a unique TAG so the assertions are about
// rows that actually existed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
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

const TAG = `mdel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

let professionalId = ''
let serviceId = ''
let userId = ''

async function cleanup() {
  // MediaAsset now cascades to its tags/likes/comments/looks, so removing the
  // pro's assets first keeps this teardown honest about what it relies on.
  await db.mediaAsset.deleteMany({ where: { professional: { businessName: `${TAG} Studio` } } })
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
  userId = proUser.id

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Media',
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

/** A public asset shaped exactly like one `POST /api/v1/pro/media` creates. */
async function createTaggedAsset(suffix: string) {
  return db.mediaAsset.create({
    data: {
      professionalId,
      primaryServiceId: serviceId,
      storageBucket: 'media-public',
      storagePath: `pro/${professionalId}/${TAG}_${suffix}.jpg`,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PUBLIC,
      phase: MediaPhase.OTHER,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
      // The route ALWAYS writes at least one tag — which is exactly why a
      // RESTRICT here made every asset undeletable.
      services: { createMany: { data: [{ serviceId }] } },
    },
    select: { id: true },
  })
}

describe('deleting a MediaAsset', () => {
  it('succeeds for a tagged asset — the tag cascades away', async () => {
    const asset = await createTaggedAsset('tagged')
    expect(await db.mediaServiceTag.count({ where: { mediaId: asset.id } })).toBe(1)

    // Before the cascade migration this threw P2003 (foreign key constraint
    // "MediaServiceTag_mediaId_fkey"), which the route surfaced as a 500.
    await db.mediaAsset.delete({ where: { id: asset.id } })

    expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(0)
    expect(await db.mediaServiceTag.count({ where: { mediaId: asset.id } })).toBe(0)
  })

  it('takes the LookPost with it, because a look cannot outlive its primary photo', async () => {
    const asset = await createTaggedAsset('look')
    const look = await db.lookPost.create({
      data: {
        professionalId,
        primaryMediaAssetId: asset.id,
        serviceId,
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        publishedAt: new Date(),
        assets: { create: [{ mediaAssetId: asset.id, sortOrder: 0 }] },
      },
      select: { id: true },
    })

    // §19b: every public upload IS a LookPost, so this is the ordinary case —
    // not an edge case. RESTRICT here meant no public media was ever deletable.
    await db.mediaAsset.delete({ where: { id: asset.id } })

    expect(await db.lookPost.count({ where: { id: look.id } })).toBe(0)
    expect(await db.lookPostAsset.count({ where: { lookPostId: look.id } })).toBe(0)
  })

  it('carries engagement rows with it', async () => {
    const asset = await createTaggedAsset('engagement')
    await db.mediaLike.create({ data: { mediaId: asset.id, userId } })
    await db.mediaComment.create({ data: { mediaId: asset.id, userId, body: 'nice' } })

    await db.mediaAsset.delete({ where: { id: asset.id } })

    expect(await db.mediaLike.count({ where: { mediaId: asset.id } })).toBe(0)
    expect(await db.mediaComment.count({ where: { mediaId: asset.id } })).toBe(0)
  })

  it('deletes a whole pro’s media in one deleteMany — the privacy path’s shape', async () => {
    // lib/privacy/deleteUserData does exactly this (a bare deleteMany scoped to
    // professionalId) with no dependent cleanup, so a RESTRICT made user-data
    // deletion fail for any pro who had ever posted. This is the regression test
    // for that, expressed the way the caller actually writes it.
    const a = await createTaggedAsset('bulk_a')
    const b = await createTaggedAsset('bulk_b')
    await db.lookPost.create({
      data: {
        professionalId,
        primaryMediaAssetId: b.id,
        serviceId,
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        publishedAt: new Date(),
      },
      select: { id: true },
    })

    const result = await db.mediaAsset.deleteMany({ where: { professionalId } })

    expect(result.count).toBeGreaterThanOrEqual(2)
    expect(await db.mediaAsset.count({ where: { id: { in: [a.id, b.id] } } })).toBe(0)
    expect(await db.lookPost.count({ where: { primaryMediaAssetId: b.id } })).toBe(0)
  })

  it('leaves a non-primary asset’s look standing', async () => {
    // LookPostAsset cascades, but only that row: deleting a secondary photo must
    // not destroy a look that still has its primary.
    const primary = await createTaggedAsset('multi_primary')
    const secondary = await createTaggedAsset('multi_secondary')
    const look = await db.lookPost.create({
      data: {
        professionalId,
        primaryMediaAssetId: primary.id,
        serviceId,
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        publishedAt: new Date(),
        assets: {
          create: [
            { mediaAssetId: primary.id, sortOrder: 0 },
            { mediaAssetId: secondary.id, sortOrder: 1 },
          ],
        },
      },
      select: { id: true },
    })

    await db.mediaAsset.delete({ where: { id: secondary.id } })

    expect(await db.lookPost.count({ where: { id: look.id } })).toBe(1)
    expect(await db.lookPostAsset.count({ where: { lookPostId: look.id } })).toBe(1)

    await db.mediaAsset.delete({ where: { id: primary.id } })
  })
})
