import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import {
  continueToAddOns,
  expectAddOnsPage,
  expectContinueDisabled,
  expectContinueEnabled,
  expectHoldSuccess,
  expectMobileAddressRequired,
  openAddMobileAddressModal,
  selectSavedMobileAddress,
  switchToMobile,
  waitForAvailabilityReady,
} from './utils/availabilityHelpers'
import {
  seedBookingFlow,
  type SeedBookingFlowResult,
} from './fixtures/seedBookingFlow'
import { teardownBookingFlow } from './fixtures/teardownBookingFlow'

const prisma = new PrismaClient()
const DEFAULT_OFFERING_TITLE = 'E2E Base Offering'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getOfferingTitle(seed: SeedBookingFlowResult): string {
  const maybeTitle =
    'title' in seed.offering &&
    typeof seed.offering.title === 'string' &&
    seed.offering.title.trim().length > 0
      ? seed.offering.title.trim()
      : null

  return maybeTitle ?? DEFAULT_OFFERING_TITLE
}

function bookingCta(page: Page, seed: SeedBookingFlowResult) {
  return page.getByRole('button', {
    name: new RegExp(
      `^Book\\s+${escapeRegExp(getOfferingTitle(seed))}$`,
      'i',
    ),
  })
}

function availabilityDialog(page: Page) {
  return page.getByRole('dialog').first()
}

function slotButtons(page: Page) {
  return availabilityDialog(page).getByRole('button', {
    name: /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}(?::\d{2})?\s?(?:AM|PM)/i,
  })
}

async function gotoProfessionalServicesPage(
  page: Page,
  seed: SeedBookingFlowResult,
): Promise<void> {
  await page.goto(
    `/professionals/${encodeURIComponent(
      seed.credentials.professional.professionalId,
    )}?tab=services`,
  )

  await expect(bookingCta(page, seed)).toBeVisible()
}

async function openAvailabilityFromSeededService(
  page: Page,
  seed: SeedBookingFlowResult,
): Promise<void> {
  await bookingCta(page, seed).click()
  await expect(availabilityDialog(page)).toBeVisible()
  await expect(
    availabilityDialog(page).getByText(/availability/i).first(),
  ).toBeVisible()
}

async function chooseFirstVisibleTimeSlot(page: Page): Promise<void> {
  const firstSlot = slotButtons(page).first()
  await expect(firstSlot).toBeVisible()
  await firstSlot.click()
}

test.beforeAll(async () => {
  await prisma.$connect()
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

test.describe('mobile availability browser flow', () => {
  let seed: SeedBookingFlowResult | null = null

  test.afterEach(async () => {
    await teardownBookingFlow({
      prisma,
      seed,
    })
    seed = null
  })

  test('uses a saved address for mobile availability, creates a hold, and continues to add-ons', async ({
    page,
  }) => {
    seed = await seedBookingFlow(
      { prisma },
      {
        withSavedAddress: true,
        withAddOn: true,
        offersInSalon: true,
        offersMobile: true,
      },
    )

    if (!seed.clientAddress) {
      throw new Error('Expected seeded client address for saved-address test')
    }

    if (!seed.locations.mobileBase) {
      throw new Error('Expected seeded mobile base for mobile test')
    }

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)

    await switchToMobile(page)
    await selectSavedMobileAddress(page, seed.clientAddress.id)
    await waitForAvailabilityReady(page)

    const holdResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
    )

    await chooseFirstVisibleTimeSlot(page)

    const holdResponse = await holdResponsePromise
    const holdBody = await holdResponse.text()

    console.log('mobile hold status', holdResponse.status())
    console.log('mobile hold body', holdBody)

    expect(holdResponse.status(), holdBody).toBe(201)

    await expectHoldSuccess(page)
    await expectContinueEnabled(page)

    await continueToAddOns(page)
    await page.waitForURL(/\/booking\/add-ons(?:\?|$)/)

    const url = new URL(page.url())

    expect(url.pathname).toBe('/booking/add-ons')
    expect(url.searchParams.get('holdId')).toBeTruthy()
    expect(url.searchParams.get('offeringId')).toBe(seed.offering.id)
    expect(url.searchParams.get('locationType')).toBe('MOBILE')
    expect(url.searchParams.get('clientAddressId')).toBe(seed.clientAddress.id)

    await expectAddOnsPage(page)
  })

  test('blocks mobile availability progress when the client has no saved address and opens the add-address modal', async ({
    page,
  }) => {
    seed = await seedBookingFlow(
      { prisma },
      {
        withSavedAddress: false,
        withAddOn: true,
        offersInSalon: true,
        offersMobile: true,
      },
    )

    if (seed.clientAddress) {
      throw new Error('Expected no seeded client address for empty-address test')
    }

    if (!seed.locations.mobileBase) {
      throw new Error('Expected seeded mobile base for mobile test')
    }

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)

    await switchToMobile(page)
    await expectMobileAddressRequired(page)
    await expectContinueDisabled(page)

    await openAddMobileAddressModal(page)
  })
})