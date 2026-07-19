// lib/booking/lifecycleContract.noShow.test.ts
//
// The NO_SHOW terminal transition (Phase 2 revenue protection). A confirmed
// (ACCEPTED) booking may be marked NO_SHOW by the pro or admin, and by no one
// else / from no other status.
import { describe, expect, it } from 'vitest'
import { BookingStatus } from '@prisma/client'

import {
  isLegalStatusTransition,
  isTerminalBookingStatus,
} from './lifecycleContract'

describe('isTerminalBookingStatus — derived from the transition contract', () => {
  // Pinned for EVERY status, so adding a status or an outgoing transition to
  // the contract shows up here instead of silently changing what "terminal"
  // means at the four call sites that consume it.
  const CASES: ReadonlyArray<[BookingStatus, boolean]> = [
    [BookingStatus.PENDING, false],
    [BookingStatus.ACCEPTED, false],
    [BookingStatus.IN_PROGRESS, false],
    [BookingStatus.COMPLETED, true],
    [BookingStatus.CANCELLED, true],
    [BookingStatus.NO_SHOW, true],
  ]

  for (const [status, terminal] of CASES) {
    it(`${status} is ${terminal ? '' : 'not '}terminal`, () => {
      expect(isTerminalBookingStatus(status)).toBe(terminal)
    })
  }

  it('covers every BookingStatus the schema defines', () => {
    // Guards the list above against a new enum member being added to Prisma
    // without anyone deciding whether it ends the lifecycle.
    expect(new Set(CASES.map(([s]) => s))).toEqual(
      new Set(Object.values(BookingStatus)),
    )
  })

  it('agrees with NO_SHOW having no legal transition to another status', () => {
    for (const to of Object.values(BookingStatus)) {
      // NO_SHOW → NO_SHOW is deliberately legal: assertLegalStatusTransition
      // returns early when from === to, which is what makes re-marking an
      // already-no-showed booking an idempotent no-op rather than an error.
      if (to === BookingStatus.NO_SHOW) continue

      for (const actor of ['PRO', 'CLIENT', 'ADMIN', 'SYSTEM'] as const) {
        expect(
          isLegalStatusTransition(BookingStatus.NO_SHOW, to, actor),
        ).toBe(false)
      }
    }
  })
})

describe('NO_SHOW status transitions', () => {
  it('lets a pro or admin mark a confirmed booking NO_SHOW', () => {
    expect(
      isLegalStatusTransition(BookingStatus.ACCEPTED, BookingStatus.NO_SHOW, 'PRO'),
    ).toBe(true)
    expect(
      isLegalStatusTransition(BookingStatus.ACCEPTED, BookingStatus.NO_SHOW, 'ADMIN'),
    ).toBe(true)
  })

  it('does not let a client mark a no-show', () => {
    expect(
      isLegalStatusTransition(
        BookingStatus.ACCEPTED,
        BookingStatus.NO_SHOW,
        'CLIENT',
      ),
    ).toBe(false)
  })

  it('only allows NO_SHOW from a confirmed booking', () => {
    expect(
      isLegalStatusTransition(BookingStatus.PENDING, BookingStatus.NO_SHOW, 'PRO'),
    ).toBe(false)
    expect(
      isLegalStatusTransition(
        BookingStatus.IN_PROGRESS,
        BookingStatus.NO_SHOW,
        'PRO',
      ),
    ).toBe(false)
    expect(
      isLegalStatusTransition(
        BookingStatus.COMPLETED,
        BookingStatus.NO_SHOW,
        'PRO',
      ),
    ).toBe(false)
  })
})
