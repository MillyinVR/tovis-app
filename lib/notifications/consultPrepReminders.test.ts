import { BookingStatus, ConsultServiceFamily } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { deriveConsultPrepBadge } from '@/lib/consult/prepBadge'
import {
  deriveConsultPrepState,
  type ConsultPrepSession,
  type ConsultPrepState,
} from '@/lib/consult/prepDeadline'

import {
  buildConsultPrepReminderContent,
  consultPrepReminderHref,
  parseConsultPrepReminderPayload,
  planConsultPrepReminders,
} from './consultPrepReminders'

const APPOINTMENT = new Date('2026-10-16T14:00:00.000Z')
// Hair N = 48h.
const DEADLINE = new Date('2026-10-14T14:00:00.000Z')

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
  overrides: { bookingStatus?: BookingStatus; scheduledFor?: Date } = {},
): ConsultPrepSession {
  const booking = sparkBooking({
    status: overrides.bookingStatus ?? BookingStatus.ACCEPTED,
    scheduledFor: overrides.scheduledFor ?? APPOINTMENT,
  })
  return {
    id: 'consult_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    serviceCategoryId: 'cat_1',
    bookingId: null,
    anchorLookPostId: 'look_1',
    serviceCategory: {
      id: 'cat_1',
      slug: 'hair-color',
      name: 'Hair Color',
      isActive: true,
      consultFamily: ConsultServiceFamily.HAIR,
    },
    booking: null,
    inspiredBookings: [booking],
  }
}

function prepFor(
  args: { complete?: boolean; bookingStatus?: BookingStatus } = {},
): { session: ConsultPrepSession; prep: ConsultPrepState } {
  const s = session({ bookingStatus: args.bookingStatus })
  const answers = args.complete
    ? {
        box_dye_history: 'never',
        prior_lightening: 'never',
        henna_plant_dye_history: 'never',
        other_chemical_history: 'never',
        prior_reaction: 'no',
      }
    : {}
  return {
    session: s,
    prep: deriveConsultPrepState({
      session: s,
      intakePayloads: [
        {
          packId: 'hair-color',
          packVersion: 3,
          schemaVersion: 2,
          complete: false,
          answers,
        },
      ],
    }),
  }
}

describe('the escalation plan', () => {
  it('🔴 measures every stage from the DEADLINE, not the appointment', () => {
    // Tori, 2026-09-06. Appointment-relative would put the "24h" nudge a full
    // day AFTER the hair deadline it is nagging about.
    const { session: s, prep } = prepFor()
    const plan = planConsultPrepReminders({
      session: s,
      prep,
      now: new Date('2026-10-01T00:00:00.000Z'),
    })

    expect(plan.map((item) => item.stage)).toEqual(['AHEAD', 'SOON', 'DUE'])
    expect(plan.map((item) => item.runAt.toISOString())).toEqual([
      '2026-10-11T14:00:00.000Z', // deadline − 72h
      '2026-10-13T14:00:00.000Z', // deadline − 24h
      '2026-10-14T14:00:00.000Z', // the deadline itself
    ])
    // Strictly increasing, and none of them after the deadline.
    for (const item of plan) {
      expect(item.runAt.getTime()).toBeLessThanOrEqual(DEADLINE.getTime())
    }
  })

  it('gives each stage a stable per-consult dedupe key, so it fires once', () => {
    const { session: s, prep } = prepFor()
    const plan = planConsultPrepReminders({
      session: s,
      prep,
      now: new Date('2026-10-01T00:00:00.000Z'),
    })
    expect(plan.map((item) => item.dedupeKey)).toEqual([
      'consult-prep:consult_1:AHEAD',
      'consult-prep:consult_1:SOON',
      'consult-prep:consult_1:DUE',
    ])
  })

  it('drops stages already in the past rather than firing them late', () => {
    const { session: s, prep } = prepFor()
    // Booked two days before the appointment: the deadline has already gone.
    const plan = planConsultPrepReminders({
      session: s,
      prep,
      now: new Date('2026-10-14T15:00:00.000Z'),
    })
    expect(plan).toEqual([])
  })

  it('plans only the stages still ahead when booked mid-escalation', () => {
    const { session: s, prep } = prepFor()
    const plan = planConsultPrepReminders({
      session: s,
      prep,
      now: new Date('2026-10-12T00:00:00.000Z'),
    })
    expect(plan.map((item) => item.stage)).toEqual(['SOON', 'DUE'])
  })

  it('plans NOTHING once prep is complete — this is "reminders stop"', () => {
    const { session: s, prep } = prepFor({ complete: true })
    expect(prep.complete).toBe(true)
    expect(
      planConsultPrepReminders({
        session: s,
        prep,
        now: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).toEqual([])
  })

  it('plans NOTHING for a cancelled booking — this is the other "stop"', () => {
    for (const status of [BookingStatus.CANCELLED, BookingStatus.NO_SHOW]) {
      const { session: s, prep } = prepFor({ bookingStatus: status })
      expect(
        planConsultPrepReminders({
          session: s,
          prep,
          now: new Date('2026-10-01T00:00:00.000Z'),
        }),
      ).toEqual([])
    }
  })

  it('plans NOTHING for a completed appointment', () => {
    const { session: s, prep } = prepFor({
      bookingStatus: BookingStatus.COMPLETED,
    })
    expect(
      planConsultPrepReminders({
        session: s,
        prep,
        now: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).toEqual([])
  })
})

describe('what the reminder says', () => {
  const payload = {
    stage: 'SOON' as const,
    consultSessionId: 'consult_1',
    bookingId: 'booking_1',
    deadlineAt: DEADLINE.toISOString(),
    timeZone: 'America/New_York',
  }

  it('fills the pro and the deadline, and renders the date in her zone', () => {
    const content = buildConsultPrepReminderContent({
      payload,
      professionalName: 'Susie',
    })
    // 14:00Z on Oct 14 is 10:00 in New York — the same calendar day, which is
    // what she is told.
    expect(content.body).toContain('Wednesday, October 14')
    expect(content.body).toContain('Susie')
    expect(content.title).toBe('Due tomorrow')
  })

  it('leaves no slot unfilled in any stage', () => {
    for (const stage of ['BOOKED', 'AHEAD', 'SOON', 'DUE'] as const) {
      const content = buildConsultPrepReminderContent({
        payload: { ...payload, stage },
        professionalName: 'Susie',
      })
      expect(content.title).not.toContain('{')
      expect(content.body).not.toContain('{')
    }
  })

  it('🔴 never names a specific safety question', () => {
    // The answers are health-adjacent and live behind a login; the
    // notification is a doorbell, not the ask. A lock screen someone else can
    // read must not say "we still need to know about your box dye".
    for (const stage of ['BOOKED', 'AHEAD', 'SOON', 'DUE'] as const) {
      const content = buildConsultPrepReminderContent({
        payload: { ...payload, stage },
        professionalName: 'Susie',
      })
      const text = `${content.title} ${content.body}`.toLowerCase()
      for (const term of [
        'box dye',
        'henna',
        'lighten',
        'bleach',
        'reaction',
        'allerg',
        'chemical',
      ]) {
        expect(text).not.toContain(term)
      }
    }
  })

  it('never threatens the appointment — nothing here is a gate', () => {
    const due = buildConsultPrepReminderContent({
      payload: { ...payload, stage: 'DUE' },
      professionalName: 'Susie',
    })
    expect(due.body).toContain('still on')
    for (const term of ['cancel', 'lose', 'forfeit', 'must']) {
      expect(due.body.toLowerCase()).not.toContain(term)
    }
  })
})

describe('the stored payload', () => {
  const valid = {
    stage: 'AHEAD',
    consultSessionId: 'consult_1',
    bookingId: 'booking_1',
    deadlineAt: DEADLINE.toISOString(),
    timeZone: 'America/New_York',
  }

  it('round-trips a good row', () => {
    expect(parseConsultPrepReminderPayload(valid)).toEqual(valid)
  })

  it('refuses anything it cannot act on, rather than guessing', () => {
    expect(parseConsultPrepReminderPayload(null)).toBeNull()
    expect(parseConsultPrepReminderPayload([])).toBeNull()
    expect(
      parseConsultPrepReminderPayload({ ...valid, stage: 'WHENEVER' }),
    ).toBeNull()
    expect(
      parseConsultPrepReminderPayload({ ...valid, deadlineAt: 'soon' }),
    ).toBeNull()
    expect(
      parseConsultPrepReminderPayload({ ...valid, consultSessionId: '' }),
    ).toBeNull()
  })

  it('repairs an unusable timezone instead of refusing the reminder', () => {
    // A bad zone must not cost the client the notification — the date simply
    // renders in the default zone.
    expect(
      parseConsultPrepReminderPayload({ ...valid, timeZone: 'Mars/Olympus' })
        ?.timeZone,
    ).toBe('UTC')
  })
})

describe('the pro’s badge', () => {
  it('renders nothing for a booking with no consult', () => {
    expect(deriveConsultPrepBadge(null).significant).toBe(false)
  })

  it('is INCOMPLETE before the deadline and OVERDUE after it', () => {
    const { prep } = prepFor()
    expect(deriveConsultPrepBadge(prep, new Date('2026-10-13T00:00:00Z')).kind).toBe(
      'INCOMPLETE',
    )
    expect(deriveConsultPrepBadge(prep, new Date('2026-10-15T00:00:00Z')).kind).toBe(
      'OVERDUE',
    )
  })

  it('is COMPLETE once the answers are in, even past the deadline', () => {
    const { prep } = prepFor({ complete: true })
    expect(deriveConsultPrepBadge(prep, new Date('2026-10-15T00:00:00Z')).kind).toBe(
      'COMPLETE',
    )
  })

  it('stays INCOMPLETE, never OVERDUE, with no appointment to be late for', () => {
    const { prep } = prepFor({ bookingStatus: BookingStatus.CANCELLED })
    expect(prep.deadlineAt).toBeNull()
    expect(deriveConsultPrepBadge(prep, new Date('2027-01-01T00:00:00Z')).kind).toBe(
      'INCOMPLETE',
    )
  })
})

describe('where a tap lands', () => {
  it('is the singular consult route, encoded, with nothing after the id', () => {
    // The web route is `app/client/(gated)/consult/[id]`; the iOS deep-link
    // mapper accepts `/client/consult/<id>` and ONLY when the path has exactly
    // three parts. A plural or a trailing segment lands on a 404 / Home.
    expect(consultPrepReminderHref('consult_1')).toBe('/client/consult/consult_1')
    expect(consultPrepReminderHref('a b/c')).toBe('/client/consult/a%20b%2Fc')
    expect(consultPrepReminderHref('consult_1').split('/').filter(Boolean)).toHaveLength(3)
  })
})
