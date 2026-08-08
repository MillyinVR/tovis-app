// lib/booking/rescheduleWidth.test.ts
//
// `resolveRescheduleCommitDurationMinutes` is the one gate every reschedule
// window runs — the availability OFFER (lib/availability/data/durationContext),
// the hold RESERVE and the COMMIT (both in lib/booking/writeBoundary), plus the
// token reschedule-hold route. Testing it here tests all four, which is the
// point of it living in one pure function.
//
// The cancellation-window cutoff is the load-bearing case. Reschedule mutates
// `scheduledFor` on the SAME booking row and both refund rules re-read that
// column at cancel time, so without the cutoff a client two hours out could push
// the booking a month forward and then cancel it "in good time" for a full auto
// refund. That arbitrage is invisible to every other suite: it needs no invalid
// input and leaves no failing write behind it.
import { describe, expect, it } from 'vitest'
import { BookingStatus } from '@prisma/client'

import { CLIENT_FULL_REFUND_WINDOW_MS } from '@/lib/booking/constants'
import { isBookingError } from '@/lib/booking/errors'

import {
  resolveRescheduleCommitDurationMinutes,
  type RescheduleTargetRecord,
} from './rescheduleWidth'

const NOW = new Date('2026-08-07T12:00:00.000Z')

/** Comfortably outside the window, so only the field under test decides. */
const FAR_OUT = new Date(NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS * 5)

function makeBooking(
  overrides: Partial<RescheduleTargetRecord> = {},
): RescheduleTargetRecord {
  return {
    status: BookingStatus.ACCEPTED,
    scheduledFor: FAR_OUT,
    startedAt: null,
    finishedAt: null,
    offeringId: 'off_1',
    totalDurationMinutes: 90,
    ...overrides,
  }
}

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error: unknown) {
    if (isBookingError(error)) return error.code
    throw error
  }
  throw new Error('expected a booking error, but the call returned')
}

describe('resolveRescheduleCommitDurationMinutes', () => {
  it('returns the booking’s committed width and offering when it may be moved', () => {
    expect(
      resolveRescheduleCommitDurationMinutes(makeBooking(), {
        now: NOW,
        actor: 'CLIENT',
      }),
    ).toEqual({ totalDurationMinutes: 90, offeringId: 'off_1' })
  })

  describe('the client cancellation-window cutoff', () => {
    it('refuses a client whose booking is already inside the window', () => {
      const booking = makeBooking({
        scheduledFor: new Date(
          NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS - 60_000,
        ),
      })

      expect(
        codeOf(() =>
          resolveRescheduleCommitDurationMinutes(booking, {
            now: NOW,
            actor: 'CLIENT',
          }),
        ),
      ).toBe('BOOKING_RESCHEDULE_TOO_LATE')
    })

    // The boundary has to agree with isAutoCancelRefundEligible, which refunds a
    // client cancel when `now <= scheduledFor - WINDOW`. Exactly on the line the
    // cancel is still refundable, so the reschedule must still be allowed —
    // otherwise there is an instant where a client can neither move the booking
    // nor be treated as cancelling in good time.
    it('allows a client exactly on the boundary', () => {
      const booking = makeBooking({
        scheduledFor: new Date(NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS),
      })

      expect(
        resolveRescheduleCommitDurationMinutes(booking, {
          now: NOW,
          actor: 'CLIENT',
        }).totalDurationMinutes,
      ).toBe(90)
    })

    it('allows a client one second outside the window', () => {
      const booking = makeBooking({
        scheduledFor: new Date(
          NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS + 1000,
        ),
      })

      expect(
        resolveRescheduleCommitDurationMinutes(booking, {
          now: NOW,
          actor: 'CLIENT',
        }).totalDurationMinutes,
      ).toBe(90)
    })

    // A pro reaches this function through the availability read path. Holding
    // them to the client's window would refuse a pro moving their own
    // short-notice booking — which their write path explicitly supports.
    it('does NOT apply to a pro, even deep inside the window', () => {
      const booking = makeBooking({
        scheduledFor: new Date(NOW.getTime() + 60_000),
      })

      expect(
        resolveRescheduleCommitDurationMinutes(booking, {
          now: NOW,
          actor: 'PRO',
        }).totalDurationMinutes,
      ).toBe(90)
    })

    // A booking already in the past is inside the window by definition; the
    // client is refused for lateness rather than falling through to a width.
    it('refuses a client whose booking is in the past', () => {
      const booking = makeBooking({
        scheduledFor: new Date(NOW.getTime() - CLIENT_FULL_REFUND_WINDOW_MS),
      })

      expect(
        codeOf(() =>
          resolveRescheduleCommitDurationMinutes(booking, {
            now: NOW,
            actor: 'CLIENT',
          }),
        ),
      ).toBe('BOOKING_RESCHEDULE_TOO_LATE')
    })
  })

  describe('the guards the cutoff sits alongside', () => {
    it.each([
      [BookingStatus.COMPLETED, 'BOOKING_NOT_RESCHEDULABLE'],
      [BookingStatus.CANCELLED, 'BOOKING_NOT_RESCHEDULABLE'],
    ])('refuses a %s booking', (status, expected) => {
      expect(
        codeOf(() =>
          resolveRescheduleCommitDurationMinutes(makeBooking({ status }), {
            now: NOW,
            actor: 'CLIENT',
          }),
        ),
      ).toBe(expected)
    })

    it('refuses a started booking', () => {
      expect(
        codeOf(() =>
          resolveRescheduleCommitDurationMinutes(
            makeBooking({ startedAt: new Date(NOW.getTime() - 1000) }),
            { now: NOW, actor: 'CLIENT' },
          ),
        ),
      ).toBe('BOOKING_ALREADY_STARTED')
    })

    it('refuses a booking with no offering', () => {
      expect(
        codeOf(() =>
          resolveRescheduleCommitDurationMinutes(
            makeBooking({ offeringId: null }),
            { now: NOW, actor: 'CLIENT' },
          ),
        ),
      ).toBe('BOOKING_MISSING_OFFERING')
    })

    it.each([null, 0, 5, 10_000])(
      'refuses a corrupt committed duration (%s)',
      (totalDurationMinutes) => {
        expect(
          codeOf(() =>
            resolveRescheduleCommitDurationMinutes(
              makeBooking({ totalDurationMinutes }),
              { now: NOW, actor: 'CLIENT' },
            ),
          ),
        ).toBe('INVALID_DURATION')
      },
    )

    // Ordering matters for the message the client sees. A cancelled booking that
    // is ALSO inside the window is unmovable for good, so "cannot be
    // rescheduled" must win over "too soon to move yourself" — the latter
    // implies moving it earlier would have worked.
    it('reports the terminal status ahead of the lateness cutoff', () => {
      const booking = makeBooking({
        status: BookingStatus.CANCELLED,
        scheduledFor: new Date(NOW.getTime() + 60_000),
      })

      expect(
        codeOf(() =>
          resolveRescheduleCommitDurationMinutes(booking, {
            now: NOW,
            actor: 'CLIENT',
          }),
        ),
      ).toBe('BOOKING_NOT_RESCHEDULABLE')
    })

    // The cutoff is a TIMING refusal, so it must come before the corrupt-data
    // ones: a client moving a booking they still could have moved yesterday
    // should be told about the deadline, not about an internal duration.
    it('reports the lateness cutoff ahead of a corrupt duration', () => {
      const booking = makeBooking({
        totalDurationMinutes: 0,
        scheduledFor: new Date(NOW.getTime() + 60_000),
      })

      expect(
        codeOf(() =>
          resolveRescheduleCommitDurationMinutes(booking, {
            now: NOW,
            actor: 'CLIENT',
          }),
        ),
      ).toBe('BOOKING_RESCHEDULE_TOO_LATE')
    })
  })
})
