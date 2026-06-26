// tests/integration/reschedule-ownership.test.ts
//
// Anti-enumeration contract for client-owned booking transactions
// (reschedule / cancel / checkout / consultation decisions all route through
// lockClientOwnedBookingSchedule). A booking that is missing and a booking
// owned by ANOTHER client must return the SAME uniform BOOKING_NOT_FOUND (404)
// — never FORBIDDEN (403) — so a client cannot probe for a status difference
// to learn that someone else's booking exists.
//
// Runs against the docker test database like the other integration suites:
//   pnpm test:integration

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient, Prisma, Role, ServiceLocationType } from '@prisma/client'

import { lockClientOwnedBookingSchedule } from '@/lib/booking/scheduleTransaction'
import { isBookingError } from '@/lib/booking/errors'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

const tag = `reschedule_owner_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`

let tenantId = ''
let ownerClientId = ''
let otherClientId = ''
let bookingId = ''

const seededUserEmails: string[] = []

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Reschedule Owner', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  async function seedClient(label: string): Promise<string> {
    const email = `${tag}_${label}@example.com`
    const user = await db.user.create({
      data: { email, password: 'test-password', role: Role.CLIENT },
      select: { id: true },
    })
    seededUserEmails.push(email)

    const client = await db.clientProfile.create({
      data: {
        userId: user.id,
        firstName: label,
        lastName: 'Owner',
        homeTenantId: tenantId,
      },
      select: { id: true },
    })
    return client.id
  }

  ownerClientId = await seedClient('owner')
  otherClientId = await seedClient('other')

  const proEmail = `${tag}_pro@example.com`
  const proUser = await db.user.create({
    data: { email: proEmail, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })
  seededUserEmails.push(proEmail)

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Pro',
      lastName: 'Owner',
      businessName: `${tag} studio`,
      homeTenantId: tenantId,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId: pro.id,
      type: 'SALON',
      name: `${tag} salon`,
      isPrimary: true,
      isBookable: true,
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

  const scheduledFor = new Date()
  scheduledFor.setUTCDate(scheduledFor.getUTCDate() + 30)
  scheduledFor.setUTCHours(12, 0, 0, 0)

  const booking = await db.booking.create({
    data: {
      clientId: ownerClientId,
      professionalId: pro.id,
      serviceId: service.id,
      scheduledFor,
      locationType: ServiceLocationType.SALON,
      locationId: location.id,
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      totalDurationMinutes: 60,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
    },
    select: { id: true },
  })
  bookingId = booking.id
}, 60_000)

afterAll(async () => {
  await db.booking.deleteMany({ where: { id: bookingId } })
  await db.professionalLocation.deleteMany({
    where: { name: `${tag} salon` },
  })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${tag} studio` },
  })
  await db.clientProfile.deleteMany({ where: { lastName: 'Owner' } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.service.deleteMany({ where: { name: `${tag} service` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

async function lockResult(args: {
  bookingId: string
  clientId: string
}): Promise<unknown> {
  return db
    .$transaction((tx) =>
      lockClientOwnedBookingSchedule({
        tx,
        bookingId: args.bookingId,
        clientId: args.clientId,
      }),
    )
    .catch((error: unknown) => error)
}

describe('lockClientOwnedBookingSchedule ownership', () => {
  it('locks the schedule for the booking owner', async () => {
    const result = await lockResult({
      bookingId,
      clientId: ownerClientId,
    })

    expect(isBookingError(result)).toBe(false)
    expect(result).toMatchObject({ professionalId: expect.any(String) })
  })

  it('returns a uniform BOOKING_NOT_FOUND (404) for a missing booking', async () => {
    const result = await lockResult({
      bookingId: 'does-not-exist',
      clientId: ownerClientId,
    })

    expect(isBookingError(result)).toBe(true)
    if (isBookingError(result)) {
      expect(result.code).toBe('BOOKING_NOT_FOUND')
      expect(result.httpStatus).toBe(404)
    }
  })

  it('returns the SAME BOOKING_NOT_FOUND for another client’s booking — no FORBIDDEN enumeration oracle', async () => {
    const result = await lockResult({
      bookingId,
      clientId: otherClientId,
    })

    expect(isBookingError(result)).toBe(true)
    if (isBookingError(result)) {
      expect(result.code).toBe('BOOKING_NOT_FOUND')
      expect(result.httpStatus).toBe(404)
    }
  })
})
