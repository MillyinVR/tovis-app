import { expect, type Locator, type Page } from '@playwright/test'
import { byTestId, mobileAddressOption, testIds, text } from './selectors'

type Scope = Page | Locator
type DayTarget = string | RegExp

function availabilityDrawer(scope: Scope): Locator {
  return scope.getByRole('dialog').first()
}

function dayButton(scope: Scope, day: DayTarget): Locator {
  return availabilityDrawer(scope).getByRole('button', {
    name: day,
  })
}

function slotButtons(scope: Scope): Locator {
  return availabilityDrawer(scope).getByRole('button', {
    name: /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}(?::\d{2})?\s?(?:AM|PM)/i,
  })
}

function continueButton(scope: Scope): Locator {
  return availabilityDrawer(scope)
    .getByRole('button', {
      name: /continue(?:\s+to\s+add-ons)?/i,
    })
    .first()
}

export async function openAvailabilityDrawer(page: Page): Promise<Locator> {
  await byTestId(page, testIds.availability.openTrigger).click()
  const drawer = availabilityDrawer(page)
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText(text.availability.heading)).toBeVisible()
  return drawer
}

export async function closeAvailabilityDrawer(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  await expect(drawer).toBeVisible()
  await byTestId(drawer, testIds.availability.closeButton).click()
  await expect(drawer).toBeHidden()
}

export async function waitForAvailabilityReady(
  page: Page,
  options?: { allowError?: boolean },
): Promise<void> {
  const drawer = availabilityDrawer(page)
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText(text.availability.heading)).toBeVisible()

  const loading = byTestId(drawer, testIds.availability.loading)
  const errorByTestId = byTestId(drawer, testIds.availability.error)
  const errorByText = drawer.getByText(text.availability.failed)

  if (await loading.count()) {
    await expect(loading).toBeHidden()
  }

  if (!options?.allowError) {
    if (await errorByTestId.count()) {
      await expect(errorByTestId).toBeHidden()
    }
    if (await errorByText.count()) {
      await expect(errorByText).toBeHidden()
    }
  }

  await expect(
    drawer.getByRole('button', { name: /Mon|Tue|Wed|Thu|Fri|Sat|Sun/i }).first(),
  ).toBeVisible({ timeout: 30_000 })

  await expect(slotButtons(page).first()).toBeVisible({ timeout: 30_000 })

  await expect(
    availabilityDrawer(page).getByText(/something went wrong/i),
  ).not.toBeVisible({ timeout: 5_000 })
}

export async function expectAvailabilityError(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const errorByTestId = byTestId(drawer, testIds.availability.error)
  const errorByText = drawer.getByText(text.availability.failed)

  if (await errorByTestId.count()) {
    await expect(errorByTestId).toBeVisible()
    await expect(errorByTestId).toContainText(text.availability.failed)
    return
  }

  await expect(errorByText).toBeVisible()
}

export async function retryAvailability(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const retryByTestId = byTestId(drawer, testIds.availability.retryButton)

  if (await retryByTestId.count()) {
    await retryByTestId.click()
    return
  }

  await drawer.getByRole('button', { name: text.availability.retry }).click()
}

export async function switchToSalon(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const salonOption = byTestId(drawer, testIds.location.salonOption)

  if (await salonOption.count()) {
    await salonOption.scrollIntoViewIfNeeded()
    await salonOption.click({ force: true })
    return
  }

  await drawer
    .getByRole('button', { name: text.location.salon })
    .click({ force: true })
}

export async function switchToMobile(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const mobileOption = byTestId(drawer, testIds.location.mobileOption)

  const target = (await mobileOption.count())
    ? mobileOption
    : drawer.getByRole('button', { name: text.location.mobile })

  // Scroll the scroll container to the top so the toggle is
  // fully clear of the fixed StickyCTA footer before clicking
  await drawer.evaluate((el) => {
    const scroller = el.querySelector('.looksNoScrollbar')
    if (scroller) scroller.scrollTop = 0
  })

  await target.click({ force: true })
}

export async function chooseDay(page: Page, day: DayTarget): Promise<void> {
  const target = dayButton(page, day)
  await expect(target).toBeVisible()
  await target.click()
}

export async function chooseSlot(page: Page, slotIso: string): Promise<void> {
  const drawer = availabilityDrawer(page)
  const slotByTestId = byTestId(drawer, testIds.availability.slotChip(slotIso))

  if (await slotByTestId.count()) {
    await expect(slotByTestId).toBeVisible()
    await slotByTestId.click()
    return
  }

  throw new Error(
    `chooseSlot requires a matching slot test id for slot ${slotIso}.`,
  )
}

export async function expectSlotVisible(
  page: Page,
  slotIso: string,
): Promise<void> {
  const drawer = availabilityDrawer(page)
  await expect(
    byTestId(drawer, testIds.availability.slotChip(slotIso)),
  ).toBeVisible()
}

export async function expectSlotNotVisible(
  page: Page,
  slotIso: string,
): Promise<void> {
  const drawer = availabilityDrawer(page)
  await expect(
    byTestId(drawer, testIds.availability.slotChip(slotIso)),
  ).toHaveCount(0)
}

export async function expectHoldSuccess(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const holdBanner = byTestId(drawer, testIds.availability.holdBanner)
  const holdCountdown = byTestId(drawer, testIds.availability.holdCountdown)

  if ((await holdBanner.count()) && (await holdCountdown.count())) {
    await expect(holdBanner).toBeVisible()
    await expect(holdCountdown).toBeVisible()
    return
  }

  await expect(continueButton(page)).toBeEnabled({ timeout: 15_000 })
}

export async function expectHoldExpired(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  await expect(drawer.getByText(text.availability.expired)).toBeVisible()
}

export async function expectContinueEnabled(page: Page): Promise<void> {
  await expect(continueButton(page)).toBeEnabled()
}

export async function expectContinueDisabled(page: Page): Promise<void> {
  await expect(continueButton(page)).toBeDisabled()
}

export async function continueToAddOns(page: Page): Promise<void> {
  await continueButton(page).click()
}

export async function expectAddOnsPage(page: Page): Promise<void> {
  const pageByTestId = byTestId(page, testIds.addOns.page)

  if (await pageByTestId.count()) {
    await expect(pageByTestId).toBeVisible()
    return
  }

  await expect(
    page.getByRole('heading', { name: /^add-ons$/i }),
  ).toBeVisible()
}

export async function selectSavedMobileAddress(
  page: Page,
  addressId: string,
): Promise<void> {
  const drawer = availabilityDrawer(page)
  const section = byTestId(drawer, testIds.mobileAddress.section)
  const option = mobileAddressOption(section, addressId)

  await expect(section).toBeVisible()
  await expect(option).toBeVisible({ timeout: 15_000 })
  await option.click()
}

export async function expectMobileAddressRequired(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const section = byTestId(drawer, testIds.mobileAddress.section)

  await expect(section).toBeVisible()
  await expect(
    byTestId(section, testIds.mobileAddress.emptyState),
  ).toBeVisible()
  await expect(
    section.getByText(text.mobileAddress.noSavedAddress),
  ).toBeVisible()
  await expectContinueDisabled(page)
}

export async function openAddMobileAddressModal(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const section = byTestId(drawer, testIds.mobileAddress.section)

  await expect(section).toBeVisible()
  await byTestId(section, testIds.mobileAddress.addButton).click()
  await expect(byTestId(page, testIds.mobileAddress.modal)).toBeVisible()
}