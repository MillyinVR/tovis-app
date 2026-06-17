// lib/migration/clientImport.test.ts

import { describe, expect, it } from 'vitest'

import {
  evaluateClientRow,
  evaluateClientRows,
  summarizeClientRows,
  type ColumnMapping,
  type RawCsvRow,
} from './clientImport'

const MAP: ColumnMapping = {
  firstName: 'First',
  lastName: 'Last',
  email: 'Email',
  phone: 'Phone',
}

function row(over: Partial<RawCsvRow> = {}): RawCsvRow {
  return { First: 'Maya', Last: 'Rodriguez', Email: 'maya@gmail.com', Phone: '(415) 555-0172', ...over }
}

describe('evaluateClientRow', () => {
  it('accepts a complete row and normalizes contact', () => {
    const r = evaluateClientRow(row(), MAP)
    expect(r.importable).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.parsed.firstName).toBe('Maya')
    expect(r.parsed.email).toBe('maya@gmail.com')
    expect(r.parsed.phone).toBe('+14155550172') // E.164 via normalizePhone
  })

  it('trims whitespace from fields', () => {
    const r = evaluateClientRow(row({ First: '  Maya  ', Email: '  MAYA@GMAIL.COM ' }), MAP)
    expect(r.parsed.firstName).toBe('Maya')
    expect(r.parsed.email).toBe('maya@gmail.com')
  })

  it('flags a missing name and is not importable', () => {
    const r = evaluateClientRow(row({ Last: '' }), MAP)
    expect(r.issues).toContain('MISSING_NAME')
    expect(r.importable).toBe(false)
  })

  it('flags an invalid email but stays importable when phone is valid', () => {
    const r = evaluateClientRow(row({ Email: 'not-an-email' }), MAP)
    expect(r.issues).toContain('INVALID_EMAIL')
    expect(r.parsed.email).toBeNull()
    expect(r.importable).toBe(true) // valid phone still present
  })

  it('flags missing contact when neither email nor phone is usable', () => {
    const r = evaluateClientRow(row({ Email: '', Phone: '' }), MAP)
    expect(r.issues).toContain('MISSING_CONTACT')
    expect(r.importable).toBe(false)
  })

  it('is importable with phone only (no email column mapped)', () => {
    const r = evaluateClientRow(row({ Email: '' }), MAP)
    expect(r.parsed.email).toBeNull()
    expect(r.parsed.phone).toBe('+14155550172')
    expect(r.importable).toBe(true)
  })
})

describe('summarizeClientRows', () => {
  it('counts importable and issue buckets', () => {
    const rows = evaluateClientRows(
      [
        row(),
        row({ Last: '' }), // missing name
        row({ Email: '', Phone: '' }), // missing contact
        row({ Phone: 'abc' }), // invalid phone (email still valid → importable)
      ],
      MAP,
    )
    const s = summarizeClientRows(rows)
    expect(s.total).toBe(4)
    expect(s.importable).toBe(2) // complete row + invalid-phone-but-valid-email row
    expect(s.missingName).toBe(1)
    expect(s.missingContact).toBe(1)
    expect(s.invalidContact).toBe(1)
  })
})
