// app/(main)/booking/AvailabilityDrawer/perf/availabilityPerfTypes.ts

export const AVAILABILITY_PERF_METRICS = [
  'drawer_open_to_first_usable_ms',
  'day_switch_to_times_visible_ms',
  'hold_request_latency_ms',
  'continue_to_add_ons_ms',
  'background_refresh_ms',
] as const

export type AvailabilityPerfMetricName =
  (typeof AVAILABILITY_PERF_METRICS)[number]

export const AVAILABILITY_PERF_SCENARIOS = [
  'drawer-open',
  'day-switch',
  'hold-request',
  'continue-to-add-ons',
  'background-refresh',
] as const

export type AvailabilityPerfScenarioName =
  (typeof AVAILABILITY_PERF_SCENARIOS)[number]

export type AvailabilityPerfPrimitive = string | number | boolean | null

export type AvailabilityPerfMetaValue =
  | AvailabilityPerfPrimitive
  | readonly AvailabilityPerfPrimitive[]

/**
 * Keep perf metadata JSON-safe and boring on purpose.
 * This makes Playwright reads, artifact writing, and CI summaries simpler.
 */
export type AvailabilityPerfMeta = Record<string, AvailabilityPerfMetaValue>

export type AvailabilityPerfKey = string

export type AvailabilityPerfStatus = 'completed' | 'cancelled'

export type AvailabilityPerfActiveEntry = {
  metric: AvailabilityPerfMetricName
  key: AvailabilityPerfKey
  startedAt: number
  meta?: AvailabilityPerfMeta
}

export type AvailabilityPerfCompletedEntry = {
  metric: AvailabilityPerfMetricName
  key: AvailabilityPerfKey
  startedAt: number
  endedAt: number
  durationMs: number
  status: 'completed'
  meta?: AvailabilityPerfMeta
}

export type AvailabilityPerfCancelledEntry = {
  metric: AvailabilityPerfMetricName
  key: AvailabilityPerfKey
  startedAt: number
  endedAt: number
  durationMs: null
  status: 'cancelled'
  reason: string
  meta?: AvailabilityPerfMeta
}

export type AvailabilityPerfEntry =
  | AvailabilityPerfCompletedEntry
  | AvailabilityPerfCancelledEntry

export type AvailabilityPerfStore = {
  /**
   * Version the store shape now so later changes are explicit.
   */
  version: 1

  /**
   * Completed or cancelled metric entries.
   * Playwright and aggregation scripts read from here.
   */
  entries: AvailabilityPerfEntry[]

  /**
   * In-flight metrics keyed by explicit key or default key.
   */
  active: Record<AvailabilityPerfKey, AvailabilityPerfActiveEntry | undefined>
}

export type StartAvailabilityMetricArgs = {
  metric: AvailabilityPerfMetricName
  key?: AvailabilityPerfKey
  meta?: AvailabilityPerfMeta
}

export type EndAvailabilityMetricArgs = {
  metric: AvailabilityPerfMetricName
  key?: AvailabilityPerfKey
  meta?: AvailabilityPerfMeta
}

export type CancelAvailabilityMetricArgs = {
  metric: AvailabilityPerfMetricName
  key?: AvailabilityPerfKey
  reason: string
}

declare global {
  interface Window {
    __tovisAvailabilityPerf?: AvailabilityPerfStore
  }
}