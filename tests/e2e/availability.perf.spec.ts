import { promises as fs } from 'fs'
import path from 'path'
import { expect, test, type Locator, type Page } from '@playwright/test'

import type {
  AvailabilityPerfCompletedEntry,
  AvailabilityPerfEntry,
  AvailabilityPerfMeta,
  AvailabilityPerfMetricName,
  AvailabilityPerfScenarioName,
} from '../../app/(main)/booking/AvailabilityDrawer/perf/availabilityPerfTypes'

type CompletedRawPerfSample = {
  scenario: AvailabilityPerfScenarioName
  metric: AvailabilityPerfMetricName
  durationMs: number
  meta?: AvailabilityPerfMeta
  invalid?: false
}

type InvalidRawPerfSample = {
  scenario: AvailabilityPerfScenarioName
  metric: AvailabilityPerfMetricName
  invalid: true
  invalidReason: string
  meta?: AvailabilityPerfMeta
}

type RawPerfSample = CompletedRawPerfSample | InvalidRawPerfSample

type RawPerfArtifact = {
  gate: 2
  suite: 'availability'
  environment: 'desktop' | 'mobile'
  deviceProfile: string
  projectName: string
  collectedAt: string
  sampleTargetPerScenario: number
  bookingUrl: string
  samples: RawPerfSample[]
}

type HoldAttemptOutcome =
  | {
      ok: true
      entry: AvailabilityPerfCompletedEntry
    }
  | {
      ok: false
      reason: string
      meta?: AvailabilityPerfMeta
    }

const PERF_CASES = {
  drawerOpen: {
    scenario: 'drawer-open',
    metric: 'drawer_open_to_first_usable_ms',
  },
  daySwitch: {
    scenario: 'day-switch',
    metric: 'day_switch_to_times_visible_ms',
  },
  holdRequest: {
    scenario: 'hold-request',
    metric: 'hold_request_latency_ms',
  },
  continueToAddOns: {
    scenario: 'continue-to-add-ons',
    metric: 'continue_to_add_ons_ms',
  },
  backgroundRefresh: {
    scenario: 'background-refresh',
    metric: 'background_refresh_ms',
  },
} satisfies Record<
  string,
  {
    scenario: AvailabilityPerfScenarioName
    metric: AvailabilityPerfMetricName
  }
>

const DEFAULT_SAMPLE_COUNT = 2
const DEFAULT_BOOKING_URL = 'http://127.0.0.1:3000/looks'
const MAX_HOLD_ATTEMPTS_PER_SAMPLE = 8

const SAMPLE_COUNT = parsePositiveInteger(
  process.env.PERF_SAMPLES,
  DEFAULT_SAMPLE_COUNT,
)

const BOOKING_URL = readTrimmedEnv(
  process.env.PERF_BOOKING_URL,
  DEFAULT_BOOKING_URL,
)

const SELECTORS = {
  bookingTrigger: compactSelectors([
    process.env.PERF_BOOKING_TRIGGER_SELECTOR,
    '[data-testid="open-availability-button"]',
    '[data-testid="book-now-button"]',
    'button:has-text("Check availability")',
    'button:has-text("Availability")',
    'button:has-text("Book")',
  ]),
  dayButton: compactSelectors([process.env.PERF_DAY_BUTTON_SELECTOR]),
  slotButton: compactSelectors([
    process.env.PERF_SLOT_BUTTON_SELECTOR,
    '[data-testid="availability-slot-button"]',
  ]),
  drawerContinue: compactSelectors([
    process.env.PERF_DRAWER_CONTINUE_SELECTOR,
    '[data-testid="availability-hold-continue-button"]',
  ]),
  backgroundRefreshTrigger: compactSelectors([
    process.env.PERF_BACKGROUND_REFRESH_TRIGGER_SELECTOR,
    '[data-testid="availability-refresh-button"]',
  ]),
}

function isNonEmptyString(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function readTrimmedEnv(value: string | undefined, fallback: string): string {
  return isNonEmptyString(value) ? value.trim() : fallback
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function compactSelectors(
  selectors: Array<string | undefined | null>,
): string[] {
  return selectors.filter(isNonEmptyString).map((selector) => selector.trim())
}

function environmentFromProject(projectName: string): 'desktop' | 'mobile' {
  return /pixel|mobile|android/i.test(projectName) ? 'mobile' : 'desktop'
}

function artifactPathForProject(projectName: string): string {
  const environment = environmentFromProject(projectName)
  const filename =
    environment === 'mobile' ? 'raw-mobile.json' : 'raw-desktop.json'

  return path.join(process.cwd(), 'artifacts', 'perf', 'availability', filename)
}

async function ensureArtifactDir(projectName: string): Promise<void> {
  await fs.mkdir(path.dirname(artifactPathForProject(projectName)), {
    recursive: true,
  })
}

async function writeArtifact(
  projectName: string,
  artifact: RawPerfArtifact,
): Promise<void> {
  await ensureArtifactDir(projectName)
  await fs.writeFile(
    artifactPathForProject(projectName),
    JSON.stringify(artifact, null, 2),
    'utf-8',
  )
}

function isCompletedPerfEntry(
  entry: AvailabilityPerfEntry,
): entry is AvailabilityPerfCompletedEntry {
  return entry.status === 'completed' && typeof entry.durationMs === 'number'
}

function readBooleanMeta(
  meta: AvailabilityPerfMeta | undefined,
  key: string,
): boolean | null {
  const value = meta?.[key]
  return typeof value === 'boolean' ? value : null
}

function readNumberMeta(
  meta: AvailabilityPerfMeta | undefined,
  key: string,
): number | null {
  const value = meta?.[key]
  return typeof value === 'number' ? value : null
}

function isSuccessfulHoldEntry(entry: AvailabilityPerfCompletedEntry): boolean {
  return (
    readBooleanMeta(entry.meta, 'ok') === true &&
    readNumberMeta(entry.meta, 'statusCode') === 201
  )
}

function getHoldFailureReason(entry: AvailabilityPerfCompletedEntry): string {
  const statusCode = readNumberMeta(entry.meta, 'statusCode')
  if (statusCode != null) {
    return `hold_request_status_${statusCode}`
  }

  const ok = readBooleanMeta(entry.meta, 'ok')
  if (ok === false) {
    return 'hold_request_unsuccessful'
  }

  return 'hold_request_missing_success_signal'
}

async function resetPerfStore(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (!window.__tovisAvailabilityPerf) {
      window.__tovisAvailabilityPerf = {
        version: 1,
        entries: [],
        active: {},
      }
      return
    }

    window.__tovisAvailabilityPerf.entries = []
    window.__tovisAvailabilityPerf.active = {}
  })
}

async function readPerfEntries(page: Page): Promise<AvailabilityPerfEntry[]> {
  return page.evaluate(() => {
    return window.__tovisAvailabilityPerf?.entries ?? []
  })
}

async function waitForMetric(
  page: Page,
  metric: AvailabilityPerfMetricName,
  key?: string,
  timeoutMs = 15_000,
): Promise<AvailabilityPerfCompletedEntry | null> {
  try {
    await page.waitForFunction(
      ({ metricName, metricKey }) => {
        const entries = window.__tovisAvailabilityPerf?.entries ?? []

        return entries.some((entry) => {
          if (entry.metric !== metricName) return false
          if (entry.status !== 'completed') return false
          if (metricKey && entry.key !== metricKey) return false
          return typeof entry.durationMs === 'number'
        })
      },
      { metricName: metric, metricKey: key ?? null },
      { timeout: timeoutMs },
    )
  } catch {
    return null
  }

  const entries = await readPerfEntries(page)
  const completedEntries = entries.filter(isCompletedPerfEntry)

  return (
    completedEntries.findLast((entry) => {
      if (entry.metric !== metric) return false
      if (key && entry.key !== key) return false
      return true
    }) ?? null
  )
}

async function gotoBookingPage(page: Page): Promise<void> {
  if (!BOOKING_URL) {
    throw new Error(
      'Missing PERF_BOOKING_URL. Set it to a page where the availability flow can be opened.',
    )
  }

  await page.goto(BOOKING_URL, { waitUntil: 'networkidle' })
}

async function firstVisibleLocator(
  page: Page,
  selectors: readonly string[],
): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()

    if ((await locator.count()) === 0) continue

    try {
      await locator.waitFor({ state: 'visible', timeout: 750 })
      return locator
    } catch {
      // try next selector
    }
  }

  return null
}

async function findBookingTrigger(page: Page): Promise<Locator> {
  const locator = await firstVisibleLocator(page, SELECTORS.bookingTrigger)

  if (!locator) {
    throw new Error(
      'Could not find booking trigger. Set PERF_BOOKING_TRIGGER_SELECTOR for this page.',
    )
  }

  return locator
}

async function openDrawerAndWaitUsable(
  page: Page,
): Promise<AvailabilityPerfCompletedEntry | null> {
  const trigger = await findBookingTrigger(page)
  await trigger.click()

  await expect(page.getByTestId('availability-drawer')).toBeVisible()
  return waitForMetric(page, PERF_CASES.drawerOpen.metric)
}

async function findDayButtons(page: Page): Promise<Locator[]> {
  for (const selector of SELECTORS.dayButton) {
    const locators = page.locator(selector)
    const count = await locators.count()

    if (count === 0) continue

    return Array.from({ length: count }, (_, index) => locators.nth(index))
  }

  const drawer = page.getByTestId('availability-drawer')
  const buttons = drawer.getByRole('button')
  const count = await buttons.count()
  const results: Locator[] = []

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index)
    const text = ((await button.textContent()) ?? '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!text) continue
    if (!/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s*\d{1,2}$/i.test(text)) continue

    results.push(button)
  }

  return results
}

async function waitForHoldReady(page: Page): Promise<void> {
  const drawer = page.getByTestId('availability-drawer')

  const signals: Locator[] = [
    page.getByTestId('availability-hold-banner'),
    page.getByTestId('availability-hold-continue-button'),
    drawer.getByText(/your time is held|time held/i).first(),
  ]

  for (const locator of signals) {
    try {
      await expect(locator).toBeVisible({ timeout: 15_000 })
      return
    } catch {
      // try next signal
    }
  }

  throw new Error('hold_ready_ui_missing')
}

async function clickDifferentDay(page: Page): Promise<string | null> {
  const buttons = await findDayButtons(page)

  if (buttons.length < 2) return null

  const target = buttons[1]
  const label = ((await target.textContent()) ?? '').replace(/\s+/g, ' ').trim()

  await target.click()
  return label || 'unknown-day'
}

async function findSlotButtons(page: Page): Promise<Locator[]> {
  for (const selector of SELECTORS.slotButton) {
    const locators = page.locator(selector)
    const count = await locators.count()

    if (count === 0) continue

    return Array.from({ length: count }, (_, index) => locators.nth(index))
  }

  const drawer = page.getByTestId('availability-drawer')
  const timeLikeButtons = drawer
    .getByRole('button')
    .filter({ hasText: /(\d{1,2}:\d{2}|\d{1,2}\s?(am|pm))/i })

  const count = await timeLikeButtons.count()

  return Array.from({ length: count }, (_, index) => timeLikeButtons.nth(index))
}

async function createSuccessfulHold(
  page: Page,
  options?: { requireReadyUi?: boolean },
): Promise<HoldAttemptOutcome> {
  const slotButtons = await findSlotButtons(page)

  if (slotButtons.length === 0) {
    return { ok: false, reason: 'slot_button_missing' }
  }

  let lastFailureReason = 'hold_not_created'
  let lastFailureMeta: AvailabilityPerfMeta | undefined

  const attemptCount = Math.min(slotButtons.length, MAX_HOLD_ATTEMPTS_PER_SAMPLE)

  for (let index = 0; index < attemptCount; index += 1) {
    const slotButton = slotButtons[index]

    try {
      await expect(slotButton).toBeVisible({ timeout: 1_500 })
      if (!(await slotButton.isEnabled())) {
        continue
      }
    } catch {
      continue
    }

    await resetPerfStore(page)
    await slotButton.click()

    const entry = await waitForMetric(
      page,
      PERF_CASES.holdRequest.metric,
      undefined,
      20_000,
    )

    if (!entry) {
      lastFailureReason = 'missing_perf_metric'
      continue
    }

    if (!isSuccessfulHoldEntry(entry)) {
      lastFailureReason = getHoldFailureReason(entry)
      lastFailureMeta = entry.meta
      continue
    }

    if (options?.requireReadyUi) {
      try {
        await waitForHoldReady(page)
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof Error ? error.message : 'hold_ready_ui_missing',
          meta: entry.meta,
        }
      }
    }

    return {
      ok: true,
      entry,
    }
  }

  return {
    ok: false,
    reason: lastFailureReason,
    meta: lastFailureMeta,
  }
}

async function waitForAddOnsReady(page: Page): Promise<void> {
  const signals: Locator[] = [
    page.getByTestId('booking-add-ons-continue-button'),
    page.getByTestId('booking-add-ons-list'),
    page.getByRole('heading', { name: /add-ons/i }).first(),
  ]

  for (const locator of signals) {
    try {
      await expect(locator).toBeVisible({ timeout: 15_000 })
      return
    } catch {
      // try next signal
    }
  }

  throw new Error('add_ons_ready_ui_missing')
}

async function findEnabledContinueButton(page: Page): Promise<Locator | null> {
  const explicit = await firstVisibleLocator(page, SELECTORS.drawerContinue)
  if (explicit) {
    try {
      await expect(explicit).toBeEnabled({ timeout: 15_000 })
      return explicit
    } catch {
      // fall through to generic search
    }
  }

  const drawer = page.getByTestId('availability-drawer')
  const candidates = drawer.getByRole('button', {
    name: /continue to add-ons|continue/i,
  })
  const count = await candidates.count()

  for (let index = 0; index < count; index += 1) {
    const button = candidates.nth(index)

    try {
      if (!(await button.isVisible())) continue
      if (!(await button.isEnabled())) continue
      return button
    } catch {
      // try next candidate
    }
  }

  return null
}

async function clickContinueAndWait(
  page: Page,
): Promise<AvailabilityPerfCompletedEntry | null> {
  const preferred = page.getByTestId('availability-hold-continue-button')

  if ((await preferred.count()) > 0) {
    await expect(preferred).toBeVisible({ timeout: 15_000 })
    await expect(preferred).toBeEnabled({ timeout: 15_000 })
    await preferred.click()
  } else {
    const button = await findEnabledContinueButton(page)

    if (!button) {
      throw new Error(
        'Could not find enabled drawer continue button. Set PERF_DRAWER_CONTINUE_SELECTOR if needed.',
      )
    }

    await expect(button).toBeEnabled({ timeout: 15_000 })
    await button.click()
  }

  await waitForAddOnsReady(page)

  return waitForMetric(
    page,
    PERF_CASES.continueToAddOns.metric,
    undefined,
    20_000,
  )
}

async function triggerBackgroundRefresh(page: Page): Promise<void> {
  const trigger = await firstVisibleLocator(
    page,
    SELECTORS.backgroundRefreshTrigger,
  )

  if (!trigger) {
    throw new Error('background_refresh_trigger_missing')
  }

  await expect(trigger).toBeEnabled({ timeout: 15_000 })
  await trigger.click()
}

function mergeMeta(
  entryMeta?: AvailabilityPerfMeta,
  extraMeta?: AvailabilityPerfMeta,
): AvailabilityPerfMeta | undefined {
  if (!entryMeta && !extraMeta) return undefined

  return {
    ...(entryMeta ?? {}),
    ...(extraMeta ?? {}),
  }
}

function toCompletedSample(
  perfCase: {
    scenario: AvailabilityPerfScenarioName
    metric: AvailabilityPerfMetricName
  },
  entry: AvailabilityPerfCompletedEntry,
  extraMeta?: AvailabilityPerfMeta,
): CompletedRawPerfSample {
  return {
    scenario: perfCase.scenario,
    metric: perfCase.metric,
    durationMs: entry.durationMs,
    meta: mergeMeta(entry.meta, extraMeta),
  }
}

function toInvalidSample(
  perfCase: {
    scenario: AvailabilityPerfScenarioName
    metric: AvailabilityPerfMetricName
  },
  invalidReason: string,
  extraMeta?: AvailabilityPerfMeta,
): InvalidRawPerfSample {
  return {
    scenario: perfCase.scenario,
    metric: perfCase.metric,
    invalid: true,
    invalidReason,
    meta: extraMeta,
  }
}

async function collectDrawerOpenSample(page: Page): Promise<RawPerfSample> {
  try {
    await gotoBookingPage(page)
    await resetPerfStore(page)

    const entry = await openDrawerAndWaitUsable(page)

    if (!entry) {
      return toInvalidSample(PERF_CASES.drawerOpen, 'missing_perf_metric')
    }

    return toCompletedSample(PERF_CASES.drawerOpen, entry)
  } catch (error) {
    return toInvalidSample(
      PERF_CASES.drawerOpen,
      error instanceof Error ? error.message : 'drawer_open_failed',
    )
  }
}

async function collectDaySwitchSample(page: Page): Promise<RawPerfSample> {
  try {
    await gotoBookingPage(page)
    await resetPerfStore(page)

    const usable = await openDrawerAndWaitUsable(page)

    if (!usable) {
      return toInvalidSample(PERF_CASES.daySwitch, 'drawer_not_usable')
    }

    await resetPerfStore(page)

    const dayLabel = await clickDifferentDay(page)

    if (!dayLabel) {
      return toInvalidSample(PERF_CASES.daySwitch, 'insufficient_day_buttons')
    }

    const entry = await waitForMetric(page, PERF_CASES.daySwitch.metric)

    if (!entry) {
      return toInvalidSample(PERF_CASES.daySwitch, 'missing_perf_metric', {
        requestedDayLabel: dayLabel,
      })
    }

    return toCompletedSample(PERF_CASES.daySwitch, entry, {
      requestedDayLabel: dayLabel,
    })
  } catch (error) {
    return toInvalidSample(
      PERF_CASES.daySwitch,
      error instanceof Error ? error.message : 'day_switch_failed',
    )
  }
}

async function collectHoldRequestSample(page: Page): Promise<RawPerfSample> {
  try {
    await gotoBookingPage(page)
    await resetPerfStore(page)

    const usable = await openDrawerAndWaitUsable(page)

    if (!usable) {
      return toInvalidSample(PERF_CASES.holdRequest, 'drawer_not_usable')
    }

    const holdOutcome = await createSuccessfulHold(page)

    if (!holdOutcome.ok) {
      return toInvalidSample(
        PERF_CASES.holdRequest,
        holdOutcome.reason,
        holdOutcome.meta,
      )
    }

    return toCompletedSample(PERF_CASES.holdRequest, holdOutcome.entry)
  } catch (error) {
    return toInvalidSample(
      PERF_CASES.holdRequest,
      error instanceof Error ? error.message : 'hold_request_failed',
    )
  }
}

async function collectContinueSample(page: Page): Promise<RawPerfSample> {
  try {
    await gotoBookingPage(page)
    await resetPerfStore(page)

    const usable = await openDrawerAndWaitUsable(page)

    if (!usable) {
      return toInvalidSample(PERF_CASES.continueToAddOns, 'drawer_not_usable')
    }

    const holdOutcome = await createSuccessfulHold(page, {
      requireReadyUi: true,
    })

    if (!holdOutcome.ok) {
      return toInvalidSample(
        PERF_CASES.continueToAddOns,
        holdOutcome.reason,
        holdOutcome.meta,
      )
    }

    await resetPerfStore(page)

    const entry = await clickContinueAndWait(page)

    if (!entry) {
      return toInvalidSample(PERF_CASES.continueToAddOns, 'missing_perf_metric')
    }

    return toCompletedSample(PERF_CASES.continueToAddOns, entry)
  } catch (error) {
    return toInvalidSample(
      PERF_CASES.continueToAddOns,
      error instanceof Error ? error.message : 'continue_failed',
    )
  }
}

async function collectBackgroundRefreshSample(
  page: Page,
): Promise<RawPerfSample> {
  try {
    await gotoBookingPage(page)
    await resetPerfStore(page)

    const usable = await openDrawerAndWaitUsable(page)

    if (!usable) {
      return toInvalidSample(PERF_CASES.backgroundRefresh, 'drawer_not_usable')
    }

    await resetPerfStore(page)
    await triggerBackgroundRefresh(page)

    const entry = await waitForMetric(
      page,
      PERF_CASES.backgroundRefresh.metric,
      undefined,
      20_000,
    )

    if (!entry) {
      return toInvalidSample(PERF_CASES.backgroundRefresh, 'missing_perf_metric')
    }

    return toCompletedSample(PERF_CASES.backgroundRefresh, entry)
  } catch (error) {
    return toInvalidSample(
      PERF_CASES.backgroundRefresh,
      error instanceof Error ? error.message : 'background_refresh_failed',
    )
  }
}

test.describe('availability performance collection', () => {
  test.describe.configure({ mode: 'serial' })

  test('collect raw perf samples', async ({ page }, testInfo) => {
    test.setTimeout(10 * 60 * 1000)

    const projectName = testInfo.project.name
    const environment = environmentFromProject(projectName)
    const samples: RawPerfSample[] = []

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectDrawerOpenSample(page))
    }

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectDaySwitchSample(page))
    }

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectHoldRequestSample(page))
    }

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectContinueSample(page))
    }

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectBackgroundRefreshSample(page))
    }

    const artifact: RawPerfArtifact = {
      gate: 2,
      suite: 'availability',
      environment,
      deviceProfile: projectName,
      projectName,
      collectedAt: new Date().toISOString(),
      sampleTargetPerScenario: SAMPLE_COUNT,
      bookingUrl: BOOKING_URL,
      samples,
    }

    await writeArtifact(projectName, artifact)

    expect(samples.length).toBe(SAMPLE_COUNT * 5)
  })
})