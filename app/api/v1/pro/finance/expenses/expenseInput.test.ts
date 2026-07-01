import { describe, expect, it } from 'vitest'

import { parseExpenseWriteInput } from './expenseInput'

const validBody = {
  category: 'SUPPLIES_PRODUCTS',
  amount: '187.40',
  label: 'CosmoProf order',
  date: '2026-04-03',
}

describe('parseExpenseWriteInput (create / requireAll)', () => {
  it('accepts a well-formed body and converts dollars to cents', () => {
    const result = parseExpenseWriteInput(validBody, { requireAll: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.category).toBe('SUPPLIES_PRODUCTS')
    expect(result.value.amountCents).toBe(18740)
    expect(result.value.label).toBe('CosmoProf order')
    expect(result.value.dateInput).toEqual({ year: 2026, month: 4, day: 3 })
  })

  it('accepts a numeric amount too', () => {
    const result = parseExpenseWriteInput(
      { ...validBody, amount: 187.4 },
      { requireAll: true },
    )
    expect(result.ok && result.value.amountCents).toBe(18740)
  })

  it('rejects an unknown category', () => {
    const result = parseExpenseWriteInput(
      { ...validBody, category: 'NOT_A_CATEGORY' },
      { requireAll: true },
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a missing category', () => {
    const { category: _omitted, ...withoutCategory } = validBody
    const result = parseExpenseWriteInput(withoutCategory, { requireAll: true })
    expect(result.ok).toBe(false)
  })

  it('rejects non-positive and absurd amounts', () => {
    expect(
      parseExpenseWriteInput({ ...validBody, amount: '0' }, { requireAll: true })
        .ok,
    ).toBe(false)
    expect(
      parseExpenseWriteInput(
        { ...validBody, amount: '-5' },
        { requireAll: true },
      ).ok,
    ).toBe(false)
    expect(
      parseExpenseWriteInput(
        { ...validBody, amount: '99999999' },
        { requireAll: true },
      ).ok,
    ).toBe(false)
  })

  it('rejects impossible calendar dates', () => {
    expect(
      parseExpenseWriteInput(
        { ...validBody, date: '2026-02-30' },
        { requireAll: true },
      ).ok,
    ).toBe(false)
    expect(
      parseExpenseWriteInput(
        { ...validBody, date: '04/03/2026' },
        { requireAll: true },
      ).ok,
    ).toBe(false)
  })

  it('requires all fields on create', () => {
    expect(
      parseExpenseWriteInput(
        { category: 'OTHER' },
        { requireAll: true },
      ).ok,
    ).toBe(false)
  })
})

describe('parseExpenseWriteInput (patch / partial)', () => {
  it('allows a subset of fields', () => {
    const result = parseExpenseWriteInput(
      { amount: '42.00' },
      { requireAll: false },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.amountCents).toBe(4200)
    expect(result.value.category).toBeUndefined()
  })

  it('treats null notes / receiptMediaId as an explicit clear', () => {
    const result = parseExpenseWriteInput(
      { notes: null, receiptMediaId: null },
      { requireAll: false },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.notes).toBeNull()
    expect(result.value.receiptMediaId).toBeNull()
  })

  it('rejects a non-record body', () => {
    expect(parseExpenseWriteInput(null, { requireAll: false }).ok).toBe(false)
    expect(parseExpenseWriteInput('nope', { requireAll: false }).ok).toBe(false)
  })
})
