// lib/consult/declineDepositSettlement.test.ts
//
// The sentence a pro reads back after deciding a declined client's deposit.
// This is where the original defect was VISIBLE — the screen said "you refunded
// her deposit of $X" whenever the REFUND button had been pressed, regardless of
// whether a cent had moved — so the copy is pinned by outcome here.

import { describe, expect, it } from 'vitest'

import {
  describeDeclineDepositSettlement,
  settlementFromRecord,
} from './declineDepositSettlement'

const CHARGE = 20000 // $200.00 up front: $180 deposit + $20 fee

describe('settlementFromRecord', () => {
  it('KEEP is always KEPT', () => {
    expect(settlementFromRecord({ choice: 'KEEP', refundedCents: 0 })).toBe('KEPT')
  })

  // 🔴 The reload path. A recorded REFUND whose money never moved must not read
  // back as a refund, however many times the page is loaded.
  it('REFUND with nothing returned is NOT_MOVED', () => {
    expect(settlementFromRecord({ choice: 'REFUND', refundedCents: 0 })).toBe(
      'NOT_MOVED',
    )
  })

  it('REFUND with cents returned is REFUNDED', () => {
    expect(settlementFromRecord({ choice: 'REFUND', refundedCents: 20000 })).toBe(
      'REFUNDED',
    )
  })
})

describe('describeDeclineDepositSettlement', () => {
  it('a kept deposit names the full charge', () => {
    const line = describeDeclineDepositSettlement({
      settlement: 'KEPT',
      refundedCents: 0,
      chargeCents: CHARGE,
    })

    expect(line).toContain('kept her deposit of')
    expect(line).toContain('$200.00')
  })

  it('a real refund names the cents that moved', () => {
    const line = describeDeclineDepositSettlement({
      settlement: 'REFUNDED',
      refundedCents: CHARGE,
      chargeCents: CHARGE,
    })

    expect(line).toBe('Recorded: you refunded her deposit of $200.00.')
  })

  // 🔴 The defect, stated as a test: this sentence must never claim a refund.
  it('a refund that moved nothing does not say a refund happened', () => {
    const line = describeDeclineDepositSettlement({
      settlement: 'NOT_MOVED',
      refundedCents: 0,
      chargeCents: CHARGE,
    })

    expect(line).not.toMatch(/you refunded her deposit of/)
    expect(line).toContain('No money moved')
    // …and it does not print an amount that never moved.
    expect(line).not.toContain('$200.00')
  })

  it('a partial refund names both numbers rather than the charge alone', () => {
    const line = describeDeclineDepositSettlement({
      settlement: 'REFUNDED',
      refundedCents: 5000,
      chargeCents: CHARGE,
    })

    expect(line).toContain('$50.00')
    expect(line).toContain('$200.00')
    expect(line).not.toBe('Recorded: you refunded her deposit of $200.00.')
  })
})
