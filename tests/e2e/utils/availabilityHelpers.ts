import { expect, type Locator, type Page } from '@playwright/test'
import {
  availabilityContinueButton,
  availabilityDayButtons,
  availabilityDrawer,
  availabilitySlot,
  availabilitySlotButtons,
  byTestId,
  mobileAddressOption,
  testIds,
  text,
} from './selectors'

type Scope = Page | Locator
type DayTarget = string | RegExp

function dayButton(scope: Scope, day: DayTarget): Locator {
  return availabilityDrawer(scope).getByRole('button', {
    name: day,
  })
}

function continueButton(scope: Scope): Locator {
  return availabilityContinueButton(scope)
}

function salonFallbackButton(scope: Scope): Locator {
  return scope
    .getByRole('button', {
      name: /^(?:in-salon|salon)$/i,
    })
    .first()
}

function mobileFallbackButton(scope: Scope): Locator {
  return scope
    .getByRole('button', {
      name: /^mobile$/i,
    })
    .first()
}

async function waitForMobileAddressLoadingToFinish(
  section: Locator,
): Promise<void> {
  const loadingText = section.getByText(/loading saved addresses/i)

  if (await loadingText.count()) {
    await expect(loadingText).toBeHidden({ timeout: 15_000 })
  }
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

  const errorByTestId = byTestId(drawer, testIds.availability.error)
  const errorByText = drawer.getByText(text.availability.failed)
  const loadingByText = drawer.getByText(
    /loading times|loading more days|holding your time/i,
  )

  if (await loadingByText.count()) {
    await expect(loadingByText).toBeHidden({ timeout: 30_000 })
  }

  if (!options?.allowError) {
    if (await errorByTestId.count()) {
      await expect(errorByTestId).toBeHidden()
    }

    if (await errorByText.count()) {
      await expect(errorByText).toBeHidden()
    }
  }

  await expect(availabilityDayButtons(page).first()).toBeVisible({
    timeout: 30_000,
  })

  await expect(availabilitySlotButtons(page).first()).toBeVisible({
    timeout: 30_000,
  })

  await expect(
    drawer.getByText(/something went wrong/i),
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
  const salonOption = byTestId(drawer, testIds.location.salonOption).first()
  const fallback = salonFallbackButton(drawer)

  if (await salonOption.count()) {
    await expect(salonOption).toBeVisible({ timeout: 15_000 })
    await salonOption.scrollIntoViewIfNeeded()
    await salonOption.click({ force: true })
    return
  }

  await expect(fallback).toBeVisible({ timeout: 15_000 })
  await fallback.scrollIntoViewIfNeeded()
  await fallback.click({ force: true })
}

export async function switchToMobile(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const mobileOption = byTestId(drawer, testIds.location.mobileOption).first()
  const fallback = mobileFallbackButton(drawer)

  if (await mobileOption.count()) {
    await expect(mobileOption).toBeVisible({ timeout: 15_000 })
    await mobileOption.scrollIntoViewIfNeeded()
    await mobileOption.click({ force: true })
    return
  }

  await expect(fallback).toBeVisible({ timeout: 15_000 })
  await fallback.scrollIntoViewIfNeeded()
  await fallback.click({ force: true })
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
    await expect(slotByTestId).toBeEnabled()
    await slotByTestId.click()
    return
  }

  throw new Error(
    `chooseSlot requires a matching slot test id for slot ${slotIso}.`,
  )
}

export async function chooseFirstEnabledSlot(page: Page): Promise<void> {
  const slots = availabilitySlotButtons(page)
  const count = await slots.count()

  for (let index = 0; index < count; index += 1) {
    const slot = slots.nth(index)

    if (!(await slot.isVisible())) continue
    if (!(await slot.isEnabled())) continue

    await slot.click()
    return
  }

  throw new Error('No enabled availability slot found.')
}

export async function expectSlotVisible(
  page: Page,
  slotIso: string,
): Promise<void> {
  await expect(availabilitySlot(page, slotIso)).toBeVisible()
}

export async function expectSlotNotVisible(
  page: Page,
  slotIso: string,
): Promise<void> {
  await expect(availabilitySlot(page, slotIso)).toHaveCount(0)
}

export async function expectHoldSuccess(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const holdBanner = byTestId(drawer, testIds.availability.holdBanner)

  if (await holdBanner.count()) {
    await expect(holdBanner).toBeVisible()
    await expect(continueButton(page)).toBeEnabled({ timeout: 15_000 })
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
  await expect(continueButton(page)).toBeEnabled({ timeout: 15_000 })
  await continueButton(page).click()
}

export async function expectAddOnsPage(page: Page): Promise<void> {
  const listByTestId = byTestId(page, testIds.addOns.list)

  if (await listByTestId.count()) {
    await expect(listByTestId).toBeVisible()
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
  await waitForMobileAddressLoadingToFinish(section)
  await expect(option).toBeVisible({ timeout: 15_000 })
  await option.click()
}

export async function expectMobileAddressRequired(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const section = byTestId(drawer, testIds.mobileAddress.section)
  const emptyState = byTestId(section, testIds.mobileAddress.emptyState)
  const addButton = byTestId(section, testIds.mobileAddress.addButton)

  const noSavedAddressText = section.getByText(
    text.mobileAddress.noSavedAddress,
  )
  const noSavedAddressHelpText = section.getByText(
    text.mobileAddress.noSavedAddressHelp,
  )
  const addFirstAddressButton = section.getByRole('button', {
    name: text.mobileAddress.addFirstAddress,
  })

  await expect(section).toBeVisible()
  await waitForMobileAddressLoadingToFinish(section)

  if (await emptyState.count()) {
    await expect(emptyState).toBeVisible()
  }

  await expect(noSavedAddressText).toBeVisible({ timeout: 15_000 })
  await expect(noSavedAddressHelpText).toBeVisible({ timeout: 15_000 })
  await expect(addButton).toBeVisible()
  await expect(addButton).toBeEnabled()
  await expect(addFirstAddressButton).toBeVisible()
  await expect(addFirstAddressButton).toBeEnabled()
  await expectContinueDisabled(page)
}

export async function openAddMobileAddressModal(page: Page): Promise<void> {
  const drawer = availabilityDrawer(page)
  const section = byTestId(drawer, testIds.mobileAddress.section)
  const addButton = byTestId(section, testIds.mobileAddress.addButton)

  await expect(section).toBeVisible()
  await waitForMobileAddressLoadingToFinish(section)
  await expect(addButton).toBeVisible()
  await expect(addButton).toBeEnabled()
  await addButton.click()
  await expect(byTestId(page, testIds.mobileAddress.modal)).toBeVisible()
}