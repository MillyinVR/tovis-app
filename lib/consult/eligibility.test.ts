import { BookingStatus } from '@prisma/client'
import { afterEach, describe, expect, it } from 'vitest'

import {
  AI_CONSULT_BOOKING_WINDOW_DAYS,
  type AiConsultEligibilityBooking,
  evaluateAiConsultBookingEligibility,
} from './eligibility'

const NOW = new Date('2026-08-07T12:00:00.000Z')

function booking(
  overrides: Partial<AiConsultEligibilityBooking> = {},
): AiConsultEligibilityBooking {
  return {
    status: BookingStatus.ACCEPTED,
    scheduledFor: new Date('2026-08-14T12:00:00.000Z'),
    professionalId: 'pro_1',
    service: {
      categoryId: 'cat_hair_color',
      category: { slug: 'hair-color' },
    },
    ...overrides,
  }
}

describe('evaluateAiConsultBookingEligibility', () => {
  afterEach(() => {
    delete process.env.ENABLE_AI_CONSULT
  })

  it('allows an enabled, upcoming hair-color booking', () => {
    process.env.ENABLE_AI_CONSULT = '1'

    expect(evaluateAiConsultBookingEligibility(booking(), NOW)).toEqual({
      eligible: true,
    })
    expect(
      evaluateAiConsultBookingEligibility(
        booking({ status: BookingStatus.PENDING }),
        NOW,
      ),
    ).toEqual({ eligible: true })
  })

  it('keeps disabled professionals dark', () => {
    expect(evaluateAiConsultBookingEligibility(booking(), NOW)).toEqual({
      eligible: false,
      reason: 'FEATURE_DISABLED',
      hidden: true,
    })
  })

  it('keeps non-pilot verticals dark', () => {
    process.env.ENABLE_AI_CONSULT = '1'
    expect(
      evaluateAiConsultBookingEligibility(
        booking({
          service: {
            categoryId: 'cat_brows',
            category: { slug: 'brows' },
          },
        }),
        NOW,
      ),
    ).toEqual({
      eligible: false,
      reason: 'VERTICAL_NOT_ENABLED',
      hidden: true,
    })
  })

  it.each([
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.NO_SHOW,
  ])('rejects a %s booking', (status) => {
    process.env.ENABLE_AI_CONSULT = '1'
    expect(
      evaluateAiConsultBookingEligibility(booking({ status }), NOW),
    ).toEqual({
      eligible: false,
      reason: 'BOOKING_NOT_UPCOMING',
      hidden: false,
    })
  })

  it('rejects a booking whose scheduled time has passed', () => {
    process.env.ENABLE_AI_CONSULT = '1'
    expect(
      evaluateAiConsultBookingEligibility(
        booking({ scheduledFor: new Date('2026-08-07T11:59:59.999Z') }),
        NOW,
      ),
    ).toEqual({
      eligible: false,
      reason: 'BOOKING_NOT_UPCOMING',
      hidden: false,
    })
  })

  it(`rejects a booking beyond the ${AI_CONSULT_BOOKING_WINDOW_DAYS}-day pilot window`, () => {
    process.env.ENABLE_AI_CONSULT = '1'
    expect(
      evaluateAiConsultBookingEligibility(
        booking({ scheduledFor: new Date('2026-11-06T12:00:00.001Z') }),
        NOW,
      ),
    ).toEqual({
      eligible: false,
      reason: 'BOOKING_OUTSIDE_PILOT_WINDOW',
      hidden: false,
    })
  })

  it(`allows a booking exactly ${AI_CONSULT_BOOKING_WINDOW_DAYS} elapsed days away`, () => {
    process.env.ENABLE_AI_CONSULT = '1'
    expect(
      evaluateAiConsultBookingEligibility(
        booking({ scheduledFor: new Date('2026-11-05T12:00:00.000Z') }),
        NOW,
      ),
    ).toEqual({ eligible: true })
  })
})
