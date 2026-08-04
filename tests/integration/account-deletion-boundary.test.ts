// tests/integration/account-deletion-boundary.test.ts
//
// Real-Postgres proof for self-serve account deletion. Runs against the docker
// test database:
//   pnpm test:integration
//
// The unit tests for `deleteUserData` mock every Prisma delegate, so a mocked
// `deleteMany` succeeds exactly where real Postgres refuses. That is the class
// of bug this file exists to catch: `ProfessionalLocation` is referenced by
// `Booking.locationId` with `onDelete: Restrict`, so deleting a pro's locations
// raised `Booking_locationId_fkey` for any pro who had ever taken a booking —
// invisible to a mock, and now reachable by anyone tapping "Delete account".
//
// Both halves of a deletion get proved here:
//   1. the right rows DIE     — nothing that keeps ACTING on a deleted account
//                               survives (push tokens, search index, @handle)
//   2. the right rows SURVIVE — the other party's booking, money and profile
//                               are untouched
//
// Test data is tagged and torn down in afterAll; this suite never calls a
// global deleteMany({}).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AccountDeletionRequestStatus,
  BookingStatus,
  DevicePlatform,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  cancelAccountDeletion,
  evaluateAccountDeletionEligibility,
  executeDueAccountDeletions,
  requestAccountDeletion,
} from '@/lib/privacy/accountDeletion'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `acctdel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'
const DAY_MS = 24 * 60 * 60 * 1000

type Fixtures = {
  tenantId: string
  categoryId: string
  serviceId: string
  offeringId: string
  /** The pro whose account gets deleted. */
  proUserId: string
  proProfileId: string
  proLocationId: string
  proHandle: string
  /** The client on the other side of the pro's booking — must survive. */
  clientUserId: string
  clientProfileId: string
  bookingId: string
}

let fx: Fixtures

const WORKING_HOURS = {
  mon: { enabled: true, start: '09:00', end: '18:00' },
  tue: { enabled: true, start: '09:00', end: '18:00' },
  wed: { enabled: true, start: '09:00', end: '18:00' },
  thu: { enabled: true, start: '09:00', end: '18:00' },
  fri: { enabled: true, start: '09:00', end: '18:00' },
  sat: { enabled: true, start: '09:00', end: '18:00' },
  sun: { enabled: true, start: '09:00', end: '18:00' },
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Account Deletion', isActive: true },
    select: { id: true },
  })

  const proUser = await db.user.create({
    data: {
      email: `${tag}_pro@example.com`,
      password: 'test-password',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Deleting',
      lastName: 'Pro',
      businessName: `${tag} studio`,
      homeTenantId: tenant.id,
      timeZone: ZONE,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId: pro.id,
      type: ProfessionalLocationType.SALON,
      name: `${tag} salon`,
      isPrimary: true,
      isBookable: true,
      timeZone: ZONE,
      formattedAddress: '123 Delete St, San Diego, CA 92101',
      addressLine1: '123 Delete St',
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
    data: {
      email: `${tag}_client@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })

  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Surviving',
      lastName: 'Client',
      homeTenantId: tenant.id,
    },
    select: { id: true },
  })

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

  // A COMPLETED booking in the past: the financial record that must survive,
  // and the row whose foreign key makes the pro's location undeletable.
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

  const proHandle = `${tag}handle`.slice(0, 24)

  // Rows that keep ACTING on the account if they survive.
  await db.handleRegistration.create({
    data: { handleNormalized: proHandle, professionalId: pro.id },
  })
  await db.deviceToken.create({
    data: {
      userId: proUser.id,
      platform: DevicePlatform.IOS,
      token: `${tag}-pro-token`,
      isActive: true,
    },
  })
  await db.practiceShot.create({
    data: {
      professionalId: pro.id,
      storageBucket: 'practice',
      storagePath: `${tag}/shot.jpg`,
      contentType: 'image/jpeg',
    },
  })

  // The discovery projection. Raw SQL because `geom` is an Unsupported
  // PostGIS column the Prisma client cannot write.
  await db.$executeRaw`
    INSERT INTO "ProfessionalSearchIndex" (
      "locationId", "professionalId", "geom", "lat", "lng",
      "verificationStatus", "locationType", "isPrimary", "isBookable",
      "workingHours", "categoryIds", "serviceIds"
    ) VALUES (
      ${location.id}, ${pro.id},
      ST_SetSRID(ST_MakePoint(-117.1611, 32.7157), 4326)::geography,
      32.7157, -117.1611,
      'APPROVED'::"VerificationStatus",
      'SALON'::"ProfessionalLocationType",
      true, true,
      ${WORKING_HOURS}::jsonb,
      ARRAY[]::text[], ARRAY[]::text[]
    )
  `

  // The surviving client's own push token — a control. Deleting the pro must
  // not touch it.
  await db.deviceToken.create({
    data: {
      userId: clientUser.id,
      platform: DevicePlatform.IOS,
      token: `${tag}-client-token`,
      isActive: true,
    },
  })

  fx = {
    tenantId: tenant.id,
    categoryId: category.id,
    serviceId: service.id,
    offeringId: offering.id,
    proUserId: proUser.id,
    proProfileId: pro.id,
    proLocationId: location.id,
    proHandle,
    clientUserId: clientUser.id,
    clientProfileId: client.id,
    bookingId: booking.id,
  }
}, 60_000)

describe('deletion eligibility', () => {
  it('blocks a pro with an upcoming client appointment', async () => {
    const upcoming = await db.booking.create({
      data: {
        clientId: fx.clientProfileId,
        professionalId: fx.proProfileId,
        serviceId: fx.serviceId,
        offeringId: fx.offeringId,
        scheduledFor: new Date(Date.now() + 7 * DAY_MS),
        status: BookingStatus.ACCEPTED,
        locationType: ServiceLocationType.SALON,
        locationId: fx.proLocationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal('120.00'),
        totalDurationMinutes: 60,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
      },
      select: { id: true },
    })

    const proSide = await evaluateAccountDeletionEligibility({
      db,
      userId: fx.proUserId,
    })
    expect(proSide.eligible).toBe(false)
    expect(proSide.blockers.map((b) => b.code)).toContain(
      'UPCOMING_BOOKINGS_AS_PRO',
    )

    // The same booking blocks the CLIENT for their own reason.
    const clientSide = await evaluateAccountDeletionEligibility({
      db,
      userId: fx.clientUserId,
    })
    expect(clientSide.blockers.map((b) => b.code)).toContain(
      'UPCOMING_BOOKINGS_AS_CLIENT',
    )

    // A blocked request must not open a window.
    const refused = await requestAccountDeletion({ db, userId: fx.proUserId })
    expect(refused.ok).toBe(false)
    expect(
      await db.accountDeletionRequest.count({
        where: { userId: fx.proUserId },
      }),
    ).toBe(0)

    // Clearing the obligation clears the block — the blocker is not a dead end.
    await db.booking.delete({ where: { id: upcoming.id } })
    const after = await evaluateAccountDeletionEligibility({
      db,
      userId: fx.proUserId,
    })
    expect(after.eligible).toBe(true)
  })
})

describe('the grace window', () => {
  it('schedules, cancels, and refuses to run before it is due', async () => {
    const opened = await requestAccountDeletion({ db, userId: fx.proUserId })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const scheduled = new Date(opened.request.scheduledFor).getTime()
    const requested = new Date(opened.request.requestedAt).getTime()
    expect(Math.round((scheduled - requested) / DAY_MS)).toBe(
      ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
    )

    // A second request must not open a second window — the partial unique
    // index is the guard, not a read-then-write in the route.
    const again = await requestAccountDeletion({ db, userId: fx.proUserId })
    expect(again.ok).toBe(false)
    if (!again.ok && again.code === 'ALREADY_PENDING') {
      expect(again.request.id).toBe(opened.request.id)
    } else {
      throw new Error('expected ALREADY_PENDING')
    }

    // Nothing is due yet, so the sweep must not touch the account.
    const early = await executeDueAccountDeletions({ db })
    expect(early.completed).toBe(0)

    const stillThere = await db.user.findUniqueOrThrow({
      where: { id: fx.proUserId },
      select: { email: true },
    })
    expect(stillThere.email).toBe(`${tag}_pro@example.com`)

    // Cancelling reopens the ability to request again.
    const cancelled = await cancelAccountDeletion({ db, userId: fx.proUserId })
    expect(cancelled.ok).toBe(true)
    expect(
      await db.accountDeletionRequest.count({
        where: {
          userId: fx.proUserId,
          status: AccountDeletionRequestStatus.PENDING,
        },
      }),
    ).toBe(0)
  })
})

describe('an obligation that appears DURING the grace window', () => {
  it('defers the deletion instead of anonymizing a live client', async () => {
    const opened = await requestAccountDeletion({ db, userId: fx.proUserId })
    expect(opened.ok).toBe(true)

    // Eligible on day 0 — then the pro takes a booking on day 3. Nothing stops
    // them: the window does not deactivate the account.
    const madeDuringWindow = await db.booking.create({
      data: {
        clientId: fx.clientProfileId,
        professionalId: fx.proProfileId,
        serviceId: fx.serviceId,
        offeringId: fx.offeringId,
        scheduledFor: new Date(
          Date.now() + (ACCOUNT_DELETION_GRACE_PERIOD_DAYS + 5) * DAY_MS,
        ),
        status: BookingStatus.ACCEPTED,
        locationType: ServiceLocationType.SALON,
        locationId: fx.proLocationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal('120.00'),
        totalDurationMinutes: 60,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
      },
      select: { id: true },
    })

    const afterWindow = new Date(
      Date.now() + (ACCOUNT_DELETION_GRACE_PERIOD_DAYS + 1) * DAY_MS,
    )
    const swept = await executeDueAccountDeletions({ db, now: afterWindow })

    // Deferred, not completed and not failed: the user still leaves, just after
    // the appointment they made does.
    expect(swept.completed).toBe(0)
    expect(swept.failed).toBe(0)
    expect(swept.deferred).toBe(1)

    // The account is untouched — this is the assertion that matters. Without
    // the re-check the pro's profile would already be anonymized here, with a
    // real client booked in five days' time.
    const stillIntact = await db.user.findUniqueOrThrow({
      where: { id: fx.proUserId },
      select: { email: true },
    })
    expect(stillIntact.email).toBe(`${tag}_pro@example.com`)
    expect(
      await db.deviceToken.count({ where: { userId: fx.proUserId } }),
    ).toBe(1)

    // The request is still open, so it runs once the obligation clears.
    expect(
      await db.accountDeletionRequest.count({
        where: {
          userId: fx.proUserId,
          status: AccountDeletionRequestStatus.PENDING,
        },
      }),
    ).toBe(1)

    // Clear it and cancel the request so the next block starts clean.
    await db.booking.delete({ where: { id: madeDuringWindow.id } })
    await cancelAccountDeletion({ db, userId: fx.proUserId })
  })
})

describe('executing a due deletion for a pro who has taken a booking', () => {
  // Without this, every "expect(count).toBe(0)" below would pass just as
  // happily against data that was never seeded — a green probe that means NO
  // DATA rather than DELETED.
  it('starts from a state where all the target rows genuinely exist', async () => {
    expect(
      await db.deviceToken.count({ where: { userId: fx.proUserId } }),
    ).toBe(1)
    expect(
      await db.handleRegistration.count({
        where: { handleNormalized: fx.proHandle },
      }),
    ).toBe(1)
    expect(
      await db.practiceShot.count({
        where: { professionalId: fx.proProfileId },
      }),
    ).toBe(1)
    expect(
      await db.professionalSearchIndex.count({
        where: { professionalId: fx.proProfileId },
      }),
    ).toBe(1)

    const location = await db.professionalLocation.findUniqueOrThrow({
      where: { id: fx.proLocationId },
      select: { formattedAddress: true, archivedAt: true, isBookable: true },
    })
    expect(location.formattedAddress).not.toBeNull()
    expect(location.archivedAt).toBeNull()
    expect(location.isBookable).toBe(true)
  })

  it('completes against a real database', async () => {
    const reopened = await requestAccountDeletion({ db, userId: fx.proUserId })
    expect(reopened.ok).toBe(true)

    // Wind the clock past the window rather than mutating the row, so the
    // sweep's own due-date query is what selects it.
    const afterWindow = new Date(
      Date.now() + (ACCOUNT_DELETION_GRACE_PERIOD_DAYS + 1) * DAY_MS,
    )

    const swept = await executeDueAccountDeletions({ db, now: afterWindow })

    expect(swept.failed).toBe(0)
    expect(swept.completed).toBe(1)

    const request = await db.accountDeletionRequest.findFirstOrThrow({
      where: { userId: fx.proUserId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, completedAt: true, resultJson: true },
    })
    expect(request.status).toBe(AccountDeletionRequestStatus.COMPLETED)
    expect(request.completedAt).not.toBeNull()
    expect(request.resultJson).not.toBeNull()
  })

  it('kills the rows that would keep acting on the account', async () => {
    // Push credentials: a surviving token keeps delivering to a deleted user.
    expect(
      await db.deviceToken.count({ where: { userId: fx.proUserId } }),
    ).toBe(0)

    // The @handle lock: not releasing it holds the name hostage forever.
    expect(
      await db.handleRegistration.count({
        where: { handleNormalized: fx.proHandle },
      }),
    ).toBe(0)

    // Private media rows.
    expect(
      await db.practiceShot.count({
        where: { professionalId: fx.proProfileId },
      }),
    ).toBe(0)

    // Discovery: the pro must leave the search index.
    expect(
      await db.professionalSearchIndex.count({
        where: { professionalId: fx.proProfileId },
      }),
    ).toBe(0)

    // The user row survives (bookings reference it) but is de-identified.
    const user = await db.user.findUniqueOrThrow({
      where: { id: fx.proUserId },
      select: { email: true, phone: true, emailHashV2: true },
    })
    expect(user.email).not.toBe(`${tag}_pro@example.com`)
    expect(user.email).toContain('deleted')
    expect(user.phone).toBeNull()
    expect(user.emailHashV2).toBeNull()
  })

  it('anonymizes the location instead of deleting it, keeping the booking valid', async () => {
    const location = await db.professionalLocation.findUniqueOrThrow({
      where: { id: fx.proLocationId },
      select: {
        formattedAddress: true,
        addressLine1: true,
        city: true,
        postalCode: true,
        lat: true,
        lng: true,
        archivedAt: true,
        isBookable: true,
      },
    })

    // Still there — six models reference it with Restrict — but scrubbed.
    expect(location.formattedAddress).toBeNull()
    expect(location.addressLine1).toBeNull()
    expect(location.city).toBeNull()
    expect(location.postalCode).toBeNull()
    expect(location.lat).toBeNull()
    expect(location.lng).toBeNull()
    expect(location.archivedAt).not.toBeNull()
    expect(location.isBookable).toBe(false)
  })

  it('leaves the other party‘s records completely intact', async () => {
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: fx.bookingId },
      select: { status: true, totalAmount: true, clientId: true },
    })
    expect(booking.status).toBe(BookingStatus.COMPLETED)
    expect(booking.clientId).toBe(fx.clientProfileId)
    expect(booking.totalAmount?.toString()).toBe('120')

    const client = await db.clientProfile.findUniqueOrThrow({
      where: { id: fx.clientProfileId },
      select: { firstName: true, lastName: true },
    })
    expect(client.firstName).toBe('Surviving')
    expect(client.lastName).toBe('Client')

    const clientUser = await db.user.findUniqueOrThrow({
      where: { id: fx.clientUserId },
      select: { email: true },
    })
    expect(clientUser.email).toBe(`${tag}_client@example.com`)

    // The control token: deleting the pro must not sweep up the client's.
    expect(
      await db.deviceToken.count({ where: { userId: fx.clientUserId } }),
    ).toBe(1)
  })
})

afterAll(async () => {
  if (!fx) {
    await db.$disconnect()
    return
  }

  await db.accountDeletionRequest.deleteMany({
    where: { userId: { in: [fx.proUserId, fx.clientUserId] } },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.proProfileId } })
  await db.professionalServiceOffering.deleteMany({
    where: { professionalId: fx.proProfileId },
  })
  await db.professionalLocation.deleteMany({
    where: { professionalId: fx.proProfileId },
  })
  await db.professionalProfile.deleteMany({ where: { id: fx.proProfileId } })
  await db.clientProfile.deleteMany({ where: { id: fx.clientProfileId } })
  await db.deviceToken.deleteMany({
    where: { userId: { in: [fx.proUserId, fx.clientUserId] } },
  })
  await db.user.deleteMany({
    where: { id: { in: [fx.proUserId, fx.clientUserId] } },
  })
  await db.service.deleteMany({ where: { id: fx.serviceId } })
  await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
  await db.tenant.deleteMany({ where: { id: fx.tenantId } })

  await db.$disconnect()
})
