import { expect, test, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import {
  chooseFirstEnabledSlot,
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

  const drawer = byTestId(page, testIds.availability.drawer)
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText(/^availability$/i)).toBeVisible()
}

async function waitForLocationToggleReady(page: Page): Promise<void> {
  const drawer = byTestId(page, testIds.availability.drawer)

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

  await expectHoldSuccess(page)
  await expectContinueEnabled(page)
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
    await waitForLocationToggleReady(page)

    await switchToMobile(page)
    await selectSavedMobileAddress(page, seed.clientAddress.id)
    await waitForAvailabilityReady(page)

    await createHoldAndAssertSuccess(page, 'mobile')

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
    await waitForLocationToggleReady(page)

    await switchToMobile(page)
    await expectMobileAddressRequired(page)
    await expectContinueDisabled(page)

    await openAddMobileAddressModal(page)
  })
})