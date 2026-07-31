// tests/integration/pro-client-policy.test.ts
//
// K16 — one pro's booking policy for one client, against real Postgres through
// the REAL write boundary (createHold / finalizeBookingFromHold /
// createProBooking / resolveDiscoveryFinalize), never a re-implementation.
//
// The DoD this suite exists to prove:
//
//   🔴 the self-serve switch stops a NEW appointment and NOTHING else — a
//      reschedule of an appointment the pro already agreed to still works, and
//      the pro can still book that client by hand;
//   🔴 a card-on-file requirement refuses finalize while LEAVING THE HOLD
//      STANDING, so the inline add-card step can finish inside the same
//      reservation, and goes inert when the save-card rail is dark;
//   🔴 a per-client deposit/prepay requirement reaches the money the booking
//      actually stamps.
//
// RED-PROOF — each was RUN against this suite, not reasoned about. See the
// "RED-PROOF RESULTS" block at the bottom for the recorded output.
//
// Run with `pnpm test:integration` (or the whole dir in CI via integration.yml).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  DepositScope,
  DepositType,
  OfferingPrepayScope,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  createHold,
  createProBooking,
  finalizeBookingFromHold,
} from '@/lib/booking/writeBoundary'
import { resolveDiscoveryFinalize } from '@/lib/booking/resolveDiscoveryFinalize'
import { isBookingError } from '@/lib/booking/errors'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `pro_policy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'
const BASE_PRICE = '120.00'
const BASE_DURATION_MINUTES = 60

type Fixtures = {
  tenantId: string
  professionalId: string
  proUserId: string
  clientId: string
  clientUserId: string
  serviceId: string
  offeringId: string
  locationId: string
}

let fx: Fixtures

/**
 * Each booking gets its own slot — the pro-overlap exclusion constraint is real
 * in this database, and two fixtures that touch collide before the test under
 * examination ever runs.
 *
 * Spaced THREE hours, not one: the fixture service is 60 minutes and the pro's
 * buffer extends the reserved range past the hour, so hourly slots overlap and
 * every later test fails with TIME_BOOKED for a reason that has nothing to do
 * with policy.
 */
let slotCursor = 0
function nextStart(): Date {
  slotCursor += 1
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 30)
  // 17:00Z ≈ 10:00 in America/Los_Angeles — inside the fixture working window.
  d.setUTCHours(17, 0, 0, 0)
  d.setUTCHours(d.getUTCHours() + slotCursor * 3)
  return d
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Pro client policy', isActive: true },
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
      firstName: 'Policy',
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
      // This suite books through the REAL hold/finalize path, which refuses a
      // pro who is not booking-ready — so the salon needs an address and coords.
      formattedAddress: '123 Policy St, San Diego, CA 92101',
      addressLine1: '123 Policy St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      workingHours: {
        mon: { enabled: true, start: '00:00', end: '23:59' },
        tue: { enabled: true, start: '00:00', end: '23:59' },
        wed: { enabled: true, start: '00:00', end: '23:59' },
        thu: { enabled: true, start: '00:00', end: '23:59' },
        fri: { enabled: true, start: '00:00', end: '23:59' },
        sat: { enabled: true, start: '00:00', end: '23:59' },
        sun: { enabled: true, start: '00:00', end: '23:59' },
      },
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
      firstName: 'Policy',
      lastName: 'Client',
      email: `${tag}_client@example.com`,
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
      name: `${tag} colour`,
      categoryId: category.id,
      defaultDurationMinutes: BASE_DURATION_MINUTES,
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
      salonDurationMinutes: BASE_DURATION_MINUTES,
      salonPriceStartingAt: new Prisma.Decimal(BASE_PRICE),
    },
    select: { id: true },
  })

  // Stripe-ready with a usable flat deposit, so the money switches have
  // something real to resolve against. Scope stays the DEFAULT
  // (NEW_DISCOVERY_ONLY), which is what makes the per-client deposit test
  // meaningful: this client is NOT new-via-discovery, so nothing but the policy
  // can make them owe a deposit.
  await db.professionalPaymentSettings.create({
    data: {
      professionalId: pro.id,
      depositEnabled: true,
      depositType: DepositType.FLAT,
      depositFlatAmount: new Prisma.Decimal('40.00'),
      depositScope: DepositScope.NEW_DISCOVERY_ONLY,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  })

  fx = {
    tenantId: tenant.id,
    professionalId: pro.id,
    proUserId: proUser.id,
    clientId: client.id,
    clientUserId: clientUser.id,
    serviceId: service.id,
    offeringId: offering.id,
    locationId: location.id,
  }
}, 120_000)

afterAll(async () => {
  // Resolved by TAG, not from `fx`: a seed that throws half-way leaves rows
  // behind, and an `if (!fx) return` would skip the cleanup the NEXT run trips
  // over ([[failed-seed-leaves-orphans-confounds-next-run]]).
  const pros = await db.professionalProfile.findMany({
    where: { businessName: { startsWith: tag } },
    select: { id: true },
  })
  const proIds = pros.map((p) => p.id)
  const users = await db.user.findMany({
    where: { email: { startsWith: tag } },
    select: { id: true },
  })
  const userIds = users.map((u) => u.id)
  const clients = await db.clientProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  })
  const clientIds = clients.map((c) => c.id)

  await db.proClientPolicy.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.clientPaymentMethod.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await db.bookingHold.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.bookingServiceItem.deleteMany({
    where: { booking: { professionalId: { in: proIds } } },
  })
  await db.booking.deleteMany({ where: { professionalId: { in: proIds } } })
  await db.professionalPaymentSettings.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.professionalServiceOffering.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.professionalLocation.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await db.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await db.professionalProfile.deleteMany({ where: { id: { in: proIds } } })
  await db.service.deleteMany({ where: { name: { startsWith: tag } } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.user.deleteMany({ where: { id: { in: userIds } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 120_000)

beforeEach(async () => {
  // Every test states its own policy. Clearing here means a test can never
  // inherit the previous one's requirement and pass for the wrong reason.
  await db.proClientPolicy.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.clientPaymentMethod.deleteMany({ where: { clientId: fx.clientId } })
  delete process.env.ENABLE_NO_SHOW_PROTECTION
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setPolicy(patch: {
  requireDeposit?: boolean
  prepayScope?: OfferingPrepayScope | null
  requireCardOnFile?: boolean
  blockSelfServeBooking?: boolean
}) {
  const data = {
    requireDeposit: patch.requireDeposit ?? false,
    prepayScope: patch.prepayScope ?? null,
    requireCardOnFile: patch.requireCardOnFile ?? false,
    blockSelfServeBooking: patch.blockSelfServeBooking ?? false,
  }

  await db.proClientPolicy.upsert({
    where: {
      professionalId_clientId: {
        professionalId: fx.professionalId,
        clientId: fx.clientId,
      },
    },
    create: {
      professionalId: fx.professionalId,
      clientId: fx.clientId,
      ...data,
    },
    update: data,
  })
}

function holdOffering() {
  return {
    id: fx.offeringId,
    professionalId: fx.professionalId,
    serviceId: fx.serviceId,
    offersInSalon: true,
    offersMobile: false,
    salonPriceStartingAt: new Prisma.Decimal(BASE_PRICE),
    salonDurationMinutes: BASE_DURATION_MINUTES,
    mobilePriceStartingAt: null,
    mobileDurationMinutes: null,
    professionalTimeZone: ZONE,
  }
}

function holdIt(args: { start: Date; rescheduleBookingId?: string | null }) {
  return createHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    addOnIds: [],
    rescheduleBookingId: args.rescheduleBookingId ?? null,
    offering: holdOffering(),
    requestedStart: args.start,
    requestedLocationId: fx.locationId,
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
  })
}

async function finalizeIt(holdId: string) {
  const discovery = await resolveDiscoveryFinalize({
    clientId: fx.clientId,
    clientUserId: fx.clientUserId,
    professionalId: fx.professionalId,
    offeringId: fx.offeringId,
    lookPostId: null,
    mediaId: null,
    source: BookingSource.REQUESTED,
    aftercare: false,
  })

  return finalizeBookingFromHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    holdId,
    openingId: null,
    addOnIds: [],
    locationType: ServiceLocationType.SALON,
    source: BookingSource.REQUESTED,
    initialStatus: BookingStatus.PENDING,
    rebookOfBookingId: null,
    offering: holdOffering(),
    discovery,
  })
}

/** The code a booking refusal carried, or null when the call SUCCEEDED. */
async function refusalCode(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run()
    return null
  } catch (error: unknown) {
    if (isBookingError(error)) return error.code
    throw error
  }
}

// ─── 1. The self-serve switch ────────────────────────────────────────────────

describe('blockSelfServeBooking', () => {
  it('1. refuses a NEW self-serve hold', async () => {
    await setPolicy({ blockSelfServeBooking: true })

    const code = await refusalCode(() => holdIt({ start: nextStart() }))

    expect(code).toBe('SELF_SERVE_BOOKING_UNAVAILABLE')
  })

  // 🔴 The refusal must not cost the pro calendar time. If the hold row landed
  // before the check, a blocked client could still sit on the pro's slots.
  it('2. reserves nothing when it refuses', async () => {
    await setPolicy({ blockSelfServeBooking: true })
    const start = nextStart()

    await refusalCode(() => holdIt({ start }))

    const holds = await db.bookingHold.count({
      where: { professionalId: fx.professionalId, scheduledFor: start },
    })

    expect(holds).toBe(0)
  })

  it('3. lets the same client hold once the switch is off', async () => {
    await setPolicy({ blockSelfServeBooking: false })

    const held = await holdIt({ start: nextStart() })

    expect(held.hold.id).toBeTruthy()
  })

  // 🔴 Tori's decision, and the reason the check reads `rescheduleBookingId`:
  // an appointment the pro ALREADY agreed to must stay movable, or the
  // Reschedule button inside K12's reminder starts 400ing.
  it('4. still allows a RESCHEDULE hold for a blocked client', async () => {
    const booked = await finalizeIt((await holdIt({ start: nextStart() })).hold.id)

    await setPolicy({ blockSelfServeBooking: true })

    // Same client, same pro, switch on — but this moves an existing booking.
    const moved = await holdIt({
      start: nextStart(),
      rescheduleBookingId: booked.booking.id,
    })

    expect(moved.hold.id).toBeTruthy()
  })

  // The pro booking their own client by hand is the POINT of the switch.
  it('5. never blocks a pro-created booking', async () => {
    await setPolicy({ blockSelfServeBooking: true })

    const created = await createProBooking({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      overrideReason: null,
      clientId: fx.clientId,
      offeringId: fx.offeringId,
      scheduledFor: nextStart(),
      locationId: fx.locationId,
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(created.booking.id).toBeTruthy()
  })
})

// ─── 2. The card-on-file requirement ─────────────────────────────────────────

describe('requireCardOnFile', () => {
  it('6. refuses finalize when the client has no saved card', async () => {
    process.env.ENABLE_NO_SHOW_PROTECTION = '1'
    await setPolicy({ requireCardOnFile: true })

    const held = await holdIt({ start: nextStart() })
    const code = await refusalCode(() => finalizeIt(held.hold.id))

    expect(code).toBe('CARD_ON_FILE_REQUIRED')
  })

  // 🔴 The hold must SURVIVE the refusal — the inline add-card step finishes
  // inside the same reservation. Enforcing at hold creation instead would take
  // the slot away from the client while they go and save a card.
  it('7. leaves the hold standing so the card step can finish', async () => {
    process.env.ENABLE_NO_SHOW_PROTECTION = '1'
    await setPolicy({ requireCardOnFile: true })

    const held = await holdIt({ start: nextStart() })
    await refusalCode(() => finalizeIt(held.hold.id))

    const stillHeld = await db.bookingHold.findUnique({
      where: { id: held.hold.id },
      select: { id: true },
    })
    expect(stillHeld).not.toBeNull()

    // Now the client saves a card — and the SAME hold finalizes.
    await db.clientPaymentMethod.create({
      data: {
        clientId: fx.clientId,
        stripePaymentMethodId: `pm_${tag}_${slotCursor}`,
        brand: 'visa',
        last4: '4242',
      },
    })

    const booked = await finalizeIt(held.hold.id)
    expect(booked.booking.id).toBeTruthy()
  })

  // 🔴 AFTERCARE is exempt because that path is UNAUTHENTICATED. `source:
  // AFTERCARE` reaches finalize only through the aftercare-token branch, and a
  // token-flow client has no session, so the setup-intent route 401s for them —
  // enforcing here would refuse the rebook and offer an add-card step that
  // cannot work. Same reasoning that already keeps deposits off this path
  // (K10-A-2). A pro who wants this client gated uses blockSelfServeBooking,
  // which DOES cover aftercare rebooks.
  it('8. does NOT refuse an aftercare rebook, which cannot save a card', async () => {
    process.env.ENABLE_NO_SHOW_PROTECTION = '1'
    await setPolicy({ requireCardOnFile: true })

    const held = await holdIt({ start: nextStart() })

    const discovery = await resolveDiscoveryFinalize({
      clientId: fx.clientId,
      clientUserId: null,
      professionalId: fx.professionalId,
      offeringId: fx.offeringId,
      lookPostId: null,
      mediaId: null,
      source: BookingSource.AFTERCARE,
      aftercare: true,
    })

    const booked = await finalizeBookingFromHold({
      clientId: fx.clientId,
      bookingEntryPoint: 'DIRECT_PROFILE',
      holdId: held.hold.id,
      openingId: null,
      addOnIds: [],
      locationType: ServiceLocationType.SALON,
      source: BookingSource.AFTERCARE,
      initialStatus: BookingStatus.PENDING,
      rebookOfBookingId: null,
      offering: holdOffering(),
      discovery,
    })

    expect(booked.booking.id).toBeTruthy()
  })

  // 🔴 The rail gate. With ENABLE_NO_SHOW_PROTECTION off, no client can save a
  // card at all, so enforcing the requirement would strand every booking.
  it('9. is inert while the save-card rail is dark', async () => {
    delete process.env.ENABLE_NO_SHOW_PROTECTION
    await setPolicy({ requireCardOnFile: true })

    const held = await holdIt({ start: nextStart() })
    const booked = await finalizeIt(held.hold.id)

    expect(booked.booking.id).toBeTruthy()
  })
})

// ─── 3. The money switches ───────────────────────────────────────────────────

describe('requireDeposit / prepayScope', () => {
  // The fixture pro's scope is NEW_DISCOVERY_ONLY and this client is a DIRECT
  // booking with a prior relationship, so ONLY the policy can make them owe
  // anything up front. That is what makes this test about the policy.
  it('10. a direct booking owes nothing up front without a policy', async () => {
    const directive = await resolveDiscoveryFinalize({
      clientId: fx.clientId,
      clientUserId: fx.clientUserId,
      professionalId: fx.professionalId,
      offeringId: fx.offeringId,
      lookPostId: null,
      mediaId: null,
      source: BookingSource.REQUESTED,
      aftercare: false,
    })

    expect(directive.depositRequirement.required).toBe(false)
  })

  it('11. requireDeposit makes that same booking owe the deposit', async () => {
    await setPolicy({ requireDeposit: true })

    const directive = await resolveDiscoveryFinalize({
      clientId: fx.clientId,
      clientUserId: fx.clientUserId,
      professionalId: fx.professionalId,
      offeringId: fx.offeringId,
      lookPostId: null,
      mediaId: null,
      source: BookingSource.REQUESTED,
      aftercare: false,
    })

    expect(directive.depositRequirement.required).toBe(true)
    expect(directive.depositRequirement.scopeRequired).toBe(true)
    // Widens the DEPOSIT only — the platform's discovery fee stays pinned to the
    // new-via-discovery subset, exactly as K10-A pinned it against depositScope.
    expect(directive.feeEligible).toBe(false)
  })

  it('12. and the stamped booking actually carries it', async () => {
    await setPolicy({ requireDeposit: true })

    const held = await holdIt({ start: nextStart() })
    const booked = await finalizeIt(held.hold.id)

    const row = await db.booking.findUniqueOrThrow({
      where: { id: booked.booking.id },
      select: { depositAmount: true },
    })

    // The pro's configured flat $40 — the policy widened the scope, it did not
    // invent an amount.
    expect(Number(row.depositAmount)).toBe(40)
  })

  it('13. a per-client prepay requirement reaches the directive', async () => {
    await setPolicy({ prepayScope: OfferingPrepayScope.ENTIRE_BOOKING })

    const directive = await resolveDiscoveryFinalize({
      clientId: fx.clientId,
      clientUserId: fx.clientUserId,
      professionalId: fx.professionalId,
      offeringId: fx.offeringId,
      lookPostId: null,
      mediaId: null,
      source: BookingSource.REQUESTED,
      aftercare: false,
    })

    expect(directive.depositRequirement.prepayScope).toBe(
      OfferingPrepayScope.ENTIRE_BOOKING,
    )
    expect(directive.depositRequirement.required).toBe(true)
  })

  // The scope UNION: the offering asks for the service only, the client policy
  // asks for the whole booking — the wider one wins.
  it('14. takes the WIDER of the offering and client prepay scopes', async () => {
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { prepayScope: OfferingPrepayScope.SERVICE_ONLY },
    })
    await setPolicy({ prepayScope: OfferingPrepayScope.ENTIRE_BOOKING })

    try {
      const directive = await resolveDiscoveryFinalize({
        clientId: fx.clientId,
        clientUserId: fx.clientUserId,
        professionalId: fx.professionalId,
        offeringId: fx.offeringId,
        lookPostId: null,
        mediaId: null,
        source: BookingSource.REQUESTED,
        aftercare: false,
      })

      expect(directive.depositRequirement.prepayScope).toBe(
        OfferingPrepayScope.ENTIRE_BOOKING,
      )
    } finally {
      await db.professionalServiceOffering.update({
        where: { id: fx.offeringId },
        data: { prepayScope: null },
      })
    }
  })

  // 🔴 A prepaid booking must hold the BILL, not the bill plus a deposit. The
  // two money terms take max, never a sum (lib/booking/prepay.ts).
  it('15. prepay + an account deposit collect the max, never the sum', async () => {
    await setPolicy({
      requireDeposit: true,
      prepayScope: OfferingPrepayScope.ENTIRE_BOOKING,
    })

    const held = await holdIt({ start: nextStart() })
    const booked = await finalizeIt(held.hold.id)

    const row = await db.booking.findUniqueOrThrow({
      where: { id: booked.booking.id },
      select: { depositAmount: true, totalAmount: true, subtotalSnapshot: true },
    })

    const deposit = Number(row.depositAmount)
    const bill = Number(row.totalAmount ?? row.subtotalSnapshot)

    // 100% of the $120 bill, NOT $120 + the pro's $40 flat deposit.
    expect(deposit).toBe(bill)
    expect(deposit).toBe(120)
  })

  // 🔴 The asymmetry, pinned. A per-client deposit widens the pro's SCOPE; it
  // cannot conjure an AMOUNT. With the pro's account-wide deposit switched off,
  // `computeDepositCents` returns 0 for every booking, so honouring the switch
  // here would stamp "deposit required, $0 to pay" — a booking waiting on a
  // charge that does not exist, which the 24h release sweep would then cancel.
  // The requirement stands down instead, and the write route refuses to STORE
  // it in this state (`describeDepositRequirementBlocker`).
  it('16. requireDeposit stands down when the pro has no deposit configured', async () => {
    await db.professionalPaymentSettings.update({
      where: { professionalId: fx.professionalId },
      data: { depositEnabled: false },
    })
    await setPolicy({ requireDeposit: true })

    try {
      const directive = await resolveDiscoveryFinalize({
        clientId: fx.clientId,
        clientUserId: fx.clientUserId,
        professionalId: fx.professionalId,
        offeringId: fx.offeringId,
        lookPostId: null,
        mediaId: null,
        source: BookingSource.REQUESTED,
        aftercare: false,
      })

      expect(directive.depositRequirement.required).toBe(false)

      // And the booking it stamps really does owe nothing — not $0-but-required.
      const held = await holdIt({ start: nextStart() })
      const booked = await finalizeIt(held.hold.id)
      const row = await db.booking.findUniqueOrThrow({
        where: { id: booked.booking.id },
        select: { depositAmount: true },
      })

      expect(Number(row.depositAmount ?? 0)).toBe(0)
    } finally {
      await db.professionalPaymentSettings.update({
        where: { professionalId: fx.professionalId },
        data: { depositEnabled: true },
      })
    }
  })

  // 🔴 PREPAY is the other half of that asymmetry: it DOES override the pro's
  // account-wide deposit switch, exactly as K10's per-service requirement does,
  // because it sizes itself from the bill and needs no configuration.
  it('17. prepay still applies with the account deposit switched off', async () => {
    await db.professionalPaymentSettings.update({
      where: { professionalId: fx.professionalId },
      data: { depositEnabled: false },
    })
    await setPolicy({ prepayScope: OfferingPrepayScope.ENTIRE_BOOKING })

    try {
      const held = await holdIt({ start: nextStart() })
      const booked = await finalizeIt(held.hold.id)
      const row = await db.booking.findUniqueOrThrow({
        where: { id: booked.booking.id },
        select: { depositAmount: true, totalAmount: true, subtotalSnapshot: true },
      })

      const bill = Number(row.totalAmount ?? row.subtotalSnapshot)
      expect(Number(row.depositAmount)).toBe(bill)
    } finally {
      await db.professionalPaymentSettings.update({
        where: { professionalId: fx.professionalId },
        data: { depositEnabled: true },
      })
    }
  })
})

// ─── RED-PROOF RESULTS ───────────────────────────────────────────────────────
//
// Each wrong implementation below was actually RUN against this suite. The
// quoted output is what the run printed — including one result that did NOT
// match the prediction written before running it (proof 2).
//
//  1. Drop the `if (!rescheduleBookingId)` guard in performLockedCreateHold, so
//     the switch refuses every hold → 1 failed | 16 passed. Only test 4 fails.
//     🔴 Tests 1–3 stay GREEN, which is exactly why the exemption needs its own
//     test: an implementation that blocks EVERYTHING passes every test that
//     only asks whether the refusal happens.
//
//  2. Move `assertClientCardOnFileSatisfied` from finalize up into
//     performLockedCreateHold (the "check it early" instinct) → 2 failed |
//     12 passed: tests 6 AND 7 fail, both with an escaping
//     "BookingError: This booking requires the client to have a card on file."
//     thrown from `holdIt`. 🔴 The prediction written here first said test 6
//     would stay green; it does not, because test 6 wraps only `finalizeIt` in
//     the refusal helper, so a throw one step earlier escapes as an error
//     rather than being read as a code. Recorded as run, not as predicted.
//
//  3. Have resolveProClientPolicy ignore `cardOnFileRailEnabled` (return the
//     stored boolean) → 1 failed | 16 passed. Test 9 fails with
//     "CARD_ON_FILE_REQUIRED" on a platform where no client can save a card.
//
//  4. Remove the `source !== AFTERCARE` exemption from the card-on-file gate →
//     1 failed | 16 passed. Test 8 fails, "CARD_ON_FILE_REQUIRED" on the one
//     path whose client has no session and therefore no way to save a card.
//     🔴 Found in review, not by a test: the first implementation had no
//     exemption, and every other test stayed green because they all finalize as
//     an authenticated client.
//
//  5. Let the per-client deposit override `proDepositEnabled` the way prepay
//     does (`(enabled && matchesScope) || clientPolicyRequiresDeposit`) →
//     1 failed | 16 passed. Test 16 fails, "expected true to be false": the
//     directive reports a deposit REQUIRED for a pro whose configuration can
//     only ever compute $0 — the stranded charge this design refuses to create.
//     🔴 This proof needs test 16 specifically; against the fixture's
//     deposit-enabled pro the override changes nothing and the whole suite
//     stays green.
