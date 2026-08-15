// lib/profiles/proProfileSignals.ts
//
// The two honest, live signals the redesigned pro public profile prints:
// a near-term availability line, and a "New to {brand}" chip.
//
// 🔴 Where they render, and where they DELIBERATELY do not:
//
// - The book bar at the bottom of the page carries the availability line for
//   EVERY pro. The frame puts it there on purpose: it is reached after the work
//   rather than floating over it, so it reads as logistics, not pressure.
// - The identity chips carry `Available today` + `New to {brand}` on a
//   BRAND-NEW pro ONLY (Tori, 2026-08-15). On an established pro the chips are
//   gone entirely — "on a page someone reaches because the work already
//   interested them, urgency signals read as pressure". A new pro has no bio, no
//   reviews and almost no grid, so availability is the one real advantage they
//   have, and it is the thing worth saying.
//
// "New" means exactly what the looks feed means by it — `evaluateNewToPlatform`,
// i.e. account age within LOOK_BADGE_THRESHOLDS.newToPlatformMaxDays. The
// availability wording (and its staleness TTL) is `evaluateAvailableSoon`. Both
// are imported from the badge engine rather than restated: a second copy of
// either rule would eventually disagree with the feed about the same pro.
import 'server-only'

import {
  evaluateAvailableSoon,
  evaluateNewToPlatform,
  type ProBadgeSignals,
} from '@/lib/looks/badges/engine'
import { prisma } from '@/lib/prisma'

export type ProProfileChipDto = {
  /** Stable key for the client render; also what a test asserts on. */
  kind: 'AVAILABLE_SOON' | 'NEW_TO_PLATFORM'
  label: string
}

export type ProProfileSignalsDto = {
  /**
   * Identity chips. EMPTY for an established pro — that is the design, not a
   * missing read. Populated only when the pro is new to the platform.
   */
  chips: ProProfileChipDto[]
  /**
   * The book bar's small-caps headline — "Available tomorrow", or null when the
   * pro has no fresh opening inside the badge engine's horizon (the bar then
   * prints its neutral fallback rather than inventing availability).
   */
  availabilityLine: string | null
}

export const EMPTY_PRO_PROFILE_SIGNALS: ProProfileSignalsDto = {
  chips: [],
  availabilityLine: null,
}

/**
 * Reads the two per-pro rows the signals need (availability stat + account
 * creation) and resolves them through the badge engine's own evaluators.
 *
 * Both reads are keyed by primary key on this ONE pro, so this is two cheap
 * point lookups on a page that already runs a dozen aggregates in parallel — not
 * the feed's batched stat machinery.
 */
export async function loadProProfileSignals(args: {
  professionalId: string
  userId: string
  brandName: string
  now?: Date
}): Promise<ProProfileSignalsDto> {
  const now = args.now ?? new Date()

  const [availabilityRow, userRow] = await Promise.all([
    prisma.professionalAvailabilityStat.findUnique({
      where: { professionalId: args.professionalId },
      select: { nextOpeningDate: true, fullness14d: true, computedAt: true },
    }),
    prisma.user.findUnique({
      where: { id: args.userId },
      select: { createdAt: true },
    }),
  ])

  return resolveProProfileSignals({
    availability: availabilityRow,
    accountCreatedAt: userRow?.createdAt ?? null,
    brandName: args.brandName,
    now,
  })
}

/**
 * Pure half of {@link loadProProfileSignals} — everything above is the two
 * reads. Exported so the rule ("chips on a new pro only") is unit-testable
 * without a database.
 */
export function resolveProProfileSignals(args: {
  availability: {
    nextOpeningDate: Date | null
    fullness14d: number
    computedAt: Date | null
  } | null
  accountCreatedAt: Date | null
  brandName: string
  now: Date
}): ProProfileSignalsDto {
  // Only the two fields the evaluators below read are real; the rest of
  // ProBadgeSignals belongs to badges this surface does not show, and zeroing
  // them is what keeps those badges from ever firing here by accident.
  const signals: ProBadgeSignals = {
    recentBookingCount: 0,
    completedBookingCount30d: 0,
    servedClientCount: 0,
    rebookedClientCount: 0,
    statComputedAt: null,
    accountCreatedAt: args.accountCreatedAt,
    distanceMiles: null,
    availability: args.availability,
  }

  const available = evaluateAvailableSoon(signals, args.now)
  const isNew = evaluateNewToPlatform(signals, args.now, args.brandName)

  const chips: ProProfileChipDto[] = []
  if (isNew) {
    // Availability leads: on a new pro it is the concrete offer, and "New to
    // {brand}" is the caveat that follows it.
    if (available) {
      chips.push({ kind: 'AVAILABLE_SOON', label: available.label })
    }
    chips.push({ kind: 'NEW_TO_PLATFORM', label: isNew.label })
  }

  return {
    chips,
    availabilityLine: available?.label ?? null,
  }
}
