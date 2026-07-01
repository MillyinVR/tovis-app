import { describe, expect, it } from 'vitest'

import { parseExpenseWriteInput, resolveExpenseAmount } from './expenseInput'

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

describe('parseExpenseWriteInput (mileage)', () => {
  it('accepts miles instead of amount on create', () => {
    const result = parseExpenseWriteInput(
      { category: 'MILEAGE', label: 'Drive to client', date: '2026-04-03', miles: '45' },
      { requireAll: true },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.miles).toBe(45)
    expect(result.value.amountCents).toBeUndefined()
  })

  it('rounds miles to one decimal and rejects junk', () => {
    const ok = parseExpenseWriteInput({ miles: 12.34 }, { requireAll: false })
    expect(ok.ok && ok.value.miles).toBe(12.3)
    expect(parseExpenseWriteInput({ miles: '-5' }, { requireAll: false }).ok).toBe(false)
    expect(parseExpenseWriteInput({ miles: 'abc' }, { requireAll: false }).ok).toBe(false)
  })
})

describe('resolveExpenseAmount', () => {
  it('computes the deduction from miles for a MILEAGE expense', () => {
    const r = resolveExpenseAmount({ category: 'MILEAGE', amountCents: undefined, miles: 100 })
    expect(r).toEqual({ ok: true, amountCents: 7250, mileageMiles: 100 })
  })

  it('uses the dollar amount (and clears miles) for a normal expense', () => {
    const r = resolveExpenseAmount({ category: 'SUPPLIES_PRODUCTS', amountCents: 4200, miles: undefined })
    expect(r).toEqual({ ok: true, amountCents: 4200, mileageMiles: null })
  })

  it('errors when neither miles nor amount is present', () => {
    expect(resolveExpenseAmount({ category: 'MILEAGE', amountCents: undefined, miles: undefined }).ok).toBe(false)
    expect(resolveExpenseAmount({ category: 'OTHER', amountCents: undefined, miles: undefined }).ok).toBe(false)
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
