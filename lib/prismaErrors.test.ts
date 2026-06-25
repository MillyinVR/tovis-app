// lib/prismaErrors.test.ts

import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  isExclusionConstraintError,
  isUniqueConstraintError,
} from './prismaErrors'

const CONSTRAINT = 'BookingHold_no_active_professional_overlap'

function knownError(message: string, code: string) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: 'test',
  })
}

function unknownError(message: string) {
  return new Prisma.PrismaClientUnknownRequestError(message, {
    clientVersion: 'test',
  })
}

describe('isUniqueConstraintError', () => {
  it('is true for a P2002 known request error', () => {
    expect(isUniqueConstraintError(knownError('dupe', 'P2002'))).toBe(true)
  })

  it('is false for other Prisma error codes', () => {
    expect(isUniqueConstraintError(knownError('fk', 'P2003'))).toBe(false)
  })

  it('is false for non-Prisma errors', () => {
    expect(isUniqueConstraintError(new Error('nope'))).toBe(false)
  })
})

describe('isExclusionConstraintError', () => {
  it('matches a known request error whose message names the constraint', () => {
    expect(
      isExclusionConstraintError(
        knownError(`conflicting key value violates exclusion constraint "${CONSTRAINT}"`, 'P2010'),
        CONSTRAINT,
      ),
    ).toBe(true)
  })

  it('matches an unknown request error whose message names the constraint', () => {
    expect(
      isExclusionConstraintError(
        unknownError(`exclusion violation on "${CONSTRAINT}"`),
        CONSTRAINT,
      ),
    ).toBe(true)
  })

  it('is false when the constraint name is absent from the message', () => {
    expect(
      isExclusionConstraintError(
        unknownError('some other database error'),
        CONSTRAINT,
      ),
    ).toBe(false)
  })

  it('does not cross-match a different constraint name', () => {
    expect(
      isExclusionConstraintError(
        unknownError('violates "Booking_no_active_professional_overlap"'),
        CONSTRAINT,
      ),
    ).toBe(false)
  })

  it('is false for plain Error and non-error values', () => {
    expect(isExclusionConstraintError(new Error(CONSTRAINT), CONSTRAINT)).toBe(
      false,
    )
    expect(isExclusionConstraintError(CONSTRAINT, CONSTRAINT)).toBe(false)
    expect(isExclusionConstraintError(null, CONSTRAINT)).toBe(false)
  })
})
