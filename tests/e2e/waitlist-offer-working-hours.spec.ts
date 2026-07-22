// tests/e2e/waitlist-offer-working-hours.spec.ts
//
// F5. `createWaitlistOffer` now runs the same scheduling gate the client's
// Confirm runs, so a pro can no longer send an offer the client physically
// cannot accept. Every slot the "Offer a time" picker renders comes from
// /availability/day, which is already inside working hours — so in normal use
// the new refusal is unreachable.
//
// There is one way a real pro reaches it: a STALE MODAL. The picker's slots are
// fetched once; if the pro's hours change while it sits open (another device,
// another tab, a partner editing the profile), the slot on screen is no longer
// offerable. This drives that:
//
//   1. sign in as a pro, open the calendar's Waitlist tab, pick a real slot
//   2. the pro's closing time moves back behind that slot
//   3. Send offer -> inline refusal, the picker STILL live, nothing written
//   4. hours restored -> the same slot sends, and a PENDING offer exists
//
// (3)+(4) together are the point: the pro is the one who can fix an off-hours
// time, so the refusal belongs to them — but only if it leaves them somewhere
// to go. A refusal that closed the modal or emptied the picker would be worse
// than the looseness F5 closed.

import { expect, test } from '@playwright/test'
import {
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  WaitlistOfferStatus,
  WaitlistPreferenceType,
  WaitlistStatus,
} from '@prisma/client'
import bcrypt from 'bcryptjs'

import { emailLookupHashV2 } from '@/lib/security/crypto/hashLookup'

const prisma = new PrismaClient()

const tag = `e2e_wl_offer_${Date.now().toString(36)}`
const PASSWORD = 'password123'
// UTC keeps the arithmetic legible: the slot labels ARE the working-window
// wall clock, so "1:00 PM" is unambiguously inside 09:00-18:00.
const ZONE = 'UTC'

function workingHours(end: string) {
  const day = { enabled: true, start: '09:00', end }
  return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }
}

/** A YYYY-MM-DD a week out — far enough that advance notice can't interfere. */
function offerYmd(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 7)
  return d.toISOString().slice(0, 10)
}

type Seed = {
  proEmail: string
  professionalId: string
  locationId: string
  waitlistEntryId: string
  tenantId: string
  categoryId: string
  serviceId: string
  clientProfileId: string
  userIds: string[]
}

let seed: Seed

async function makeUser(email: string, role: Role): Promise<string> {
  const hash = emailLookupHashV2(email)
  if (!hash) throw new Error('missing PII lookup keyring for the e2e run')
  const now = new Date()
  const user = await prisma.user.create({
    data: {
      email,
      emailHashV2: hash.hash,
      emailHashKeyVersion: hash.keyVersion,
      password: await bcrypt.hash(PASSWORD, 10),
      role,
      // isFullyVerified needs BOTH, or every authed screen 403s.
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
    },
    select: { id: true },
  })
  return user.id
}

test.beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Waitlist Offer E2E', isActive: true },
    select: { id: true },
  })

  const proEmail = `${tag}_pro@example.com`
  const clientEmail = `${tag}_client@example.com`
  const proUserId = await makeUser(proEmail, Role.PRO)
  const clientUserId = await makeUser(clientEmail, Role.CLIENT)

  const professional = await prisma.professionalProfile.create({
    data: {
      userId: proUserId,
      homeTenantId: tenant.id,
      firstName: 'Wait',
      lastName: 'Pro',
      businessName: 'Waitlist E2E Studio',
      timeZone: ZONE,
    },
    select: { id: true },
  })

  const client = await prisma.clientProfile.create({
    data: {
      userId: clientUserId,
      homeTenantId: tenant.id,
      firstName: 'Wanda',
      lastName: 'Waiter',
    },
    select: { id: true },
  })

  const category = await prisma.serviceCategory.create({
    data: { name: `${tag} Cat`, slug: `${tag}-cat`, isActive: true },
    select: { id: true },
  })
  const service = await prisma.service.create({
    data: {
      name: `${tag} Cut`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const location = await prisma.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.SALON,
      name: 'Main Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Salon St, San Diego, CA 92101',
      addressLine1: '123 Salon St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: ZONE,
      workingHours: workingHours('18:00'),
      bufferMinutes: 0,
      stepMinutes: 60,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })

  await prisma.professionalServiceOffering.create({
    data: {
      professionalId: professional.id,
      serviceId: service.id,
      isActive: true,
      offersInSalon: true,
      offersMobile: false,
      salonPriceStartingAt: new Prisma.Decimal('100.00'),
      salonDurationMinutes: 60,
    },
  })

  const entry = await prisma.waitlistEntry.create({
    data: {
      clientId: client.id,
      professionalId: professional.id,
      serviceId: service.id,
      preferenceType: WaitlistPreferenceType.ANY_TIME,
      status: WaitlistStatus.ACTIVE,
    },
    select: { id: true },
  })

  seed = {
    proEmail,
    professionalId: professional.id,
    locationId: location.id,
    waitlistEntryId: entry.id,
    tenantId: tenant.id,
    categoryId: category.id,
    serviceId: service.id,
    clientProfileId: client.id,
    userIds: [proUserId, clientUserId],
  }
})

test.afterAll(async () => {
  if (seed) {
    const pro = { professionalId: seed.professionalId }
    await prisma.clientNotification.deleteMany({
      where: { clientId: seed.clientProfileId },
    })
    await prisma.scheduledClientNotification.deleteMany({
      where: { clientId: seed.clientProfileId },
    })
    await prisma.notification.deleteMany({ where: pro })
    await prisma.idempotencyKey.deleteMany({
      where: { actorUserId: { in: seed.userIds } },
    })
    await prisma.waitlistOffer.deleteMany({ where: pro })
    await prisma.waitlistEntry.deleteMany({ where: pro })
    await prisma.professionalServiceOffering.deleteMany({ where: pro })
    await prisma.professionalLocation.deleteMany({ where: pro })
    await prisma.professionalPaymentSettings.deleteMany({ where: pro })
    await prisma.service.deleteMany({ where: { id: seed.serviceId } })
    await prisma.serviceCategory.deleteMany({ where: { id: seed.categoryId } })
    await prisma.clientProfile.deleteMany({ where: { id: seed.clientProfileId } })
    await prisma.professionalProfile.deleteMany({
      where: { id: seed.professionalId },
    })
    await prisma.user.deleteMany({ where: { id: { in: seed.userIds } } })
    await prisma.tenant.deleteMany({ where: { id: seed.tenantId } })
  }
  await prisma.$disconnect()
})

// The suite's shared storage state is the CLIENT test account; this spec needs
// the pro it seeded, so it starts signed out and logs in.
test.use({ storageState: { cookies: [], origins: [] } })

test('an off-hours waitlist offer refuses inline and the pro can still send one', async ({
  page,
}) => {
  // 1) Sign in as the seeded pro.
  await page.goto('/login')
  await page
    .locator('input[type="email"], input[name="email"]')
    .first()
    .fill(seed.proEmail)
  await page
    .locator('input[type="password"], input[name="password"]')
    .first()
    .fill(PASSWORD)
  await page
    .getByRole('button', { name: /log in|login|sign in/i })
    .first()
    .click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 30_000,
  })

  // 2) Open the calendar's Waitlist tab and start an offer.
  await page.goto('/pro/calendar')

  // The waitlist rail tile opens the management modal on its Waitlist tab.
  const waitlistTile = page.getByRole('button', { name: /^Waitlist: / })
  await expect(waitlistTile.first()).toBeVisible({ timeout: 30_000 })
  await waitlistTile.first().click()

  const offerButton = page.getByRole('button', { name: 'Offer a time' })
  await expect(offerButton.first()).toBeVisible({ timeout: 30_000 })
  await offerButton.first().click()

  const dialog = page.getByRole('dialog', { name: 'Offer a time' })
  await expect(dialog).toBeVisible()

  // 3) Pick a real availability slot — everything on screen is inside hours.
  await dialog.locator('input[type="date"]').fill(offerYmd())
  const slots = dialog.getByRole('button', {
    name: /^\d{1,2}:\d{2}\s?(AM|PM)$/i,
  })
  await expect(slots.first()).toBeVisible({ timeout: 30_000 })
  const offeredBefore = await slots.count()
  expect(offeredBefore).toBeGreaterThan(0)

  // Take the LAST slot of the day: closing time moves back behind it below.
  const lastSlot = slots.nth(offeredBefore - 1)
  await lastSlot.click()

  // 4) The pro's closing time moves in while this modal sits open.
  await prisma.professionalLocation.update({
    where: { id: seed.locationId },
    data: { workingHours: workingHours('10:00') },
  })

  const send = dialog.getByRole('button', { name: /send offer/i })
  await send.click()

  // The refusal renders where the pro is looking, in the pro's own words.
  await expect(
    dialog.getByText(/outside working hours/i),
  ).toBeVisible({ timeout: 30_000 })

  // Not a dead end: the modal is still open and the times are still tappable.
  await expect(dialog).toBeVisible()
  await expect(slots.first()).toBeEnabled()
  expect(await slots.count()).toBe(offeredBefore)

  // And nothing was written.
  expect(
    await prisma.waitlistOffer.count({
      where: { waitlistEntryId: seed.waitlistEntryId },
    }),
  ).toBe(0)
  expect(
    (
      await prisma.waitlistEntry.findUnique({
        where: { id: seed.waitlistEntryId },
        select: { status: true },
      })
    )?.status,
  ).toBe(WaitlistStatus.ACTIVE)

  // 5) The pro fixes what only the pro can fix, and the SAME slot goes out.
  //
  // The retry reuses the same idempotency key (scope + entry + slot ISO, in the
  // same ~60s bucket), and that is deliberate rather than lucky: only a
  // COMPLETED record replays, while the refusal left the row FAILED with an
  // elapsed `lockedUntil`, so the identical request is re-claimed and re-run.
  // A refused offer therefore does not burn the pro's key.
  await prisma.professionalLocation.update({
    where: { id: seed.locationId },
    data: { workingHours: workingHours('18:00') },
  })

  await send.click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  const offers = await prisma.waitlistOffer.findMany({
    where: { waitlistEntryId: seed.waitlistEntryId },
    select: { status: true, startsAt: true, durationMinutes: true },
  })
  expect(offers).toHaveLength(1)
  expect(offers[0]?.status).toBe(WaitlistOfferStatus.PENDING)
  expect(offers[0]?.durationMinutes).toBe(60)
  // The last slot of a 09:00-18:00 day on a 60-minute grid, in the fixture's
  // UTC zone — i.e. the very slot that was refused a moment ago, not some other
  // one the picker happened to re-render.
  expect(offers[0]?.startsAt.toISOString()).toBe(`${offerYmd()}T17:00:00.000Z`)

  // 6) F14: that offer RESERVED the slot, so the pro must be able to see it.
  //
  // Sending an offer moves the entry to NOTIFIED, and the calendar used to list
  // ACTIVE entries only — so the client vanished from the rail and the pro had
  // no surface anywhere showing an outstanding offer, let alone the slot it now
  // takes off their own calendar.
  const reservation = await prisma.bookingHold.findFirst({
    where: { waitlistOffer: { waitlistEntryId: seed.waitlistEntryId } },
    select: { scheduledFor: true },
  })
  expect(reservation?.scheduledFor.toISOString()).toBe(
    `${offerYmd()}T17:00:00.000Z`,
  )

  await page.goto('/pro/calendar')
  await expect(waitlistTile.first()).toBeVisible({ timeout: 30_000 })
  await waitlistTile.first().click()

  // The row is still there, now reading "Offered · <time>" instead of inviting
  // another offer.
  await expect(page.getByText(/^Offered · /)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Offer a time' })).toHaveCount(0)
})
