// lib/booking/storedSlotLiveness.ts

/**
 * READ-TIME schedule check for a time that was STORED earlier and is shown to a
 * client later — a last-minute opening, a priority offer, a pro-proposed
 * waitlist slot.
 *
 * Tori's rule, 2026-07-21: *"if a time is outside a pro's working hours, blocked
 * off by the pro, or already booked it shouldn't be visible to the client at
 * all."* Every slot a client PICKS already obeys it — `computeDaySlotsFast`
 * derives those from the live schedule on every request. The rows here are
 * different: they were validated once, at write time, and then nothing re-checks
 * them. The pro can block that time, shorten their day, or take the booking
 * through the normal flow, and the stored row keeps rendering as a live card
 * whose only outcome is a refusal.
 *
 * THIS ADDS NO SECOND SCHEDULE ENGINE. It runs `evaluateProSchedulingDecision`
 * — the same gate the commits themselves run — with nothing written. A second,
 * hand-rolled check is exactly what opened F5 and F15 in the first place, and
 * F3 was spent deleting the last one.
 *
 * OVER-ENFORCING IS A BUG, NOT A SAFE DEFAULT. Hiding a row whose commit would
 * have succeeded loses the client a real appointment, silently. Two candidate
 * fields exist for that and both are REQUIRED, not defaulted, so every call site
 * states what its own gate does (F4's rule — TypeScript then finds them all):
 *
 * - `commitGate` — WHICH gate will commit this row. Two of its behaviours differ
 *   and neither is visible from the refusal side; see the field's own comment.
 * - `releasedHoldId` — a hold this row's own commit RELEASES before it checks.
 *   A waitlist offer reserves its window (F14) and its confirm deletes that hold
 *   first, so counting it here would hide every offer the moment F14 shipped.
 */

import { ServiceLocationType } from '@prisma/client'

import { normalizeToMinute } from '@/lib/booking/conflicts'
import { resolveBookingLocationContext } from '@/lib/booking/locationContext'
import { evaluateProSchedulingDecision } from '@/lib/booking/policies/proSchedulingPolicy'
import type { SchedulingPolicyFailureCode } from '@/lib/booking/policies/types'
import { prisma } from '@/lib/prisma'

/** How many candidates are probed at once. Each probe is one gate evaluation. */
const PROBE_CONCURRENCY = 8

export type StoredSlotCandidate = {
  /** The caller's own id for this row. Verdicts come back keyed by it. */
  key: string

  professionalId: string
  /**
   * The professional's own time zone — the fallback the commit gate uses when
   * the location carries none (`resolveApptTimeZone`).
   */
  professionalTimeZone: string | null

  /** The location the row stored. Resolved exactly as the commit gate resolves it. */
  locationId: string | null
  locationType: ServiceLocationType

  startUtc: Date
  /**
   * The duration the commit will book. For a multi-service opening this is the
   * LONGEST of its services — the same conservative window
   * `createLastMinuteOpening` validated before publishing the row.
   */
  durationMinutes: number

  /**
   * Which gate actually commits this row. The read runs THAT gate, and the two
   * differ in ways a refusal can never reveal:
   *
   * - `CLIENT_HOLD` — `POST /holds` → `evaluateHoldCreationDecision`. An
   *   off-grid start is fatal (`holdPolicy.ts:187` → `checkSlotReadiness`), and
   *   `deleteActiveHoldsForClient` runs FIRST (`writeBoundary.ts:7432`), so the
   *   viewer's own PLAIN holds with this pro are not obstacles — the claim drops
   *   them. That also means the card must not vanish from the client who is
   *   mid-checkout on it. Offer-bound holds are exempt from that sweep
   *   (`holdCleanup.ts:40`), so they stay counted.
   * - `PRO_CREATE` — `performLockedCreateProBooking`, which the waitlist confirm
   *   runs. The step grid is deferred because the PRO picked the minute (F4),
   *   and NO client-hold sweep happens: `deleteActiveHoldsForClient` has exactly
   *   one call site and this is not it, so the viewer's own plain hold really
   *   would refuse this commit, and really must hide the row.
   */
  commitGate: 'CLIENT_HOLD' | 'PRO_CREATE'

  /** A hold this row's own commit releases before it checks. See the header. */
  releasedHoldId: string | null
}

export type StoredSlotDeadReason =
  | 'LOCATION_UNAVAILABLE'
  | SchedulingPolicyFailureCode

export type StoredSlotVerdict =
  | { open: true }
  | { open: false; reason: StoredSlotDeadReason }

export type CheckStoredSlotsArgs = {
  candidates: readonly StoredSlotCandidate[]
  /**
   * The client this feed is rendered for, or null for an unauthenticated
   * viewer. Their own plain holds are ignored — the claim deletes them first.
   */
  viewerClientId: string | null
  nowUtc?: Date
}

type GroupKey = string

// Joined on NUL rather than a printable separator: an IANA zone name is
// free-form enough that two different rows must never collide into one resolved
// context.
function groupKeyFor(candidate: StoredSlotCandidate): GroupKey {
  return [
    candidate.professionalId,
    candidate.locationId ?? '',
    candidate.locationType,
    candidate.professionalTimeZone ?? '',
  ].join('\u0000')
}

type ResolvedGroupContext =
  | {
      ok: true
      timeZone: string
      locationId: string
      stepMinutes: number
      bufferMinutes: number
      advanceNoticeMinutes: number
      maxDaysAhead: number
      workingHours: unknown
    }
  | { ok: false }

/**
 * The booking context the commit gate would resolve for this row — same
 * function, same arguments. `allowFallback: !locationId` mirrors
 * `performLockedCreateHold` (`writeBoundary.ts:7377`): a row that names a
 * location is judged against THAT location, never a substitute.
 */
async function resolveGroupContext(
  candidate: StoredSlotCandidate,
): Promise<ResolvedGroupContext> {
  const resolved = await resolveBookingLocationContext({
    professionalId: candidate.professionalId,
    requestedLocationId: candidate.locationId,
    locationType: candidate.locationType,
    professionalTimeZone: candidate.professionalTimeZone,
    fallbackTimeZone: 'UTC',
    requireValidTimeZone: true,
    allowFallback: !candidate.locationId,
  })

  if (!resolved.ok) return { ok: false }

  return {
    ok: true,
    timeZone: resolved.context.timeZone,
    locationId: resolved.context.locationId,
    stepMinutes: resolved.context.stepMinutes,
    bufferMinutes: resolved.context.bufferMinutes,
    advanceNoticeMinutes: resolved.context.advanceNoticeMinutes,
    maxDaysAhead: resolved.context.maxDaysAhead,
    workingHours: resolved.context.workingHours,
  }
}

/**
 * The viewing client's own active plain holds, per professional, in ONE query.
 *
 * `waitlistOfferId: null` is not decoration: it is the exact predicate
 * `deleteActiveHoldsForClient` uses. An offer-bound hold survives that sweep, so
 * it really does refuse a claim and really must stay counted here.
 */
async function loadViewerOwnHoldIds(args: {
  viewerClientId: string
  professionalIds: readonly string[]
  nowUtc: Date
}): Promise<Map<string, string>> {
  const rows = await prisma.bookingHold.findMany({
    where: {
      clientId: args.viewerClientId,
      professionalId: { in: [...args.professionalIds] },
      expiresAt: { gt: args.nowUtc },
      waitlistOfferId: null,
    },
    select: { id: true, professionalId: true },
    take: 200,
  })

  const byProfessional = new Map<string, string>()
  for (const row of rows) {
    if (!byProfessional.has(row.professionalId)) {
      byProfessional.set(row.professionalId, row.id)
    }
  }

  return byProfessional
}

async function inChunks<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []

  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size)
    results.push(...(await Promise.all(slice.map(run))))
  }

  return results
}

/**
 * Verdict per candidate, keyed by `candidate.key`. Always total: every candidate
 * gets an entry, so a caller can never read "not answered" as "still open".
 */
export async function checkStoredSlotsAreOpen(
  args: CheckStoredSlotsArgs,
): Promise<Map<string, StoredSlotVerdict>> {
  const verdicts = new Map<string, StoredSlotVerdict>()
  if (args.candidates.length === 0) return verdicts

  const nowUtc = args.nowUtc ?? new Date()

  const professionalIds = Array.from(
    new Set(args.candidates.map((candidate) => candidate.professionalId)),
  )

  // One context resolve per distinct (pro, location, mode, tz) — a feed is
  // usually one or two professionals, so this is where the batching pays.
  const groups = new Map<GroupKey, StoredSlotCandidate>()
  for (const candidate of args.candidates) {
    const key = groupKeyFor(candidate)
    if (!groups.has(key)) groups.set(key, candidate)
  }

  const needsOwnHolds = args.candidates.some(
    (candidate) => candidate.commitGate === 'CLIENT_HOLD',
  )

  const [ownHoldByProfessional, groupContexts] = await Promise.all([
    args.viewerClientId && needsOwnHolds
      ? loadViewerOwnHoldIds({
          viewerClientId: args.viewerClientId,
          professionalIds,
          nowUtc,
        })
      : Promise.resolve(new Map<string, string>()),

    inChunks(
      Array.from(groups.entries()),
      PROBE_CONCURRENCY,
      async ([key, candidate]) =>
        [key, await resolveGroupContext(candidate)] as const,
    ),
  ])

  const contextByGroup = new Map<GroupKey, ResolvedGroupContext>(groupContexts)

  await inChunks(args.candidates, PROBE_CONCURRENCY, async (candidate) => {
    const context = contextByGroup.get(groupKeyFor(candidate))

    if (!context?.ok) {
      // The location the row named is gone or unbookable, so the commit would
      // fail LOCATION_NOT_FOUND before it ever reached the schedule.
      verdicts.set(candidate.key, { open: false, reason: 'LOCATION_UNAVAILABLE' })
      return
    }

    const decision = await evaluateProSchedulingDecision({
      now: nowUtc,
      professionalId: candidate.professionalId,
      locationId: context.locationId,
      locationType: candidate.locationType,
      requestedStart: normalizeToMinute(new Date(candidate.startUtc)),
      durationMinutes: candidate.durationMinutes,
      bufferMinutes: context.bufferMinutes,
      workingHours: context.workingHours,
      timeZone: context.timeZone,
      stepMinutes: context.stepMinutes,
      advanceNoticeMinutes: context.advanceNoticeMinutes,
      maxDaysAhead: context.maxDaysAhead,
      // A client cannot grant any of these, so a row needing one is a row whose
      // commit refuses. This is the read-side twin of F5's finding: the offer
      // and the confirm have to agree, and the confirm is the one that is right.
      allowShortNotice: false,
      allowFarFuture: false,
      allowOutsideWorkingHours: false,
      enforceStepGrid: candidate.commitGate === 'CLIENT_HOLD',
      // Nothing runs after this to pick a booking/hold verdict up, so the gate
      // has to be the one that decides — same reason F5 passes false at the
      // waitlist offer site.
      deferBusyConflictsToOverlapPolicy: false,
      excludeHoldId:
        candidate.releasedHoldId ??
        (candidate.commitGate === 'CLIENT_HOLD'
          ? ownHoldByProfessional.get(candidate.professionalId) ?? null
          : null),
    })

    verdicts.set(
      candidate.key,
      decision.ok ? { open: true } : { open: false, reason: decision.code },
    )
  })

  return verdicts
}

/**
 * Keep the rows whose stored time the pro's live schedule can still serve.
 *
 * `onUncheckable` decides rows `toCandidate` returns null for — a row with no
 * window to ask about (no active service to take a duration from). REQUIRED, not
 * defaulted, because it is wrong in both directions silently: dropping hides a
 * card a surface deliberately renders, keeping shows a time nothing verified.
 * The answer is whether the row's OTHER handling already covers it — the
 * priority-offer list, for instance, renders a serviceless opening on purpose
 * and routes its claim to the pro's profile.
 */
export async function filterStillOpenRows<T>(args: {
  rows: readonly T[]
  toCandidate: (row: T) => StoredSlotCandidate | null
  viewerClientId: string | null
  onUncheckable: 'keep' | 'drop'
  nowUtc?: Date
}): Promise<T[]> {
  const candidates: StoredSlotCandidate[] = []
  const keyByRow = new Map<T, string>()

  for (const row of args.rows) {
    const candidate = args.toCandidate(row)
    if (!candidate) continue
    candidates.push(candidate)
    keyByRow.set(row, candidate.key)
  }

  const verdicts = await checkStoredSlotsAreOpen({
    candidates,
    viewerClientId: args.viewerClientId,
    nowUtc: args.nowUtc,
  })

  return args.rows.filter((row) => {
    const key = keyByRow.get(row)
    if (key === undefined) return args.onUncheckable === 'keep'
    return verdicts.get(key)?.open === true
  })
}
