import { expect, test, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import {
  chooseFirstEnabledSlot,
  continueToAddOns,
  expectAddOnsPage,
  expectContinueEnabled,
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

function availabilityDialog(page: Page): Locator {
  return byTestId(page, testIds.availability.drawer)
}

function bookingCta(page: Page, seed: SeedBookingFlowResult): Locator {
  return page.getByRole('button', {
    name: new RegExp(
      `^Book\\s+${escapeRegExp(getOfferingTitle(seed))}$`,
      'i',
    ),
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

  expect(
    holdResponse.status(),
    `POST /api/holds failed: ${holdBody}`,
  ).toBe(201)

  await expectContinueEnabled(page)
}

test.beforeAll(async () => {
  await prisma.$connect()
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

test.describe('add-ons transition browser flow', () => {
  let seed: SeedBookingFlowResult | null = null

  test.afterEach(async () => {
    await teardownBookingFlow({
      prisma,
      seed,
    })
    seed = null
  })

  test('carries hold context into add-ons after a successful salon hold', async ({
    page,
  }) => {
    seed = await seedBookingFlow(
      { prisma },
      {
        withSavedAddress: true,
        withAddOn: true,
        offersInSalon: true,
        offersMobile: false,
      },
    )

    if (!seed.services.addOn) {
      throw new Error('Expected seeded add-on for add-ons transition test')
    }

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)
    await waitForAvailabilityReady(page)

    await createHoldAndAssertSuccess(page, 'add-ons')

    await continueToAddOns(page)
    await page.waitForURL(/\/booking\/add-ons(?:\?|$)/)

    const url = new URL(page.url())

    expect(url.pathname).toBe('/booking/add-ons')
    expect(url.searchParams.get('holdId')).toBeTruthy()
    expect(url.searchParams.get('offeringId')).toBe(seed.offering.id)
    expect(url.searchParams.get('locationType')).toBe('SALON')
    expect(url.searchParams.get('source')).toBeTruthy()

    await expectAddOnsPage(page)

    const addOnsList = byTestId(page, testIds.addOns.list)
    await expect(addOnsList).toBeVisible()

    await expect(
      page.getByText(new RegExp(escapeRegExp(seed.services.addOn.name), 'i')),
    ).toBeVisible()
  })

  test('keeps add-ons page actionable after navigation from availability', async ({
    page,
  }) => {
    seed = await seedBookingFlow(
      { prisma },
      {
        withSavedAddress: true,
        withAddOn: true,
        offersInSalon: true,
        offersMobile: false,
      },
    )

    if (!seed.services.addOn) {
      throw new Error('Expected seeded add-on for add-ons actionability test')
    }

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)
    await waitForAvailabilityReady(page)

    await createHoldAndAssertSuccess(page, 'add-ons actionability')

    await continueToAddOns(page)
    await page.waitForURL(/\/booking\/add-ons(?:\?|$)/)

    await expectAddOnsPage(page)

    const skipButton = byTestId(page, testIds.addOns.skipButton)
    const addOnsContinueButton = byTestId(page, testIds.addOns.continueButton)

    await expect(skipButton).toBeVisible()
    await expect(addOnsContinueButton).toBeVisible()
    await expect(addOnsContinueButton).toBeEnabled()
  })
})