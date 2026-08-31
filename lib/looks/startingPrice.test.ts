// lib/looks/startingPrice.test.ts

import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { COPY } from '@/lib/copy'
import { formatLookStartingPrice } from './startingPrice'

describe('formatLookStartingPrice', () => {
  it('composes the label from the brand copy table, never a hardcoded word', () => {
    expect(formatLookStartingPrice(250)).toBe(
      `${COPY.bookingConfirmation.priceFrom} $250`,
    )
  })

  it('never renders a bare figure — a look price is always a STARTING price', () => {
    const label = formatLookStartingPrice(250)
    expect(label).not.toBe('$250')
    expect(label?.startsWith(COPY.bookingConfirmation.priceFrom)).toBe(true)
  })

  it('rounds to whole dollars so every surface reads the same', () => {
    expect(formatLookStartingPrice(249.5)).toBe(
      `${COPY.bookingConfirmation.priceFrom} $250`,
    )
    expect(formatLookStartingPrice('249.49')).toBe(
      `${COPY.bookingConfirmation.priceFrom} $249`,
    )
  })

  it('groups thousands', () => {
    expect(formatLookStartingPrice(1250)).toBe(
      `${COPY.bookingConfirmation.priceFrom} $1,250`,
    )
  })

  it('accepts a Prisma.Decimal, the shape the look row carries', () => {
    expect(formatLookStartingPrice(new Prisma.Decimal('180'))).toBe(
      `${COPY.bookingConfirmation.priceFrom} $180`,
    )
  })

  it('returns null for an absent price', () => {
    expect(formatLookStartingPrice(null)).toBeNull()
    expect(formatLookStartingPrice(undefined)).toBeNull()
  })

  it('treats a non-positive price as no price — "From $0" is not a promise', () => {
    expect(formatLookStartingPrice(0)).toBeNull()
    expect(formatLookStartingPrice(-10)).toBeNull()
  })

  it('returns null for an unparseable price rather than a broken label', () => {
    expect(formatLookStartingPrice('not-a-price')).toBeNull()
  })
})
