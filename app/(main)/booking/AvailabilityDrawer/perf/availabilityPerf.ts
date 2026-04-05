// app/(main)/booking/AvailabilityDrawer/perf/availabilityPerf.ts

import type {
  AvailabilityPerfActiveEntry,
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
const PERF_STORAGE_KEY = '__tovis_availability_perf_store_v1'

type StoredPerfEntry = AvailabilityPerfStore['entries'][number]

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isAvailabilityPerfMetaValue(
  value: unknown,
): value is AvailabilityPerfMeta[keyof AvailabilityPerfMeta] {
  return (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function sanitizeMeta(value: unknown): AvailabilityPerfMeta | undefined {
  if (!isRecord(value)) return undefined

  const meta: AvailabilityPerfMeta = {}

  for (const [key, entryValue] of Object.entries(value)) {
    if (isAvailabilityPerfMetaValue(entryValue)) {
      meta[key] = entryValue
    }
  }

  return meta
}

function sanitizeActiveEntry(value: unknown): AvailabilityPerfActiveEntry | null {
  if (!isRecord(value)) return null
  if (typeof value.metric !== 'string') return null
  if (typeof value.key !== 'string') return null
  if (typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) {
    return null
  }

  return {
    metric: value.metric as AvailabilityPerfMetricName,
    key: value.key,
    startedAt: value.startedAt,
    meta: sanitizeMeta(value.meta),
  }
}

function sanitizeStoredEntry(value: unknown): StoredPerfEntry | null {
  if (!isRecord(value)) return null
  if (typeof value.metric !== 'string') return null
  if (typeof value.key !== 'string') return null
  if (typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) {
    return null
  }
  if (typeof value.endedAt !== 'number' || !Number.isFinite(value.endedAt)) {
    return null
  }
  if (value.status !== 'completed' && value.status !== 'cancelled') return null

  if (value.status === 'completed') {
    if (typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs)) {
      return null
    }

    return {
      metric: value.metric as AvailabilityPerfMetricName,
      key: value.key,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      durationMs: value.durationMs <= 0 ? 1 : value.durationMs,
      status: 'completed',
      meta: sanitizeMeta(value.meta),
    }
  }

  return {
    metric: value.metric as AvailabilityPerfMetricName,
    key: value.key,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    durationMs: null,
    status: 'cancelled',
    reason: typeof value.reason === 'string' ? value.reason : 'cancelled',
    meta: sanitizeMeta(value.meta),
  }
}

function readPersistedStore(): AvailabilityPerfStore | null {
  if (!isBrowser()) return null

  try {
    const raw = window.sessionStorage.getItem(PERF_STORAGE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (parsed.version !== PERF_STORE_VERSION) return null

    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map((entry) => sanitizeStoredEntry(entry))
          .filter((entry): entry is StoredPerfEntry => entry !== null)
      : []

    const active: AvailabilityPerfStore['active'] = {}
    const rawActive = isRecord(parsed.active) ? parsed.active : {}

    for (const [key, value] of Object.entries(rawActive)) {
      const entry = sanitizeActiveEntry(value)
      if (entry) {
        active[key] = entry
      }
    }

    return {
      version: PERF_STORE_VERSION,
      entries,
      active,
    }
  } catch {
    return null
  }
}

function writePersistedStore(store: AvailabilityPerfStore): void {
  if (!isBrowser()) return

  try {
    window.sessionStorage.setItem(PERF_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // ignore storage write failures
  }
}

function flushStore(store: AvailabilityPerfStore): void {
  trimEntries(store)
  if (!isBrowser()) return

  window.__tovisAvailabilityPerf = store
  writePersistedStore(store)
}

function getOrCreateBrowserStore(): AvailabilityPerfStore | null {
  if (!isBrowser()) return null

  const existing = window.__tovisAvailabilityPerf
  if (existing?.version === PERF_STORE_VERSION) {
    return existing
  }

  const store = readPersistedStore() ?? createEmptyStore()
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
  entry: StoredPerfEntry,
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

function normalizeCompletedDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return 1
  return durationMs <= 0 ? 1 : durationMs
}

export function getAvailabilityPerfStore(): AvailabilityPerfStore {
  return getOrCreateBrowserStore() ?? createEmptyStore()
}

export function resetAvailabilityPerfStore(): void {
  const store = getOrCreateBrowserStore()
  if (!store) return

  store.entries = []
  store.active = {}
  flushStore(store)
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

  flushStore(store)
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
  const durationMs = normalizeCompletedDuration(endedAt - active.startedAt)

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
  flushStore(store)
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
  flushStore(store)
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
  const durationMs = normalizeCompletedDuration(args.durationMs)

  pushCompletedEntry(store, {
    metric: args.metric,
    key: resolveKey(args.metric, args.key),
    startedAt: endedAt - durationMs,
    endedAt,
    durationMs,
    status: 'completed',
    meta: args.meta,
  })

  flushStore(store)
}

export function getAvailabilityPerfEntries() {
  return getAvailabilityPerfStore().entries.slice()
}

export function getActiveAvailabilityPerfEntries() {
  const store = getAvailabilityPerfStore()
  return { ...store.active }
}