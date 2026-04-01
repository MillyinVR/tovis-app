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

function salonModeButton(page: Page): Locator {
  return availabilityDialog(page)
    .getByRole('button', { name: /salon/i })
    .first()
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

async function chooseFirstVisibleTimeSlot(page: Page): Promise<void> {
  const slots = slotButtons(page)
  const firstSlot = slots.first()

  await expect(firstSlot).toBeVisible({ timeout: 10_000 })
  await expect(firstSlot).toBeEnabled({ timeout: 10_000 })

  await firstSlot.click()
}

async function selectSalonModeIfVisible(page: Page): Promise<void> {
  const button = salonModeButton(page)

  if (await button.count()) {
    await button.click()
  }
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

    await expect(dayButtons(page).first()).toBeVisible()
    await expect(slotButtons(page).first()).toBeVisible()
    await expect(continueButton(page)).toBeDisabled()
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

    await selectSalonModeIfVisible(page)
    await waitForAvailabilityReady(page)

    const holdResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/holds') &&
        resp.request().method() === 'POST',
    )

    await chooseFirstVisibleTimeSlot(page)

    const holdResponse = await holdResponsePromise
    const holdBody = await holdResponse.text()

    console.log('hold status', holdResponse.status())
    console.log('hold body', holdBody)

    expect(holdResponse.status(), holdBody).toBe(201)

    await expect(continueButton(page)).toBeEnabled({ timeout: 15_000 })
    await continueButton(page).click()

    await page.waitForURL(/\/booking\/add-ons(?:\?|$)/)

    const url = new URL(page.url())

    expect(url.pathname).toBe('/booking/add-ons')
    expect(url.searchParams.get('holdId')).toBeTruthy()
    expect(url.searchParams.get('offeringId')).toBe(seed.offering.id)
    expect(url.searchParams.get('locationType')).toBe('SALON')

    await expect(
      page.getByRole('heading', { name: /add-ons|add ons/i }),
    ).toBeVisible()
  })
})