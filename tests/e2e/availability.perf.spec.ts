// tests/e2e/availability.perf.spec.ts
import { promises as fs } from 'fs'
import path from 'path'
import { expect, test, type Locator, type Page } from '@playwright/test'

type PerfEntry = {
  metric: string
  key: string
  startedAt: number
  endedAt: number
  durationMs: number | null
  status: 'completed' | 'cancelled'
  reason?: string
  meta?: Record<string, unknown>
}

type RawPerfSample =
  | {
      scenario:
        | 'drawer-open'
        | 'day-switch'
        | 'hold-request'
        | 'continue-to-add-ons'
        | 'background-refresh'
      metric:
        | 'drawer_open_to_first_usable_ms'
        | 'day_switch_to_times_visible_ms'
        | 'hold_request_latency_ms'
        | 'continue_to_add_ons_ms'
        | 'background_refresh_ms'
      durationMs: number
      meta?: Record<string, unknown>
      invalid?: false
    }
  | {
      scenario:
        | 'drawer-open'
        | 'day-switch'
        | 'hold-request'
        | 'continue-to-add-ons'
        | 'background-refresh'
      metric:
        | 'drawer_open_to_first_usable_ms'
        | 'day_switch_to_times_visible_ms'
        | 'hold_request_latency_ms'
        | 'continue_to_add_ons_ms'
        | 'background_refresh_ms'
      invalid: true
      invalidReason: string
      meta?: Record<string, unknown>
    }

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

const SAMPLE_COUNT = Number.parseInt(process.env.PERF_SAMPLES ?? '2', 10)
const BOOKING_URL =
  process.env.PERF_BOOKING_URL?.trim() || 'http://127.0.0.1:3000/looks'

const SELECTORS = {
  bookingTrigger: [
    process.env.PERF_BOOKING_TRIGGER_SELECTOR,
    '[data-testid="open-availability-button"]',
    '[data-testid="book-now-button"]',
    'button:has-text("Check availability")',
    'button:has-text("Availability")',
    'button:has-text("Book")',
  ].filter(Boolean) as string[],
  dayButton: [process.env.PERF_DAY_BUTTON_SELECTOR].filter(Boolean) as string[],
  slotButton: [
    process.env.PERF_SLOT_BUTTON_SELECTOR,
    '[data-testid="availability-slot-button"]',
  ].filter(Boolean) as string[],
    drawerContinue: [process.env.PERF_DRAWER_CONTINUE_SELECTOR].filter(
    Boolean,
  ) as string[],
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

async function resetPerfStore(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & {
      __tovisAvailabilityPerf?: {
        version: number
        entries: unknown[]
        active: Record<string, unknown>
      }
    }

    if (!w.__tovisAvailabilityPerf) {
      w.__tovisAvailabilityPerf = {
        version: 1,
        entries: [],
        active: {},
      }
      return
    }

    w.__tovisAvailabilityPerf.entries = []
    w.__tovisAvailabilityPerf.active = {}
  })
}

async function readPerfEntries(page: Page): Promise<PerfEntry[]> {
  return page.evaluate(() => {
    const w = window as Window & {
      __tovisAvailabilityPerf?: {
        entries?: PerfEntry[]
      }
    }

    return Array.isArray(w.__tovisAvailabilityPerf?.entries)
      ? w.__tovisAvailabilityPerf.entries
      : []
  })
}

async function waitForMetric(
  page: Page,
  metric: RawPerfSample['metric'],
  key?: string,
  timeoutMs = 15_000,
): Promise<PerfEntry | null> {
  try {
    await page.waitForFunction(
      ([metricName, metricKey]) => {
        const w = window as Window & {
          __tovisAvailabilityPerf?: {
            entries?: PerfEntry[]
          }
        }

        const entries = Array.isArray(w.__tovisAvailabilityPerf?.entries)
          ? w.__tovisAvailabilityPerf.entries
          : []

        return entries.some((entry) => {
          if (entry.metric !== metricName) return false
          if (entry.status !== 'completed') return false
          if (metricKey && entry.key !== metricKey) return false
          return typeof entry.durationMs === 'number'
        })
      },
      [metric, key ?? null],
      { timeout: timeoutMs },
    )
  } catch {
    return null
  }

  const entries = await readPerfEntries(page)
  const completed = entries.filter((entry) => {
    if (entry.metric !== metric) return false
    if (entry.status !== 'completed') return false
    if (key && entry.key !== key) return false
    return typeof entry.durationMs === 'number'
  })

  return completed.at(-1) ?? null
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
  selectors: string[],
): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()

    if ((await locator.count()) === 0) continue

    try {
      if (await locator.isVisible({ timeout: 750 })) {
        return locator
      }
    } catch {
      // keep trying
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

async function openDrawerAndWaitUsable(page: Page): Promise<PerfEntry | null> {
  const trigger = await findBookingTrigger(page)
  await trigger.click()

  await expect(page.getByTestId('availability-drawer')).toBeVisible()
  return waitForMetric(page, 'drawer_open_to_first_usable_ms')
}

async function findDayButtons(page: Page): Promise<Locator[]> {
  if (SELECTORS.dayButton.length > 0) {
    const locators = page.locator(SELECTORS.dayButton[0])
    const count = await locators.count()
    return Array.from({ length: count }, (_, i) => locators.nth(i))
  }

  const drawer = page.getByTestId('availability-drawer')
  const buttons = drawer.getByRole('button')
  const count = await buttons.count()
  const results: Locator[] = []

  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i)
    const text = ((await button.textContent()) ?? '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!text) continue

    if (!/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s*\d{1,2}$/i.test(text)) {
      continue
    }

    results.push(button)
  }

  return results
}

async function waitForHoldReady(page: Page): Promise<void> {
  const drawer = page.getByTestId('availability-drawer')

  const signals = [
    page.getByTestId('availability-hold-banner'),
    drawer
      .getByRole('button', { name: /continue to add-ons|continue/i })
      .last(),
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

async function findSlotButton(page: Page): Promise<Locator> {
  const explicit = await firstVisibleLocator(page, SELECTORS.slotButton)
  if (explicit) return explicit

  const drawer = page.getByTestId('availability-drawer')
  const timeLikeButton = drawer
    .getByRole('button')
    .filter({ hasText: /(\d{1,2}:\d{2}|\d{1,2}\s?(am|pm))/i })
    .first()

  if ((await timeLikeButton.count()) > 0) {
    return timeLikeButton
  }

  throw new Error(
    'Could not find slot button. Set PERF_SLOT_BUTTON_SELECTOR for this flow.',
  )
}

async function createHoldAndWait(
  page: Page,
  options?: { requireReadyUi?: boolean },
): Promise<PerfEntry | null> {
  const slotButton = await findSlotButton(page)
  await slotButton.click()

  const entry = await waitForMetric(
    page,
    'hold_request_latency_ms',
    undefined,
    20_000,
  )
  if (!entry) {
    return null
  }

  if (options?.requireReadyUi) {
    await waitForHoldReady(page)
  }

  return entry
}

async function waitForAddOnsReady(page: Page): Promise<void> {
  const signals = [
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
  if (SELECTORS.drawerContinue.length > 0) {
    const explicit = page.locator(SELECTORS.drawerContinue[0]).first()
    if ((await explicit.count()) > 0) {
      try {
        await expect(explicit).toBeVisible({ timeout: 5_000 })
        await expect(explicit).toBeEnabled({ timeout: 15_000 })
        return explicit
      } catch {
        // fall through to generic search
      }
    }
  }

  const drawer = page.getByTestId('availability-drawer')
  const candidates = drawer.getByRole('button', {
    name: /continue to add-ons|continue/i,
  })

  const count = await candidates.count()

  for (let i = 0; i < count; i += 1) {
    const button = candidates.nth(i)

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

async function clickContinueAndWait(page: Page): Promise<PerfEntry | null> {
  const preferred = page
    .locator('[data-testid="availability-hold-banner"] button:not([disabled])')
    .first()

  if (await preferred.count()) {
    await expect(preferred).toBeVisible({ timeout: 15_000 })
    await preferred.click()
  } else {
    const button = await firstVisibleLocator(page, SELECTORS.drawerContinue)
    if (!button) {
      throw new Error(
        'Could not find enabled drawer continue button. Set PERF_DRAWER_CONTINUE_SELECTOR if needed.',
      )
    }

    await expect(button).toBeEnabled({ timeout: 15_000 })
    await button.click()
  }

  await waitForAddOnsReady(page)
  return waitForMetric(page, 'continue_to_add_ons_ms', undefined, 20_000)
}

function toCompletedSample(
  scenario: RawPerfSample['scenario'],
  metric: RawPerfSample['metric'],
  entry: PerfEntry,
  extraMeta?: Record<string, unknown>,
): RawPerfSample {
  return {
    scenario,
    metric,
    durationMs: Number(entry.durationMs ?? 0),
    meta: {
      ...(entry.meta ?? {}),
      ...(extraMeta ?? {}),
    },
  }
}

function toInvalidSample(
  scenario: RawPerfSample['scenario'],
  metric: RawPerfSample['metric'],
  invalidReason: string,
  extraMeta?: Record<string, unknown>,
): RawPerfSample {
  return {
    scenario,
    metric,
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
      return toInvalidSample(
        'drawer-open',
        'drawer_open_to_first_usable_ms',
        'missing_perf_metric',
      )
    }

    return toCompletedSample(
      'drawer-open',
      'drawer_open_to_first_usable_ms',
      entry,
    )
  } catch (error) {
    return toInvalidSample(
      'drawer-open',
      'drawer_open_to_first_usable_ms',
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
      return toInvalidSample(
        'day-switch',
        'day_switch_to_times_visible_ms',
        'drawer_not_usable',
      )
    }

    await resetPerfStore(page)

    const dayLabel = await clickDifferentDay(page)
    if (!dayLabel) {
      return toInvalidSample(
        'day-switch',
        'day_switch_to_times_visible_ms',
        'insufficient_day_buttons',
      )
    }

    const entry = await waitForMetric(page, 'day_switch_to_times_visible_ms')
    if (!entry) {
      return toInvalidSample(
        'day-switch',
        'day_switch_to_times_visible_ms',
        'missing_perf_metric',
        { requestedDayLabel: dayLabel },
      )
    }

    return toCompletedSample(
      'day-switch',
      'day_switch_to_times_visible_ms',
      entry,
      { requestedDayLabel: dayLabel },
    )
  } catch (error) {
    return toInvalidSample(
      'day-switch',
      'day_switch_to_times_visible_ms',
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
      return toInvalidSample(
        'hold-request',
        'hold_request_latency_ms',
        'drawer_not_usable',
      )
    }

    await resetPerfStore(page)

    const entry = await createHoldAndWait(page)
    if (!entry) {
      return toInvalidSample(
        'hold-request',
        'hold_request_latency_ms',
        'missing_perf_metric',
      )
    }

    return toCompletedSample(
      'hold-request',
      'hold_request_latency_ms',
      entry,
    )
  } catch (error) {
    return toInvalidSample(
      'hold-request',
      'hold_request_latency_ms',
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
      return toInvalidSample(
        'continue-to-add-ons',
        'continue_to_add_ons_ms',
        'drawer_not_usable',
      )
    }

    const holdEntry = await createHoldAndWait(page, { requireReadyUi: true })
    if (!holdEntry) {
      return toInvalidSample(
        'continue-to-add-ons',
        'continue_to_add_ons_ms',
        'hold_not_created',
      )
    }

    await resetPerfStore(page)

    const entry = await clickContinueAndWait(page)
    if (!entry) {
      return toInvalidSample(
        'continue-to-add-ons',
        'continue_to_add_ons_ms',
        'missing_perf_metric',
      )
    }

    return toCompletedSample(
      'continue-to-add-ons',
      'continue_to_add_ons_ms',
      entry,
    )
  } catch (error) {
    return toInvalidSample(
      'continue-to-add-ons',
      'continue_to_add_ons_ms',
      error instanceof Error ? error.message : 'continue_failed',
    )
  }
}

async function collectBackgroundRefreshSample(
  page: Page,
): Promise<RawPerfSample> {
  void page

  return toInvalidSample(
    'background-refresh',
    'background_refresh_ms',
    'background_refresh_setup_missing',
    {
      note:
        'This scenario needs a project-specific stale-cache setup hook before it can be measured reliably.',
    },
  )
}

test.describe('availability performance collection', () => {
  test.describe.configure({ mode: 'serial' })

  test('collect raw perf samples', async ({ page }, testInfo) => {
    test.setTimeout(10 * 60 * 1000)

    const projectName = testInfo.project.name
    const environment = environmentFromProject(projectName)

    const samples: RawPerfSample[] = []

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      samples.push(await collectDrawerOpenSample(page))
    }

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      samples.push(await collectDaySwitchSample(page))
    }

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      samples.push(await collectHoldRequestSample(page))
    }

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      samples.push(await collectContinueSample(page))
    }

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
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