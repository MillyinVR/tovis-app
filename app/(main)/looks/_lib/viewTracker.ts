// app/(main)/looks/_lib/viewTracker.ts
//
// Sampled, debounced client-side view tracking (social-first plan B2). Both the
// feed (active-slide impressions) and the detail page (opens) call
// trackLookView; this module dedupes per session, batches, and flushes the id
// list to POST /api/v1/looks/views — which enqueues a job that denormalizes
// viewCount. Best-effort throughout: a view must never surface an error or
// block UX, and a dropped flush just means a slightly low (approximate) count.

const ENDPOINT = '/api/v1/looks/views'

// Debounce window before a partial batch flushes.
const FLUSH_INTERVAL_MS = 5_000
// Flush eagerly once a batch reaches this size (fast scrollers).
const MAX_PENDING = 24
// Soft cap on the per-session dedupe set. A single session won't realistically
// pass this; clearing past it trades a little re-counting for bounded memory.
const MAX_SEEN = 4_000

// Look ids already counted this session (pending or sent) — the sampling that
// keeps write volume down: each look pings at most once per session.
const seen = new Set<string>()
let pending: string[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let unloadListenersBound = false

function clearTimer() {
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
}

function flush(useBeacon = false) {
  clearTimer()
  if (pending.length === 0) return

  const batch = pending
  pending = []

  const body = JSON.stringify({ lookPostIds: batch })

  try {
    if (
      useBeacon &&
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      const ok = navigator.sendBeacon(
        ENDPOINT,
        new Blob([body], { type: 'application/json' }),
      )
      if (ok) return
      // Beacon was refused (e.g. payload too large) — fall through to fetch.
    }

    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // ignore — sampled counts tolerate the occasional lost flush
    })
  } catch {
    // ignore — view tracking is strictly best-effort
  }
}

function bindUnloadListeners() {
  if (unloadListenersBound || typeof window === 'undefined') return
  unloadListenersBound = true

  // Send whatever's buffered before the tab is backgrounded/closed — beacon
  // survives unload where a normal fetch may be cancelled.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true)
  })
  window.addEventListener('pagehide', () => flush(true))
}

/**
 * Record that the given look was viewed (a feed impression or a detail open).
 * No-ops on the server, for a blank id, or for a look already counted this
 * session.
 */
export function trackLookView(lookPostId: string | null | undefined): void {
  if (typeof window === 'undefined') return
  if (!lookPostId) return

  const id = lookPostId.trim()
  if (!id || seen.has(id)) return

  if (seen.size >= MAX_SEEN) seen.clear()
  seen.add(id)
  pending.push(id)

  bindUnloadListeners()

  if (pending.length >= MAX_PENDING) {
    flush()
    return
  }

  if (timer == null) {
    timer = setTimeout(() => flush(), FLUSH_INTERVAL_MS)
  }
}
