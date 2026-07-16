// lib/migration/clientImport.test.ts

import { describe, expect, it } from 'vitest'

import {
  evaluateClientRow,
  evaluateClientRows,
  splitFullName,
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

describe('splitFullName', () => {
  it('splits first token from the rest', () => {
    expect(splitFullName('Jane Doe')).toEqual({ firstName: 'Jane', lastName: 'Doe' })
    expect(splitFullName('  Maria  Garcia Lopez ')).toEqual({
      firstName: 'Maria',
      lastName: 'Garcia Lopez',
    })
  })

  it('leaves lastName empty for a single token', () => {
    expect(splitFullName('Cher')).toEqual({ firstName: 'Cher', lastName: '' })
    expect(splitFullName('   ')).toEqual({ firstName: '', lastName: '' })
  })
})

describe('evaluateClientRow with a fullName mapping', () => {
  const FULL_MAP: ColumnMapping = { fullName: 'Name', email: 'Email' }

  it('derives first/last from the combined column', () => {
    const r = evaluateClientRow({ Name: 'Jane Q Doe', Email: 'jane@gmail.com' }, FULL_MAP)
    expect(r.parsed.firstName).toBe('Jane')
    expect(r.parsed.lastName).toBe('Q Doe')
    expect(r.importable).toBe(true)
  })

  it('flags a single-token combined name as missing', () => {
    const r = evaluateClientRow({ Name: 'Cher', Email: 'cher@gmail.com' }, FULL_MAP)
    expect(r.issues).toContain('MISSING_NAME')
    expect(r.importable).toBe(false)
  })

  it('prefers explicit first/last columns over the combined column', () => {
    const r = evaluateClientRow(
      { First: 'Maya', Last: 'Rodriguez', Name: 'Wrong Person', Email: 'maya@gmail.com' },
      { firstName: 'First', lastName: 'Last', fullName: 'Name', email: 'Email' },
    )
    expect(r.parsed.firstName).toBe('Maya')
    expect(r.parsed.lastName).toBe('Rodriguez')
  })

  it('fills only the missing half from the combined column', () => {
    const r = evaluateClientRow(
      { First: '', Last: '', Name: 'Jane Doe', Email: 'jane@gmail.com' },
      { firstName: 'First', lastName: 'Last', fullName: 'Name', email: 'Email' },
    )
    expect(r.parsed.firstName).toBe('Jane')
    expect(r.parsed.lastName).toBe('Doe')
    expect(r.importable).toBe(true)
  })
})
