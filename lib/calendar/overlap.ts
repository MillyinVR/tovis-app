// lib/calendar/overlap.ts

// ─── Types ────────────────────────────────────────────────────────────────────

export type OverlapRangeInput = {
  startsAt: string | Date
  endsAt: string | Date
}

export type NormalizedOverlapRange = {
  startMs: number
  endMs: number
}

export type OverlapMinutesForRangeArgs<TEvent extends OverlapRangeInput> = {
  events: TEvent[]
  rangeStart: string | Date
  rangeEnd: string | Date
}

export type FilteredOverlapMinutesForRangeArgs<TEvent extends OverlapRangeInput> =
  OverlapMinutesForRangeArgs<TEvent> & {
    shouldInclude: (event: TEvent) => boolean
  }

// ─── Constants ────────────────────────────────────────────────────────────────

const MS_PER_MINUTE = 60_000

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function dateMs(value: string | Date): number | null {
  const date = value instanceof Date ? value : new Date(value)
  const ms = date.getTime()

  return Number.isFinite(ms) ? ms : null
}

function normalizeRange(input: OverlapRangeInput): NormalizedOverlapRange | null {
  const startMs = dateMs(input.startsAt)
  const endMs = dateMs(input.endsAt)

  if (startMs === null || endMs === null) return null
  if (endMs <= startMs) return null

  return {
    startMs,
    endMs,
  }
}

function minutesFromMilliseconds(milliseconds: number): number {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 0

  return Math.round(milliseconds / MS_PER_MINUTE)
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export function overlapMilliseconds(
  first: OverlapRangeInput,
  second: OverlapRangeInput,
): number {
  const firstRange = normalizeRange(first)
  const secondRange = normalizeRange(second)

  if (!firstRange || !secondRange) return 0

  const overlapStartMs = Math.max(firstRange.startMs, secondRange.startMs)
  const overlapEndMs = Math.min(firstRange.endMs, secondRange.endMs)

  return Math.max(0, overlapEndMs - overlapStartMs)
}

export function overlapMinutes(
  first: OverlapRangeInput,
  second: OverlapRangeInput,
): number {
  return minutesFromMilliseconds(overlapMilliseconds(first, second))
}

export function hasOverlap(
  first: OverlapRangeInput,
  second: OverlapRangeInput,
): boolean {
  return overlapMilliseconds(first, second) > 0
}

export type IdentifiedOverlapRange = OverlapRangeInput & { id: string }

/**
 * The ids among `events` whose time ranges overlap at least one other event —
 * the pro calendar's passive double-book highlight. Half-open (via
 * `overlapMilliseconds`): back-to-back events that merely touch do NOT count.
 */
export function overlappingEventIds(
  events: readonly IdentifiedOverlapRange[],
): Set<string> {
  const ids = new Set<string>()

  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const first = events[i]
      const second = events[j]

      if (first && second && hasOverlap(first, second)) {
        ids.add(first.id)
        ids.add(second.id)
      }
    }
  }

  return ids
}

export type IdentifiedNamedRange = IdentifiedOverlapRange & {
  clientName?: string | null
}

/**
 * The client names of the events whose time ranges overlap `range` — the pro
 * new-booking form's passive double-book heads-up (mirror of the calendar
 * confirm modal's `pendingOverlapName`). Half-open (via `hasOverlap`), so a
 * back-to-back booking that merely touches does NOT warn. Order-preserving and
 * de-duplicated by name; an event without a client name falls back to
 * `fallbackName`. Callers filter out BLOCK-kind events first so this only
 * surfaces client-vs-client collisions, never the pro's own blocked time.
 */
export function overlappingClientNamesForRange(
  range: OverlapRangeInput,
  events: readonly IdentifiedNamedRange[],
  fallbackName: string,
): string[] {
  const names: string[] = []
  const seen = new Set<string>()

  for (const event of events) {
    if (!hasOverlap(range, event)) continue

    const name = event.clientName?.trim() || fallbackName
    if (seen.has(name)) continue

    seen.add(name)
    names.push(name)
  }

  return names
}

export function overlapMinutesForRange<TEvent extends OverlapRangeInput>(
  args: OverlapMinutesForRangeArgs<TEvent>,
): number {
  const { events, rangeStart, rangeEnd } = args

  let totalMinutes = 0

  for (const event of events) {
    totalMinutes += overlapMinutes(
      {
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      },
      {
        startsAt: rangeStart,
        endsAt: rangeEnd,
      },
    )
  }

  return totalMinutes
}

export function filteredOverlapMinutesForRange<
  TEvent extends OverlapRangeInput,
>(args: FilteredOverlapMinutesForRangeArgs<TEvent>): number {
  const { events, rangeStart, rangeEnd, shouldInclude } = args

  let totalMinutes = 0

  for (const event of events) {
    if (!shouldInclude(event)) continue

    totalMinutes += overlapMinutes(
      {
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      },
      {
        startsAt: rangeStart,
        endsAt: rangeEnd,
      },
    )
  }

  return totalMinutes
}