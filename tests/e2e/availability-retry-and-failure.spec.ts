import { expect, test, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

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

function dayButtons(page: Page): Locator {
  return availabilityDialog(page).getByRole('button', {
    name: /Mon|Tue|Wed|Thu|Fri|Sat|Sun/i,
  })
}

function slotButtons(page: Page): Locator {
  return availabilityDialog(page).getByRole('button', {
    name: /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}(?::\d{2})?\s?(?:AM|PM)/i,
  })
}

function availabilityError(page: Page): Locator {
  return availabilityDialog(page).getByText(
    /could not load|something went wrong|failed/i,
  )
}

function availabilityRetryButton(page: Page): Locator {
  return availabilityDialog(page)
    .getByRole('button', { name: /retry/i })
    .first()
}

function holdExpiredMessage(page: Page): Locator {
  return availabilityDialog(page).getByText(
    /expired|time ran out|hold expired/i,
  )
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

async function waitForAvailabilityReady(page: Page): Promise<void> {
  await expect(availabilityDialog(page)).toBeVisible()
  await expect(dayButtons(page).first()).toBeVisible({ timeout: 30_000 })
  await expect(slotButtons(page).first()).toBeVisible({ timeout: 30_000 })
}

async function chooseSlotByIndex(page: Page, index: number): Promise<void> {
  const slots = slotButtons(page)
  await expect(slots.first()).toBeVisible()
  expect(await slots.count()).toBeGreaterThan(0)
  await slots.nth(index).click()
}

test.beforeAll(async () => {
  await prisma.$connect()
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

test.describe('availability retry and failure browser flow', () => {
  let seed: SeedBookingFlowResult | null = null

  test.afterEach(async ({ page }) => {
    await page.unroute('**/api/availability/day**')
    await page.unroute('**/api/holds')

    await teardownBookingFlow({
      prisma,
      seed,
    })
    seed = null
  })

  test('shows an availability error and recovers after retry', async ({
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

    let failedOnce = false

    await page.route('**/api/availability/day**', async (route) => {
      const request = route.request()

      if (request.method() !== 'GET') {
        await route.continue()
        return
      }

      if (!failedOnce) {
        failedOnce = true

        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: 'Could not load availability.',
          }),
        })
        return
      }

      await route.continue()
    })

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)

    await expect(availabilityError(page)).toBeVisible()
    await expect(continueButton(page)).toBeDisabled()

    await availabilityRetryButton(page).click()
    await waitForAvailabilityReady(page)

    await expect(slotButtons(page).first()).toBeVisible()
  })

  test('surfaces a hold-expired path, keeps continue disabled, and allows retrying the hold', async ({
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

    let failedHoldOnce = false

    await page.route('**/api/holds', async (route) => {
      const request = route.request()

      if (request.method() !== 'POST') {
        await route.continue()
        return
      }

      if (!failedHoldOnce) {
        failedHoldOnce = true

        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: 'Hold expired.',
            code: 'HOLD_EXPIRED',
            retryable: true,
            uiAction: 'retry',
            message: 'Hold expired.',
          }),
        })
        return
      }

      await route.continue()
    })

    await gotoProfessionalServicesPage(page, seed)
    await openAvailabilityFromSeededService(page, seed)
    await waitForAvailabilityReady(page)

    const failedHoldResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
    )

    await chooseSlotByIndex(page, 0)

    const failedHoldResponse = await failedHoldResponsePromise
    const failedHoldBody = await failedHoldResponse.text()

    console.log('failed hold status', failedHoldResponse.status())
    console.log('failed hold body', failedHoldBody)

    expect(failedHoldResponse.status(), failedHoldBody).toBe(409)

    await expect(holdExpiredMessage(page)).toBeVisible()
    await expect(continueButton(page)).toBeDisabled()

    // Wait for slots to be interactable before setting up the retry interceptor.
    // This ensures the UI has fully settled into error state before we click again.
    await expect(slotButtons(page).first()).toBeVisible({ timeout: 15_000 })

    const retryIndex = (await slotButtons(page).count()) > 1 ? 1 : 0

    const retryHoldResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
      { timeout: 30_000 },
    )

    await chooseSlotByIndex(page, retryIndex)

    const retryHoldResponse = await retryHoldResponsePromise
    const retryHoldBody = await retryHoldResponse.text()

    console.log('retry hold status', retryHoldResponse.status())
    console.log('retry hold body', retryHoldBody)

    expect(retryHoldResponse.status(), retryHoldBody).toBe(201)

    await expect(continueButton(page)).toBeEnabled({ timeout: 15_000 })
  })
})