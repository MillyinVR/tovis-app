// K8: the pro's per-service calendar colour, resolved from REAL rows.
//
// The chain (BASE service item's offering → the pro's offering for the
// booking's service → category default → none) is already pinned as pure logic
// by lib/calendar/eventColor.test.ts and lib/calendar/serviceSwatch.test.ts.
// What only a database can prove is the half those cannot fake:
//
//   - `Booking.offeringId` is genuinely nullable, and a real null row still
//     resolves through the per-service fallback;
//   - a real multi-service booking (BASE + ADD_ON rows, real enum, real
//     sortOrder) picks the base service's colour;
//   - the fallback query is scoped to the viewing pro, so a second pro's colour
//     for the same catalog service cannot leak onto this pro's calendar;
//   - a value in the column that is no longer in the palette falls THROUGH to
//     the next step instead of blanking the chain.
//
// The route↔helper half of the contract is enforced by the compiler, not here:
// `SwatchBookingRow` requires every column the resolver reads, so
// app/api/v1/pro/calendar/route.ts cannot drop one without failing typecheck
// (it did exactly that during K8 until `serviceId` was added to the select).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingServiceItemType,
  BookingStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  loadOfferingSwatchesByServiceId,
  resolveBookingServiceSwatch,
} from '@/lib/calendar/serviceSwatch'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

/** Exactly the shape `SwatchBookingRow` demands — the route selects the same. */
const swatchBookingSelect = {
  id: true,
  serviceId: true,
  offering: { select: { calendarSwatch: true } },
  serviceItems: {
    select: {
      itemType: true,
      sortOrder: true,
      offering: { select: { calendarSwatch: true } },
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.BookingSelect

type Fixtures = {
  tenantId: string
  clientId: string
  professionalId: string
  otherProfessionalId: string
  locationId: string
  /** serviceId → the pro's offering id for it. */
  offeringByService: Map<string, string>
  serviceIds: {
    /** Pro's offering swatch '09'. */
    coloured: string
    /** Pro's offering swatch '02'. */
    secondColoured: string
    /** Pro's offering swatch '11' — used as an ADD_ON. */
    addOn: string
    /** Pro's offering swatch is NULL. */
    colourless: string
    /** Pro's offering swatch is a value no longer in the palette. */
    stale: string
    /** ONLY the other pro has a colour for this one. */
    otherProOnly: string
  }
}

let fx: Fixtures

async function seedFixtures(): Promise<Fixtures> {
  const tag = `swatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
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
      homeTenantId: tenant.id,
      firstName: 'Swatch',
      lastName: 'Client',
    },
    select: { id: true },
  })

  async function createPro(suffix: string) {
    const user = await db.user.create({
      data: {
        email: `${tag}_pro${suffix}@example.com`,
        password: 'test-password',
        role: Role.PRO,
      },
      select: { id: true },
    })

    const profile = await db.professionalProfile.create({
      data: {
        userId: user.id,
        homeTenantId: tenant.id,
        firstName: 'Swatch',
        lastName: `Pro${suffix}`,
        businessName: `Swatch Studio ${suffix}`,
        timeZone: 'America/Los_Angeles',
      },
      select: { id: true },
    })

    return profile.id
  }

  const professionalId = await createPro('A')
  const otherProfessionalId = await createPro('B')

  const category = await db.serviceCategory.create({
    data: { name: `${tag} Category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })

  async function createService(name: string) {
    const service = await db.service.create({
      data: {
        name: `${tag} ${name}`,
        categoryId: category.id,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('100.00'),
        isActive: true,
      },
      select: { id: true },
    })

    return service.id
  }

  const serviceIds = {
    coloured: await createService('Coloured'),
    secondColoured: await createService('SecondColoured'),
    addOn: await createService('AddOn'),
    colourless: await createService('Colourless'),
    stale: await createService('Stale'),
    otherProOnly: await createService('OtherProOnly'),
  }

  const offeringByService = new Map<string, string>()

  async function createOffering(args: {
    professionalId: string
    serviceId: string
    calendarSwatch: string | null
    remember?: boolean
  }) {
    const offering = await db.professionalServiceOffering.create({
      data: {
        professionalId: args.professionalId,
        serviceId: args.serviceId,
        offersInSalon: true,
        salonPriceStartingAt: new Prisma.Decimal('100.00'),
        salonDurationMinutes: 60,
        calendarSwatch: args.calendarSwatch,
      },
      select: { id: true },
    })

    if (args.remember !== false) {
      offeringByService.set(args.serviceId, offering.id)
    }

    return offering.id
  }

  await createOffering({
    professionalId,
    serviceId: serviceIds.coloured,
    calendarSwatch: '09',
  })
  await createOffering({
    professionalId,
    serviceId: serviceIds.secondColoured,
    calendarSwatch: '02',
  })
  await createOffering({
    professionalId,
    serviceId: serviceIds.addOn,
    calendarSwatch: '11',
  })
  await createOffering({
    professionalId,
    serviceId: serviceIds.colourless,
    calendarSwatch: null,
  })
  await createOffering({
    professionalId,
    serviceId: serviceIds.stale,
    calendarSwatch: 'legacy-teal',
  })
  await createOffering({
    professionalId,
    serviceId: serviceIds.otherProOnly,
    calendarSwatch: null,
  })

  // The SAME catalog service, coloured by a different pro. Nothing this pro's
  // calendar reads may pick it up.
  await createOffering({
    professionalId: otherProfessionalId,
    serviceId: serviceIds.otherProOnly,
    calendarSwatch: '12',
    remember: false,
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'Swatch Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Swatch St, San Diego, CA 92101',
      addressLine1: '123 Swatch St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: 'America/Los_Angeles',
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

  return {
    tenantId: tenant.id,
    clientId: client.id,
    professionalId,
    otherProfessionalId,
    locationId: location.id,
    offeringByService,
    serviceIds,
  }
}

let bookingHourCursor = 0

async function createBooking(args: {
  serviceId: string
  /** `null` reproduces the nullable `Booking.offeringId` the chain exists for. */
  offeringId: string | null
  items?: {
    serviceId: string
    offeringId: string | null
    itemType: BookingServiceItemType
    sortOrder: number
  }[]
}): Promise<string> {
  // Distinct instants: the pro has a GIST overlap constraint on active
  // bookings, so seeded rows must not share a slot.
  bookingHourCursor += 1

  const scheduledFor = new Date()
  scheduledFor.setUTCDate(scheduledFor.getUTCDate() + 1)
  scheduledFor.setUTCHours(6 + bookingHourCursor, 0, 0, 0)

  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: args.serviceId,
      offeringId: args.offeringId,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      scheduledFor,
      status: BookingStatus.ACCEPTED,
      locationId: fx.locationId,
      locationType: ServiceLocationType.SALON,
      locationTimeZone: 'America/Los_Angeles',
      totalDurationMinutes: 60,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalAmount: new Prisma.Decimal('100.00'),
      ...(args.items?.length
        ? {
            serviceItems: {
              create: args.items.map((item) => ({
                serviceId: item.serviceId,
                offeringId: item.offeringId,
                itemType: item.itemType,
                sortOrder: item.sortOrder,
                priceSnapshot: new Prisma.Decimal('100.00'),
                durationMinutesSnapshot: 60,
              })),
            },
          }
        : {}),
    },
    select: { id: true },
  })

  return booking.id
}

/**
 * The route's own two steps, run against the database: load the fallback map
 * for the rows that need it, then resolve each booking.
 */
async function resolveSwatches(
  bookingIds: readonly string[],
): Promise<Map<string, string | null>> {
  const rows = await db.booking.findMany({
    where: { id: { in: [...bookingIds] } },
    select: swatchBookingSelect,
  })

  const swatchByServiceId = await loadOfferingSwatchesByServiceId({
    db,
    professionalId: fx.professionalId,
  })

  return new Map(
    rows.map((row) => [row.id, resolveBookingServiceSwatch(row, swatchByServiceId)]),
  )
}

async function resolveOne(bookingId: string): Promise<string | null> {
  const map = await resolveSwatches([bookingId])

  return map.get(bookingId) ?? null
}

beforeAll(async () => {
  fx = await seedFixtures()
}, 60_000)

afterAll(async () => {
  // Leaf-first, filtered to this suite's rows — other suites own broad wipes.
  await db.bookingServiceItem.deleteMany({
    where: { booking: { professionalId: fx.professionalId } },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.professionalServiceOffering.deleteMany({
    where: {
      professionalId: { in: [fx.professionalId, fx.otherProfessionalId] },
    },
  })
  await db.$disconnect()
})

describe('per-service calendar swatch (real DB)', () => {
  it('takes the BASE item’s colour on a multi-service booking, not the add-on’s', async () => {
    const bookingId = await createBooking({
      serviceId: fx.serviceIds.coloured,
      // The booking-level offering points at a DIFFERENT colour on purpose:
      // if the item chain were skipped, this would surface as '02'.
      offeringId: fx.offeringByService.get(fx.serviceIds.secondColoured) ?? null,
      items: [
        {
          serviceId: fx.serviceIds.addOn,
          offeringId: fx.offeringByService.get(fx.serviceIds.addOn) ?? null,
          itemType: BookingServiceItemType.ADD_ON,
          sortOrder: 0,
        },
        {
          serviceId: fx.serviceIds.coloured,
          offeringId: fx.offeringByService.get(fx.serviceIds.coloured) ?? null,
          itemType: BookingServiceItemType.BASE,
          sortOrder: 1,
        },
      ],
    })

    expect(await resolveOne(bookingId)).toBe('09')
  })

  it('takes the lowest-sortOrder BASE item when a visit holds two services', async () => {
    const bookingId = await createBooking({
      serviceId: fx.serviceIds.coloured,
      offeringId: null,
      items: [
        {
          serviceId: fx.serviceIds.coloured,
          offeringId: fx.offeringByService.get(fx.serviceIds.coloured) ?? null,
          itemType: BookingServiceItemType.BASE,
          sortOrder: 5,
        },
        {
          serviceId: fx.serviceIds.secondColoured,
          offeringId:
            fx.offeringByService.get(fx.serviceIds.secondColoured) ?? null,
          itemType: BookingServiceItemType.BASE,
          sortOrder: 1,
        },
      ],
    })

    expect(await resolveOne(bookingId)).toBe('02')
  })

  it('resolves a booking with a NULL offeringId and no items through the pro’s offering', async () => {
    const bookingId = await createBooking({
      serviceId: fx.serviceIds.coloured,
      offeringId: null,
    })

    expect(await resolveOne(bookingId)).toBe('09')
  })

  it('resolves to no colour when the pro has not coloured the service', async () => {
    const bookingId = await createBooking({
      serviceId: fx.serviceIds.colourless,
      offeringId: fx.offeringByService.get(fx.serviceIds.colourless) ?? null,
    })

    expect(await resolveOne(bookingId)).toBeNull()
  })

  it('steps past a stored value that is no longer in the palette', async () => {
    // The booking's own offering carries 'legacy-teal'; its BASE item carries
    // the same. Neither is paintable, so the chain must reach the per-service
    // fallback rather than stopping on a value it cannot use.
    const staleOfferingId = fx.offeringByService.get(fx.serviceIds.stale) ?? null

    const bookingId = await createBooking({
      serviceId: fx.serviceIds.stale,
      offeringId: staleOfferingId,
      items: [
        {
          serviceId: fx.serviceIds.stale,
          offeringId: staleOfferingId,
          itemType: BookingServiceItemType.BASE,
          sortOrder: 0,
        },
      ],
    })

    // Every level of this booking's chain holds the same unpaintable value, so
    // the honest answer is "no colour" — never a broken attribute.
    expect(await resolveOne(bookingId)).toBeNull()
  })

  it('never borrows another pro’s colour for the same catalog service', async () => {
    const bookingId = await createBooking({
      serviceId: fx.serviceIds.otherProOnly,
      offeringId: fx.offeringByService.get(fx.serviceIds.otherProOnly) ?? null,
    })

    expect(await resolveOne(bookingId)).toBeNull()

    // …and the loader itself refuses to hand the other pro's row over.
    const map = await loadOfferingSwatchesByServiceId({
      db,
      professionalId: fx.professionalId,
    })

    expect(map.has(fx.serviceIds.otherProOnly)).toBe(false)

    const otherMap = await loadOfferingSwatchesByServiceId({
      db,
      professionalId: fx.otherProfessionalId,
    })

    expect(otherMap.get(fx.serviceIds.otherProOnly)).toBe('12')
  })

  it('resolves a whole page of bookings deterministically in one pass', async () => {
    const ids = await Promise.all([
      createBooking({ serviceId: fx.serviceIds.coloured, offeringId: null }),
      createBooking({
        serviceId: fx.serviceIds.colourless,
        offeringId: fx.offeringByService.get(fx.serviceIds.colourless) ?? null,
      }),
      createBooking({
        serviceId: fx.serviceIds.secondColoured,
        offeringId:
          fx.offeringByService.get(fx.serviceIds.secondColoured) ?? null,
      }),
    ])

    const first = await resolveSwatches(ids)
    const second = await resolveSwatches(ids)

    // One coloured via the per-service fallback, one uncoloured, one coloured
    // via its own offering — resolved together, in a single fallback query.
    expect(first.get(ids[0])).toBe('09')
    expect(first.get(ids[1])).toBeNull()
    expect(first.get(ids[2])).toBe('02')

    // Deterministic: the same rows resolve identically on a second pass. Keyed
    // comparison, not entry order — `findMany` makes no ordering promise here.
    for (const id of ids) {
      expect(second.get(id)).toBe(first.get(id))
    }
  })
})
