// lib/booking/lifecycleContract.noShow.test.ts
//
// The NO_SHOW terminal transition (Phase 2 revenue protection). A confirmed
// (ACCEPTED) booking may be marked NO_SHOW by the pro or admin, and by no one
// else / from no other status.
import { describe, expect, it } from 'vitest'
import { BookingStatus } from '@prisma/client'

import { isLegalStatusTransition } from './lifecycleContract'

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
