// lib/booking/storedSlotLiveness.test.ts
//
// The wiring, in isolation. The schedule behaviour itself is driven against real
// Postgres (tests/integration/opening-liveness.test.ts and the F15 block in
// tests/integration/waitlist-offer.test.ts); what these pin is the shape around
// it — which arguments reach the shared gate, how many times the context is
// resolved, and that a verdict comes back for every candidate.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  resolveBookingLocationContext: vi.fn(),
  evaluateProSchedulingDecision: vi.fn(),
  holdFindMany: vi.fn(),
}))

vi.mock('@/lib/booking/locationContext', () => ({
  resolveBookingLocationContext: mocks.resolveBookingLocationContext,
}))

vi.mock('@/lib/booking/policies/proSchedulingPolicy', () => ({
  evaluateProSchedulingDecision: mocks.evaluateProSchedulingDecision,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { bookingHold: { findMany: mocks.holdFindMany } },
}))

import {
  checkStoredSlotsAreOpen,
  filterStillOpenRows,
  type StoredSlotCandidate,
} from './storedSlotLiveness'

const START = new Date('2026-08-01T20:00:00.000Z')

function candidate(over?: Partial<StoredSlotCandidate>): StoredSlotCandidate {
  return {
    key: 'row_1',
    professionalId: 'pro_1',
    professionalTimeZone: 'America/Los_Angeles',
    locationId: 'loc_1',
    locationType: ServiceLocationType.SALON,
    startUtc: START,
    durationMinutes: 60,
    commitGate: 'CLIENT_HOLD',
    releasedHoldId: null,
    ...over,
  }
}

function contextOk() {
  return {
    ok: true,
    context: {
      timeZone: 'America/Los_Angeles',
      locationId: 'loc_1',
      stepMinutes: 15,
      bufferMinutes: 10,
      advanceNoticeMinutes: 30,
      maxDaysAhead: 60,
      workingHours: { mon: { enabled: true, start: '09:00', end: '18:00' } },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveBookingLocationContext.mockResolvedValue(contextOk())
  mocks.evaluateProSchedulingDecision.mockResolvedValue({ ok: true, value: {} })
  mocks.holdFindMany.mockResolvedValue([])
})

describe('checkStoredSlotsAreOpen', () => {
  it('touches nothing when there are no candidates', async () => {
    const verdicts = await checkStoredSlotsAreOpen({
      candidates: [],
      viewerClientId: 'client_1',
    })

    expect(verdicts.size).toBe(0)
    expect(mocks.holdFindMany).not.toHaveBeenCalled()
    expect(mocks.resolveBookingLocationContext).not.toHaveBeenCalled()
  })

  // The gate has to run with the flags a CLIENT actually has. None of these
  // overrides is available to them, so allowing any would show a row whose
  // commit refuses — the exact asymmetry F5 closed on the write side.
  it('runs the commit gate with no override a client cannot grant', async () => {
    await checkStoredSlotsAreOpen({
      candidates: [candidate()],
      viewerClientId: null,
    })

    expect(mocks.evaluateProSchedulingDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        requestedStart: START,
        durationMinutes: 60,
        bufferMinutes: 10,
        stepMinutes: 15,
        advanceNoticeMinutes: 30,
        maxDaysAhead: 60,
        timeZone: 'America/Los_Angeles',
        allowShortNotice: false,
        allowFarFuture: false,
        allowOutsideWorkingHours: false,
        enforceStepGrid: true,
        // Nothing runs after this to pick a booking/hold verdict up, so the
        // gate itself has to decide.
        deferBusyConflictsToOverlapPolicy: false,
      }),
    )
  })

  it('reports the gate’s own refusal code', async () => {
    mocks.evaluateProSchedulingDecision.mockResolvedValue({
      ok: false,
      code: 'TIME_BLOCKED',
    })

    const verdicts = await checkStoredSlotsAreOpen({
      candidates: [candidate()],
      viewerClientId: null,
    })

    expect(verdicts.get('row_1')).toEqual({ open: false, reason: 'TIME_BLOCKED' })
  })

  it('never asks the schedule when the row’s location is gone', async () => {
    mocks.resolveBookingLocationContext.mockResolvedValue({
      ok: false,
      error: 'LOCATION_NOT_FOUND',
    })

    const verdicts = await checkStoredSlotsAreOpen({
      candidates: [candidate()],
      viewerClientId: null,
    })

    expect(verdicts.get('row_1')).toEqual({
      open: false,
      reason: 'LOCATION_NOT_FOUND',
    })
    expect(mocks.evaluateProSchedulingDecision).not.toHaveBeenCalled()
  })

  // F16 split what F15 collapsed: the two location errors are one decision for a
  // feed (hide it) and two different jobs for the pro whose badge has to explain
  // it, so the verdict carries the gate's own error through rather than one
  // catch-all reason.
  it('tells a missing location apart from one with no time zone', async () => {
    mocks.resolveBookingLocationContext.mockResolvedValue({
      ok: false,
      error: 'TIMEZONE_REQUIRED',
    })

    const verdicts = await checkStoredSlotsAreOpen({
      candidates: [candidate()],
      viewerClientId: null,
    })

    expect(verdicts.get('row_1')).toEqual({
      open: false,
      reason: 'TIMEZONE_REQUIRED',
    })
    expect(mocks.evaluateProSchedulingDecision).not.toHaveBeenCalled()
  })

  // A feed is usually one or two professionals with several rows each. The
  // context is what makes this affordable: resolved once per distinct
  // (pro, location, mode, tz), not once per row.
  it('resolves one context per distinct location, not per row', async () => {
    await checkStoredSlotsAreOpen({
      candidates: [
        candidate({ key: 'a' }),
        candidate({ key: 'b', startUtc: new Date('2026-08-02T20:00:00.000Z') }),
        candidate({ key: 'c', locationId: 'loc_2' }),
      ],
      viewerClientId: null,
    })

    expect(mocks.resolveBookingLocationContext).toHaveBeenCalledTimes(2)
    expect(mocks.evaluateProSchedulingDecision).toHaveBeenCalledTimes(3)
  })

  it('answers for every candidate', async () => {
    const verdicts = await checkStoredSlotsAreOpen({
      candidates: [candidate({ key: 'a' }), candidate({ key: 'b' })],
      viewerClientId: null,
    })

    expect([...verdicts.keys()].sort()).toEqual(['a', 'b'])
  })

  it('skips the own-hold lookup entirely for a signed-out viewer', async () => {
    await checkStoredSlotsAreOpen({
      candidates: [candidate()],
      viewerClientId: null,
    })

    expect(mocks.holdFindMany).not.toHaveBeenCalled()
    expect(mocks.evaluateProSchedulingDecision).toHaveBeenCalledWith(
      expect.objectContaining({ excludeHoldId: null }),
    )
  })

  // Mirrors `deleteActiveHoldsForClient` exactly: the client's own PLAIN holds
  // with this pro are dropped by their own claim, so they are not an obstacle —
  // but an offer-bound hold survives that sweep and must stay one.
  it('discounts the viewer’s own plain hold with that professional', async () => {
    mocks.holdFindMany.mockResolvedValue([
      { id: 'hold_own', professionalId: 'pro_1' },
    ])

    await checkStoredSlotsAreOpen({
      candidates: [candidate()],
      viewerClientId: 'client_1',
    })

    expect(mocks.holdFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client_1',
          waitlistOfferId: null,
        }),
      }),
    )
    expect(mocks.evaluateProSchedulingDecision).toHaveBeenCalledWith(
      expect.objectContaining({ excludeHoldId: 'hold_own' }),
    )
  })

  it('prefers the row’s own released reservation over the viewer’s other hold', async () => {
    mocks.holdFindMany.mockResolvedValue([
      { id: 'hold_own', professionalId: 'pro_1' },
    ])

    await checkStoredSlotsAreOpen({
      candidates: [candidate({ releasedHoldId: 'hold_offer' })],
      viewerClientId: 'client_1',
    })

    expect(mocks.evaluateProSchedulingDecision).toHaveBeenCalledWith(
      expect.objectContaining({ excludeHoldId: 'hold_offer' }),
    )
  })

  // The other half of `commitGate`, and the one that is pure over-permission if
  // it is wrong. `deleteActiveHoldsForClient` has exactly ONE call site —
  // `performLockedCreateHold`. A PRO_CREATE commit (the waitlist confirm) never
  // runs it, so the viewer's own hold really would refuse that commit.
  it('does NOT discount the viewer’s own hold for a PRO_CREATE commit', async () => {
    mocks.holdFindMany.mockResolvedValue([
      { id: 'hold_own', professionalId: 'pro_1' },
    ])

    await checkStoredSlotsAreOpen({
      candidates: [candidate({ commitGate: 'PRO_CREATE' })],
      viewerClientId: 'client_1',
    })

    expect(mocks.evaluateProSchedulingDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeHoldId: null,
        enforceStepGrid: false,
      }),
    )
    // …and with nothing to discount, the query is never even issued.
    expect(mocks.holdFindMany).not.toHaveBeenCalled()
  })
})

describe('filterStillOpenRows', () => {
  it('keeps only the rows whose slot is still open', async () => {
    mocks.evaluateProSchedulingDecision.mockImplementation(
      async (args: { requestedStart: Date }) =>
        args.requestedStart.getTime() === START.getTime()
          ? { ok: true, value: {} }
          : { ok: false, code: 'TIME_BOOKED' },
    )

    const rows = [
      { id: 'live', startUtc: START },
      { id: 'dead', startUtc: new Date('2026-08-05T20:00:00.000Z') },
    ]

    const kept = await filterStillOpenRows({
      rows,
      toCandidate: (row) => candidate({ key: row.id, startUtc: row.startUtc }),
      viewerClientId: null,
      onUncheckable: 'drop',
    })

    expect(kept.map((row) => row.id)).toEqual(['live'])
  })

  // `onUncheckable` is required precisely because it is wrong in both
  // directions silently.
  it('honours onUncheckable for a row it cannot describe', async () => {
    const rows = [{ id: 'no_window' }]
    const toCandidate = () => null

    expect(
      (
        await filterStillOpenRows({
          rows,
          toCandidate,
          viewerClientId: null,
          onUncheckable: 'keep',
        })
      ).map((row) => row.id),
    ).toEqual(['no_window'])

    expect(
      await filterStillOpenRows({
        rows,
        toCandidate,
        viewerClientId: null,
        onUncheckable: 'drop',
      }),
    ).toEqual([])
  })
})
