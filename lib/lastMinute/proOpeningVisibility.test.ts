// lib/lastMinute/proOpeningVisibility.test.ts
//
// F16: what the PRO's own opening card is told. The schedule behaviour itself is
// driven against real Postgres (tests/integration/opening-liveness.test.ts);
// what these pin is the translation layer — which rows are worth asking about,
// how a refusal code becomes something a badge can say, and the two judgments
// the client feeds never had to make:
//
//   • a hold is a claim in progress, NOT a dead opening;
//   • the window is priced from the offerings a CLIENT can still book, because
//     the pro's select deliberately does not filter deactivated ones.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpeningStatus, ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  checkStoredSlotsAreOpen: vi.fn(),
}))

vi.mock('@/lib/booking/storedSlotLiveness', () => ({
  checkStoredSlotsAreOpen: mocks.checkStoredSlotsAreOpen,
}))

import {
  resolveProOpeningVisibility,
  type ProOpeningVisibilityRow,
} from './proOpeningVisibility'

const NOW = new Date('2026-08-01T12:00:00.000Z')
const START = new Date('2026-08-01T20:00:00.000Z')

function serviceRow(over?: {
  isActive?: boolean
  salonDurationMinutes?: number | null
  defaultDurationMinutes?: number | null
}) {
  return {
    service: { defaultDurationMinutes: over?.defaultDurationMinutes ?? 60 },
    offering: {
      isActive: over?.isActive ?? true,
      salonDurationMinutes: over?.salonDurationMinutes ?? 60,
      mobileDurationMinutes: null,
    },
  }
}

function row(over?: Partial<ProOpeningVisibilityRow>): ProOpeningVisibilityRow {
  return {
    id: 'opening_1',
    professionalId: 'pro_1',
    startAt: START,
    status: OpeningStatus.ACTIVE,
    bookedAt: null,
    cancelledAt: null,
    locationId: 'loc_1',
    locationType: ServiceLocationType.SALON,
    professional: { timeZone: 'America/Los_Angeles' },
    services: [serviceRow()],
    ...over,
  }
}

/** Make the shared gate answer `verdict` for every candidate it is handed. */
function gateAnswers(verdict: unknown) {
  mocks.checkStoredSlotsAreOpen.mockImplementation(
    async ({ candidates }: { candidates: { key: string }[] }) =>
      new Map(candidates.map((candidate) => [candidate.key, verdict])),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  gateAnswers({ open: true })
})

describe('resolveProOpeningVisibility', () => {
  // THE ALLOW CASE. Every assertion below is "a badge appeared"; without this
  // one they all pass against a mapper that badges everything.
  it('says nothing is wrong with an opening the schedule can still serve', async () => {
    const visibility = await resolveProOpeningVisibility({
      rows: [row()],
      nowUtc: NOW,
    })

    expect(visibility.get('opening_1')).toBe('VISIBLE')
  })

  // The one that matters most: a client mid-checkout on this very opening puts
  // a hold on the slot, so the shared gate says TIME_HELD. Reporting that as
  // "gone dark, go fix it" would tell the pro their opening is broken at the
  // exact moment it is working.
  it('reports a hold as a claim in progress, not as a dead opening', async () => {
    gateAnswers({ open: false, reason: 'TIME_HELD' })

    const visibility = await resolveProOpeningVisibility({
      rows: [row()],
      nowUtc: NOW,
    })

    expect(visibility.get('opening_1')).toBe('BEING_CLAIMED')
  })

  it.each([
    ['TIME_BOOKED', 'TIME_BOOKED'],
    ['TIME_BLOCKED', 'TIME_BLOCKED'],
    ['OUTSIDE_WORKING_HOURS', 'OUTSIDE_WORKING_HOURS'],
    ['WORKING_HOURS_REQUIRED', 'WORKING_HOURS_MISSING'],
    ['WORKING_HOURS_INVALID', 'WORKING_HOURS_MISSING'],
    ['ADVANCE_NOTICE_REQUIRED', 'TOO_SOON'],
    ['MAX_DAYS_AHEAD_EXCEEDED', 'TOO_FAR_AHEAD'],
    ['STEP_MISMATCH', 'OFF_BOOKING_GRID'],
    // F15 collapsed these two into one reason because nothing read the
    // difference. They are two different jobs for the pro, which is why F16
    // split them.
    ['LOCATION_NOT_FOUND', 'LOCATION_UNAVAILABLE'],
    ['TIMEZONE_REQUIRED', 'LOCATION_TIME_ZONE_MISSING'],
  ])('turns a %s refusal into %s', async (reason, expected) => {
    gateAnswers({ open: false, reason })

    const visibility = await resolveProOpeningVisibility({
      rows: [row()],
      nowUtc: NOW,
    })

    expect(visibility.get('opening_1')).toBe(expected)
  })

  describe('rows it does not ask about', () => {
    it.each([
      ['booked', { status: OpeningStatus.BOOKED, bookedAt: NOW }],
      ['cancelled', { status: OpeningStatus.CANCELLED, cancelledAt: NOW }],
      ['expired', { status: OpeningStatus.EXPIRED }],
      [
        'already started',
        { startAt: new Date(NOW.getTime() - 60_000) },
      ],
    ])('leaves an %s opening unchecked', async (_label, over) => {
      const visibility = await resolveProOpeningVisibility({
        rows: [row(over)],
        nowUtc: NOW,
      })

      expect(visibility.get('opening_1')).toBe('NOT_CHECKED')
      expect(mocks.checkStoredSlotsAreOpen).not.toHaveBeenCalled()
    })

    it('never reports an unanswered row as visible', async () => {
      mocks.checkStoredSlotsAreOpen.mockResolvedValue(new Map())

      const visibility = await resolveProOpeningVisibility({
        rows: [row()],
        nowUtc: NOW,
      })

      expect(visibility.get('opening_1')).toBe('NOT_CHECKED')
    })

    it('answers for every row, checked or not', async () => {
      const visibility = await resolveProOpeningVisibility({
        rows: [
          row({ id: 'live' }),
          row({ id: 'gone', status: OpeningStatus.CANCELLED }),
        ],
        nowUtc: NOW,
      })

      expect([...visibility.keys()].sort()).toEqual(['gone', 'live'])
    })
  })

  // `proOpeningSelect` omits the client select's `offering.isActive` filter so
  // the pro can SEE a deactivated link (F9). The badge answers a CLIENT
  // question, so it has to re-apply that filter — in both directions.
  describe('deactivated offerings', () => {
    it('flags an opening whose every offering has been deactivated', async () => {
      const visibility = await resolveProOpeningVisibility({
        rows: [row({ services: [serviceRow({ isActive: false })] })],
        nowUtc: NOW,
      })

      expect(visibility.get('opening_1')).toBe('NO_ACTIVE_SERVICE')
      // Nothing to ask: the client feeds drop the row before the schedule
      // question arises, because they require some active offering.
      expect(mocks.checkStoredSlotsAreOpen).not.toHaveBeenCalled()
    })

    it('prices the window from the offerings a client can still book', async () => {
      await resolveProOpeningVisibility({
        rows: [
          row({
            services: [
              // The longest service — but no client can book it any more, so it
              // must not widen the window the badge is judged against.
              serviceRow({ isActive: false, salonDurationMinutes: 240 }),
              serviceRow({ isActive: true, salonDurationMinutes: 45 }),
            ],
          }),
        ],
        nowUtc: NOW,
      })

      expect(mocks.checkStoredSlotsAreOpen).toHaveBeenCalledTimes(1)
      const call = mocks.checkStoredSlotsAreOpen.mock.calls[0]?.[0]
      expect(call.candidates).toHaveLength(1)
      expect(call.candidates[0].durationMinutes).toBe(45)
    })
  })

  // The pro is not a client, so there is no viewer hold to discount. Passing a
  // client id here would silently exempt that client's hold and turn a genuine
  // TIME_HELD into VISIBLE.
  it('asks as nobody in particular, and in one batched call', async () => {
    await resolveProOpeningVisibility({
      rows: [row({ id: 'a' }), row({ id: 'b' })],
      nowUtc: NOW,
    })

    expect(mocks.checkStoredSlotsAreOpen).toHaveBeenCalledTimes(1)
    const call = mocks.checkStoredSlotsAreOpen.mock.calls[0]?.[0]
    expect(call.viewerClientId).toBeNull()
    expect(call.nowUtc).toBe(NOW)
    expect(call.candidates.map((c: { key: string }) => c.key)).toEqual(['a', 'b'])
  })
})
