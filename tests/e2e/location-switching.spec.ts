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

async function expectHoldCreated(page: Page): Promise<void> {
  await expect(continueButton(page)).toBeEnabled({ timeout: 15_000 })
}

async function expectHoldClearedAfterLocationSwitch(
  page: Page,
  targetMode: 'MOBILE' | 'SALON',
): Promise<void> {
  if (targetMode === 'MOBILE') {
    // Switching TO mobile: wait for the address selector to appear.
    // This is the stable positive signal that locationType is now MOBILE.
    await expect(
      availabilityDialog(page).getByTestId('mobile-address-add-button')
    ).toBeVisible({ timeout: 15_000 })
  } else {
    // Switching TO salon: address selector goes away, slots reload.
    // waitForAvailabilityReady is called by the test after this — just
    // confirm Continue is disabled and the hold banner is gone.
    await expect(
      availabilityDialog(page).getByTestId('availability-hold-banner')
    ).toBeHidden({ timeout: 15_000 })
  }
  await expectContinueDisabled(page)
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

    const salonHoldResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
    )

    await chooseFirstVisibleTimeSlot(page)

    const salonHoldResponse = await salonHoldResponsePromise
    const salonHoldBody = await salonHoldResponse.text()

    console.log('salon hold status', salonHoldResponse.status())
    console.log('salon hold body', salonHoldBody)

    expect(salonHoldResponse.status(), salonHoldBody).toBe(201)
    await expectHoldCreated(page)

    await switchToMobile(page)
    await expectHoldClearedAfterLocationSwitch(page, 'MOBILE')

    await selectSavedMobileAddress(page, seed.clientAddress.id)
    await waitForAvailabilityReady(page)

    const mobileHoldResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
    )

    await chooseFirstVisibleTimeSlot(page)

    const mobileHoldResponse = await mobileHoldResponsePromise
    const mobileHoldBody = await mobileHoldResponse.text()

    console.log('mobile hold status', mobileHoldResponse.status())
    console.log('mobile hold body', mobileHoldBody)

    expect(mobileHoldResponse.status(), mobileHoldBody).toBe(201)
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

    const mobileHoldResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
    )

    await chooseFirstVisibleTimeSlot(page)

    const mobileHoldResponse = await mobileHoldResponsePromise
    const mobileHoldBody = await mobileHoldResponse.text()

    console.log('mobile hold status', mobileHoldResponse.status())
    console.log('mobile hold body', mobileHoldBody)

    expect(mobileHoldResponse.status(), mobileHoldBody).toBe(201)
    await expectHoldCreated(page)

    await switchToSalon(page)
    await waitForAvailabilityReady(page)
    await expectHoldClearedAfterLocationSwitch(page, 'SALON')

    const salonHoldResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
    )

    await chooseFirstVisibleTimeSlot(page)

    const salonHoldResponse = await salonHoldResponsePromise
    const salonHoldBody = await salonHoldResponse.text()

    console.log('salon hold status', salonHoldResponse.status())
    console.log('salon hold body', salonHoldBody)

    expect(salonHoldResponse.status(), salonHoldBody).toBe(201)
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