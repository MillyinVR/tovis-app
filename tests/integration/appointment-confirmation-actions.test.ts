// tests/integration/appointment-confirmation-actions.test.ts
//
// K12 — the client-confirmation loop's WRITERS, against real Postgres through
// the real write boundary:
//
//   • the ASK (armAppointmentConfirmationAsk): stamps
//     clientConfirmationRequestedAt exactly once, mints an
//     APPOINTMENT_CONFIRMATION token expiring at the appointment start, and
//     refuses to arm a booking that is no longer askable;
//   • the ANSWERS (recordAppointmentConfirmationFromClientToken): confirm is
//     idempotent and re-stamps; decline notifies the pro and — D5 — NEVER
//     touches the slot; the latest answer wins through real writes;
//   • CANCEL PARITY (the K12 DoD): a token cancel runs the same boundary call
//     and the same shared refund orchestration as the authed route, proven
//     side by side on two identical bookings — refund summary and DB money
//     outcome must be byte-equal, in both the ≥24h (refund) and <24h
//     (deposit-forfeit) policy windows;
//   • RESCHEDULE RESETS the loop: both the pro's time-move
//     (updateProBooking#nextStart) and the client's hold-path reschedule
//     (createHold → rescheduleBookingFromHold) clear all three timestamps —
//     and a duration-only edit does NOT.
//
// Only Stripe's network boundary (refunds.create) is mocked, the
// refund-concurrency suite's pattern. The DB is the assertion surface.
//
// Run with `pnpm test:integration` (or the whole dir in CI via integration.yml).
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  BookingDepositStatus,
  BookingServiceItemType,
  BookingStatus,
  ClientActionTokenKind,
  NotificationEventKey,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

// The client hold path snapshots the location address through the PII
// envelope, so the boundary needs a real keyring (K10's recipe).
vi.hoisted(() => {
  const key32 = Buffer.alloc(32, 9).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({ 'address-aead-v1': key32 })
})

// Only Stripe's network boundary is mocked; prisma, the policy code, the
// advisory locks and the write boundary all run for real against the test DB.
let refundCallCount = 0
const stripe = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ refunds: { create: stripe.create } }),
}))

import {
  resolveAppointmentConfirmationTokenForMutation,
} from '@/lib/booking/appointmentConfirmationTokens'
import { runCancelRefundOrchestration } from '@/lib/booking/cancelRefundOrchestration'
import { loadClientBookingBuckets } from '@/lib/booking/clientBookingBuckets'
import { deriveClientConfirmationState } from '@/lib/booking/clientConfirmation'
import {
  HOLD_CREATE_OFFERING_SELECT,
  toCreateHoldOffering,
} from '@/lib/booking/holdCreateOffering'
import {
  armAppointmentConfirmationAsk,
  cancelBooking,
  createHold,
  recordAppointmentConfirmationFromAuthedClient,
  recordAppointmentConfirmationFromClientToken,
  rescheduleBookingFromHold,
  updateProBooking,
} from '@/lib/booking/writeBoundary'
import { getClientActionPathPrefix } from '@/lib/clientActions/linkBuilders'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `appt_conf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

type Fixtures = {
  tenantId: string
  professionalId: string
  proUserId: string
  serviceId: string
  offeringId: string
  locationId: string
  clientId: string
}

let fx: Fixtures
const seededUserEmails: string[] = []

const HOUR_MS = 60 * 60 * 1000

/** Next occurrence of 18:00Z at least minAheadMs out — always 10:00/11:00 in
 * America/Los_Angeles (inside the fixture's 09:00–18:00 working hours), DST
 * either way. */
function futureWorkingInstant(minAheadMs: number, offsetHours = 0): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + Math.ceil(minAheadMs / (24 * HOUR_MS)) + 1)
  d.setUTCHours(18 + offsetHours, 0, 0, 0)
  return d
}

type SeedBookingArgs = {
  scheduledFor: Date
  status?: BookingStatus
  requestedAt?: Date | null
  confirmedAt?: Date | null
  declinedAt?: Date | null
  deposit?: {
    pi: string
    depositDollars: string
    feeCents: number
  }
}

async function seedBooking(args: SeedBookingArgs): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      offeringId: fx.offeringId,
      scheduledFor: args.scheduledFor,
      status: args.status ?? BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal('120.00'),
      totalAmount: new Prisma.Decimal('120.00'),
      totalDurationMinutes: 60,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      clientConfirmationRequestedAt: args.requestedAt ?? null,
      clientConfirmedAt: args.confirmedAt ?? null,
      clientConfirmationDeclinedAt: args.declinedAt ?? null,
      ...(args.deposit
        ? {
            depositStatus: BookingDepositStatus.PAID,
            depositStripePaymentIntentId: args.deposit.pi,
            depositAmount: new Prisma.Decimal(args.deposit.depositDollars),
            depositPaidAt: new Date(Date.now() - HOUR_MS),
            discoveryFeeAmount: args.deposit.feeCents,
          }
        : {}),
    },
    select: { id: true },
  })

  // The pro-update path recomputes the bill from the booking's SERVICE ITEMS,
  // so a booking with none is refused as INVALID_SERVICE_ITEMS before it can
  // reach the time move. Seed the BASE item every real create path writes.
  await db.bookingServiceItem.create({
    data: {
      bookingId: booking.id,
      serviceId: fx.serviceId,
      offeringId: fx.offeringId,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: new Prisma.Decimal('120.00'),
      durationMinutesSnapshot: 60,
      sortOrder: 0,
    },
    select: { id: true },
  })

  return booking.id
}

/** Arm the ask inside a transaction (the cron's shape) and return the RAW token
 * parsed off the href — the only place it ever exists. */
async function armAndExtractToken(
  bookingId: string,
  now = new Date(),
): Promise<{ rawToken: string; href: string; requestedAtStamped: boolean }> {
  const armed = await db.$transaction((tx) =>
    armAppointmentConfirmationAsk({ tx, bookingId, now }),
  )
  if (!armed) throw new Error('expected the booking to be askable')

  const prefix = `${getClientActionPathPrefix('APPOINTMENT_CONFIRMATION')}/`
  expect(armed.href.startsWith(prefix)).toBe(true)

  return {
    rawToken: decodeURIComponent(armed.href.slice(prefix.length)),
    href: armed.href,
    requestedAtStamped: armed.requestedAtStamped,
  }
}

async function readConfirmationRow(bookingId: string) {
  const row = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      status: true,
      scheduledFor: true,
      clientConfirmationRequestedAt: true,
      clientConfirmedAt: true,
      clientConfirmationDeclinedAt: true,
    },
  })
  return row
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Appt Confirmation', isActive: true },
    select: { id: true },
  })

  const proEmail = `${tag}_pro@example.com`
  const proUser = await db.user.create({
    data: { email: proEmail, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })
  seededUserEmails.push(proEmail)

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Confirm',
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
      // The client hold path books through the real reserve path, which
      // refuses a pro who is not booking-ready — address + coordinates needed.
      formattedAddress: '123 Confirm St, San Diego, CA 92101',
      addressLine1: '123 Confirm St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
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

  const clientEmail = `${tag}_client@example.com`
  const clientUser = await db.user.create({
    data: { email: clientEmail, password: 'test-password', role: Role.CLIENT },
    select: { id: true },
  })
  seededUserEmails.push(clientEmail)
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Confirm',
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

  fx = {
    tenantId: tenant.id,
    professionalId: pro.id,
    proUserId: proUser.id,
    serviceId: service.id,
    offeringId: offering.id,
    locationId: location.id,
    clientId: client.id,
  }
}, 60_000)

// A Stripe refund stub returning a unique id per call. Installed BEFORE each
// test, not after: set in afterEach it would be absent for the first test, and
// a refund with no Stripe response settles FAILED → the summary reads
// PROCESSING and the assertion measures the mock, not the policy.
beforeEach(() => {
  refundCallCount = 0
  stripe.create.mockReset()
  stripe.create.mockImplementation(async () => ({
    id: `re_${tag}_${++refundCallCount}`,
  }))
})

afterEach(async () => {
  await db.bookingRefund.deleteMany({
    where: { booking: { professionalId: fx.professionalId } },
  })
  await db.clientActionToken.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.notificationDelivery.deleteMany({
    where: { dispatch: { professionalId: fx.professionalId } },
  })
  await db.notificationDispatch.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.notification.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.clientNotification.deleteMany({ where: { clientId: fx.clientId } })
  await db.scheduledClientNotification.deleteMany({
    where: { clientId: fx.clientId },
  })
  await db.bookingHold.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
})

afterAll(async () => {
  await db.professionalLocation.deleteMany({ where: { name: `${tag} salon` } })
  await db.professionalServiceOffering.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.clientProfile.deleteMany({
    where: { firstName: 'Confirm', lastName: 'Client', homeTenantId: fx.tenantId },
  })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${tag} studio` },
  })
  await db.service.deleteMany({ where: { name: `${tag} service` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

describe('armAppointmentConfirmationAsk (the ask)', () => {
  it('stamps requestedAt on the first ask, mints a token expiring at the appointment, and does not move requestedAt on a later ask', async () => {
    const scheduledFor = futureWorkingInstant(48 * HOUR_MS)
    const bookingId = await seedBooking({ scheduledFor })

    const first = await armAndExtractToken(bookingId)
    expect(first.requestedAtStamped).toBe(true)

    const afterFirst = await readConfirmationRow(bookingId)
    expect(afterFirst.clientConfirmationRequestedAt).not.toBeNull()
    expect(deriveClientConfirmationState(afterFirst)).toBe('AWAITING_CLIENT')

    // The 2h reminder asks again: a fresh token, the SAME requestedAt, and the
    // earlier token is NOT revoked (the older SMS link must keep working).
    const second = await armAndExtractToken(bookingId)
    expect(second.requestedAtStamped).toBe(false)
    expect(second.rawToken).not.toBe(first.rawToken)

    const afterSecond = await readConfirmationRow(bookingId)
    expect(afterSecond.clientConfirmationRequestedAt?.getTime()).toBe(
      afterFirst.clientConfirmationRequestedAt?.getTime(),
    )

    const tokens = await db.clientActionToken.findMany({
      where: { bookingId, kind: ClientActionTokenKind.APPOINTMENT_CONFIRMATION },
      select: { expiresAt: true, revokedAt: true, singleUse: true },
    })
    expect(tokens).toHaveLength(2)
    for (const token of tokens) {
      expect(token.revokedAt).toBeNull()
      expect(token.singleUse).toBe(false)
      expect(token.expiresAt.getTime()).toBe(scheduledFor.getTime())
    }
  })

  it('arms nothing for a cancelled or already-started booking', async () => {
    const cancelledId = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS),
      status: BookingStatus.CANCELLED,
    })
    const pastId = await seedBooking({
      scheduledFor: new Date(Date.now() - HOUR_MS),
    })

    for (const bookingId of [cancelledId, pastId]) {
      const armed = await db.$transaction((tx) =>
        armAppointmentConfirmationAsk({ tx, bookingId, now: new Date() }),
      )
      expect(armed).toBeNull()

      const row = await readConfirmationRow(bookingId)
      expect(row.clientConfirmationRequestedAt).toBeNull()
    }

    const tokens = await db.clientActionToken.count({
      where: { kind: ClientActionTokenKind.APPOINTMENT_CONFIRMATION },
    })
    expect(tokens).toBe(0)
  })
})

describe('recordAppointmentConfirmationFromClientToken (the answers)', () => {
  it('confirm stamps clientConfirmedAt and an idempotent re-confirm re-stamps it forward', async () => {
    const bookingId = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS),
    })
    const { rawToken } = await armAndExtractToken(bookingId)

    const first = await recordAppointmentConfirmationFromClientToken({
      rawToken,
      answer: 'CONFIRM',
    })
    expect(first.state).toBe('CLIENT_CONFIRMED')
    expect(first.meta.mutated).toBe(true)

    const afterFirst = await readConfirmationRow(bookingId)
    expect(afterFirst.clientConfirmedAt).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 15))

    const second = await recordAppointmentConfirmationFromClientToken({
      rawToken,
      answer: 'CONFIRM',
    })
    expect(second.state).toBe('CLIENT_CONFIRMED')
    // Same state — but the stamp moved forward (K11's tie-break design).
    expect(second.meta.mutated).toBe(false)

    const afterSecond = await readConfirmationRow(bookingId)
    expect(afterSecond.clientConfirmedAt!.getTime()).toBeGreaterThan(
      afterFirst.clientConfirmedAt!.getTime(),
    )
  })

  it('decline stamps, notifies the pro, and — D5 — never touches the slot; a later confirm wins', async () => {
    const bookingId = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS),
    })
    const { rawToken } = await armAndExtractToken(bookingId)

    const declined = await recordAppointmentConfirmationFromClientToken({
      rawToken,
      answer: 'DECLINE',
    })
    expect(declined.state).toBe('DECLINED')

    const row = await readConfirmationRow(bookingId)
    expect(row.clientConfirmationDeclinedAt).not.toBeNull()
    // D5: the booking is untouched — still ACCEPTED, still occupying its slot.
    expect(row.status).toBe(BookingStatus.ACCEPTED)

    const proNotifications = await db.notification.findMany({
      where: {
        professionalId: fx.professionalId,
        eventKey: NotificationEventKey.APPOINTMENT_CONFIRMATION_DECLINED,
      },
      select: { bookingId: true },
    })
    expect(proNotifications).toHaveLength(1)
    expect(proNotifications[0]?.bookingId).toBe(bookingId)

    // The latest answer wins through REAL writes (K11's derivation).
    await new Promise((resolve) => setTimeout(resolve, 15))
    const confirmed = await recordAppointmentConfirmationFromClientToken({
      rawToken,
      answer: 'CONFIRM',
    })
    expect(confirmed.state).toBe('CLIENT_CONFIRMED')
  })

  it('refuses an answer once the booking is cancelled, and an expired token never resolves', async () => {
    const bookingId = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS),
    })
    const { rawToken } = await armAndExtractToken(bookingId)

    await db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED },
      select: { id: true },
    })

    await expect(
      recordAppointmentConfirmationFromClientToken({
        rawToken,
        answer: 'CONFIRM',
      }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CONFIRMATION_UNAVAILABLE' })

    // Expiry: the token dies at the appointment start.
    await db.clientActionToken.updateMany({
      where: { bookingId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    await expect(
      resolveAppointmentConfirmationTokenForMutation({ rawToken }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_TOKEN_INVALID' })
  })
})

describe('in-app answer parity with the link answer (the K13 DoD)', () => {
  /**
   * The whole point of K13's shared core: a client who answers in the app and a
   * client who answers from the reminder link are saying the same thing, so the
   * two must be indistinguishable in the database afterwards. Run side by side
   * on two identical bookings — a single-path assertion would pass just as
   * happily against two separate implementations that had drifted.
   */
  it('confirm: both paths leave identical stamps, status and derived state', async () => {
    // An hour apart because `@@unique([professionalId, scheduledFor])` makes
    // two bookings at the same instant impossible — the pair is otherwise
    // identical, and both are the same distance from any policy window.
    const viaLink = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS),
    })
    const viaApp = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS, 1),
    })

    const { rawToken } = await armAndExtractToken(viaLink)
    // The in-app booking is armed too, so the ONLY difference between the two
    // is which entry point recorded the answer.
    await armAndExtractToken(viaApp)

    const linkResult = await recordAppointmentConfirmationFromClientToken({
      rawToken,
      answer: 'CONFIRM',
    })
    const appResult = await recordAppointmentConfirmationFromAuthedClient({
      bookingId: viaApp,
      clientId: fx.clientId,
      answer: 'CONFIRM',
    })

    expect(appResult.state).toBe(linkResult.state)
    expect(appResult.meta.mutated).toBe(linkResult.meta.mutated)

    const linkRow = await readConfirmationRow(viaLink)
    const appRow = await readConfirmationRow(viaApp)

    expect(appRow.status).toBe(linkRow.status)
    expect(appRow.clientConfirmedAt).not.toBeNull()
    expect(appRow.clientConfirmationDeclinedAt).toBeNull()
    // Same SHAPE of row: which columns carry a value, not the instants.
    expect({
      requested: appRow.clientConfirmationRequestedAt != null,
      confirmed: appRow.clientConfirmedAt != null,
      declined: appRow.clientConfirmationDeclinedAt != null,
    }).toEqual({
      requested: linkRow.clientConfirmationRequestedAt != null,
      confirmed: linkRow.clientConfirmedAt != null,
      declined: linkRow.clientConfirmationDeclinedAt != null,
    })
    expect(deriveClientConfirmationState(appRow)).toBe(
      deriveClientConfirmationState(linkRow),
    )
  })

  it('decline: both paths keep the slot (D5) and both notify the pro', async () => {
    const appScheduledFor = futureWorkingInstant(48 * HOUR_MS, 1)
    const viaLink = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS),
    })
    const viaApp = await seedBooking({ scheduledFor: appScheduledFor })

    const { rawToken } = await armAndExtractToken(viaLink)
    await armAndExtractToken(viaApp)

    const linkResult = await recordAppointmentConfirmationFromClientToken({
      rawToken,
      answer: 'DECLINE',
    })
    const appResult = await recordAppointmentConfirmationFromAuthedClient({
      bookingId: viaApp,
      clientId: fx.clientId,
      answer: 'DECLINE',
    })

    expect(appResult.state).toBe('DECLINED')
    expect(appResult.state).toBe(linkResult.state)

    const linkRow = await readConfirmationRow(viaLink)
    const appRow = await readConfirmationRow(viaApp)

    // D5 on BOTH paths: declining never frees the time.
    expect(appRow.status).toBe(BookingStatus.ACCEPTED)
    expect(linkRow.status).toBe(BookingStatus.ACCEPTED)
    expect(appRow.scheduledFor.getTime()).toBe(appScheduledFor.getTime())
    expect(appRow.clientConfirmationDeclinedAt).not.toBeNull()

    // The pro hears about it either way — one row per booking, same event.
    const declineNotifications = await db.notification.findMany({
      where: {
        professionalId: fx.professionalId,
        eventKey: NotificationEventKey.APPOINTMENT_CONFIRMATION_DECLINED,
        bookingId: { in: [viaLink, viaApp] },
      },
      select: { bookingId: true },
    })
    expect(declineNotifications.map((n) => n.bookingId).sort()).toEqual(
      [viaLink, viaApp].sort(),
    )
  })

  it('the client’s own feed carries the ask — and carries nothing when nobody asked, or when the loop is off', async () => {
    const ORIGINAL_FLAG = process.env.ENABLE_CLIENT_CONFIRMATION_LOOP
    process.env.ENABLE_CLIENT_CONFIRMATION_LOOP = '1'
    try {
      await driveTheFeed()
    } finally {
      if (ORIGINAL_FLAG === undefined) {
        delete process.env.ENABLE_CLIENT_CONFIRMATION_LOOP
      } else {
        process.env.ENABLE_CLIENT_CONFIRMATION_LOOP = ORIGINAL_FLAG
      }
    }
  })

  async function driveTheFeed() {
    const asked = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS),
    })
    const unasked = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS, 1),
    })
    await armAndExtractToken(asked)

    // The REAL feed the web list and the iOS client app both read — select,
    // DTO and all. Asserting on the helper alone would prove the badge derives,
    // not that it reaches the surface that has to draw the answer control.
    const before = await loadClientBookingBuckets(fx.clientId)
    const findIn = (
      buckets: Awaited<ReturnType<typeof loadClientBookingBuckets>>,
      id: string,
    ) =>
      [
        ...buckets.buckets.upcoming,
        ...buckets.buckets.pending,
        ...buckets.buckets.prebooked,
      ].find((b) => b.id === id)

    expect(findIn(before, asked)?.clientConfirmation?.kind).toBe(
      'AWAITING_CLIENT',
    )
    // Nobody asked about this one: the key is ABSENT, not a "not requested"
    // badge the app would have to know to ignore.
    expect(findIn(before, unasked)).toBeDefined()
    expect(findIn(before, unasked)?.clientConfirmation).toBeUndefined()

    await recordAppointmentConfirmationFromAuthedClient({
      bookingId: asked,
      clientId: fx.clientId,
      answer: 'CONFIRM',
    })

    const after = await loadClientBookingBuckets(fx.clientId)
    expect(findIn(after, asked)?.clientConfirmation?.kind).toBe(
      'CLIENT_CONFIRMED',
    )

    // 🔴 The kill switch reaches the CONTROL, not just the writes. Turn the
    // loop off with the stamps still on the row — the state the flag being
    // flipped back mid-trial would leave — and the client's feed must stop
    // offering an answer, because every answer route now refuses.
    delete process.env.ENABLE_CLIENT_CONFIRMATION_LOOP
    const dark = await loadClientBookingBuckets(fx.clientId)
    expect(findIn(dark, asked)).toBeDefined()
    expect(findIn(dark, asked)?.clientConfirmation).toBeUndefined()
  }

  it('refuses another client’s booking with the same uniform not-found as a missing one', async () => {
    const bookingId = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS),
    })

    await expect(
      recordAppointmentConfirmationFromAuthedClient({
        bookingId,
        clientId: 'cli_not_the_owner',
        answer: 'CONFIRM',
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' })

    // Nothing was written on the way to the refusal.
    const row = await readConfirmationRow(bookingId)
    expect(row.clientConfirmedAt).toBeNull()
    expect(row.clientConfirmationDeclinedAt).toBeNull()
  })

  it('applies the same refusals as the link path once the booking is cancelled or underway', async () => {
    const cancelled = await seedBooking({
      scheduledFor: futureWorkingInstant(48 * HOUR_MS),
      status: BookingStatus.CANCELLED,
    })

    await expect(
      recordAppointmentConfirmationFromAuthedClient({
        bookingId: cancelled,
        clientId: fx.clientId,
        answer: 'CONFIRM',
      }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CONFIRMATION_UNAVAILABLE' })

    const started = await seedBooking({
      scheduledFor: new Date(Date.now() - HOUR_MS),
    })

    await expect(
      recordAppointmentConfirmationFromAuthedClient({
        bookingId: started,
        clientId: fx.clientId,
        answer: 'CONFIRM',
      }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CONFIRMATION_UNAVAILABLE' })
  })
})

describe('token cancel parity with the authed cancel (the K12 DoD)', () => {
  /** The authed route's exact sequence (cancelBooking + shared orchestration). */
  async function cancelLikeAuthedRoute(bookingId: string) {
    const result = await cancelBooking({
      bookingId,
      actor: { kind: 'client', clientId: fx.clientId },
    })
    const refund = await runCancelRefundOrchestration({
      bookingId,
      actorKind: 'client',
      actorUserId: 'user-authed-test',
      cancelMutated: result.meta.mutated,
      priorStatus: result.priorStatus,
      operation: 'test-authed-cancel',
    })
    return refund
  }

  /** The token route's exact sequence (resolve → cancelBooking → orchestration). */
  async function cancelLikeTokenRoute(rawToken: string) {
    const resolved = await resolveAppointmentConfirmationTokenForMutation({
      rawToken,
    })
    const result = await cancelBooking({
      bookingId: resolved.booking.id,
      actor: { kind: 'client', clientId: resolved.booking.clientId },
    })
    const refund = await runCancelRefundOrchestration({
      bookingId: resolved.booking.id,
      actorKind: 'client',
      actorUserId: null,
      cancelMutated: result.meta.mutated,
      priorStatus: result.priorStatus,
      operation: 'test-token-cancel',
    })
    return refund
  }

  async function readMoneyOutcome(bookingId: string) {
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        status: true,
        cancelledByRole: true,
        depositStatus: true,
        depositRefundedCents: true,
      },
    })
    const refundRows = await db.bookingRefund.findMany({
      where: { bookingId },
      orderBy: { amountCents: 'asc' },
      select: { amountCents: true, status: true, trigger: true },
    })
    return { booking, refundRows }
  }

  it('≥24h out: identical refund summaries and identical DB money outcomes', async () => {
    const authedId = await seedBooking({
      scheduledFor: futureWorkingInstant(72 * HOUR_MS),
      deposit: { pi: `pi_dep_a_${tag}`, depositDollars: '40.00', feeCents: 500 },
    })
    const tokenId = await seedBooking({
      scheduledFor: futureWorkingInstant(72 * HOUR_MS, 1),
      deposit: { pi: `pi_dep_b_${tag}`, depositDollars: '40.00', feeCents: 500 },
    })
    const { rawToken } = await armAndExtractToken(tokenId)

    const authedSummary = await cancelLikeAuthedRoute(authedId)
    const tokenSummary = await cancelLikeTokenRoute(rawToken)

    // The DoD, literally: the same summary object, field for field.
    expect(tokenSummary).toEqual(authedSummary)

    const authedOutcome = await readMoneyOutcome(authedId)
    const tokenOutcome = await readMoneyOutcome(tokenId)
    expect(tokenOutcome).toEqual(authedOutcome)
    expect(authedOutcome.booking.status).toBe(BookingStatus.CANCELLED)
    // ≥24h client cancel refunds the deposit — money actually moved back.
    expect(authedSummary.status).toBe('REFUND_ISSUED')
  })

  it('<24h out: identical forfeiture on both paths (deposit kept, nothing refunded)', async () => {
    // The <24h line is measured from NOW — both appointments sit inside it
    // (still in the future, still ACCEPTED — just under the refund window).
    const authedId = await seedBooking({
      scheduledFor: new Date(Date.now() + 2 * HOUR_MS),
      deposit: { pi: `pi_dep_c_${tag}`, depositDollars: '40.00', feeCents: 500 },
    })
    const tokenId = await seedBooking({
      scheduledFor: new Date(Date.now() + 3 * HOUR_MS),
      deposit: { pi: `pi_dep_d_${tag}`, depositDollars: '40.00', feeCents: 500 },
    })

    const { rawToken } = await armAndExtractToken(tokenId)

    const authedSummary = await cancelLikeAuthedRoute(authedId)
    const tokenSummary = await cancelLikeTokenRoute(rawToken)

    expect(tokenSummary).toEqual(authedSummary)
    expect(authedSummary.status).toBe('FORFEITED')

    const authedOutcome = await readMoneyOutcome(authedId)
    const tokenOutcome = await readMoneyOutcome(tokenId)
    expect(tokenOutcome).toEqual(authedOutcome)
    // Forfeited on BOTH paths — the deposit is kept, no refund rows exist.
    expect(authedOutcome.refundRows).toHaveLength(0)
  })
})

describe('a reschedule resets the confirmation loop', () => {
  it('pro time-move clears all three timestamps; a duration-only edit does not', async () => {
    const scheduledFor = futureWorkingInstant(72 * HOUR_MS)
    const bookingId = await seedBooking({
      scheduledFor,
      requestedAt: new Date(Date.now() - 2 * HOUR_MS),
      confirmedAt: new Date(Date.now() - HOUR_MS),
    })

    // Control first: a duration-only edit must leave the loop alone.
    await updateProBooking({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      overrideReason: null,
      bookingId,
      nextStatus: null,
      notifyClient: false,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      nextStart: null,
      nextBuffer: null,
      nextDuration: 75,
      parsedRequestedItems: null,
      hasBuffer: false,
      hasDuration: true,
      hasServiceItems: false,
    })

    const afterDurationEdit = await readConfirmationRow(bookingId)
    expect(afterDurationEdit.clientConfirmedAt).not.toBeNull()
    expect(deriveClientConfirmationState(afterDurationEdit)).toBe(
      'CLIENT_CONFIRMED',
    )

    // The move: one hour later. The client's answer was to the OLD instant.
    await updateProBooking({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      overrideReason: null,
      bookingId,
      nextStatus: null,
      notifyClient: false,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      nextStart: new Date(scheduledFor.getTime() - HOUR_MS),
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: null,
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: false,
    })

    const afterMove = await readConfirmationRow(bookingId)
    expect(afterMove.clientConfirmationRequestedAt).toBeNull()
    expect(afterMove.clientConfirmedAt).toBeNull()
    expect(afterMove.clientConfirmationDeclinedAt).toBeNull()
    expect(deriveClientConfirmationState(afterMove)).toBe('NOT_REQUESTED')
  })

  it('client hold-path reschedule clears the loop through the real reserve → commit path', async () => {
    const scheduledFor = futureWorkingInstant(72 * HOUR_MS)
    const bookingId = await seedBooking({
      scheduledFor,
      requestedAt: new Date(Date.now() - 2 * HOUR_MS),
      declinedAt: new Date(Date.now() - HOUR_MS),
    })

    const offering = await db.professionalServiceOffering.findUniqueOrThrow({
      where: { id: fx.offeringId },
      select: HOLD_CREATE_OFFERING_SELECT,
    })

    const requestedStart = new Date(scheduledFor.getTime() + 2 * HOUR_MS)

    const hold = await createHold({
      clientId: fx.clientId,
      bookingEntryPoint: 'DIRECT_PROFILE',
      addOnIds: [],
      rescheduleBookingId: bookingId,
      offering: toCreateHoldOffering(offering),
      requestedStart,
      requestedLocationId: fx.locationId,
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
    })

    const result = await rescheduleBookingFromHold({
      bookingId,
      clientId: fx.clientId,
      holdId: hold.hold.id,
      requestedLocationType: null,
      fallbackTimeZone: 'UTC',
    })
    expect(result.booking.scheduledFor.getTime()).toBe(requestedStart.getTime())

    const afterMove = await readConfirmationRow(bookingId)
    expect(afterMove.clientConfirmationRequestedAt).toBeNull()
    expect(afterMove.clientConfirmedAt).toBeNull()
    expect(afterMove.clientConfirmationDeclinedAt).toBeNull()
    expect(deriveClientConfirmationState(afterMove)).toBe('NOT_REQUESTED')
  })
})
