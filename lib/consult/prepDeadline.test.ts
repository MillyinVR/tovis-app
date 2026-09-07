import { BookingStatus, ConsultServiceFamily } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  HAIR_COLOR_INTAKE_PACK,
  HAIR_COLOR_INTAKE_PACK_V2,
} from './intake/packs/hairColor'
import { GENERAL_SERVICE_INTAKE_PACK } from './intake/packs/generalService'
import { HAIR_GENERAL_INTAKE_PACK } from './intake/packs/hairGeneral'
import {
  CONSULT_PREP_SAFETY_QUESTION_KEYS,
  consultPrepDeadlineAt,
  consultPrepSafetyQuestions,
  deriveConsultPrepState,
  type ConsultPrepSession,
} from './prepDeadline'

const APPOINTMENT = new Date('2026-10-16T14:00:00.000Z')

/** Every safety answer the CURRENT colour pack asks, all answered. */
const COMPLETE_COLOR_ANSWERS = {
  change_scale: 'noticeable',
  goal_direction: 'lighter',
  box_dye_history: 'never',
  prior_lightening: 'never',
  henna_plant_dye_history: 'never',
  other_chemical_history: 'never',
  prior_reaction: 'no',
}

/**
 * The two booking shapes the prep select actually produces — and they are NOT
 * the same, which is the whole reason these are typed rather than asserted.
 * The spark link (`inspiredBookings`) carries only what the deadline reads; the
 * BOOKING anchor also carries the eligibility fields the pilot rule needs.
 */
type SparkBooking = ConsultPrepSession['inspiredBookings'][number]
type AnchorBooking = NonNullable<ConsultPrepSession['booking']>

function sparkBooking(overrides: Partial<SparkBooking> = {}): SparkBooking {
  return {
    id: 'booking_1',
    status: BookingStatus.ACCEPTED,
    scheduledFor: APPOINTMENT,
    totalDurationMinutes: 120,
    locationTimeZone: 'America/New_York',
    ...overrides,
  }
}

function anchorBooking(overrides: Partial<AnchorBooking> = {}): AnchorBooking {
  return {
    ...sparkBooking(),
    clientId: 'client_1',
    professionalId: 'pro_1',
    service: { categoryId: 'cat_1', category: { slug: 'hair-color' } },
    ...overrides,
  }
}

function session(
  overrides: {
    bookingStatus?: BookingStatus
    scheduledFor?: Date
    family?: ConsultServiceFamily
    categorySlug?: string
    /** Put the appointment on the BOOKING anchor instead of the spark link. */
    bookingAnchored?: boolean
  } = {},
): ConsultPrepSession {
  const shape = {
    status: overrides.bookingStatus ?? BookingStatus.ACCEPTED,
    scheduledFor: overrides.scheduledFor ?? APPOINTMENT,
  }
  const anchored = overrides.bookingAnchored ?? false
  return {
    id: 'consult_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    serviceCategoryId: 'cat_1',
    bookingId: anchored ? 'booking_1' : null,
    anchorLookPostId: anchored ? null : 'look_1',
    serviceCategory: {
      id: 'cat_1',
      slug: overrides.categorySlug ?? 'hair-color',
      name: 'Hair Color',
      isActive: true,
      consultFamily: overrides.family ?? ConsultServiceFamily.HAIR,
    },
    // Exactly one anchor, the way the database CHECK requires: a booking-
    // anchored consult carries `booking`, a spark carries `inspiredBookings`.
    booking: anchored ? anchorBooking(shape) : null,
    inspiredBookings: anchored ? [] : [sparkBooking(shape)],
  }
}

function intakeRevision(
  answers: Record<string, string>,
  overrides: { packVersion?: number; complete?: boolean } = {},
) {
  return {
    packId: 'hair-color',
    packVersion: overrides.packVersion ?? HAIR_COLOR_INTAKE_PACK.version,
    schemaVersion: 2,
    complete: overrides.complete ?? false,
    answers,
  }
}

describe('which questions are the safety ones', () => {
  it('resolves the colour pack to exactly the five P7a-4 names', () => {
    expect(
      consultPrepSafetyQuestions(HAIR_COLOR_INTAKE_PACK).map((q) => q.key),
    ).toEqual([
      'box_dye_history',
      'prior_lightening',
      'henna_plant_dye_history',
      'other_chemical_history',
      'prior_reaction',
    ])
  })

  it('resolves the FROZEN v2 pack to its own larger set, not v3s', () => {
    // 19 production rows are pinned to v2, which asked perm / relaxer /
    // keratin separately. A client on v2 must be asked for the answers v2
    // actually contains — deriving from the pinned pack is what makes that
    // automatic.
    expect(
      consultPrepSafetyQuestions(HAIR_COLOR_INTAKE_PACK_V2).map((q) => q.key),
    ).toEqual([
      'box_dye_history',
      'prior_lightening',
      'henna_plant_dye_history',
      'perm_history',
      'relaxer_texturizer_history',
      'keratin_smoothing_history',
      'other_chemical_history',
      'prior_reaction',
    ])
  })

  it('resolves the per-family equivalents', () => {
    expect(
      consultPrepSafetyQuestions(HAIR_GENERAL_INTAKE_PACK).map((q) => q.key),
    ).toEqual(['chemical_history', 'prior_lightening', 'prior_reaction'])
    expect(
      consultPrepSafetyQuestions(GENERAL_SERVICE_INTAKE_PACK).map((q) => q.key),
    ).toEqual([
      'recent_treatment_timing',
      'skin_sensitivity',
      'known_allergies',
      'prior_reaction',
    ])
  })

  it('never treats a non-safety question as one', () => {
    for (const key of ['change_scale', 'goal_direction', 'budget', 'event_timing']) {
      expect(CONSULT_PREP_SAFETY_QUESTION_KEYS.has(key)).toBe(false)
    }
  })
})

describe('the deadline', () => {
  it('is the appointment minus the category N (hair: 48h)', () => {
    const prep = deriveConsultPrepState({
      session: session(),
      intakePayloads: [],
    })
    expect(prep.deadlineAt?.toISOString()).toBe('2026-10-14T14:00:00.000Z')
  })

  it('reads the BOOKING anchor as readily as the spark link', () => {
    const prep = deriveConsultPrepState({
      session: session({ bookingAnchored: true }),
      intakePayloads: [],
    })
    expect(prep.deadlineAt?.toISOString()).toBe('2026-10-14T14:00:00.000Z')
  })

  it('is elapsed hours, not calendar math, across a DST boundary', () => {
    // US DST ends 2026-11-01. 48 elapsed hours before 09:00 local on Nov 2 is
    // 09:00 local on Oct 31 only if you do calendar math; in real time it is
    // an hour earlier. The deadline is a real-time offset, so the instant is
    // exactly 48h.
    const scheduledFor = new Date('2026-11-02T14:00:00.000Z')
    const prep = deriveConsultPrepState({
      session: session({ scheduledFor }),
      intakePayloads: [],
    })
    expect(prep.deadlineAt?.getTime()).toBe(
      scheduledFor.getTime() - 48 * 60 * 60 * 1000,
    )
  })

  it('is null when the booking was cancelled — nothing to be ready for', () => {
    for (const status of [BookingStatus.CANCELLED, BookingStatus.NO_SHOW]) {
      expect(
        deriveConsultPrepState({
          session: session({ bookingStatus: status }),
          intakePayloads: [],
        }).deadlineAt,
      ).toBeNull()
    }
  })

  it('is in the PAST once the appointment has started, never null', () => {
    // The pro's day-of flag is exactly "the deadline has gone and the answers
    // are not in", so an in-progress appointment must keep its deadline.
    const prep = deriveConsultPrepState({
      session: session({ bookingStatus: BookingStatus.IN_PROGRESS }),
      intakePayloads: [],
    })
    expect(prep.deadlineAt?.toISOString()).toBe('2026-10-14T14:00:00.000Z')
  })

  it('computes from an instant without a session', () => {
    expect(
      consultPrepDeadlineAt({
        scheduledFor: APPOINTMENT,
        prepDeadlineHours: 48,
      }).toISOString(),
    ).toBe('2026-10-14T14:00:00.000Z')
  })
})

describe('whether the answers are in', () => {
  it('is incomplete with no intake at all, and names every safety question', () => {
    const prep = deriveConsultPrepState({
      session: session(),
      intakePayloads: [],
    })
    expect(prep.complete).toBe(false)
    expect(prep.requiredCount).toBe(5)
    expect(prep.missing.map((item) => item.questionKey)).toEqual([
      'box_dye_history',
      'prior_lightening',
      'henna_plant_dye_history',
      'other_chemical_history',
      'prior_reaction',
    ])
  })

  it('carries the question in the CLIENT’s words, never the key', () => {
    const prep = deriveConsultPrepState({
      session: session(),
      intakePayloads: [],
    })
    const henna = prep.missing.find(
      (item) => item.questionKey === 'henna_plant_dye_history',
    )
    expect(henna?.question).toBe(
      'When did you last use henna or another plant-based hair dye?',
    )
    // A pro must never be shown a field name.
    expect(henna?.question).not.toContain('_')
  })

  it('completes when the LAST safety answer lands', () => {
    const { prior_reaction: _last, ...allButOne } = COMPLETE_COLOR_ANSWERS
    const before = deriveConsultPrepState({
      session: session(),
      intakePayloads: [intakeRevision(allButOne)],
    })
    expect(before.complete).toBe(false)
    expect(before.missing.map((item) => item.questionKey)).toEqual([
      'prior_reaction',
    ])

    const after = deriveConsultPrepState({
      session: session(),
      intakePayloads: [intakeRevision(COMPLETE_COLOR_ANSWERS)],
    })
    expect(after.complete).toBe(true)
    expect(after.missing).toEqual([])
  })

  it('🔴 treats "not-sure" as ANSWERED, not as missing', () => {
    // The handoff makes "I don't remember" an honest answer that hands the
    // follow-up to the pro, and the safety policy already routes it to a
    // strand test. Nagging a client who told the truth would be the bug.
    const prep = deriveConsultPrepState({
      session: session(),
      intakePayloads: [
        intakeRevision({
          ...COMPLETE_COLOR_ANSWERS,
          box_dye_history: 'not-sure',
          prior_reaction: 'not-sure',
        }),
      ],
    })
    expect(prep.complete).toBe(true)
  })

  it('does NOT require the pack to be marked complete', () => {
    // Prep is about the SAFETY answers, not about finishing the whole intake.
    // A client who answered the serious questions and skipped the rest has
    // done the thing the deadline exists for.
    const prep = deriveConsultPrepState({
      session: session(),
      intakePayloads: [intakeRevision(COMPLETE_COLOR_ANSWERS, { complete: false })],
    })
    expect(prep.complete).toBe(true)
  })

  it('counts against the PINNED pack version, not the current one', () => {
    // A v2 session that answered v2's eight safety questions is complete, even
    // though v3 only asks five — and v2's extra three must be REQUIRED of it.
    const v2Answers = {
      ...COMPLETE_COLOR_ANSWERS,
      current_color: 'blonde',
      desired_color: 'blonde',
      last_color_service_timing: 'never',
      perm_history: 'never',
      relaxer_texturizer_history: 'never',
      keratin_smoothing_history: 'never',
    }
    const complete = deriveConsultPrepState({
      session: session(),
      intakePayloads: [intakeRevision(v2Answers, { packVersion: 2 })],
    })
    expect(complete.packVersion).toBe(2)
    expect(complete.requiredCount).toBe(8)
    expect(complete.complete).toBe(true)

    const { perm_history: _perm, ...missingPerm } = v2Answers
    const incomplete = deriveConsultPrepState({
      session: session(),
      intakePayloads: [intakeRevision(missingPerm, { packVersion: 2 })],
    })
    expect(incomplete.complete).toBe(false)
    expect(incomplete.missing.map((item) => item.questionKey)).toEqual([
      'perm_history',
    ])
  })

  it('reads the NEWEST revision — a later answer replaces an earlier gap', () => {
    const { prior_reaction: _last, ...allButOne } = COMPLETE_COLOR_ANSWERS
    const prep = deriveConsultPrepState({
      session: session(),
      // Newest first, the order every caller passes.
      intakePayloads: [
        intakeRevision(COMPLETE_COLOR_ANSWERS),
        intakeRevision(allButOne),
      ],
    })
    expect(prep.complete).toBe(true)
  })

  it('requires the non-hair family’s own safety questions', () => {
    const prep = deriveConsultPrepState({
      session: session({
        family: ConsultServiceFamily.SKIN,
        categorySlug: 'facials',
      }),
      intakePayloads: [],
    })
    expect(prep.packId).toBe('general-service')
    expect(prep.missing.map((item) => item.questionKey)).toEqual([
      'recent_treatment_timing',
      'skin_sensitivity',
      'known_allergies',
      'prior_reaction',
    ])
  })
})
