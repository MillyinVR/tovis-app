// lib/consult/anchor.test.ts
import { BookingStatus } from '@prisma/client'
import { afterEach, describe, expect, it } from 'vitest'

import { AI_CONSULT_PRO_ALLOWLIST } from './access'
import {
  evaluateConsultAnchor,
  evaluateConsultAnchorScope,
  type ConsultAnchorSession,
} from './anchor'

function allowlistedPro(): string {
  const pro = AI_CONSULT_PRO_ALLOWLIST[0]
  if (!pro) {
    throw new Error(
      'These fixtures need a founder-allowlisted pro; AI_CONSULT_PRO_ALLOWLIST is empty.',
    )
  }
  return pro
}

const PRO = allowlistedPro()
const NOW = new Date('2026-09-01T00:00:00.000Z')
const SOON = new Date('2026-09-10T00:00:00.000Z')

function bookingAnchored(
  overrides: Partial<ConsultAnchorSession> = {},
): ConsultAnchorSession {
  return {
    clientId: 'client_1',
    professionalId: PRO,
    serviceCategoryId: 'cat_hair_color',
    bookingId: 'booking_1',
    anchorLookPostId: null,
    serviceCategory: { slug: 'hair-color' },
    booking: {
      clientId: 'client_1',
      status: BookingStatus.ACCEPTED,
      scheduledFor: SOON,
      professionalId: PRO,
      service: { categoryId: 'cat_hair_color', category: { slug: 'hair-color' } },
    },
    ...overrides,
  }
}

function lookAnchored(
  overrides: Partial<ConsultAnchorSession> = {},
): ConsultAnchorSession {
  return {
    clientId: 'client_1',
    professionalId: PRO,
    serviceCategoryId: 'cat_hair_color',
    bookingId: null,
    anchorLookPostId: 'look_1',
    serviceCategory: { slug: 'hair-color' },
    booking: null,
    ...overrides,
  }
}

afterEach(() => {
  delete process.env.ENABLE_AI_CONSULT
})

describe('evaluateConsultAnchor — booking arm (unchanged behaviour)', () => {
  it('accepts an owned, upcoming, in-window booking', () => {
    expect(evaluateConsultAnchor(bookingAnchored(), NOW)).toEqual({
      eligible: true,
      kind: 'BOOKING',
    })
  })

  it('hides a booking that belongs to a different client', () => {
    const session = bookingAnchored()
    const mismatched = bookingAnchored({
      booking: { ...session.booking!, clientId: 'someone_else' },
    })
    expect(evaluateConsultAnchor(mismatched, NOW)).toEqual({
      eligible: false,
      reason: 'SCOPE_MISMATCH',
      hidden: true,
    })
  })

  it('hides a booking whose professional or category disagrees with the shell', () => {
    const base = bookingAnchored()
    for (const booking of [
      { ...base.booking!, professionalId: 'other_pro' },
      {
        ...base.booking!,
        service: { categoryId: 'cat_other', category: { slug: 'hair-color' } },
      },
    ]) {
      expect(evaluateConsultAnchor(bookingAnchored({ booking }), NOW)).toEqual({
        eligible: false,
        reason: 'SCOPE_MISMATCH',
        hidden: true,
      })
    }
  })

  it('still applies the upcoming and 90-day window rules', () => {
    const base = bookingAnchored()
    expect(
      evaluateConsultAnchor(
        bookingAnchored({
          booking: {
            ...base.booking!,
            scheduledFor: new Date('2026-08-01T00:00:00.000Z'),
          },
        }),
        NOW,
      ),
    ).toEqual({
      eligible: false,
      reason: 'BOOKING_NOT_UPCOMING',
      hidden: false,
    })
    expect(
      evaluateConsultAnchor(
        bookingAnchored({
          booking: {
            ...base.booking!,
            scheduledFor: new Date('2027-09-01T00:00:00.000Z'),
          },
        }),
        NOW,
      ),
    ).toEqual({
      eligible: false,
      reason: 'BOOKING_OUTSIDE_PILOT_WINDOW',
      hidden: false,
    })
  })

  it('the scope-only rule ignores the timing window (agreement routes)', () => {
    const base = bookingAnchored()
    const stale = bookingAnchored({
      booking: {
        ...base.booking!,
        scheduledFor: new Date('2026-08-01T00:00:00.000Z'),
      },
    })
    expect(evaluateConsultAnchorScope(stale)).toEqual({
      eligible: true,
      kind: 'BOOKING',
    })
    expect(evaluateConsultAnchor(stale, NOW).eligible).toBe(false)
  })
})

describe('evaluateConsultAnchor — look arm', () => {
  it('accepts a look-anchored consult with no booking at all', () => {
    expect(evaluateConsultAnchor(lookAnchored(), NOW)).toEqual({
      eligible: true,
      kind: 'LOOK',
    })
  })

  it('has no timing rule to apply — the answer never changes with time', () => {
    for (const now of [NOW, new Date('2030-01-01T00:00:00.000Z')]) {
      expect(evaluateConsultAnchor(lookAnchored(), now)).toEqual({
        eligible: true,
        kind: 'LOOK',
      })
    }
  })

  it('stays behind the founder gate', () => {
    expect(
      evaluateConsultAnchor(
        lookAnchored({ professionalId: 'not-on-the-list' }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: 'FEATURE_DISABLED', hidden: true })
  })

  it('admits any category by default', () => {
    expect(
      evaluateConsultAnchor(
        lookAnchored({ serviceCategory: { slug: 'nails' } }),
        NOW,
      ),
    ).toEqual({ eligible: true, kind: 'LOOK' })
  })

  it('stays inside colour when the kill switch narrows the scope', () => {
    process.env.AI_CONSULT_SERVICE_SCOPE = 'HAIR_COLOR_ONLY'
    try {
      expect(
        evaluateConsultAnchor(
          lookAnchored({ serviceCategory: { slug: 'nails' } }),
          NOW,
        ),
      ).toEqual({ eligible: false, reason: 'VERTICAL_NOT_ENABLED', hidden: true })
    } finally {
      delete process.env.AI_CONSULT_SERVICE_SCOPE
    }
  })
})

describe('evaluateConsultAnchor — no anchor', () => {
  it('refuses rather than silently passing a row with neither anchor', () => {
    expect(
      evaluateConsultAnchor(
        lookAnchored({ anchorLookPostId: null, booking: null }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: 'ANCHOR_MISSING', hidden: true })
  })

  it('refuses a booking anchor whose booking row did not load', () => {
    expect(
      evaluateConsultAnchor(bookingAnchored({ booking: null }), NOW),
    ).toEqual({ eligible: false, reason: 'SCOPE_MISMATCH', hidden: true })
  })
})
