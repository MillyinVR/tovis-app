// lib/aftercare/aftercareEditWindow.test.ts
import { BookingStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS,
  resolveAftercareEditWindow,
} from './aftercareEditWindow'

const NOW = new Date('2026-07-26T18:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS)
}

describe('resolveAftercareEditWindow', () => {
  it('imposes no deadline while the booking is still live', () => {
    for (const status of [
      BookingStatus.ACCEPTED,
      BookingStatus.IN_PROGRESS,
    ] as const) {
      expect(
        resolveAftercareEditWindow({
          status,
          // A live session can carry a finishedAt and must stay editable: the
          // send is what triggers closeout, so completion is the RESULT of the
          // write, never a precondition.
          finishedAt: daysBefore(90),
          scheduledFor: daysBefore(90),
          now: NOW,
        }),
      ).toEqual({ editable: true, isPostCompletion: false, closesAt: null })
    }
  })

  it('keeps a freshly completed booking editable and reports its deadline', () => {
    const finishedAt = daysBefore(3)

    expect(
      resolveAftercareEditWindow({
        status: BookingStatus.COMPLETED,
        finishedAt,
        scheduledFor: daysBefore(3),
        now: NOW,
      }),
    ).toEqual({
      editable: true,
      isPostCompletion: true,
      closesAt: new Date(
        finishedAt.getTime() +
          AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS * DAY_MS,
      ),
    })
  })

  it('locks a completed booking once the window has elapsed', () => {
    const window = resolveAftercareEditWindow({
      status: BookingStatus.COMPLETED,
      finishedAt: daysBefore(AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS + 1),
      scheduledFor: daysBefore(AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS + 1),
      now: NOW,
    })

    expect(window.editable).toBe(false)
    expect(window.isPostCompletion).toBe(true)
  })

  it('treats the closing instant itself as closed', () => {
    const finishedAt = daysBefore(AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS)

    expect(
      resolveAftercareEditWindow({
        status: BookingStatus.COMPLETED,
        finishedAt,
        scheduledFor: finishedAt,
        now: NOW,
      }).editable,
    ).toBe(false)
  })

  it('anchors on scheduledFor when a completed booking has no finishedAt', () => {
    // Legacy rows reached COMPLETED without one; an anchor we can always
    // produce beats leaving such a booking editable forever.
    expect(
      resolveAftercareEditWindow({
        status: BookingStatus.COMPLETED,
        finishedAt: null,
        scheduledFor: daysBefore(2),
        now: NOW,
      }).editable,
    ).toBe(true)

    expect(
      resolveAftercareEditWindow({
        status: BookingStatus.COMPLETED,
        finishedAt: null,
        scheduledFor: daysBefore(
          AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS + 1,
        ),
        now: NOW,
      }).editable,
    ).toBe(false)
  })

  it('reports closed — never open — when no usable anchor exists', () => {
    // An unreadable clock must preserve the old locked-forever behavior rather
    // than open a write path.
    expect(
      resolveAftercareEditWindow({
        status: BookingStatus.COMPLETED,
        finishedAt: null,
        scheduledFor: null,
        now: NOW,
      }),
    ).toEqual({ editable: false, isPostCompletion: true, closesAt: null })

    expect(
      resolveAftercareEditWindow({
        status: BookingStatus.COMPLETED,
        finishedAt: new Date('nope'),
        scheduledFor: daysBefore(1),
        now: NOW,
      }).editable,
    ).toBe(false)
  })
})
