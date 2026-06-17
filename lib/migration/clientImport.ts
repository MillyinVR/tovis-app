// lib/migration/clientImport.ts
//
// Pure parse/normalize/validate layer for the pro client import. Takes raw CSV
// rows + a column mapping and produces normalized, validated rows ready to feed
// to upsertProClient (the single source of truth for client creation).
//
// Contact normalization reuses lib/security/contactNormalization — we do NOT
// reimplement email/phone rules here. Dedupe against the pro's existing clients
// is a DB concern handled server-side; this module is pure and unit-testable.

import { normalizeEmail, normalizePhone } from '@/lib/security/contactNormalization'

export type ClientImportField = 'firstName' | 'lastName' | 'email' | 'phone'

// Maps a logical field to the CSV header the pro chose for it.
export type ColumnMapping = Partial<Record<ClientImportField, string>>

export type RawCsvRow = Record<string, string>

export type ParsedClientRow = {
  firstName: string
  lastName: string
  email: string | null // normalized, or null
  phone: string | null // normalized E.164-ish, or null
}

export type ClientRowIssue =
  | 'MISSING_NAME'
  | 'MISSING_CONTACT'
  | 'INVALID_EMAIL'
  | 'INVALID_PHONE'

export type EvaluatedClientRow = {
  parsed: ParsedClientRow
  issues: ClientRowIssue[]
  importable: boolean
}

function readField(raw: RawCsvRow, mapping: ColumnMapping, field: ClientImportField): string {
  const header = mapping[field]
  if (!header) return ''
  const value = raw[header]
  return typeof value === 'string' ? value.trim() : ''
}

export function evaluateClientRow(
  raw: RawCsvRow,
  mapping: ColumnMapping,
): EvaluatedClientRow {
  const firstName = readField(raw, mapping, 'firstName')
  const lastName = readField(raw, mapping, 'lastName')
  const rawEmail = readField(raw, mapping, 'email')
  const rawPhone = readField(raw, mapping, 'phone')

  const email = rawEmail ? normalizeEmail(rawEmail) : null
  const phone = rawPhone ? normalizePhone(rawPhone) : null

  const issues: ClientRowIssue[] = []
  if (!firstName || !lastName) issues.push('MISSING_NAME')
  if (rawEmail && !email) issues.push('INVALID_EMAIL')
  if (rawPhone && !phone) issues.push('INVALID_PHONE')
  if (!email && !phone) issues.push('MISSING_CONTACT')

  // Mirrors upsertProClient's requirement: a name + at least one valid contact.
  const importable = Boolean(firstName) && Boolean(lastName) && Boolean(email || phone)

  return { parsed: { firstName, lastName, email, phone }, issues, importable }
}

export function evaluateClientRows(
  raws: RawCsvRow[],
  mapping: ColumnMapping,
): EvaluatedClientRow[] {
  return raws.map((raw) => evaluateClientRow(raw, mapping))
}

export type ClientImportSummary = {
  total: number
  importable: number
  missingName: number
  missingContact: number
  invalidContact: number
}

export function summarizeClientRows(rows: EvaluatedClientRow[]): ClientImportSummary {
  let importable = 0
  let missingName = 0
  let missingContact = 0
  let invalidContact = 0
  for (const row of rows) {
    if (row.importable) importable += 1
    if (row.issues.includes('MISSING_NAME')) missingName += 1
    if (row.issues.includes('MISSING_CONTACT')) missingContact += 1
    if (row.issues.includes('INVALID_EMAIL') || row.issues.includes('INVALID_PHONE'))
      invalidContact += 1
  }
  return { total: rows.length, importable, missingName, missingContact, invalidContact }
}
