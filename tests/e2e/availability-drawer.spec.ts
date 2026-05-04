import { expect, test, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import {
  chooseFirstEnabledSlot,
  continueToAddOns,
  expectAddOnsPage,
  expectContinueDisabled,
  expectContinueEnabled,
  switchToSalon,
  waitForAvailabilityReady,
} from './utils/availabilityHelpers'
import { byTestId, testIds } from './utils/selectors'
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

function bookingCta(page: Page, seed: SeedBookingFlowResult): Locator {
  return page.getByRole('button', {
    name: new RegExp(
      `^Book\\s+${escapeRegExp(getOfferingTitle(seed))}$`,
      'i',
    ),
  })
}

function availabilityDialog(page: Page): Locator {
  return byTestId(page, testIds.availability.drawer)
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

  const drawer = availabilityDialog(page)
  await expect(drawer).toBeVisible()
}

async function waitForLocationToggleReady(page: Page): Promise<void> {
  const drawer = availabilityDialog(page)

  await expect(
    byTestId(drawer, testIds.location.salonOption),
  ).toBeVisible({ timeout: 15_000 })

  await expect(
    byTestId(drawer, testIds.location.mobileOption),
  ).toBeVisible({ timeout: 15_000 })
}

async function createHoldAndAssertSuccess(
  page: Page,
  logLabel: string,
): Promise<void> {
  const [holdResponse] = await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    chooseFirstEnabledSlot(page),
  ])

  const holdBody = await holdResponse.text()

  console.log(`${logLabel} hold status`, holdResponse.status())
  console.log(`${logLabel} hold body`, holdBody)

  expect(holdResponse.status(), holdBody).toBe(201)

  await expectContinueEnabled(page)
}

test.beforeAll(async () => {
  await prisma.$connect()
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

test.describe('availability drawer browser flow', () => {
  let seed: SeedBookingFlowResult | null = null

  test.afterEach(async () => {
    await teardownBookingFlow({
      prisma,
      seed,
    })
    seed = null
  })

  test('opens the availability drawer and loads summary availability', async ({
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

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)
    await waitForAvailabilityReady(page)

    await expect(
      byTestId(page, testIds.availability.slotList),
    ).toBeVisible()

    await expectContinueDisabled(page)
  })

  test('selects a salon slot, creates a hold, and continues to add-ons', async ({
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

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)
    await waitForLocationToggleReady(page)

    await switchToSalon(page)
    await waitForAvailabilityReady(page)

    await createHoldAndAssertSuccess(page, 'availability drawer')

    await continueToAddOns(page)
    await page.waitForURL(/\/booking\/add-ons(?:\?|$)/)

    const url = new URL(page.url())

    expect(url.pathname).toBe('/booking/add-ons')
    expect(url.searchParams.get('holdId')).toBeTruthy()
    expect(url.searchParams.get('offeringId')).toBe(seed.offering.id)
    expect(url.searchParams.get('locationType')).toBe('SALON')

    await expectAddOnsPage(page)
  })
})