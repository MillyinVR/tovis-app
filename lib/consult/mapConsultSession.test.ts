// lib/consult/mapConsultSession.test.ts
//
// One consult row, two anchors, three mappers. The by-id lookup mapper is the
// one that matters: GET /api/v1/client/consult/[id] used to run only the
// booking mapper, so a look-anchored consult (Book the Look) came back as
// `consult: null` and the web flow page crashed on `.status` the moment Book
// landed there.
import { describe, expect, it } from 'vitest'
import { ConsultSessionStatus, type ConsultSession } from '@prisma/client'

import {
  toConsultLookSessionDTO,
  toConsultSessionDTO,
  toConsultSessionLookupDTO,
} from './mapConsultSession'

const NOW = new Date('2026-09-03T00:35:57.145Z')

function row(overrides: Partial<ConsultSession> = {}): ConsultSession {
  return {
    id: 'consult_1',
    clientId: 'client_1',
    serviceCategoryId: 'cat_hair_color',
    professionalId: 'pro_1',
    bookingId: null,
    status: ConsultSessionStatus.CONSENT_REQUIRED,
    createdAt: NOW,
    updatedAt: NOW,
    revisionSequence: 0,
    chartCopyOptIn: true,
    chartCopyDecidedAt: null,
    chartCopyCompletedAt: null,
    anchorLookPostId: null,
    ...overrides,
  }
}

const BOOKING_ANCHORED = row({ bookingId: 'booking_1' })
const LOOK_ANCHORED = row({ anchorLookPostId: 'look_1' })

describe('toConsultSessionDTO (booking anchor)', () => {
  it('maps a booking-anchored row', () => {
    expect(toConsultSessionDTO(BOOKING_ANCHORED)).toEqual({
      id: 'consult_1',
      status: 'CONSENT_REQUIRED',
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      serviceCategoryId: 'cat_hair_color',
      createdAt: NOW.toISOString(),
    })
  })

  it('refuses a look-anchored row (bookingId stays a non-optional String on the wire)', () => {
    expect(toConsultSessionDTO(LOOK_ANCHORED)).toBeNull()
  })
})

describe('toConsultLookSessionDTO (look anchor)', () => {
  it('maps a look-anchored row', () => {
    expect(toConsultLookSessionDTO(LOOK_ANCHORED)).toEqual({
      id: 'consult_1',
      status: 'CONSENT_REQUIRED',
      lookPostId: 'look_1',
      professionalId: 'pro_1',
      serviceCategoryId: 'cat_hair_color',
      createdAt: NOW.toISOString(),
    })
  })

  it('refuses a booking-anchored row', () => {
    expect(toConsultLookSessionDTO(BOOKING_ANCHORED)).toBeNull()
  })
})

describe('toConsultSessionLookupDTO (by consult id — either anchor)', () => {
  it('serves a booking-anchored consult as the booking DTO', () => {
    expect(toConsultSessionLookupDTO(BOOKING_ANCHORED)).toMatchObject({
      bookingId: 'booking_1',
    })
  })

  it('serves a look-anchored consult as the look DTO (the Book the Look regression)', () => {
    expect(toConsultSessionLookupDTO(LOOK_ANCHORED)).toMatchObject({
      lookPostId: 'look_1',
      status: 'CONSENT_REQUIRED',
    })
  })

  it('is null only for a row with neither anchor', () => {
    expect(toConsultSessionLookupDTO(row())).toBeNull()
  })
})
