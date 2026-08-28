// lib/booking/overlapPolicy.test.ts

import { ServiceLocationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  decideBookingOverlapPermission,
  type BookingOverlapActor,
  type BookingOverlapSource,
  type BookingWindow,
  type ProPreselectedAftercareSlot,
  type SchedulingConflict,
} from './overlapPolicy'

const startsAt = new Date('2026-06-01T17:00:00.000Z')
const endsAt = new Date('2026-06-01T18:00:00.000Z')

const requestedWindow: BookingWindow = {
  professionalId: 'pro_1',
  startsAt,
  endsAt,
}

const clientActor: BookingOverlapActor = {
  kind: 'CLIENT',
  userId: 'user_client_1',
  clientId: 'client_1',
}

const now = new Date('2026-06-01T16:00:00.000Z')

/**
 * The unattended pro paths (import, series, waitlist confirm, aftercare save).
 * Used by every pre-existing case so they keep asserting exactly what they
 * always did: B5's unconditional pro authority.
 */
const proActor: BookingOverlapActor = {
  kind: 'PRO',
  userId: 'user_pro_1',
  professionalId: 'pro_1',
  liveHoldOverlap: 'NO_DECISION_SURFACE',
}

/** The interactive pro create/reschedule, before the pro has been asked. */
const proActorAsking: BookingOverlapActor = {
  ...proActor,
  liveHoldOverlap: 'ASK_THE_PRO',
}

/** The interactive pro create/reschedule, after they chose to proceed. */
const proActorConfirmed: BookingOverlapActor = {
  ...proActor,
  liveHoldOverlap: 'PRO_CONFIRMED',
}

const liveHoldConflict: SchedulingConflict = {
  kind: 'HOLD',
  id: 'hold_conflict_1',
  professionalId: 'pro_1',
  startsAt: new Date('2026-06-01T17:15:00.000Z'),
  endsAt: new Date('2026-06-01T18:15:00.000Z'),
  expiresAt: new Date('2026-06-01T16:08:00.000Z'),
}

const lapsedHoldConflict: SchedulingConflict = {
  ...liveHoldConflict,
  id: 'hold_conflict_lapsed',
  expiresAt: new Date('2026-06-01T15:50:00.000Z'),
}

const adminActor: BookingOverlapActor = {
  kind: 'ADMIN',
  userId: 'user_admin_1',
}

const conflict: SchedulingConflict = {
  kind: 'BOOKING',
  id: 'booking_conflict_1',
  professionalId: 'pro_1',
  startsAt: new Date('2026-06-01T17:30:00.000Z'),
  endsAt: new Date('2026-06-01T18:30:00.000Z'),
}

const broadDiscoverySource: BookingOverlapSource = {
  kind: 'BROAD_DISCOVERY',
}

function makeAftercareSlot(
  overrides: Partial<ProPreselectedAftercareSlot> = {},
): ProPreselectedAftercareSlot {
  return {
    aftercareSummaryId: 'aftercare_1',
    clientActionTokenId: 'token_1',
    professionalId: 'pro_1',
    offeringId: 'offering_1',
    locationId: 'location_1',
    locationType: ServiceLocationType.SALON,
    startsAt,
    endsAt,
    ...overrides,
  }
}

describe('decideBookingOverlapPermission', () => {
  it('allows a normal client booking when there is no conflict', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: clientActor,
      source: broadDiscoverySource,
      requestedWindow,
      conflicts: [],
    })

    expect(decision).toEqual({
      ok: true,
      mode: 'NO_OVERLAP',
      conflicts: [],
    })
  })

  it('blocks a normal client booking when there is a conflict', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: clientActor,
      source: broadDiscoverySource,
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('CLIENT_OVERLAP_NOT_ALLOWED')
      expect(decision.conflicts).toEqual([conflict])
    }
  })

  it('allows a pro-created overlapping booking', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActor,
      source: { kind: 'PRO_CREATED' },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision).toEqual({
      ok: true,
      mode: 'PRO_AUTHORIZED_OVERLAP',
      conflicts: [conflict],
    })
  })

  // A calendar import runs unattended (interactive commit walks a whole ICS
  // feed; the resync cron re-walks it hourly), so it must NOT inherit the pro's
  // authority to double-book even though the actor is the pro. The importer
  // holds the time as a calendar block instead.
  it('refuses a calendar import that overlaps, despite the PRO actor', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActor,
      source: { kind: 'CALENDAR_IMPORT' },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('IMPORT_OVERLAP_NOT_ALLOWED')
    expect(decision.conflicts).toEqual([conflict])
  })

  it('refuses a calendar import that overlaps a HOLD, not just a booking', () => {
    const holdConflict: SchedulingConflict = {
      ...liveHoldConflict,
      id: 'hold_conflict_1',
    }

    const decision = decideBookingOverlapPermission({
      now,
      actor: proActor,
      source: { kind: 'CALENDAR_IMPORT' },
      requestedWindow,
      conflicts: [holdConflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('IMPORT_OVERLAP_NOT_ALLOWED')
  })

  // The refusal is scoped to conflicts only — a clean import still books.
  it('allows a calendar import when there is no conflict', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActor,
      source: { kind: 'CALENDAR_IMPORT' },
      requestedWindow,
      conflicts: [],
    })

    expect(decision).toEqual({
      ok: true,
      mode: 'NO_OVERLAP',
      conflicts: [],
    })
  })

  // The CALENDAR_IMPORT branch sits before the ADMIN branch on purpose: it is a
  // property of the source, not of who holds the pen.
  it('refuses a calendar import even for an ADMIN actor', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: adminActor,
      source: { kind: 'CALENDAR_IMPORT' },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('IMPORT_OVERLAP_NOT_ALLOWED')
  })

  // K18. A series occurrence is materialized unattended: the pro chose a
  // PATTERN, and K20's cron re-runs this with nobody at the keyboard. Same rule
  // as CALENDAR_IMPORT, same reason — a property of the SOURCE.
  it('refuses a series occurrence that overlaps, despite the PRO actor', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActor,
      source: { kind: 'SERIES_MATERIALIZATION' },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('SERIES_OVERLAP_NOT_ALLOWED')
    expect(decision.conflicts).toEqual([conflict])
  })

  it('refuses a series occurrence that overlaps a HOLD, not just a booking', () => {
    const holdConflict: SchedulingConflict = {
      ...liveHoldConflict,
      id: 'hold_conflict_series',
    }

    const decision = decideBookingOverlapPermission({
      now,
      actor: proActor,
      source: { kind: 'SERIES_MATERIALIZATION' },
      requestedWindow,
      conflicts: [holdConflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('SERIES_OVERLAP_NOT_ALLOWED')
  })

  // ── The live-hold decision (B5 follow-up, Tori 2026-08-28) ──────────────────
  //
  // Everything above pins B5's rule: a pro may overlap anything. These pin the
  // ONE exception — a client is mid-checkout on these exact minutes — and, just
  // as importantly, its edges.

  it('asks the pro before booking over a LIVE hold', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActorAsking,
      source: { kind: 'PRO_CREATED' },
      requestedWindow,
      conflicts: [liveHoldConflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('PRO_HOLD_DECISION_REQUIRED')
    // The conflicts ride along so the caller can describe the hold.
    expect(decision.conflicts).toEqual([liveHoldConflict])
  })

  it('books over a live hold once the pro has answered, as its own mode', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActorConfirmed,
      source: { kind: 'PRO_CREATED' },
      requestedWindow,
      conflicts: [liveHoldConflict],
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error('expected an allowed decision')
    // A distinct mode, not PRO_AUTHORIZED_OVERLAP: the audit trail has to be
    // able to say the choice was informed.
    expect(decision.mode).toBe('PRO_CONFIRMED_HOLD_OVERLAP')
  })

  it('still asks when a live hold rides alongside an ordinary booking conflict', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActorAsking,
      source: { kind: 'PRO_CREATED' },
      requestedWindow,
      conflicts: [conflict, liveHoldConflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('PRO_HOLD_DECISION_REQUIRED')
  })

  // The edge that keeps the friction scoped. A hold past its expiry reserves
  // nothing — every conflict query filters `expiresAt > now`, so one normally
  // cannot even reach here — and asking about it would be asking about nobody.
  it('does NOT ask about a LAPSED hold', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActorAsking,
      source: { kind: 'PRO_CREATED' },
      requestedWindow,
      conflicts: [lapsedHoldConflict],
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error('expected an allowed decision')
    expect(decision.mode).toBe('PRO_AUTHORIZED_OVERLAP')
  })

  // A hold expiring at exactly `now` is over: the conflict query's `gt: now`
  // says so, and the two must agree or the popup would ask about minutes the
  // write path already considers free.
  it('treats a hold expiring exactly at now as lapsed', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActorAsking,
      source: { kind: 'PRO_CREATED' },
      requestedWindow,
      conflicts: [{ ...liveHoldConflict, expiresAt: now }],
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error('expected an allowed decision')
    expect(decision.mode).toBe('PRO_AUTHORIZED_OVERLAP')
  })

  it('does NOT ask about another APPOINTMENT — that friction was never wanted', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActorAsking,
      source: { kind: 'PRO_CREATED' },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error('expected an allowed decision')
    expect(decision.mode).toBe('PRO_AUTHORIZED_OVERLAP')
  })

  // The unattended paths — aftercare save, series, import, waitlist confirm.
  // There is no dialog to carry the question, so failing the write with one
  // would strand the caller. Today's behaviour, pinned so a later change to the
  // default cannot quietly turn it into a refusal.
  it('does not ask on a path with no decision surface', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActor,
      source: { kind: 'PRO_CREATED' },
      requestedWindow,
      conflicts: [liveHoldConflict],
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error('expected an allowed decision')
    expect(decision.mode).toBe('PRO_AUTHORIZED_OVERLAP')
  })

  // The gate is the PRO's. An admin override answers to a different rule and a
  // client can never overlap at all, so neither ever meets this question.
  it('leaves the ADMIN override untouched by the hold decision', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: adminActor,
      source: { kind: 'ADMIN_OVERRIDE' },
      requestedWindow,
      conflicts: [liveHoldConflict],
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error('expected an allowed decision')
    expect(decision.mode).toBe('ADMIN_AUTHORIZED_OVERLAP')
  })

  it('still refuses a CLIENT on a live hold, with the client code', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: clientActor,
      source: broadDiscoverySource,
      requestedWindow,
      conflicts: [liveHoldConflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('CLIENT_OVERLAP_NOT_ALLOWED')
  })

  // An UNATTENDED source outranks the pro's stance, in both directions: an
  // import must not be able to confirm its way through a live hold either.
  it('refuses an import over a live hold even when the stance says confirmed', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActorConfirmed,
      source: { kind: 'CALENDAR_IMPORT' },
      requestedWindow,
      conflicts: [liveHoldConflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('IMPORT_OVERLAP_NOT_ALLOWED')
  })

  it('refuses a series occurrence even for an ADMIN actor', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: adminActor,
      source: { kind: 'SERIES_MATERIALIZATION' },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected a blocked decision')
    expect(decision.code).toBe('SERIES_OVERLAP_NOT_ALLOWED')
  })

  // The refusal is scoped to conflicts only. A clean occurrence books normally
  // AND stays bound by the DB overlap constraint (allowsOverlap false), which is
  // the point of materializing real rows in the first place.
  it('allows a series occurrence when there is no conflict', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: proActor,
      source: { kind: 'SERIES_MATERIALIZATION' },
      requestedWindow,
      conflicts: [],
    })

    expect(decision).toEqual({
      ok: true,
      mode: 'NO_OVERLAP',
      conflicts: [],
    })
  })

  it('allows an admin override overlapping booking', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: adminActor,
      source: { kind: 'ADMIN_OVERRIDE' },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision).toEqual({
      ok: true,
      mode: 'ADMIN_AUTHORIZED_OVERLAP',
      conflicts: [conflict],
    })
  })

  it('blocks an aftercare rebook overlap even when the pro-preselected window exactly matches', () => {
    // BOOKED-mode aftercare books the real appointment at save time, so a
    // conflict at confirm always means the time has since been taken — the
    // pro's pre-selected slot never authorizes a silent double-book.
    const decision = decideBookingOverlapPermission({
      now,
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: makeAftercareSlot(),
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('AFTERCARE_PRESELECTED_SLOT_MISMATCH')
      expect(decision.userMessage).toBe(
        'That time is no longer available. Please pick a different time.',
      )
      expect(decision.conflicts).toEqual([conflict])
    }
  })

  it('blocks an aftercare rebook overlap when no preselected slot exists', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: null,
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('AFTERCARE_PRESELECTED_SLOT_REQUIRED')
    }
  })

  it('blocks an aftercare rebook overlap when the preselected slot has a different start', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: makeAftercareSlot({
          startsAt: new Date('2026-06-01T18:00:00.000Z'),
        }),
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('AFTERCARE_PRESELECTED_SLOT_MISMATCH')
      // Surface-neutral copy: this branch serves BOTH the in-app confirm card
      // and the public aftercare link, and it only fires when the requested
      // time genuinely conflicts — never mention "link" here.
      expect(decision.userMessage).toBe(
        'That time is no longer available. Please pick a different time.',
      )
    }
  })

  it('blocks an aftercare rebook overlap when the preselected slot has a different end', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: makeAftercareSlot({
          endsAt: new Date('2026-06-01T18:30:00.000Z'),
        }),
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('AFTERCARE_PRESELECTED_SLOT_MISMATCH')
    }
  })

  it('blocks an aftercare rebook overlap when the preselected slot belongs to another pro', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: makeAftercareSlot({
          professionalId: 'pro_2',
        }),
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('AFTERCARE_PRESELECTED_SLOT_MISMATCH')
    }
  })

  it('blocks an invalid booking window', () => {
    const decision = decideBookingOverlapPermission({
      now,
      actor: clientActor,
      source: broadDiscoverySource,
      requestedWindow: {
        professionalId: 'pro_1',
        startsAt: new Date('2026-06-01T18:00:00.000Z'),
        endsAt: new Date('2026-06-01T18:00:00.000Z'),
      },
      conflicts: [],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('INVALID_BOOKING_WINDOW')
    }
  })
})