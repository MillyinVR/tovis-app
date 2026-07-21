// tests/e2e/consultation-token-retryable-refusal.spec.ts
//
// F2 follow-up. The public consultation link is `singleUse`, but the token is
// only consumed INSIDE the decision transaction, so a refusal rolls the
// consumption back and the same link still works. The page has to say so.
//
// Before this guard the page replaced the entire view with "Consultation link
// unavailable / ask your professional to resend the consultation link" on ANY
// failed decision — which, once the token survives, is actively false and
// throws away both buttons. Caught by driving the page, not by a unit test.
//
// Drives the real page against the real route:
//   1. approve while the pro has blocked time inside the extension window
//      -> inline, retryable refusal; the proposal and BOTH buttons survive
//   2. the pro clears the block
//   3. approve again from the SAME page session and the SAME link -> APPROVED

import { expect, test } from '@playwright/test'
import {
  BookingServiceItemType,
  BookingStatus,
  ConsultationApprovalStatus,
  Prisma,
  PrismaClient,
  Role,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

import { issueConsultationActionToken } from '@/lib/consultation/clientActionTokens'

const prisma = new PrismaClient()

const tag = `e2e_consult_${Date.now().toString(36)}`

type Seed = {
  rawToken: string
  bookingId: string
  blockId: string
  tenantId: string
  categoryId: string
  professionalId: string
  clientId: string
  locationId: string
  userEmails: string[]
}

let seed: Seed

const OPEN_ALL_WEEK = {
  mon: { enabled: true, start: '09:00', end: '18:00' },
  tue: { enabled: true, start: '09:00', end: '18:00' },
  wed: { enabled: true, start: '09:00', end: '18:00' },
  thu: { enabled: true, start: '09:00', end: '18:00' },
  fri: { enabled: true, start: '09:00', end: '18:00' },
  sat: { enabled: true, start: '09:00', end: '18:00' },
  sun: { enabled: true, start: '09:00', end: '18:00' },
}

test.beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'E2E Consult', isActive: true },
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
      firstName: 'Dana',
      lastName: `Consult_${tag}`,
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
      firstName: 'Robin',
      lastName: 'Stylist',
      businessName: `${tag} studio`,
      homeTenantId: tenant.id,
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
      timeZone: 'UTC',
      bufferMinutes: 15,
      workingHours: OPEN_ALL_WEEK,
    },
    select: { id: true },
  })

  const category = await prisma.serviceCategory.create({
    data: { name: `${tag} cat`, slug: `${tag}-cat`, isActive: true },
    select: { id: true },
  })

  const baseService = await prisma.service.create({
    data: {
      name: `${tag} cut`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })
  const bigService = await prisma.service.create({
    data: {
      name: `${tag} full colour`,
      categoryId: category.id,
      defaultDurationMinutes: 180,
      minPrice: new Prisma.Decimal('180.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const baseOffering = await prisma.professionalServiceOffering.create({
    data: {
      professionalId: pro.id,
      serviceId: baseService.id,
      offersInSalon: true,
      salonDurationMinutes: 60,
      salonPriceStartingAt: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })
  const bigOffering = await prisma.professionalServiceOffering.create({
    data: {
      professionalId: pro.id,
      serviceId: bigService.id,
      offersInSalon: true,
      salonDurationMinutes: 180,
      salonPriceStartingAt: new Prisma.Decimal('180.00'),
      isActive: true,
    },
    select: { id: true },
  })

  // 60min + 15min buffer from T+30d 12:00Z -> original window ends 13:15Z.
  // The proposal materializes 180min -> 15:15Z. The block sits at 14:00-14:30Z,
  // inside the EXTENSION only.
  const scheduledFor = new Date()
  scheduledFor.setUTCDate(scheduledFor.getUTCDate() + 30)
  scheduledFor.setUTCHours(12, 0, 0, 0)

  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      professionalId: pro.id,
      serviceId: baseService.id,
      offeringId: baseOffering.id,
      scheduledFor,
      status: BookingStatus.IN_PROGRESS,
      startedAt: new Date(),
      sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      locationType: ServiceLocationType.SALON,
      locationId: location.id,
      locationTimeZone: 'UTC',
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      totalDurationMinutes: 60,
      bufferMinutes: 15,
      proTenantId: tenant.id,
      clientHomeTenantId: tenant.id,
    },
    select: { id: true },
  })

  await prisma.bookingServiceItem.create({
    data: {
      bookingId: booking.id,
      serviceId: baseService.id,
      offeringId: baseOffering.id,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: new Prisma.Decimal('50.00'),
      durationMinutesSnapshot: 60,
      sortOrder: 0,
    },
  })

  const approval = await prisma.consultationApproval.create({
    data: {
      bookingId: booking.id,
      clientId: client.id,
      proId: pro.id,
      status: ConsultationApprovalStatus.PENDING,
      proposedTotal: new Prisma.Decimal('180.00'),
      proposedServicesJson: {
        currency: 'USD',
        items: [
          {
            offeringId: bigOffering.id,
            serviceId: bigService.id,
            itemType: 'BASE',
            label: 'Full colour',
            price: '180.00',
            durationMinutes: 180,
            sortOrder: 0,
          },
        ],
      },
    },
    select: { id: true },
  })

  const block = await prisma.calendarBlock.create({
    data: {
      professionalId: pro.id,
      locationId: location.id,
      startsAt: new Date(scheduledFor.getTime() + 120 * 60_000),
      endsAt: new Date(scheduledFor.getTime() + 150 * 60_000),
      note: `${tag} personal time`,
    },
    select: { id: true },
  })

  const token = await issueConsultationActionToken({
    bookingId: booking.id,
    consultationApprovalId: approval.id,
    clientId: client.id,
    professionalId: pro.id,
  })

  seed = {
    rawToken: token.rawToken,
    bookingId: booking.id,
    blockId: block.id,
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

  await prisma.clientActionToken.deleteMany({ where: { bookingId: seed.bookingId } })
  await prisma.calendarBlock.deleteMany({ where: { professionalId: seed.professionalId } })
  await prisma.consultationApprovalProof.deleteMany({
    where: { bookingId: seed.bookingId },
  })
  await prisma.consultationApproval.deleteMany({ where: { bookingId: seed.bookingId } })
  await prisma.bookingServiceItem.deleteMany({ where: { bookingId: seed.bookingId } })
  await prisma.booking.deleteMany({ where: { id: seed.bookingId } })
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

test('a blocked-time refusal keeps the consultation link usable and retries in place', async ({
  page,
}) => {
  await page.goto(`/client/consultation/${seed.rawToken}`)

  const approve = page.getByRole('button', { name: /approve consultation/i })
  await expect(approve).toBeVisible()

  // 1) The extension runs into the pro's blocked time.
  await approve.click()

  const refusal = page
    .getByRole('alert')
    .filter({ hasText: /blocked off/i })
  await expect(refusal).toBeVisible()
  await expect(refusal).toContainText(/still valid/i)

  // The whole point: this is NOT the terminal "link unavailable" card.
  await expect(page.getByText(/consultation link unavailable/i)).toHaveCount(0)
  await expect(
    page.getByText(/resend the consultation link/i),
  ).toHaveCount(0)

  // Both decisions stay available.
  await expect(approve).toBeEnabled()
  await expect(
    page.getByRole('button', { name: /decline consultation/i }),
  ).toBeEnabled()

  // The single-use link must be untouched by the refusal.
  const afterRefusal = await prisma.clientActionToken.findFirstOrThrow({
    where: { bookingId: seed.bookingId },
    select: { firstUsedAt: true, useCount: true },
  })
  expect(afterRefusal.firstUsedAt).toBeNull()
  expect(afterRefusal.useCount).toBe(0)

  // The booking must be untouched too.
  const untouched = await prisma.booking.findUniqueOrThrow({
    where: { id: seed.bookingId },
    select: { totalDurationMinutes: true, consultationConfirmedAt: true },
  })
  expect(untouched.totalDurationMinutes).toBe(60)
  expect(untouched.consultationConfirmedAt).toBeNull()

  // 2) The pro clears the block on their calendar.
  await prisma.calendarBlock.delete({ where: { id: seed.blockId } })

  // 3) Same page, same link, no reload.
  await approve.click()

  await expect(page.getByText(/already been approved/i).first()).toBeVisible()

  const approved = await prisma.booking.findUniqueOrThrow({
    where: { id: seed.bookingId },
    select: { totalDurationMinutes: true, consultationConfirmedAt: true },
  })
  expect(approved.totalDurationMinutes).toBe(180)
  expect(approved.consultationConfirmedAt).not.toBeNull()
})
