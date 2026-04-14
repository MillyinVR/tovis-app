import { expect, test, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import {
  expectAvailabilityError,
  expectContinueDisabled,
  expectContinueEnabled,
  expectHoldExpired,
  retryAvailability,
  waitForAvailabilityReady,
} from './utils/availabilityHelpers'
import {
  availabilityDrawer,
  availabilitySlotButtons,
} from './utils/selectors'
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

  const drawer = availabilityDrawer(page)
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText(/^availability$/i)).toBeVisible()
}

async function chooseEnabledSlotByIndex(
  page: Page,
  index: number,
): Promise<void> {
  const slots = availabilitySlotButtons(page)
  const count = await slots.count()
  const enabledVisibleSlots: Locator[] = []

  for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
    const slot = slots.nth(slotIndex)

    if (!(await slot.isVisible())) continue
    if (!(await slot.isEnabled())) continue

    enabledVisibleSlots.push(slot)
  }

  if (enabledVisibleSlots.length === 0) {
    throw new Error('No enabled time slot found in availability drawer')
  }

  const targetIndex =
    index >= 0 && index < enabledVisibleSlots.length ? index : 0

  await enabledVisibleSlots[targetIndex].click()
}

async function enabledSlotCount(page: Page): Promise<number> {
  const slots = availabilitySlotButtons(page)
  const count = await slots.count()
  let enabledCount = 0

  for (let index = 0; index < count; index += 1) {
    const slot = slots.nth(index)

    if (!(await slot.isVisible())) continue
    if (!(await slot.isEnabled())) continue

    enabledCount += 1
  }

  return enabledCount
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

    await expectAvailabilityError(page)
    await expectContinueDisabled(page)

    await retryAvailability(page)
    await waitForAvailabilityReady(page)

    await expect(availabilitySlotButtons(page).first()).toBeVisible()
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
      { timeout: 30_000 },
    )

    await chooseEnabledSlotByIndex(page, 0)

    const failedHoldResponse = await failedHoldResponsePromise
    const failedHoldBody = await failedHoldResponse.text()

    console.log('failed hold status', failedHoldResponse.status())
    console.log('failed hold body', failedHoldBody)

    expect(failedHoldResponse.status(), failedHoldBody).toBe(409)

    await expectHoldExpired(page)
    await expectContinueDisabled(page)

    await expect(availabilitySlotButtons(page).first()).toBeVisible({
      timeout: 15_000,
    })

    const retryIndex = (await enabledSlotCount(page)) > 1 ? 1 : 0

    const retryHoldResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
      { timeout: 30_000 },
    )

    await chooseEnabledSlotByIndex(page, retryIndex)

    const retryHoldResponse = await retryHoldResponsePromise
    const retryHoldBody = await retryHoldResponse.text()

    console.log('retry hold status', retryHoldResponse.status())
    console.log('retry hold body', retryHoldBody)

    expect(retryHoldResponse.status(), retryHoldBody).toBe(201)

    await expectContinueEnabled(page)
  })
})