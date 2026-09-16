// tests/integration/admin-moderation-counts.test.ts
//
// Real-Postgres proof for the admin inbox counts that back the native admin
// moderation surface. Runs against the docker test database:
//   pnpm test:integration
//
// The route unit tests mock these helpers entirely, so they prove the ROUTE
// shape and nothing about the queries. That is the gap this file closes: a
// wrong relation name in a nested `where` (`lookPost.professional` vs
// `professional`) type-checks, passes every mock, and only throws when real
// Postgres is asked to plan it.
//
// The load-bearing property is not "the count runs" but "the count agrees with
// the list it labels". An inbox badge reading 3 beside a queue of 1 sends an
// admin looking for work that is not there, so every case below asserts the
// count against `listAdmin*` over the SAME seeded data rather than against a
// hardcoded number.
//
// Test data is tagged and torn down in afterAll; this suite never calls a
// global deleteMany({}).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  MediaType,
  ModerationStatus,
  Prisma,
  Role,
  VerificationStatus,
  ViralServiceRequestStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  countAdminLookCommentModeration,
  countAdminLookModeration,
  listAdminLookCommentModeration,
  listAdminLookModeration,
} from '@/lib/privacy/adminLookModeration'
import {
  countAdminViralRequestsAwaitingReview,
  listAdminViralRequests,
  isViralRequestAwaitingReview,
} from '@/lib/viralRequests'

const TAG = `admincounts_${Date.now()}`

let tenantId = ''
let professionalId = ''
let clientProfileId = ''
let reporterUserId = ''
const userIds: string[] = []
const lookIds: string[] = []
const commentIds: string[] = []
const viralIds: string[] = []
let categoryId = ''
let serviceId = ''

/** A look plus its media asset, with however many UNRESOLVED reports. */
async function seedLook(args: {
  suffix: string
  status?: LookPostStatus
  moderationStatus?: ModerationStatus
  unresolvedReports?: number
  resolvedReports?: number
}): Promise<string> {
  const media = await prisma.mediaAsset.create({
    data: {
      professionalId,
      proTenantId: tenantId,
      primaryServiceId: serviceId,
      mediaType: MediaType.IMAGE,
      storageBucket: 'media-public',
      storagePath: `${TAG}/${args.suffix}.jpg`,
    },
    select: { id: true },
  })

  const look = await prisma.lookPost.create({
    data: {
      professionalId,
      primaryMediaAssetId: media.id,
      serviceId,
      status: args.status ?? LookPostStatus.PUBLISHED,
      moderationStatus: args.moderationStatus ?? ModerationStatus.APPROVED,
      publishedAt: new Date(),
    },
    select: { id: true },
  })
  lookIds.push(look.id)

  const total = (args.unresolvedReports ?? 0) + (args.resolvedReports ?? 0)
  for (let i = 0; i < total; i += 1) {
    // One report per (look, user) — the model is uniquely keyed on that pair,
    // so each report needs its own reporter.
    const reporter = await prisma.user.create({
      data: {
        email: `${TAG}_rep_${args.suffix}_${i}@example.com`,
        password: 'x',
        role: Role.CLIENT,
      },
      select: { id: true },
    })
    userIds.push(reporter.id)

    await prisma.lookPostReport.create({
      data: {
        lookPostId: look.id,
        userId: reporter.id,
        // Resolved reports must NOT count — this is the half a naive
        // `_count: { reports: true }` gets wrong.
        ...(i < (args.unresolvedReports ?? 0)
          ? {}
          : { resolvedAt: new Date(), resolvedByUserId: reporter.id }),
      },
    })
  }

  return look.id
}

beforeAll(async () => {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const proUser = await prisma.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  userIds.push(proUser.id)

  const professional = await prisma.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenantId,
      firstName: 'Admin',
      lastName: 'Counts',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })
  professionalId = professional.id

  const clientUser = await prisma.user.create({
    data: {
      email: `${TAG}_client@example.com`,
      password: 'x',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  userIds.push(clientUser.id)
  reporterUserId = clientUser.id

  const client = await prisma.clientProfile.create({
    data: {
      userId: clientUser.id,
      homeTenantId: tenantId,
      firstName: 'Counts',
      lastName: 'Client',
    },
    select: { id: true },
  })
  clientProfileId = client.id

  const category = await prisma.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
    select: { id: true },
  })
  categoryId = category.id

  const service = await prisma.service.create({
    data: {
      name: `${TAG} Color`,
      categoryId,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })
  serviceId = service.id

  // Two REPORTED looks (one carrying several reports, to prove the queue counts
  // LOOKS and not REPORTS), one look whose only report is already resolved, and
  // one clean PENDING_REVIEW look.
  const hostLookId = await seedLook({ suffix: 'reported_a', unresolvedReports: 1 })
  await seedLook({ suffix: 'reported_b', unresolvedReports: 3 })
  await seedLook({ suffix: 'resolved_only', resolvedReports: 2 })
  await seedLook({
    suffix: 'pending',
    moderationStatus: ModerationStatus.PENDING_REVIEW,
  })

  // A reported comment on the first look, and a clean one that must not count.
  const host = hostLookId
  const reportedComment = await prisma.lookComment.create({
    data: {
      lookPostId: host,
      userId: reporterUserId,
      body: `${TAG} reported comment`,
    },
    select: { id: true },
  })
  commentIds.push(reportedComment.id)
  await prisma.lookCommentReport.create({
    data: { lookCommentId: reportedComment.id, userId: reporterUserId },
  })

  const cleanComment = await prisma.lookComment.create({
    data: {
      lookPostId: host,
      userId: reporterUserId,
      body: `${TAG} clean comment`,
    },
    select: { id: true },
  })
  commentIds.push(cleanComment.id)

  // Viral requests: two awaiting a decision, one already decided.
  for (const [suffix, status] of [
    ['requested', ViralServiceRequestStatus.REQUESTED],
    ['in_review', ViralServiceRequestStatus.IN_REVIEW],
    ['approved', ViralServiceRequestStatus.APPROVED],
  ] as const) {
    const row = await prisma.viralServiceRequest.create({
      data: {
        clientId: clientProfileId,
        name: `${TAG} ${suffix}`,
        status,
      },
      select: { id: true },
    })
    viralIds.push(row.id)
  }
})

afterAll(async () => {
  await prisma.lookCommentReport.deleteMany({
    where: { lookCommentId: { in: commentIds } },
  })
  await prisma.lookComment.deleteMany({ where: { id: { in: commentIds } } })
  await prisma.lookPostReport.deleteMany({
    where: { lookPostId: { in: lookIds } },
  })
  await prisma.viralServiceRequest.deleteMany({
    where: { id: { in: viralIds } },
  })
  await prisma.lookPost.deleteMany({ where: { id: { in: lookIds } } })
  await prisma.mediaAsset.deleteMany({
    where: { storagePath: { startsWith: `${TAG}/` } },
  })
  await prisma.clientProfile.deleteMany({ where: { id: clientProfileId } })
  await prisma.professionalProfile.deleteMany({ where: { id: professionalId } })
  await prisma.service.deleteMany({ where: { id: serviceId } })
  await prisma.serviceCategory.deleteMany({ where: { id: categoryId } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
})

/** Only this suite's seeded rows — the shared test DB holds other data. */
function ours<T extends { professionalId: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.professionalId === professionalId)
}

describe('admin moderation counts (real Postgres)', () => {
  it('counts REPORTED looks, and agrees with the queue it labels', async () => {
    const listed = ours(
      await listAdminLookModeration({ status: 'REPORTED', q: `${TAG} Studio` }),
    )
    const count = await countAdminLookModeration({
      status: 'REPORTED',
      q: `${TAG} Studio`,
    })

    // Two looks are reported — NOT four, though they carry four reports
    // between them, and not three, because the resolved-only look is settled.
    expect(listed).toHaveLength(2)
    expect(count).toBe(listed.length)
  })

  it('counts PENDING looks separately from reported ones', async () => {
    const listed = ours(
      await listAdminLookModeration({ status: 'PENDING', q: `${TAG} Studio` }),
    )
    const count = await countAdminLookModeration({
      status: 'PENDING',
      q: `${TAG} Studio`,
    })

    expect(listed).toHaveLength(1)
    expect(count).toBe(listed.length)
  })

  it('counts reported COMMENTS through the lookPost→professional relation', async () => {
    // The nested relation is the part no mock can validate.
    const listed = ours(
      await listAdminLookCommentModeration({
        status: 'REPORTED',
        q: `${TAG} Studio`,
      }),
    )
    const count = await countAdminLookCommentModeration({
      status: 'REPORTED',
      q: `${TAG} Studio`,
    })

    expect(listed).toHaveLength(1)
    expect(count).toBe(listed.length)
  })

  it('applies the same professional search filter the list applies', async () => {
    // A query that matches nothing must zero the count, not ignore the filter.
    const count = await countAdminLookModeration({
      status: 'REPORTED',
      q: `${TAG}_no_such_pro`,
    })
    expect(count).toBe(0)
  })

  it('counts viral requests awaiting review, matching the queue predicate', async () => {
    const seeded = (await listAdminViralRequests(prisma, { take: 300 })).filter(
      (row) => viralIds.includes(row.id),
    )
    const awaitingInList = seeded.filter((row) =>
      isViralRequestAwaitingReview(row.status),
    )
    expect(awaitingInList).toHaveLength(2)

    // A true table-wide count, so it must be at least our seeded two and must
    // never fall below what the queue shows.
    const count = await countAdminViralRequestsAwaitingReview(prisma)
    expect(count).toBeGreaterThanOrEqual(awaitingInList.length)
  })
})
