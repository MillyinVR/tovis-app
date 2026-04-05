import { promises as fs } from 'fs'
import path from 'path'
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'

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

type VisibleSlotInspection = {
  signatures: string[]
  slotCount: number
  enabledCount: number
  inferredSelectedDayYMD: string | null
}

type SlotCandidate = {
  button: Locator
  signature: string
  slotISO: string | null
  enabled: boolean
}

type DaySwitchOutcome =
  | {
      ok: true
      label: string
      selectedDayYMD: string | null
      entry: AvailabilityPerfCompletedEntry | null
      inspection: VisibleSlotInspection
    }
  | {
      ok: false
      reason: string
    }

type PageDiagnostics = {
  consoleErrors: string[]
  pageErrors: string[]
  requestFailures: string[]
}

function attachPageDiagnostics(page: Page): PageDiagnostics {
  const diagnostics: PageDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
  }

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    diagnostics.consoleErrors.push(msg.text())
  })

  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(
      error instanceof Error ? error.message : String(error),
    )
  })

  page.on('requestfailed', (request) => {
    diagnostics.requestFailures.push(
      `${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'request_failed'}`,
    )
  })

  return diagnostics
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
const DEFAULT_BOOKING_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  `http://127.0.0.1:${process.env.PORT ?? 3000}`
const DEFAULT_BOOKING_URL = `${DEFAULT_BOOKING_BASE_URL.replace(/\/$/, '')}/looks`
const MAX_HOLD_ATTEMPTS_PER_SAMPLE = 8
const MAX_BOOKING_PAGE_RETRIES = 3
const MAX_FUTURE_DAY_ATTEMPTS = 7

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

function readStringMeta(
  meta: AvailabilityPerfMeta | undefined,
  key: string,
): string | null {
  const value = meta?.[key]
  return typeof value === 'string' ? value : null
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForLooksPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')

  try {
    await page.waitForLoadState('networkidle', { timeout: 15_000 })
  } catch {
    // tolerate long-lived background requests
  }

  await expect(page.locator('body')).toBeVisible({ timeout: 15_000 })

  await expect
    .poll(
      async () => {
        const text = ((await page.locator('body').textContent()) ?? '')
          .replace(/\s+/g, ' ')
          .trim()

        return text.length
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0)
}

function buildRunBookingUrl(): string {
  const url = new URL(BOOKING_URL)
  url.searchParams.set('perfRun', String(Date.now()))
  return url.toString()
}

async function ensureBookingPageReachable(
  request: APIRequestContext,
): Promise<void> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= MAX_BOOKING_PAGE_RETRIES; attempt += 1) {
    try {
      const response = await request.get(BOOKING_URL, {
        failOnStatusCode: false,
        timeout: 5_000,
      })

      if (response.status() < 500) {
        return
      }

      lastError = new Error(`booking_url_status_${response.status()}`)
    } catch (error) {
      lastError = error
    }

    if (attempt < MAX_BOOKING_PAGE_RETRIES) {
      await sleep(750 * attempt)
    }
  }

  throw new Error(
    lastError instanceof Error
      ? lastError.message
      : 'booking_url_unreachable',
  )
}

async function resetPerfStore(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      window.sessionStorage.removeItem('__tovis_availability_perf_store_v1')
    } catch {
      // ignore storage reset failures
    }

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

async function gotoBookingPage(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  if (!BOOKING_URL) {
    throw new Error(
      'Missing PERF_BOOKING_URL. Set it to a page where the availability flow can be opened.',
    )
  }

  await ensureBookingPageReachable(request)

  let lastError: unknown = null

  for (let attempt = 1; attempt <= MAX_BOOKING_PAGE_RETRIES; attempt += 1) {
    try {
      await page.goto(buildRunBookingUrl(), { waitUntil: 'domcontentloaded' })
      await waitForLooksPageReady(page)
      return
    } catch (error) {
      lastError = error
      if (attempt < MAX_BOOKING_PAGE_RETRIES) {
        await sleep(750 * attempt)
      }
    }
  }

  throw new Error(
    lastError instanceof Error ? lastError.message : 'page_goto_failed',
  )
}

async function firstVisibleLocator(
  page: Page,
  selectors: readonly string[],
  timeoutMs = 10_000,
): Promise<Locator | null> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    for (const selector of selectors) {
      const locators = page.locator(selector)
      const count = await locators.count()

      for (let index = 0; index < count; index += 1) {
        const locator = locators.nth(index)

        try {
          if (await locator.isVisible()) {
            return locator
          }
        } catch {
          // keep scanning
        }
      }
    }

    await page.waitForTimeout(200)
  }

  return null
}

async function countVisibleLocators(
  page: Page,
  selectors: readonly string[],
): Promise<number> {
  let visibleCount = 0

  for (const selector of selectors) {
    const locators = page.locator(selector)
    const count = await locators.count()

    for (let index = 0; index < count; index += 1) {
      try {
        if (await locators.nth(index).isVisible()) {
          visibleCount += 1
        }
      } catch {
        // ignore transient visibility errors
      }
    }
  }

  return visibleCount
}

async function describeBookingTriggers(
  page: Page,
  selectors: readonly string[],
): Promise<string> {
  const lines: string[] = []

  for (const selector of selectors) {
    const locators = page.locator(selector)
    const count = await locators.count()
    let visibleCount = 0
    const samples: string[] = []

    for (let index = 0; index < Math.min(count, 3); index += 1) {
      const locator = locators.nth(index)

      let visible = false
      try {
        visible = await locator.isVisible()
      } catch {
        visible = false
      }

      if (visible) {
        visibleCount += 1
      }

      let text = ''
      try {
        text = (((await locator.textContent()) ?? '').replace(/\s+/g, ' ').trim())
      } catch {
        text = ''
      }

      samples.push(
        `[${index}] visible=${visible} text="${text.slice(0, 80)}"`,
      )
    }

    lines.push(
      `${selector} => count=${count}, visible=${visibleCount}${
        samples.length ? `, samples=${samples.join(' | ')}` : ''
      }`,
    )
  }

  return lines.join(' || ')
}

async function describePageState(page: Page): Promise<string> {
  const url = page.url()

  let title = ''
  try {
    title = await page.title()
  } catch {
    title = ''
  }

  let bodyText = ''
  try {
    bodyText = ((await page.locator('body').textContent()) ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
  } catch {
    bodyText = ''
  }

  const visibleButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button'))
      .map((button) => {
        const text = (button.textContent ?? '').replace(/\s+/g, ' ').trim()
        return text
      })
      .filter(Boolean)
      .slice(0, 12)
  })

  return `url=${url} | title="${title}" | body="${bodyText}" | visibleButtons=${JSON.stringify(visibleButtons)}`
}

function describeDiagnostics(diagnostics: PageDiagnostics): string {
  return [
    `consoleErrors=${JSON.stringify(diagnostics.consoleErrors.slice(0, 8))}`,
    `pageErrors=${JSON.stringify(diagnostics.pageErrors.slice(0, 8))}`,
    `requestFailures=${JSON.stringify(diagnostics.requestFailures.slice(0, 8))}`,
  ].join(' | ')
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
  diagnostics?: PageDiagnostics,
): Promise<AvailabilityPerfCompletedEntry | null> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 20_000) {
    const visibleCount = await countVisibleLocators(page, SELECTORS.bookingTrigger)

    if (visibleCount > 0) {
      const trigger = await findBookingTrigger(page)
      await trigger.scrollIntoViewIfNeeded()
      await trigger.click()

      await expect(page.getByTestId('availability-drawer')).toBeVisible()
      return waitForMetric(page, PERF_CASES.drawerOpen.metric)
    }

    await page.waitForTimeout(200)
  }

  const diagnostic = await describeBookingTriggers(page, SELECTORS.bookingTrigger)
  const pageState = await describePageState(page)
  const browserState = diagnostics ? describeDiagnostics(diagnostics) : ''
  throw new Error(
    `booking_trigger_not_visible | ${diagnostic} | ${pageState}${browserState ? ` | ${browserState}` : ''}`,
  )
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

async function readDayButtonLabel(button: Locator): Promise<string> {
  return (((await button.textContent()) ?? '').replace(/\s+/g, ' ').trim() ||
    'unknown-day')
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

async function readVisibleSlotButtonSignatures(
  page: Page,
): Promise<string[]> {
  const slotButtons = await findSlotButtons(page)
  const signatures: string[] = []

  for (const slotButton of slotButtons) {
    try {
      if (!(await slotButton.isVisible())) continue

      const signature = await slotButton.evaluate((element) => {
        const htmlElement = element as HTMLElement
        const dataset = htmlElement.dataset
        const ariaLabel = htmlElement.getAttribute('aria-label') ?? ''
        const text = (htmlElement.textContent ?? '').replace(/\s+/g, ' ').trim()

        return `${ariaLabel}|${text}|${JSON.stringify(dataset)}`
      })

      signatures.push(signature)
    } catch {
      // skip if evaluation fails
    }
  }

  return signatures
}

function extractSlotIsoFromSignature(signature: string): string | null {
  const match = signature.match(/availability-slot-(\d{4}-\d{2}-\d{2}T[^"]+)/)
  return match?.[1] ?? null
}

function compareSlotCandidatesNewestFirst(
  left: SlotCandidate,
  right: SlotCandidate,
): number {
  const leftIso = left.slotISO ?? ''
  const rightIso = right.slotISO ?? ''

  if (leftIso && rightIso) {
    return rightIso.localeCompare(leftIso)
  }

  if (leftIso) return -1
  if (rightIso) return 1
  return 0
}

function buildFutureDayVisitOrder(
  dayButtonCount: number,
  maxFutureDayAttempts: number,
): number[] {
  const maxIndex = Math.min(dayButtonCount - 1, maxFutureDayAttempts)
  const indexes: number[] = []

  for (let index = maxIndex; index >= 1; index -= 1) {
    indexes.push(index)
  }

  return indexes
}

async function readVisibleSlotCandidates(page: Page): Promise<SlotCandidate[]> {
  const slotButtons = await findSlotButtons(page)
  const candidates: SlotCandidate[] = []

  for (const slotButton of slotButtons) {
    try {
      if (!(await slotButton.isVisible())) continue

      const enabled = await slotButton.isEnabled()
      const signature = await slotButton.evaluate((element) => {
        const htmlElement = element as HTMLElement
        const dataset = htmlElement.dataset
        const ariaLabel = htmlElement.getAttribute('aria-label') ?? ''
        const text = (htmlElement.textContent ?? '').replace(/\s+/g, ' ').trim()

        return `${ariaLabel}|${text}|${JSON.stringify(dataset)}`
      })

      candidates.push({
        button: slotButton,
        signature,
        slotISO: extractSlotIsoFromSignature(signature),
        enabled,
      })
    } catch {
      // ignore transient slot read failures
    }
  }

  return candidates
}

function inferSelectedDayYMDFromSignatures(signatures: string[]): string | null {
  const values = Array.from(
    new Set(
      signatures
        .map((signature) => extractSlotIsoFromSignature(signature)?.slice(0, 10) ?? null)
        .filter((value): value is string => Boolean(value)),
    ),
  )

  if (values.length === 0) return null
  return values[0] ?? null
}

async function inspectVisibleSlots(page: Page): Promise<VisibleSlotInspection> {
  const candidates = await readVisibleSlotCandidates(page)
  const signatures = candidates.map((candidate) => candidate.signature)

  return {
    signatures,
    slotCount: candidates.length,
    enabledCount: candidates.filter((candidate) => candidate.enabled).length,
    inferredSelectedDayYMD: inferSelectedDayYMDFromSignatures(signatures),
  }
}

async function waitForSlotButtonsToRefresh(
  page: Page,
  previousSignatures: string[],
): Promise<void> {
  const previousKey = previousSignatures.join('|')

  if (!previousKey) return

  await expect
    .poll(
      async () => (await readVisibleSlotButtonSignatures(page)).join('|'),
      { timeout: 10_000 },
    )
    .not.toBe(previousKey)
}

async function switchToDayByIndex(
  page: Page,
  targetIndex: number,
  previousSignatures: string[],
  fallbackSelectedDayYMD: string | null,
): Promise<DaySwitchOutcome> {
  const buttons = await findDayButtons(page)

  if (buttons.length <= targetIndex) {
    return { ok: false, reason: 'insufficient_day_buttons' }
  }

  const target = buttons[targetIndex]
  const label = await readDayButtonLabel(target)

  await resetPerfStore(page)
  await target.click()

  const entry = await waitForMetric(
    page,
    PERF_CASES.daySwitch.metric,
    undefined,
    10_000,
  )

  try {
    await waitForSlotButtonsToRefresh(page, previousSignatures)
  } catch {
    // tolerate unchanged signatures; inspection still tells us current state
  }

  const inspection = await inspectVisibleSlots(page)
  const selectedDayYMD =
    readStringMeta(entry?.meta, 'selectedDayYMD') ??
    inspection.inferredSelectedDayYMD ??
    fallbackSelectedDayYMD

  return {
    ok: true,
    label,
    selectedDayYMD,
    entry,
    inspection,
  }
}

async function createSuccessfulHold(
  page: Page,
  options?: {
    requireReadyUi?: boolean
    expectedSelectedDayYMD?: string | null
  },
): Promise<HoldAttemptOutcome> {
  const candidates = (await readVisibleSlotCandidates(page))
    .filter((candidate) => candidate.enabled)
    .filter((candidate) => {
      if (!options?.expectedSelectedDayYMD) return true
      if (!candidate.slotISO) return true

      return candidate.slotISO.startsWith(options.expectedSelectedDayYMD)
    })
    .sort(compareSlotCandidatesNewestFirst)

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: options?.expectedSelectedDayYMD
        ? 'no_enabled_slots_for_expected_day'
        : 'slot_button_missing',
    }
  }

  let lastFailureReason = 'hold_not_created'
  let lastFailureMeta: AvailabilityPerfMeta | undefined

  const attemptCount = Math.min(candidates.length, MAX_HOLD_ATTEMPTS_PER_SAMPLE)

  for (let index = 0; index < attemptCount; index += 1) {
    const candidate = candidates[index]

    try {
      await candidate.button.scrollIntoViewIfNeeded()
      await expect(candidate.button).toBeVisible({ timeout: 1_500 })
      await expect(candidate.button).toBeEnabled({ timeout: 1_500 })
    } catch {
      continue
    }

    await resetPerfStore(page)
    await candidate.button.click()

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

    if (!isEntryForExpectedDay(entry.meta, options?.expectedSelectedDayYMD)) {
      lastFailureReason = 'hold_request_slot_day_mismatch'
      lastFailureMeta = entry.meta
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

function isEntryForExpectedDay(
  meta: AvailabilityPerfMeta | undefined,
  expectedSelectedDayYMD: string | null | undefined,
): boolean {
  if (!expectedSelectedDayYMD) return true

  const slotISO = readStringMeta(meta, 'slotISO')
  if (!slotISO) return true

  return slotISO.startsWith(expectedSelectedDayYMD)
}

async function createSuccessfulHoldAcrossDays(
  page: Page,
  options?: {
    requireReadyUi?: boolean
    currentSelectedDayYMD?: string | null
  },
): Promise<HoldAttemptOutcome> {
  const initialInspection = await inspectVisibleSlots(page)
  const initialSelectedDayYMD =
    options?.currentSelectedDayYMD ?? initialInspection.inferredSelectedDayYMD

  let activeSelectedDayYMD = initialSelectedDayYMD
  let previousSignatures = initialInspection.signatures
  let lastFailureReason = 'no_bookable_slots_on_visible_days'
  let lastFailureMeta: AvailabilityPerfMeta | undefined

  const dayButtons = await findDayButtons(page)
  const futureDayIndexes = buildFutureDayVisitOrder(
    dayButtons.length,
    MAX_FUTURE_DAY_ATTEMPTS,
  )

  for (const dayIndex of futureDayIndexes) {
    const switched = await switchToDayByIndex(
      page,
      dayIndex,
      previousSignatures,
      activeSelectedDayYMD,
    )

    if (!switched.ok) {
      lastFailureReason = switched.reason
      continue
    }

    previousSignatures = switched.inspection.signatures
    activeSelectedDayYMD = switched.selectedDayYMD

    if (switched.inspection.enabledCount === 0) {
      lastFailureReason = 'no_enabled_slots_on_candidate_day'
      continue
    }

    const holdAttempt = await createSuccessfulHold(page, {
      requireReadyUi: options?.requireReadyUi,
      expectedSelectedDayYMD: activeSelectedDayYMD,
    })

    if (holdAttempt.ok) {
      return holdAttempt
    }

    lastFailureReason = holdAttempt.reason
    lastFailureMeta = holdAttempt.meta
  }

  if (initialInspection.enabledCount > 0) {
    const switchedBackToCurrent =
      futureDayIndexes.length > 0
        ? await switchToDayByIndex(
            page,
            0,
            previousSignatures,
            initialSelectedDayYMD,
          )
        : {
            ok: true as const,
            label: 'current',
            selectedDayYMD: initialSelectedDayYMD,
            entry: null,
            inspection: initialInspection,
          }

    if (switchedBackToCurrent.ok) {
      const holdAttempt = await createSuccessfulHold(page, {
        requireReadyUi: options?.requireReadyUi,
        expectedSelectedDayYMD:
          switchedBackToCurrent.selectedDayYMD ?? initialSelectedDayYMD,
      })

      if (holdAttempt.ok) {
        return holdAttempt
      }

      lastFailureReason = holdAttempt.reason
      lastFailureMeta = holdAttempt.meta
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

function validateBackgroundRefreshEntry(
  entry: AvailabilityPerfCompletedEntry,
): string | null {
  const refreshKind = readStringMeta(entry.meta, 'refreshKind')
  if (!refreshKind) {
    return 'background_refresh_missing_kind'
  }

  return null
}

async function collectDrawerOpenSample(
  page: Page,
  request: APIRequestContext,
): Promise<RawPerfSample> {
  try {
    const diagnostics = attachPageDiagnostics(page)
    await gotoBookingPage(page, request)
    await resetPerfStore(page)

    const entry = await openDrawerAndWaitUsable(page, diagnostics)

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

async function collectDaySwitchSample(
  page: Page,
  request: APIRequestContext,
): Promise<RawPerfSample> {
  try {
    await gotoBookingPage(page, request)
    await resetPerfStore(page)

    const usable = await openDrawerAndWaitUsable(page)

    if (!usable) {
      return toInvalidSample(PERF_CASES.daySwitch, 'drawer_not_usable')
    }

    const currentSelectedDayYMD = readStringMeta(usable.meta, 'selectedDayYMD')
    const previousSignatures = await readVisibleSlotButtonSignatures(page)
    const switched = await switchToDayByIndex(
      page,
      1,
      previousSignatures,
      currentSelectedDayYMD,
    )

    if (!switched.ok) {
      return toInvalidSample(PERF_CASES.daySwitch, switched.reason)
    }

    if (!switched.entry) {
      return toInvalidSample(PERF_CASES.daySwitch, 'missing_perf_metric', {
        requestedDayLabel: switched.label,
      })
    }

    return toCompletedSample(PERF_CASES.daySwitch, switched.entry, {
      requestedDayLabel: switched.label,
    })
  } catch (error) {
    return toInvalidSample(
      PERF_CASES.daySwitch,
      error instanceof Error ? error.message : 'day_switch_failed',
    )
  }
}

async function collectHoldRequestSample(
  page: Page,
  request: APIRequestContext,
): Promise<RawPerfSample> {
  try {
    await gotoBookingPage(page, request)
    await resetPerfStore(page)

    const usable = await openDrawerAndWaitUsable(page)

    if (!usable) {
      return toInvalidSample(PERF_CASES.holdRequest, 'drawer_not_usable')
    }

    const currentSelectedDayYMD = readStringMeta(usable.meta, 'selectedDayYMD')

    const holdOutcome = await createSuccessfulHoldAcrossDays(page, {
      currentSelectedDayYMD,
    })

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

async function collectContinueSample(
  page: Page,
  request: APIRequestContext,
): Promise<RawPerfSample> {
  try {
    await gotoBookingPage(page, request)
    await resetPerfStore(page)

    const usable = await openDrawerAndWaitUsable(page)

    if (!usable) {
      return toInvalidSample(PERF_CASES.continueToAddOns, 'drawer_not_usable')
    }

    const currentSelectedDayYMD = readStringMeta(usable.meta, 'selectedDayYMD')

    const holdOutcome = await createSuccessfulHoldAcrossDays(page, {
      requireReadyUi: true,
      currentSelectedDayYMD,
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
  request: APIRequestContext,
): Promise<RawPerfSample> {
  try {
    await gotoBookingPage(page, request)
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

    const invalidReason = validateBackgroundRefreshEntry(entry)
    if (invalidReason) {
      return toInvalidSample(
        PERF_CASES.backgroundRefresh,
        invalidReason,
        entry.meta,
      )
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

  test('collect raw perf samples', async ({ page, request }, testInfo) => {
    test.setTimeout(10 * 60 * 1000)

    const projectName = testInfo.project.name
    const environment = environmentFromProject(projectName)
    const samples: RawPerfSample[] = []

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectDrawerOpenSample(page, request))
    }

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectDaySwitchSample(page, request))
    }

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectHoldRequestSample(page, request))
    }

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectContinueSample(page, request))
    }

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(await collectBackgroundRefreshSample(page, request))
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
