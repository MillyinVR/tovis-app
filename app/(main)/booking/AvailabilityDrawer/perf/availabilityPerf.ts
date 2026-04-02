// app/(main)/booking/AvailabilityDrawer/perf/availabilityPerf.ts

import type {
  AvailabilityPerfActiveEntry,
  AvailabilityPerfCompletedEntry,
  AvailabilityPerfKey,
  AvailabilityPerfMeta,
  AvailabilityPerfMetricName,
  AvailabilityPerfStore,
  CancelAvailabilityMetricArgs,
  EndAvailabilityMetricArgs,
  StartAvailabilityMetricArgs,
} from './availabilityPerfTypes'

const PERF_STORE_VERSION = 1 as const
const MAX_PERF_ENTRIES = 5_000

function createEmptyStore(): AvailabilityPerfStore {
  return {
    version: PERF_STORE_VERSION,
    entries: [],
    active: {},
  }
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function nowMs(): number {
  return isBrowser() && typeof window.performance?.now === 'function'
    ? window.performance.now()
    : Date.now()
}

function resolveKey(
  metric: AvailabilityPerfMetricName,
  key?: AvailabilityPerfKey,
): AvailabilityPerfKey {
  return key?.trim() || metric
}

function trimEntries(store: AvailabilityPerfStore): void {
  const overflow = store.entries.length - MAX_PERF_ENTRIES
  if (overflow > 0) {
    store.entries.splice(0, overflow)
  }
}

function getOrCreateBrowserStore(): AvailabilityPerfStore | null {
  if (!isBrowser()) return null

  const existing = window.__tovisAvailabilityPerf
  if (existing?.version === PERF_STORE_VERSION) {
    return existing
  }

  const store = createEmptyStore()
  window.__tovisAvailabilityPerf = store
  return store
}

function mergeMeta(
  startMeta?: AvailabilityPerfMeta,
  endMeta?: AvailabilityPerfMeta,
): AvailabilityPerfMeta | undefined {
  if (!startMeta && !endMeta) return undefined
  return {
    ...(startMeta ?? {}),
    ...(endMeta ?? {}),
  }
}

function pushCompletedEntry(
  store: AvailabilityPerfStore,
  entry: AvailabilityPerfCompletedEntry,
): void {
  store.entries.push(entry)
  trimEntries(store)
}

function pushCancelledEntry(
  store: AvailabilityPerfStore,
  args: {
    active: AvailabilityPerfActiveEntry
    endedAt: number
    reason: string
  },
): void {
  store.entries.push({
    metric: args.active.metric,
    key: args.active.key,
    startedAt: args.active.startedAt,
    endedAt: args.endedAt,
    durationMs: null,
    status: 'cancelled',
    reason: args.reason,
    meta: args.active.meta,
  })
  trimEntries(store)
}

export function getAvailabilityPerfStore(): AvailabilityPerfStore {
  return getOrCreateBrowserStore() ?? createEmptyStore()
}

export function resetAvailabilityPerfStore(): void {
  const store = getOrCreateBrowserStore()
  if (!store) return

  store.entries = []
  store.active = {}
}

export function startAvailabilityMetric({
  metric,
  key,
  meta,
}: StartAvailabilityMetricArgs): void {
  const store = getOrCreateBrowserStore()
  if (!store) return

  const resolvedKey = resolveKey(metric, key)
  const startedAt = nowMs()
  const existing = store.active[resolvedKey]

  if (existing) {
    pushCancelledEntry(store, {
      active: existing,
      endedAt: startedAt,
      reason: 'restarted',
    })
  }

  store.active[resolvedKey] = {
    metric,
    key: resolvedKey,
    startedAt,
    meta,
  }
}

export function endAvailabilityMetric({
  metric,
  key,
  meta,
}: EndAvailabilityMetricArgs): void {
  const store = getOrCreateBrowserStore()
  if (!store) return

  const resolvedKey = resolveKey(metric, key)
  const active = store.active[resolvedKey]
  if (!active) return
  if (active.metric !== metric) return

  const endedAt = nowMs()
  const durationMs = Math.max(0, endedAt - active.startedAt)

  pushCompletedEntry(store, {
    metric,
    key: resolvedKey,
    startedAt: active.startedAt,
    endedAt,
    durationMs,
    status: 'completed',
    meta: mergeMeta(active.meta, meta),
  })

  delete store.active[resolvedKey]
}

export function cancelAvailabilityMetric({
  metric,
  key,
  reason,
}: CancelAvailabilityMetricArgs): void {
  const store = getOrCreateBrowserStore()
  if (!store) return

  const resolvedKey = resolveKey(metric, key)
  const active = store.active[resolvedKey]
  if (!active) return
  if (active.metric !== metric) return

  pushCancelledEntry(store, {
    active,
    endedAt: nowMs(),
    reason: reason.trim() || 'cancelled',
  })

  delete store.active[resolvedKey]
}

export function recordAvailabilityDuration(args: {
  metric: AvailabilityPerfMetricName
  durationMs: number
  key?: AvailabilityPerfKey
  meta?: AvailabilityPerfMeta
}): void {
  const store = getOrCreateBrowserStore()
  if (!store) return

  const endedAt = nowMs()
  const durationMs = Number.isFinite(args.durationMs)
    ? Math.max(0, args.durationMs)
    : 0

  pushCompletedEntry(store, {
    metric: args.metric,
    key: resolveKey(args.metric, args.key),
    startedAt: endedAt - durationMs,
    endedAt,
    durationMs,
    status: 'completed',
    meta: args.meta,
  })
}

export function getAvailabilityPerfEntries() {
  return getAvailabilityPerfStore().entries.slice()
}

export function getActiveAvailabilityPerfEntries() {
  const store = getAvailabilityPerfStore()
  return { ...store.active }
}
