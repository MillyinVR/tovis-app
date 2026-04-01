import { expect, test, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import {
  continueToAddOns,
  expectAddOnsPage,
  expectContinueDisabled,
  selectSavedMobileAddress,
  switchToMobile,
  switchToSalon,
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

function availabilityDialog(page: Page): Locator {
  return page.getByRole('dialog').first()
}

function bookingCta(page: Page, seed: SeedBookingFlowResult): Locator {
  return page.getByRole('button', {
    name: new RegExp(
      `^Book\\s+${escapeRegExp(getOfferingTitle(seed))}$`,
      'i',
    ),
  })
}

function continueButton(page: Page): Locator {
  return availabilityDialog(page)
    .getByRole('button', {
      name: /continue(?:\s+to\s+add-ons)?/i,
    })
    .first()
}

function slotButtons(page: Page): Locator {
  return availabilityDialog(page).getByRole('button', {
    name: /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}(?::\d{2})?\s?(?:AM|PM)/i,
  })
}

function holdBanner(page: Page): Locator {
  return availabilityDialog(page).getByTestId('availability-hold-banner')
}

function mobileAddressSection(page: Page): Locator {
  return availabilityDialog(page).getByTestId('mobile-address-section')
}

function mobileAddressAddButton(page: Page): Locator {
  return availabilityDialog(page).getByTestId('mobile-address-add-button')
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

async function chooseFirstEnabledTimeSlot(page: Page): Promise<void> {
  const slots = slotButtons(page)
  const count = await slots.count()

  for (let index = 0; index < count; index += 1) {
    const slot = slots.nth(index)

    if (!(await slot.isVisible())) continue
    if (!(await slot.isEnabled())) continue

    await slot.click()
    return
  }

  throw new Error('No enabled time slot found in availability drawer')
}

async function createHoldFromFirstEnabledSlot(page: Page): Promise<{
  status: number
  body: string
}> {
  const [holdResponse] = await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    chooseFirstEnabledTimeSlot(page),
  ])

  return {
    status: holdResponse.status(),
    body: await holdResponse.text(),
  }
}

async function expectHoldCreated(page: Page): Promise<void> {
  await expect(continueButton(page)).toBeEnabled({ timeout: 15_000 })
}

async function waitForLocationToggleReady(page: Page): Promise<void> {
  await waitForAvailabilityReady(page)

  const drawer = availabilityDialog(page)

  await expect(
    drawer.getByTestId('booking-location-salon'),
  ).toBeVisible({ timeout: 15_000 })

  await expect(
    drawer.getByTestId('booking-location-mobile'),
  ).toBeVisible({ timeout: 15_000 })
}

async function expectHoldClearedAfterLocationSwitch(
  page: Page,
  targetMode: 'MOBILE' | 'SALON',
): Promise<void> {
  await expect(holdBanner(page)).toBeHidden({ timeout: 15_000 })
  await expectContinueDisabled(page)

  if (targetMode === 'MOBILE') {
    await expect(mobileAddressSection(page)).toBeVisible({ timeout: 15_000 })
    await expect(mobileAddressAddButton(page)).toBeVisible({ timeout: 15_000 })
    return
  }

  await expect(mobileAddressSection(page)).toHaveCount(0, {
    timeout: 15_000,
  })
}

test.beforeAll(async () => {
  await prisma.$connect()
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

test.describe('location switching browser flow', () => {
  test.setTimeout(120_000)

  let seed: SeedBookingFlowResult | null = null

  test.afterEach(async () => {
    await teardownBookingFlow({
      prisma,
      seed,
    })
    seed = null
  })

  test('switching from salon to mobile resets the held salon selection and creates a mobile hold', async ({
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
      throw new Error('Expected seeded client address for salon->mobile test')
    }

    if (!seed.locations.mobileBase) {
      throw new Error('Expected seeded mobile base for salon->mobile test')
    }

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)
    await waitForAvailabilityReady(page)

    const salonHold = await createHoldFromFirstEnabledSlot(page)

    console.log('salon hold status', salonHold.status)
    console.log('salon hold body', salonHold.body)

    expect(salonHold.status, salonHold.body).toBe(201)
    await expectHoldCreated(page)
    await waitForLocationToggleReady(page)

    await switchToMobile(page)
    await expectHoldClearedAfterLocationSwitch(page, 'MOBILE')

    await selectSavedMobileAddress(page, seed.clientAddress.id)
    await waitForAvailabilityReady(page)

    const mobileHold = await createHoldFromFirstEnabledSlot(page)

    console.log('mobile hold status', mobileHold.status)
    console.log('mobile hold body', mobileHold.body)

    expect(mobileHold.status, mobileHold.body).toBe(201)
    await expectHoldCreated(page)

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

  test('switching from mobile to salon resets the mobile selection and creates a salon hold', async ({
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
      throw new Error('Expected seeded client address for mobile->salon test')
    }

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)
    await waitForAvailabilityReady(page)

    await switchToMobile(page)
    await selectSavedMobileAddress(page, seed.clientAddress.id)
    await waitForAvailabilityReady(page)

    const mobileHold = await createHoldFromFirstEnabledSlot(page)

    console.log('mobile hold status', mobileHold.status)
    console.log('mobile hold body', mobileHold.body)

    expect(mobileHold.status, mobileHold.body).toBe(201)
    await expectHoldCreated(page)
    await waitForLocationToggleReady(page)

    await switchToSalon(page)
    await expectHoldClearedAfterLocationSwitch(page, 'SALON')
    await waitForAvailabilityReady(page)

    const salonHold = await createHoldFromFirstEnabledSlot(page)

    console.log('salon hold status', salonHold.status)
    console.log('salon hold body', salonHold.body)

    expect(salonHold.status, salonHold.body).toBe(201)
    await expectHoldCreated(page)

    await continueToAddOns(page)
    await page.waitForURL(/\/booking\/add-ons(?:\?|$)/)

    const url = new URL(page.url())

    expect(url.pathname).toBe('/booking/add-ons')
    expect(url.searchParams.get('holdId')).toBeTruthy()
    expect(url.searchParams.get('offeringId')).toBe(seed.offering.id)
    expect(url.searchParams.get('locationType')).toBe('SALON')
    expect(url.searchParams.get('clientAddressId')).toBeFalsy()

    await expectAddOnsPage(page)
  })
})