// tests/integration/account-deletion-consult-proposal.test.ts
//
// Real-Postgres proof that a client who committed to a look can still delete
// her account.
//
//   pnpm test:integration
//
// THE BUG THIS EXISTS FOR. `ConsultBookingProposal` references
// `ConsultSession` and `ConsultServiceEstimate` with `onDelete: Restrict`, and
// both of those are HARD-DELETED by the client deletion rules. Nothing in the
// registry deleted the proposal first, so the delete raised a foreign-key
// violation — and because the whole run is ONE transaction, that single P2003
// rolled back every rule, marked the request FAILED, and the failure path is
// deliberately never retried. The client's erasure would have stalled forever.
//
// It was invisible to every existing guard: the completeness boundary detects
// subject links by DIRECT foreign key only, and this model reaches the client
// through `consultSessionId`.
//
// A unit test cannot catch this class of bug at all — `deleteUserData`'s unit
// tests mock every delegate, and a mocked `deleteMany` succeeds exactly where
// real Postgres refuses. That is the same reasoning that put
// `account-deletion-boundary.test.ts` next door, for the same shape of defect.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AccountDeletionRequestStatus,
  BookingStatus,
  ConsultRevisionKind,
  ConsultServiceEstimateStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  executeDueAccountDeletions,
  requestAccountDeletion,
} from '@/lib/privacy/accountDeletion'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `acctdelconsult_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'
const DAY_MS = 24 * 60 * 60 * 1000

const WORKING_HOURS = {
  mon: { enabled: true, start: '09:00', end: '18:00' },
  tue: { enabled: true, start: '09:00', end: '18:00' },
  wed: { enabled: true, start: '09:00', end: '18:00' },
  thu: { enabled: true, start: '09:00', end: '18:00' },
  fri: { enabled: true, start: '09:00', end: '18:00' },
  sat: { enabled: true, start: '09:00', end: '18:00' },
  sun: { enabled: true, start: '09:00', end: '18:00' },
}

let tenantId = ''
let clientUserId = ''
let clientProfileId = ''
let proProfileId = ''
let proUserId = ''
let consultSessionId = ''
let estimateId = ''
let proposalId = ''
let bookingId = ''

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Consult Proposal Deletion', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const proUser = await db.user.create({
    data: { email: `${tag}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  proUserId = proUser.id

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Look',
      lastName: 'Pro',
      businessName: `${tag} studio`,
      homeTenantId: tenant.id,
      timeZone: ZONE,
    },
    select: { id: true },
  })
  proProfileId = pro.id

  const location = await db.professionalLocation.create({
    data: {
      professionalId: pro.id,
      type: ProfessionalLocationType.SALON,
      name: `${tag} salon`,
      isPrimary: true,
      isBookable: true,
      timeZone: ZONE,
      formattedAddress: '9 Look Ln, San Diego, CA 92101',
      addressLine1: '9 Look Ln',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      workingHours: WORKING_HOURS,
    },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: { email: `${tag}_client@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  clientUserId = clientUser.id

  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Committed',
      lastName: 'Client',
      homeTenantId: tenant.id,
    },
    select: { id: true },
  })
  clientProfileId = client.id

  const category = await db.serviceCategory.create({
    data: { name: `${tag} category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })

  const service = await db.service.create({
    data: {
      name: `${tag} service`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: pro.id,
      serviceId: service.id,
      isActive: true,
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: 60,
      salonPriceStartingAt: new Prisma.Decimal('120.00'),
    },
    select: { id: true },
  })

  // A PAST booking, so deletion eligibility does not block on an upcoming
  // appointment — this test is about the foreign key, not the grace rules.
  const booking = await db.booking.create({
    data: {
      clientId: client.id,
      professionalId: pro.id,
      serviceId: service.id,
      offeringId: offering.id,
      scheduledFor: new Date(Date.now() - 30 * DAY_MS),
      status: BookingStatus.COMPLETED,
      locationType: ServiceLocationType.SALON,
      locationId: location.id,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal('120.00'),
      totalAmount: new Prisma.Decimal('120.00'),
      totalDurationMinutes: 60,
      proTenantId: tenant.id,
      clientHomeTenantId: tenant.id,
    },
    select: { id: true },
  })
  bookingId = booking.id

  const session = await db.consultSession.create({
    data: {
      clientId: client.id,
      professionalId: pro.id,
      serviceCategoryId: category.id,
      anchorLookPostId: `${tag}-look`,
    },
    select: { id: true },
  })
  consultSessionId = session.id

  const revision = await db.consultRevision.create({
    data: {
      consultSessionId: session.id,
      revision: 1,
      kind: ConsultRevisionKind.ANALYSIS,
      payload: {},
      schemaVersion: 1,
    },
    select: { id: true },
  })

  const estimate = await db.consultServiceEstimate.create({
    data: {
      consultSessionId: session.id,
      professionalId: pro.id,
      sourceAnalysisRevisionId: revision.id,
      status: ConsultServiceEstimateStatus.ESTIMATED,
      locationType: ServiceLocationType.SALON,
      stepMinutes: 15,
      bufferMinutes: 0,
      schemaVersion: 1,
      derivationVersion: 'test',
    },
    select: { id: true },
  })
  estimateId = estimate.id

  const proposal = await db.consultBookingProposal.create({
    data: {
      bookingId: booking.id,
      consultSessionId: session.id,
      estimateId: estimate.id,
      locationType: ServiceLocationType.SALON,
      stepMinutes: 15,
      bufferMinutes: 0,
      totalDurationMinutes: 60,
      startingAtPrice: new Prisma.Decimal('120.00'),
      schemaVersion: 1,
      derivationVersion: 'test',
    },
    select: { id: true },
  })
  proposalId = proposal.id
})

afterAll(async () => {
  // Ordered teardown: the same Restrict edges this test is about.
  await db.consultBookingProposal.deleteMany({ where: { consultSessionId } })
  await db.consultServiceEstimate.deleteMany({ where: { consultSessionId } })
  await db.consultSession.deleteMany({ where: { id: consultSessionId } })
  await db.accountDeletionRequest.deleteMany({
    where: { userId: { in: [clientUserId, proUserId] } },
  })
  await db.booking.deleteMany({ where: { id: bookingId } })
  await db.clientProfile.deleteMany({ where: { id: clientProfileId } })
  await db.professionalProfile.deleteMany({ where: { id: proProfileId } })
  await db.user.deleteMany({ where: { id: { in: [clientUserId, proUserId] } } })
  await db.tenant.deleteMany({ where: { id: tenantId } })
  await db.$disconnect()
})

describe('deleting a client who committed to a look', () => {
  // Without this the assertions below would pass just as happily against rows
  // that were never seeded — a green probe meaning NO DATA rather than DELETED.
  it('starts from a proposal that genuinely exists, behind two Restrict edges', async () => {
    expect(await db.consultBookingProposal.count({ where: { id: proposalId } })).toBe(1)
    expect(await db.consultServiceEstimate.count({ where: { id: estimateId } })).toBe(1)
    expect(await db.consultSession.count({ where: { id: consultSessionId } })).toBe(1)
  })

  // 🔴 The whole point. Before the fix this ran the FK violation, `failed`
  // came back 1, `completed` 0, and every other rule rolled back with it.
  it('completes against a real database instead of failing on a foreign key', async () => {
    const requested = await requestAccountDeletion({ db, userId: clientUserId })
    expect(requested.ok).toBe(true)

    const afterWindow = new Date(
      Date.now() + (ACCOUNT_DELETION_GRACE_PERIOD_DAYS + 1) * DAY_MS,
    )
    const swept = await executeDueAccountDeletions({ db, now: afterWindow })

    expect(swept.failed).toBe(0)
    expect(swept.completed).toBe(1)

    const request = await db.accountDeletionRequest.findFirstOrThrow({
      where: { userId: clientUserId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    })
    expect(request.status).toBe(AccountDeletionRequestStatus.COMPLETED)
  })

  it('takes the proposal with the consult it was derived from', async () => {
    expect(await db.consultBookingProposal.count({ where: { id: proposalId } })).toBe(0)
    expect(await db.consultServiceEstimate.count({ where: { id: estimateId } })).toBe(0)
    expect(await db.consultSession.count({ where: { id: consultSessionId } })).toBe(0)
  })

  it('leaves the professional’s booking record intact', async () => {
    // Booking is RETAIN: the pro's own record of an appointment that happened.
    expect(await db.booking.count({ where: { id: bookingId } })).toBe(1)
  })
})
