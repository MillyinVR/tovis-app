// tests/e2e/rebook-token-stale-slot.spec.ts
//
// F4 follow-up. The public rebook link now holds a client-chosen start to the
// pro's slot grid. Every slot the RebookCard offers comes from
// /availability/day, which generates its candidates from that same grid — so in
// normal use the refusal is unreachable.
//
// There is exactly one way a real client can hit it: a STALE PAGE. If the pro
// moves their working-window start (or changes stepMinutes) while the card is
// open, every slot already rendered re-anchors and goes off-grid. The F4 PR
// claimed that fails safe. Claiming is not watching — this drives it.
//
//   1. load the public link, let the card render real slots
//   2. the pro shifts their window start 09:00 -> 09:07 (slots now off-grid)
//   3. tap a stale slot -> inline refusal, slot list STILL live, nothing booked
//   4. reload -> the re-anchored grid is offered and a slot books
//
// (4) is the half that matters: a refusal the client cannot escape would be
// worse than the looseness F4 closed.
//
// Note on a red herring in this run's server log: the location below uses
// `timeZone: 'UTC'` to keep the grid arithmetic readable (a UTC wall minute is
// the offset from the 09:00 window start), and that trips a React hydration
// warning on the card's "Times shown in …" line — Node's ICU renders `UTC` as
// "GMT+00:00" while Chromium renders "GMT". Checked, not assumed: the two
// agree on every real IANA zone ("Pacific Time", "Eastern Time", "United
// Kingdom Time"), and no production location carries a literal 'UTC'. It is a
// fixture artifact, not a bug in `friendlyTimeZoneLabel`.

import { expect, test } from '@playwright/test'
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingStatus,
  ClientActionTokenKind,
  Prisma,
  PrismaClient,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { hashClientActionToken } from '@/lib/consultation/clientActionTokens'

const prisma = new PrismaClient()

const tag = `e2e_rebook_step_${Date.now().toString(36)}`

const STEP_MINUTES = 15
const DURATION_MINUTES = 60
const BUFFER_MINUTES = 15

function workingHours(start: string) {
  const day = { enabled: true, start, end: '18:00' }
  return {
    mon: day,
    tue: day,
    wed: day,
    thu: day,
    fri: day,
    sat: day,
    sun: day,
  }
}

type Seed = {
  rawToken: string
  bookingId: string
  tenantId: string
  categoryId: string
  professionalId: string
  clientId: string
  locationId: string
  userEmails: string[]
}

let seed: Seed

test.beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'E2E Rebook Step', isActive: true },
    select: { id: true },
  })

  const clientEmail = `${tag}_client@example.com`
  const clientUser = await prisma.user.create({
    data: { email: clientEmail, password: 'test-password', role: Role.CLIENT },
    select: { id: true },
  })
  const client = await prisma.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Wren',
      lastName: `Rebook_${tag}`,
      homeTenantId: tenant.id,
    },
    select: { id: true },
  })

  const proEmail = `${tag}_pro@example.com`
  const proUser = await prisma.user.create({
    data: { email: proEmail, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })
  const pro = await prisma.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Sam',
      lastName: 'Stylist',
      businessName: `${tag} studio`,
      homeTenantId: tenant.id,
      timeZone: 'UTC',
    },
    select: { id: true },
  })

  const location = await prisma.professionalLocation.create({
    data: {
      professionalId: pro.id,
      type: 'SALON',
      name: `${tag} salon`,
      isPrimary: true,
      isBookable: true,
      formattedAddress: '1 Grid St, San Diego, CA 92101',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: 'UTC',
      bufferMinutes: BUFFER_MINUTES,
      stepMinutes: STEP_MINUTES,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
      workingHours: workingHours('09:00'),
    },
    select: { id: true },
  })

  const category = await prisma.serviceCategory.create({
    data: { name: `${tag} cat`, slug: `${tag}-cat`, isActive: true },
    select: { id: true },
  })

  const service = await prisma.service.create({
    data: {
      name: `${tag} cut`,
      categoryId: category.id,
      defaultDurationMinutes: DURATION_MINUTES,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const offering = await prisma.professionalServiceOffering.create({
    data: {
      professionalId: pro.id,
      serviceId: service.id,
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: DURATION_MINUTES,
      salonPriceStartingAt: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })

  // The source visit: finished and paid a week ago — the only shape the client
  // rebook gate accepts.
  const past = new Date()
  past.setUTCDate(past.getUTCDate() - 7)
  past.setUTCHours(14, 0, 0, 0)

  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      professionalId: pro.id,
      serviceId: service.id,
      offeringId: offering.id,
      scheduledFor: past,
      status: BookingStatus.COMPLETED,
      finishedAt: past,
      checkoutStatus: BookingCheckoutStatus.PAID,
      paymentCollectedAt: past,
      locationType: ServiceLocationType.SALON,
      locationId: location.id,
      locationTimeZone: 'UTC',
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      totalDurationMinutes: DURATION_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
      proTenantId: tenant.id,
      clientHomeTenantId: tenant.id,
    },
    select: { id: true },
  })

  await prisma.bookingServiceItem.create({
    data: {
      bookingId: booking.id,
      serviceId: service.id,
      offeringId: offering.id,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: new Prisma.Decimal('50.00'),
      durationMinutesSnapshot: DURATION_MINUTES,
      sortOrder: 0,
    },
  })

  // A recommended window opening in 7 days pins which day the card loads, so
  // the test never depends on "is there still time left today".
  const windowStart = new Date()
  windowStart.setUTCDate(windowStart.getUTCDate() + 7)
  windowStart.setUTCHours(0, 0, 0, 0)
  const windowEnd = new Date(windowStart)
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 7)

  const aftercare = await prisma.aftercareSummary.create({
    data: {
      bookingId: booking.id,
      rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
      rebookWindowStart: windowStart,
      rebookWindowEnd: windowEnd,
      sentToClientAt: new Date(),
    },
    select: { id: true },
  })

  // The token row the route resolves against. Built directly rather than through
  // createAftercareAccessDelivery so the test never enqueues a real email/SMS.
  const rawToken = `${tag}_${Math.random().toString(36).slice(2)}`
  const expiresAt = new Date()
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 30)

  await prisma.clientActionToken.create({
    data: {
      kind: ClientActionTokenKind.AFTERCARE_ACCESS,
      tokenHash: hashClientActionToken(rawToken),
      singleUse: false,
      bookingId: booking.id,
      aftercareSummaryId: aftercare.id,
      clientId: client.id,
      professionalId: pro.id,
      expiresAt,
    },
  })

  seed = {
    rawToken,
    bookingId: booking.id,
    tenantId: tenant.id,
    categoryId: category.id,
    professionalId: pro.id,
    clientId: client.id,
    locationId: location.id,
    userEmails: [clientEmail, proEmail],
  }
})

test.afterAll(async () => {
  if (!seed) {
    await prisma.$disconnect()
    return
  }

  await prisma.aftercareSummary.updateMany({
    where: { bookingId: seed.bookingId },
    data: { rebookedBookingId: null },
  })
  await prisma.clientActionToken.deleteMany({
    where: { professionalId: seed.professionalId },
  })
  await prisma.bookingServiceItem.deleteMany({
    where: { booking: { professionalId: seed.professionalId } },
  })
  await prisma.aftercareSummary.deleteMany({
    where: { booking: { professionalId: seed.professionalId } },
  })
  await prisma.booking.deleteMany({
    where: { professionalId: seed.professionalId },
  })
  await prisma.professionalServiceOffering.deleteMany({
    where: { professionalId: seed.professionalId },
  })
  await prisma.professionalLocation.deleteMany({ where: { id: seed.locationId } })
  await prisma.professionalProfile.deleteMany({ where: { id: seed.professionalId } })
  await prisma.clientProfile.deleteMany({ where: { id: seed.clientId } })
  await prisma.user.deleteMany({ where: { email: { in: seed.userEmails } } })
  await prisma.service.deleteMany({ where: { categoryId: seed.categoryId } })
  await prisma.serviceCategory.deleteMany({ where: { id: seed.categoryId } })
  await prisma.tenant.deleteMany({ where: { id: seed.tenantId } })
  await prisma.$disconnect()
})

test('a stale off-grid slot refuses inline and the client can still rebook', async ({
  page,
}) => {
  await page.goto(`/client/rebook/${seed.rawToken}`)

  // The card fetches /availability/day for the first day of the recommended
  // window; every button it renders is a real slot off the pro's grid.
  const slots = page.getByRole('button', { name: /^\d{1,2}:\d{2}\s?(AM|PM)$/i })
  await expect(slots.first()).toBeVisible({ timeout: 30_000 })
  const offeredBefore = await slots.count()
  expect(offeredBefore).toBeGreaterThan(0)

  // 2) The pro moves their opening time while this page sits open. The grid is
  // anchored to the window start, so :00/:15/:30/:45 all become off-grid.
  await prisma.professionalLocation.update({
    where: { id: seed.locationId },
    data: { workingHours: workingHours('09:07') },
  })

  // 3) The client taps a slot that was valid when it rendered.
  await slots.first().click()

  await expect(
    page.getByText(/must be on a 15-minute boundary/i),
  ).toBeVisible({ timeout: 30_000 })

  // Not a dead end: the times are still on screen and still tappable.
  await expect(slots.first()).toBeEnabled()
  expect(await slots.count()).toBe(offeredBefore)

  // And it is NOT the success state.
  await expect(page.getByText(/booking requested/i)).toHaveCount(0)

  // Nothing was written.
  await expect(
    prisma.booking.count({ where: { rebookOfBookingId: seed.bookingId } }),
  ).resolves.toBe(0)

  // 4) A reload re-asks availability, which re-anchors to 09:07 — the client is
  // not stranded.
  await page.reload()
  await expect(slots.first()).toBeVisible({ timeout: 30_000 })
  await slots.first().click()

  await expect(page.getByText(/booking requested/i)).toBeVisible({
    timeout: 30_000,
  })

  const created = await prisma.booking.findFirstOrThrow({
    where: { rebookOfBookingId: seed.bookingId },
    select: { scheduledFor: true, status: true },
  })
  expect(created.status).toBe(BookingStatus.PENDING)
  // The re-anchored grid runs 09:07, 09:22, 09:37 … so the booked minute is
  // 7 past a quarter hour — proof the page followed the pro's new window
  // rather than replaying its stale slots.
  expect(created.scheduledFor.getUTCMinutes() % STEP_MINUTES).toBe(
    7 % STEP_MINUTES,
  )
})
