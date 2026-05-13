// lib/booking/closeoutBlockers.test.ts
import { describe, expect, it } from 'vitest'

import {
  CLOSEOUT_BLOCKER_CODES,
  getCloseoutBlockerDescription,
  getCloseoutBlockerDisplay,
  getCloseoutBlockerDisplays,
  getCloseoutBlockerLabel,
  hasCloseoutBlockers,
  isCloseoutBlockerCode,
  normalizeCloseoutBlockerCodes,
  type CloseoutBlockerCode,
} from './closeoutBlockers'

describe('lib/booking/closeoutBlockers', () => {
  it('recognizes known closeout blocker codes', () => {
    for (const code of CLOSEOUT_BLOCKER_CODES) {
      expect(isCloseoutBlockerCode(code)).toBe(true)
    }
  })

  it('rejects unknown blocker codes', () => {
    expect(isCloseoutBlockerCode('')).toBe(false)
    expect(isCloseoutBlockerCode('NOPE')).toBe(false)
    expect(isCloseoutBlockerCode('CHECKOUT_REQUIRED')).toBe(false)
    expect(isCloseoutBlockerCode(null)).toBe(false)
    expect(isCloseoutBlockerCode(undefined)).toBe(false)
    expect(isCloseoutBlockerCode(123)).toBe(false)
  })

  it('provides display copy for every blocker code', () => {
    for (const code of CLOSEOUT_BLOCKER_CODES) {
      const display = getCloseoutBlockerDisplay(code)

      expect(display.code).toBe(code)
      expect(display.label.trim().length).toBeGreaterThan(0)
      expect(display.description.trim().length).toBeGreaterThan(0)
      expect(display.actionLabel.trim().length).toBeGreaterThan(0)

      expect(getCloseoutBlockerLabel(code)).toBe(display.label)
      expect(getCloseoutBlockerDescription(code)).toBe(display.description)
    }
  })

  it('normalizes blocker code arrays by dropping unknown values and duplicates', () => {
    const normalized = normalizeCloseoutBlockerCodes([
      'PAYMENT_NOT_COLLECTED',
      'NOPE',
      'AFTER_PHOTOS_REQUIRED',
      'PAYMENT_NOT_COLLECTED',
      null,
      'CHECKOUT_NOT_COMPLETE',
    ])

    expect(normalized).toEqual([
      'PAYMENT_NOT_COLLECTED',
      'AFTER_PHOTOS_REQUIRED',
      'CHECKOUT_NOT_COMPLETE',
    ] satisfies CloseoutBlockerCode[])
  })

  it('returns display rows for valid blocker codes only', () => {
    const displays = getCloseoutBlockerDisplays([
      'AFTER_PHOTOS_REQUIRED',
      'NOPE',
      'PAYMENT_NOT_COLLECTED',
    ])

    expect(displays).toEqual([
      {
        code: 'AFTER_PHOTOS_REQUIRED',
        label: 'After photos required',
        description:
          'Add at least one after photo before this booking can be completed.',
        actionLabel: 'Add after photos',
      },
      {
        code: 'PAYMENT_NOT_COLLECTED',
        label: 'Payment not collected',
        description:
          'Collect or confirm payment before this booking can be completed.',
        actionLabel: 'Go to checkout',
      },
    ])
  })

  it('reports whether valid closeout blockers exist', () => {
    expect(hasCloseoutBlockers([])).toBe(false)
    expect(hasCloseoutBlockers(['NOPE'])).toBe(false)
    expect(hasCloseoutBlockers(['AFTERCARE_NOT_SENT'])).toBe(true)
  })
})