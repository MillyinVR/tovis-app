// lib/booking/overlapPolicy.ts

import type { ServiceLocationType } from '@prisma/client'

export type BookingOverlapActor =
  | {
      kind: 'CLIENT'
      userId: string
      clientId: string
    }
  | {
      kind: 'PRO'
      userId: string
      professionalId: string
    }
  | {
      kind: 'ADMIN'
      userId: string
    }

export type BookingWindow = {
  professionalId: string
  startsAt: Date
  endsAt: Date
}

export type SchedulingConflictKind = 'BOOKING' | 'HOLD'

export type SchedulingConflict = {
  kind: SchedulingConflictKind
  id: string
  professionalId: string
  startsAt: Date
  endsAt: Date
}

export type ProPreselectedAftercareSlot = {
  aftercareSummaryId: string
  clientActionTokenId: string
  professionalId: string
  offeringId: string | null
  locationId: string
  locationType: ServiceLocationType
  startsAt: Date
  endsAt: Date
}

export type BookingOverlapSource =
  | {
      kind: 'BROAD_DISCOVERY'
    }
  | {
      kind: 'DIRECT_PROFILE'
    }
  | {
      kind: 'SPECIFIC_SEARCH'
    }
  | {
      kind: 'NFC_CARD'
    }
  | {
      kind: 'PRO_CREATED'
    }
  | {
      kind: 'ADMIN_OVERRIDE'
    }
  | {
      kind: 'AFTERCARE_REBOOK'
      aftercareSummaryId: string
      clientActionTokenId: string
      proPreselectedSlot: ProPreselectedAftercareSlot | null
    }

export type BookingOverlapAllowedMode =
  | 'NO_OVERLAP'
  | 'PRO_AUTHORIZED_OVERLAP'
  | 'ADMIN_AUTHORIZED_OVERLAP'

export type BookingOverlapBlockedCode =
  | 'CLIENT_OVERLAP_NOT_ALLOWED'
  | 'AFTERCARE_PRESELECTED_SLOT_REQUIRED'
  | 'AFTERCARE_PRESELECTED_SLOT_MISMATCH'
  | 'INVALID_BOOKING_WINDOW'

export type BookingOverlapDecision =
  | {
      ok: true
      mode: BookingOverlapAllowedMode
      conflicts: SchedulingConflict[]
    }
  | {
      ok: false
      code: BookingOverlapBlockedCode
      userMessage: string
      conflicts: SchedulingConflict[]
    }

export function hasSchedulingConflicts(
  conflicts: readonly SchedulingConflict[],
): boolean {
  return conflicts.length > 0
}

export function isValidBookingWindow(window: BookingWindow): boolean {
  const startsAtMs = window.startsAt.getTime()
  const endsAtMs = window.endsAt.getTime()

  return (
    window.professionalId.trim().length > 0 &&
    Number.isFinite(startsAtMs) &&
    Number.isFinite(endsAtMs) &&
    startsAtMs < endsAtMs
  )
}

export function decideBookingOverlapPermission(args: {
  actor: BookingOverlapActor
  source: BookingOverlapSource
  requestedWindow: BookingWindow
  conflicts: readonly SchedulingConflict[]
}): BookingOverlapDecision {
  const conflicts = [...args.conflicts]

  if (!isValidBookingWindow(args.requestedWindow)) {
    return {
      ok: false,
      code: 'INVALID_BOOKING_WINDOW',
      userMessage: 'That appointment time is invalid. Please choose another time.',
      conflicts,
    }
  }

  if (!hasSchedulingConflicts(conflicts)) {
    return {
      ok: true,
      mode: 'NO_OVERLAP',
      conflicts,
    }
  }

  if (args.actor.kind === 'PRO') {
    return {
      ok: true,
      mode: 'PRO_AUTHORIZED_OVERLAP',
      conflicts,
    }
  }

  if (args.actor.kind === 'ADMIN') {
    return {
      ok: true,
      mode: 'ADMIN_AUTHORIZED_OVERLAP',
      conflicts,
    }
  }

  if (args.source.kind === 'AFTERCARE_REBOOK') {
    const slot = args.source.proPreselectedSlot

    if (!slot) {
      return {
        ok: false,
        code: 'AFTERCARE_PRESELECTED_SLOT_REQUIRED',
        userMessage:
          'That time is no longer available. Please choose another time.',
        conflicts,
      }
    }

    // The pro's pre-selected slot no longer authorizes booking over a
    // conflict: BOOKED-mode aftercare creates the real next appointment at
    // save time, so a live proposal's slot cannot be taken out from under the
    // client. A conflict here — legacy proposals included — therefore always
    // means the time has since been taken; the honest answer on every surface
    // (in-app confirm card and public aftercare link alike) is "taken, pick
    // another", never a silent double-book.
    return {
      ok: false,
      code: 'AFTERCARE_PRESELECTED_SLOT_MISMATCH',
      userMessage:
        'That time is no longer available. Please pick a different time.',
      conflicts,
    }
  }

  return {
    ok: false,
    code: 'CLIENT_OVERLAP_NOT_ALLOWED',
    userMessage: 'That time is no longer available. Please choose another time.',
    conflicts,
  }
}