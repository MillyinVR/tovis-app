// tests/integration/pro-booking-client-relationship.test.ts
//
// The pro-created booking was a chart-access grant anybody could write.
//
// POST /api/v1/pro/bookings took `clientId` from the request body and handed it
// to `createProBookingWithClient` → `resolveProBookingClient`, which did a bare
// `clientProfile.findUnique({ where: { id } })` with no scoping at all. The
// booking it created was auto-ACCEPTED (`getProCreatedBookingStatus`), and
// `proClientVisibilityWhere` accepts "ACCEPTED and still upcoming" as full chart
// access. So one POST with a future date and someone else's client id opened
// that client's allergies, notes, photos, date of birth, phone and service
// addresses — to a pro with no relationship to them, and no way for them to say
// no. The id was never a secret: the chart-refusal screen, the thread page and
// the booking-new prefill all carry it.
//
// The `client: { email, phone }` payload was the same exploit with a different
// key — `upsertProClient` MATCHES an existing profile on those hashes, so
// knowing the victim's phone number was enough.
//
// The two keys get two different answers, because they are different acts:
// naming a raw profile id has no legitimate stranger case, while naming a
// person by email is how a walk-in is identified — and client identity is
// GLOBAL by design (one account across all pros), so a second pro must still be
// able to book someone who already has an account.
//
// This suite drives the real write paths against real Postgres and pins:
//   1. the id-keyed reach is REFUSED, writes nothing, leaves the chart shut
//   2. the contact-keyed reach is ALLOWED and MARKED
//      (`Booking.proCreatedWithoutRelationship`) — the appointment is real, the
//      chart stays shut, and the victim's profile is not re-parented
//   3. a SECOND marked booking does not cite the first as history — the pair
//      cannot let itself in by POSTing twice
//   4. the recurring-series door (`createBookingSeries`) is shut too
//   5. every legitimate relationship still books AND still opens the chart:
//      a client this pro created, a returning client, a waitlister, and a
//      client who granted chart access
//   6. the victim's OWN pro keeps their access throughout
//
// Run with `pnpm test:integration`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AftercareRebookMode,
  BookingStatus,
  ClientChartShareStatus,
  ClientClaimStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

import { createProBookingWithClient } from '@/lib/booking/createProBookingWithClient'
import {
  createBookingSeries,
  createProBooking,
  upsertBookingAftercare,
} from '@/lib/booking/writeBoundary'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { loadProClientRelationship } from '@/lib/clients/proClientRelationship'
import {
  buildClientProfileContactLookupData,
  buildUserContactLookupData,
} from '@/lib/security/contactLookup'
import { rootTenantContext } from '@/lib/tenant/context'

// The pro-create boundary snapshots the salon address through the PII envelope,
// and the contact-keyed case needs the lookup HMAC to match an existing profile.
vi.hoisted(() => {
  const key32 = Buffer.alloc(32, 7).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({ 'address-aead-v1': key32 })
  // Case 3 exercises the recurring-series door, which is dark by default.
  process.env.ENABLE_RECURRING_APPOINTMENTS = '1'
})

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `procr_rel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
/**
 * `User.phone` is globally unique, so a constant fixture number collides with
 * whatever a previous (or interrupted) run left behind. Derived per run.
 */
const phoneSuffix = Math.floor(Math.random() * 900_000) + 100_000
const ZONE = 'America/Los_Angeles'
const BASE_PRICE = '200.00'
const HOUR_MS = 60 * 60 * 1000

const VICTIM_EMAIL = `${tag}_victim@example.com`
const VICTIM_PHONE = `+1555${phoneSuffix}`

type ProFixture = {
  professionalId: string
  proUserId: string
  locationId: string
  offeringId: string
}

type Fixtures = {
  tenantId: string
  serviceId: string
  /** The pro doing the reaching — no relationship with the victim. */
  attacker: ProFixture
  /** The client's own pro, who created their record. */
  incumbent: ProFixture
  /** Another pro's claimed client. The record this exploit was reaching for. */
  victimClientId: string
  /** A client the attacker created themselves (the walk-in). */
  ownClientId: string
  /** A client the attacker saw once before (prior booking, long since done). */
  returningClientId: string
  /** Another pro's client who GRANTED the attacker chart access. */
  consentingClientId: string
  /** Another pro's client who joined the attacker's waitlist. */
  waitlistClientId: string
}

let fx: Fixtures

/** A working-hours-safe start `days` out (18:00 UTC = mid-morning in ZONE). */
function futureStart(days: number, extraHours = 0): Date {
  const at = new Date(Date.now() + days * 24 * HOUR_MS + extraHours * HOUR_MS)
  at.setUTCMinutes(0, 0, 0)
  at.setUTCHours(18)
  return at
}

function attackerCreate(args: {
  scheduledFor: Date
  clientId?: string | null
  client?: {
    firstName: string
    lastName: string
    email?: string
    phone?: string
  } | null
}) {
  return createProBookingWithClient({
    professionalId: fx.attacker.professionalId,
    actorUserId: fx.attacker.proUserId,
    tenantContext: rootTenantContext(fx.tenantId),
    overrideReason: null,
    clientId: args.clientId ?? null,
    client: args.client ?? null,
    clientAddressId: null,
    serviceAddress: null,
    offeringId: fx.attacker.offeringId,
    locationId: fx.attacker.locationId,
    locationType: ServiceLocationType.SALON,
    scheduledFor: args.scheduledFor,
    internalNotes: null,
    requestedBufferMinutes: null,
    requestedTotalDurationMinutes: null,
    allowOutsideWorkingHours: false,
    allowShortNotice: false,
    allowFarFuture: false,
  })
}

function countAttackerBookings(clientId: string) {
  return db.booking.count({
    where: { professionalId: fx.attacker.professionalId, clientId },
  })
}

async function seedPro(name: string): Promise<ProFixture> {
  const email = `${tag}_${name}@example.com`
  const user = await db.user.create({
    data: { email, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })

  const pro = await db.professionalProfile.create({
    data: {
      userId: user.id,
      firstName: name,
      lastName: 'Pro',
      businessName: `${tag} ${name}`,
      homeTenantId: fx.tenantId,
      timeZone: ZONE,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId: pro.id,
      type: ProfessionalLocationType.SALON,
      name: `${tag} ${name} salon`,
      isPrimary: true,
      isBookable: true,
      timeZone: ZONE,
      formattedAddress: '123 Relation St, San Diego, CA 92101',
      addressLine1: '123 Relation St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      maxDaysAhead: 3650,
      workingHours: {
        mon: { enabled: true, start: '09:00', end: '18:00' },
        tue: { enabled: true, start: '09:00', end: '18:00' },
        wed: { enabled: true, start: '09:00', end: '18:00' },
        thu: { enabled: true, start: '09:00', end: '18:00' },
        fri: { enabled: true, start: '09:00', end: '18:00' },
        sat: { enabled: true, start: '09:00', end: '18:00' },
        sun: { enabled: true, start: '09:00', end: '18:00' },
      },
    },
    select: { id: true },
  })

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: pro.id,
      serviceId: fx.serviceId,
      salonPriceStartingAt: new Prisma.Decimal(BASE_PRICE),
      salonDurationMinutes: 60,
      offersInSalon: true,
      offersMobile: false,
      isActive: true,
    },
    select: { id: true },
  })

  return {
    professionalId: pro.id,
    proUserId: user.id,
    locationId: location.id,
    offeringId: offering.id,
  }
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Pro Relationship', isActive: true },
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

  // Partially built so seedPro can read tenantId/serviceId off it.
  fx = {
    tenantId: tenant.id,
    serviceId: service.id,
  } as Fixtures

  fx.attacker = await seedPro('attacker')
  fx.incumbent = await seedPro('incumbent')

  // The victim: a CLAIMED client of the incumbent pro, with a real user account
  // and both contact channels populated so the contact-keyed match can find them.
  const victimUser = await db.user.create({
    data: {
      email: VICTIM_EMAIL,
      phone: VICTIM_PHONE,
      password: 'test-password',
      role: Role.CLIENT,
      // The blind-index columns a real signup writes. Without them the
      // contact-keyed reach below finds nothing and the case proves nothing —
      // upsertProClient matches on the HASHES, never on the plaintext.
      ...buildUserContactLookupData({
        email: VICTIM_EMAIL,
        phone: VICTIM_PHONE,
      }),
    },
    select: { id: true },
  })
  const victim = await db.clientProfile.create({
    data: {
      userId: victimUser.id,
      firstName: 'Vic',
      lastName: 'Timm',
      email: VICTIM_EMAIL,
      phone: VICTIM_PHONE,
      claimStatus: ClientClaimStatus.CLAIMED,
      claimedAt: new Date(),
      homeTenantId: tenant.id,
      createdByProfessionalId: fx.incumbent.professionalId,
      ...buildClientProfileContactLookupData({
        email: VICTIM_EMAIL,
        phone: VICTIM_PHONE,
      }),
    },
    select: { id: true },
  })
  fx.victimClientId = victim.id

  // The incumbent's real, current relationship with them — this is what must
  // survive the fix untouched.
  await db.booking.create({
    data: {
      clientId: victim.id,
      professionalId: fx.incumbent.professionalId,
      serviceId: service.id,
      scheduledFor: futureStart(14),
      status: BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.incumbent.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
      totalDurationMinutes: 60,
      proTenantId: tenant.id,
      clientHomeTenantId: tenant.id,
    },
  })

  // The attacker's own walk-in client record.
  const own = await db.clientProfile.create({
    data: {
      firstName: 'Walkin',
      lastName: 'Own',
      email: `${tag}_own@example.com`,
      homeTenantId: tenant.id,
      createdByProfessionalId: fx.attacker.professionalId,
    },
    select: { id: true },
  })
  fx.ownClientId = own.id

  // A returning client: created by the incumbent, but the attacker has seen
  // them before. The booking is old enough to be OUTSIDE the post-visit window,
  // so this pins that "prior booking" — not "currently visible" — is the rule.
  const returning = await db.clientProfile.create({
    data: {
      firstName: 'Rita',
      lastName: 'Turning',
      email: `${tag}_returning@example.com`,
      homeTenantId: tenant.id,
      createdByProfessionalId: fx.incumbent.professionalId,
    },
    select: { id: true },
  })
  fx.returningClientId = returning.id

  const longAgo = new Date(Date.now() - 400 * 24 * HOUR_MS)
  await db.booking.create({
    data: {
      clientId: returning.id,
      professionalId: fx.attacker.professionalId,
      serviceId: service.id,
      scheduledFor: longAgo,
      finishedAt: longAgo,
      status: BookingStatus.COMPLETED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.attacker.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
      totalDurationMinutes: 60,
      proTenantId: tenant.id,
      clientHomeTenantId: tenant.id,
    },
  })

  // A client of the incumbent who has GRANTED the attacker chart access —
  // consent, with no shared history at all.
  const consentingUser = await db.user.create({
    data: {
      email: `${tag}_consenting@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  const consenting = await db.clientProfile.create({
    data: {
      userId: consentingUser.id,
      firstName: 'Connie',
      lastName: 'Sent',
      email: `${tag}_consenting@example.com`,
      claimStatus: ClientClaimStatus.CLAIMED,
      claimedAt: new Date(),
      homeTenantId: tenant.id,
      createdByProfessionalId: fx.incumbent.professionalId,
    },
    select: { id: true },
  })
  fx.consentingClientId = consenting.id

  await db.clientChartShare.create({
    data: {
      clientId: consenting.id,
      professionalId: fx.attacker.professionalId,
      status: ClientChartShareStatus.GRANTED,
      respondedAt: new Date(),
    },
  })

  // A client who asked the attacker for a slot. This is the "message a
  // waitlister, then offer them a time" flow BookingCreateContent calls
  // load-bearing — it must survive the gate.
  const waitlister = await db.clientProfile.create({
    data: {
      firstName: 'Willa',
      lastName: 'Waiting',
      email: `${tag}_waitlist@example.com`,
      homeTenantId: tenant.id,
      createdByProfessionalId: fx.incumbent.professionalId,
    },
    select: { id: true },
  })
  fx.waitlistClientId = waitlister.id

  await db.waitlistEntry.create({
    data: {
      clientId: waitlister.id,
      professionalId: fx.attacker.professionalId,
      serviceId: service.id,
    },
  })
}, 60_000)

afterAll(async () => {
  // Ordered by dependency: bookings and shares before the profiles they point
  // at, profiles before the users and tenant. Failing to clear these leaves the
  // shared test database holding globally-unique emails/phones that the next
  // run collides with.
  const proIds = [fx.attacker.professionalId, fx.incumbent.professionalId]

  await db.notificationDelivery.deleteMany({
    where: { dispatch: { client: { homeTenantId: fx.tenantId } } },
  })
  await db.notificationDispatch.deleteMany({
    where: { client: { homeTenantId: fx.tenantId } },
  })
  await db.proClientInvite.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.clientChartShare.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.waitlistEntry.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.booking.deleteMany({ where: { professionalId: { in: proIds } } })
  await db.bookingSeries.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.professionalServiceOffering.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.professionalLocation.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.clientProfile.deleteMany({ where: { homeTenantId: fx.tenantId } })
  await db.professionalProfile.deleteMany({ where: { id: { in: proIds } } })
  await db.service.deleteMany({ where: { name: `${tag} service` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.user.deleteMany({ where: { email: { startsWith: tag } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

describe('the exploit: a pro-created booking as a chart-access grant', () => {
  it('refuses a booking for another pro\'s client, writes nothing, and leaves the chart shut', async () => {
    // Precondition: the attacker cannot see this chart, and this is the state
    // the exploit existed to change.
    const before = await assertProCanViewClient(
      fx.attacker.professionalId,
      fx.victimClientId,
    )
    expect(before.ok).toBe(false)
    expect(before.visibility.reason).toBe('NONE')

    const result = await attackerCreate({
      clientId: fx.victimClientId,
      scheduledFor: futureStart(21),
    })

    // Soft, so that a run with the gate disarmed keeps going and shows the
    // CONSEQUENCE below rather than stopping at "the booking was allowed" —
    // this suite's whole point is that the write and the chart are the same
    // event. Soft assertions still fail the run.
    expect.soft(result.ok).toBe(false)
    expect.soft(result).toMatchObject({ status: 404, code: 'CLIENT_NOT_FOUND' })

    // No booking row — the refusal is before the write, not a rollback after it.
    expect.soft(await countAttackerBookings(fx.victimClientId)).toBe(0)

    // And therefore still no chart. Pre-fix this read UPCOMING_ACCEPTED —
    // allergies, notes, photos, DOB, phone and service addresses, one POST after
    // never having met the client.
    const after = await assertProCanViewClient(
      fx.attacker.professionalId,
      fx.victimClientId,
    )
    expect(after.ok).toBe(false)
    expect(after.visibility.canViewClient).toBe(false)
    expect(after.visibility.reason).toBe('NONE')
  })

  it('lets the email/phone reach BOOK — and marks it, so the chart still does not open', async () => {
    const result = await attackerCreate({
      client: {
        firstName: 'Vic',
        lastName: 'Timm',
        email: VICTIM_EMAIL,
        phone: VICTIM_PHONE,
      },
      scheduledFor: futureStart(22),
    })

    // Allowed on purpose: this is the same call a second pro makes for a real
    // walk-in who already has an account.
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // It resolved onto the VICTIM's existing profile — global client identity —
    // which is exactly why the mark has to exist.
    expect(result.clientId).toBe(fx.victimClientId)

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: result.bookingResult.booking.id },
      select: { status: true, proCreatedWithoutRelationship: true },
    })
    expect(booking.status).toBe(BookingStatus.ACCEPTED)
    expect(booking.proCreatedWithoutRelationship).toBe(true)

    // The whole point: an upcoming ACCEPTED booking, and NO chart.
    const after = await assertProCanViewClient(
      fx.attacker.professionalId,
      fx.victimClientId,
    )
    expect(after.ok).toBe(false)
    expect(after.visibility.canViewClient).toBe(false)
    expect(after.visibility.reason).toBe('NONE')

    // The contact match must not have re-parented the victim's record onto the
    // attacker either — that would hand them the CREATED_BY_PRO clause.
    const profile = await db.clientProfile.findUniqueOrThrow({
      where: { id: fx.victimClientId },
      select: { createdByProfessionalId: true },
    })
    expect(profile.createdByProfessionalId).toBe(fx.incumbent.professionalId)
  })

  it('does not let a marked booking become the history that admits the next one', async () => {
    // Two POSTs, not one: if the marked booking counted as PRIOR_BOOKING, the
    // second would be written unmarked and the chart would open on attempt two.
    const second = await attackerCreate({
      client: {
        firstName: 'Vic',
        lastName: 'Timm',
        email: VICTIM_EMAIL,
        phone: VICTIM_PHONE,
      },
      scheduledFor: futureStart(25),
    })

    expect(second.ok).toBe(true)
    if (!second.ok) return

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: second.bookingResult.booking.id },
      select: { proCreatedWithoutRelationship: true },
    })
    expect(booking.proCreatedWithoutRelationship).toBe(true)

    const after = await assertProCanViewClient(
      fx.attacker.professionalId,
      fx.victimClientId,
    )
    expect(after.ok).toBe(false)

    // And the id-keyed door stays shut too: marked bookings are not history, so
    // the pair is still unestablished.
    const byId = await attackerCreate({
      clientId: fx.victimClientId,
      scheduledFor: futureStart(26),
    })
    expect(byId).toMatchObject({ ok: false, code: 'CLIENT_NOT_FOUND' })
  })

  it('shuts the recurring-series door on the same reach', async () => {
    await expect(
      createBookingSeries({
        professionalId: fx.attacker.professionalId,
        actorUserId: fx.attacker.proUserId,
        clientId: fx.victimClientId,
        offeringId: fx.attacker.offeringId,
        locationId: fx.attacker.locationId,
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
        firstOccurrenceAt: futureStart(23),
        intervalWeeks: 2,
        occurrenceCount: 3,
        internalNotes: null,
        overrideReason: null,
        requestedBufferMinutes: null,
        requestedTotalDurationMinutes: null,
        allowOutsideWorkingHours: false,
        allowShortNotice: false,
        allowFarFuture: false,
      }),
    ).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' })

    expect(
      await db.bookingSeries.count({
        where: {
          professionalId: fx.attacker.professionalId,
          clientId: fx.victimClientId,
        },
      }),
    ).toBe(0)
    // No occurrence rows either. Counted by seriesId rather than by pair,
    // because the contact-keyed cases above legitimately left marked bookings
    // behind — those are allowed; a series occurrence is not.
    expect(
      await db.booking.count({
        where: {
          professionalId: fx.attacker.professionalId,
          clientId: fx.victimClientId,
          seriesId: { not: null },
        },
      }),
    ).toBe(0)
  })

  it('marks at the write boundary too, for the callers that skip the route', async () => {
    // The calendar import resolves its client by EMAIL through upsertProClient
    // and calls createProBooking directly, so no route-level check runs for it.
    // The boundary asks for itself — and marks rather than refuses, so a
    // migrating pro's imported history is not silently dropped.
    const result = await createProBooking({
      professionalId: fx.attacker.professionalId,
      actorUserId: fx.attacker.proUserId,
      clientId: fx.victimClientId,
      offeringId: fx.attacker.offeringId,
      locationId: fx.attacker.locationId,
      locationType: ServiceLocationType.SALON,
      scheduledFor: futureStart(24),
      clientAddressId: null,
      internalNotes: null,
      overrideReason: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: true,
      allowShortNotice: true,
      allowFarFuture: false,
      importMode: true,
    })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: result.booking.id },
      select: { proCreatedWithoutRelationship: true },
    })
    expect(row.proCreatedWithoutRelationship).toBe(true)

    expect(
      (
        await assertProCanViewClient(
          fx.attacker.professionalId,
          fx.victimClientId,
        )
      ).ok,
    ).toBe(false)
  })

  it('cannot launder the mark through an aftercare rebook', async () => {
    // The chain: write a marked booking, author aftercare on it (the
    // PRO_AFTERCARE_SAVE gate allows that before the source completes), and let
    // the rebook it creates be the unmarked one. The rebook re-asks instead of
    // inheriting, and a marked parent is not history, so the child is marked too.
    const seed = await attackerCreate({
      client: {
        firstName: 'Vic',
        lastName: 'Timm',
        email: VICTIM_EMAIL,
        phone: VICTIM_PHONE,
      },
      scheduledFor: futureStart(40),
    })
    expect(seed.ok).toBe(true)
    if (!seed.ok) return

    // Aftercare needs the session past its early steps; the pro drives that
    // themselves in the app, so the fixture just sets it.
    await db.booking.update({
      where: { id: seed.bookingResult.booking.id },
      data: { sessionStep: SessionStep.AFTER_PHOTOS, startedAt: new Date() },
    })

    const nextStart = futureStart(47)

    const result = await upsertBookingAftercare({
      bookingId: seed.bookingResult.booking.id,
      professionalId: fx.attacker.professionalId,
      actorUserId: fx.attacker.proUserId,
      notes: 'next visit',
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: nextStart,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      rebookSlot: {
        offeringId: fx.attacker.offeringId,
        locationId: fx.attacker.locationId,
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
        startsAt: nextStart,
        endsAt: new Date(nextStart.getTime() + 60 * 60 * 1000),
      },
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      overrideReason: null,
      createRebookReminder: false,
      rebookReminderDaysBefore: 0,
      createProductReminder: false,
      productReminderDaysAfter: 0,
      recommendedProducts: [],
      sendToClient: false,
      version: null,
    })

    const rebookId = result.aftercare.rebookedBookingId
    expect(rebookId).toBeTruthy()

    const rebooked = await db.booking.findUniqueOrThrow({
      where: { id: String(rebookId) },
      select: { proCreatedWithoutRelationship: true, status: true },
    })
    expect(rebooked.proCreatedWithoutRelationship).toBe(true)

    expect(
      (
        await assertProCanViewClient(
          fx.attacker.professionalId,
          fx.victimClientId,
        )
      ).ok,
    ).toBe(false)
  })

  it('leaves the client\'s OWN pro exactly where they were', async () => {
    const incumbent = await assertProCanViewClient(
      fx.incumbent.professionalId,
      fx.victimClientId,
    )
    expect(incumbent.ok).toBe(true)
    expect(incumbent.visibility.reason).toBe('UPCOMING_ACCEPTED')
  })
})

describe('the legitimate cases still work', () => {
  it('books a client this pro created, and opens their chart', async () => {
    const result = await attackerCreate({
      clientId: fx.ownClientId,
      scheduledFor: futureStart(30),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.bookingResult.booking.status).toBe(BookingStatus.ACCEPTED)
    expect(await countAttackerBookings(fx.ownClientId)).toBe(1)

    const gate = await assertProCanViewClient(
      fx.attacker.professionalId,
      fx.ownClientId,
    )
    expect(gate.ok).toBe(true)
  })

  it('books a brand-new walk-in typed in by hand', async () => {
    const result = await attackerCreate({
      client: {
        firstName: 'Fresh',
        lastName: 'Walkin',
        email: `${tag}_fresh@example.com`,
        phone: `+1556${phoneSuffix}`,
      },
      scheduledFor: futureStart(31),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // upsertProClient stamps the new profile with this pro, which is exactly
    // what carries it through the gate.
    const created = await db.clientProfile.findUniqueOrThrow({
      where: { id: result.clientId },
      select: { createdByProfessionalId: true },
    })
    expect(created.createdByProfessionalId).toBe(fx.attacker.professionalId)

    const gate = await assertProCanViewClient(
      fx.attacker.professionalId,
      result.clientId,
    )
    expect(gate.ok).toBe(true)
  })

  it('books a returning client whose only history is long outside the chart window', async () => {
    // The pair is invisible to the chart gate before this booking — "prior
    // booking" is a broader test than "currently visible", on purpose.
    const before = await assertProCanViewClient(
      fx.attacker.professionalId,
      fx.returningClientId,
    )
    expect(before.ok).toBe(false)

    const result = await attackerCreate({
      clientId: fx.returningClientId,
      scheduledFor: futureStart(32),
    })

    expect(result.ok).toBe(true)

    const after = await assertProCanViewClient(
      fx.attacker.professionalId,
      fx.returningClientId,
    )
    expect(after.ok).toBe(true)
  })

  it('books a waitlister who asked this pro for a slot', async () => {
    const relationship = await loadProClientRelationship({
      professionalId: fx.attacker.professionalId,
      clientId: fx.waitlistClientId,
    })
    expect(relationship).toMatchObject({
      established: true,
      reason: 'WAITLIST_ENTRY',
    })

    const result = await attackerCreate({
      clientId: fx.waitlistClientId,
      scheduledFor: futureStart(34),
    })

    expect(result.ok).toBe(true)
  })

  it('books a client who granted chart access, with no shared history', async () => {
    const relationship = await loadProClientRelationship({
      professionalId: fx.attacker.professionalId,
      clientId: fx.consentingClientId,
    })
    expect(relationship).toEqual({
      found: true,
      established: true,
      reason: 'CHART_SHARE_GRANTED',
    })

    const result = await attackerCreate({
      clientId: fx.consentingClientId,
      scheduledFor: futureStart(33),
    })

    expect(result.ok).toBe(true)
  })
})

describe('the relationship predicate itself', () => {
  it('answers not-found and not-established with the same shape', async () => {
    expect(
      await loadProClientRelationship({
        professionalId: fx.attacker.professionalId,
        clientId: 'client_does_not_exist',
      }),
    ).toEqual({ found: false, established: false, reason: null })

    expect(
      await loadProClientRelationship({
        professionalId: fx.attacker.professionalId,
        clientId: fx.victimClientId,
      }),
    ).toEqual({ found: true, established: false, reason: null })
  })

  it('names the clause that admitted the pair', async () => {
    expect(
      await loadProClientRelationship({
        professionalId: fx.attacker.professionalId,
        clientId: fx.ownClientId,
      }),
    ).toMatchObject({ established: true, reason: 'CREATED_BY_PRO' })

    expect(
      await loadProClientRelationship({
        professionalId: fx.attacker.professionalId,
        clientId: fx.returningClientId,
      }),
    ).toMatchObject({ established: true, reason: 'PRIOR_BOOKING' })
  })
})
