// lib/licensing/caDcaLicense.ts
//
// Shared handling for CA DCA (BreEZe) license lookups: how a license number is
// normalized before it is sent or compared, and how a license record is pulled
// out of a BreEZe search payload.
//
// Both the signup verifier (app/api/v1/auth/register) and the standalone
// verify endpoint (app/api/v1/pro-license/verify) go through here, so the two
// cannot drift apart on what counts as a match or as a readable record.

import { isRecord, type UnknownRecord } from '@/lib/guards'

/* =========================================================
   License numbers
========================================================= */

/**
 * Physical CA BBC licenses carry a letter prefix identifying the license type
 * (C cosmetologist, B barber, E esthetician, N nail technician, …), but BreEZe
 * keys on the numeric portion only. The Board's own instructions are explicit:
 * "the license number will not include the letter(s) in your license, only the
 * numbers", and for establishments "do not include the letter A".
 * https://www.barbercosmo.ca.gov/forms_pubs/publications/faqs.shtml
 *
 * So a pro reading "C123456" off their card and DCA answering "123456" are
 * naming the same license. Everything below exists so that those two never read
 * as a mismatch.
 */

/** Uppercase and drop everything that is not a letter or a digit. */
function alnum(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * The form we send to BreEZe as `licNumber`: digits only when the value has the
 * usual "<letter prefix><digits>" shape, otherwise the alphanumeric form
 * unchanged — we don't mangle a shape we don't recognise.
 *
 * Leading zeros are deliberately NOT stripped here: a leading zero could be
 * part of the real number, and a query that misses now degrades to manual
 * review rather than to a rejection, so guessing buys nothing.
 */
export function dcaLicenseQueryNumber(raw: string): string {
  const s = alnum(raw)
  const withoutPrefix = /^[A-Z]+([0-9]+)$/.exec(s)
  return withoutPrefix?.[1] ?? s
}

/**
 * The comparison form. Prefix dropped and leading zeros stripped from the
 * numeric run, so "C123456", "123456", "0123456" and "c-123 456" all reduce to
 * the same value.
 *
 * Only ever used to compare two numbers — never to store or display one. What
 * the pro typed is what gets persisted.
 */
export function canonicalLicenseNumber(raw: string): string {
  const s = dcaLicenseQueryNumber(raw)
  return /^[0-9]+$/.test(s) ? s.replace(/^0+(?=[0-9])/, '') : s
}

/**
 * True only when both sides reduce to the same non-empty canonical number.
 * An empty/absent number on either side is never a match.
 */
export function licenseNumbersMatch(a: string, b: string): boolean {
  const left = canonicalLicenseNumber(a)
  const right = canonicalLicenseNumber(b)
  return left.length > 0 && left === right
}

/* =========================================================
   BreEZe search payloads
========================================================= */

export type DcaLicenseRecord = {
  /** As returned by DCA, uppercased. May be null if the record omits it. */
  licNumber: string | null
  /** Non-empty by construction — a record without one is not "well-formed". */
  statusCode: string
  expDate: string | null
  issueDate: string | null
}

function firstOf(value: unknown): unknown {
  return Array.isArray(value) && value.length ? value[0] : null
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s ? s : null
}

/**
 * Walk the one nested path BreEZe wraps every search answer in:
 * `licenseDetails[0].getFullLicenseDetail[0]`. Both the license record and the
 * licensee name hang off it, so the walk lives in exactly one place.
 */
function fullLicenseDetailOf(data: unknown): UnknownRecord | null {
  if (!isRecord(data)) return null

  const root = firstOf(data.licenseDetails)
  if (!isRecord(root)) return null

  const full = firstOf(root.getFullLicenseDetail)
  return isRecord(full) ? full : null
}

/**
 * Pull the single license record out of a BreEZe search payload.
 *
 * Returns `null` when the payload is not a well-formed BreEZe record — an empty
 * body, a 200-shaped gateway error page, and schema drift all land here, and
 * they are indistinguishable from each other. Callers MUST treat `null` as "we
 * do not know", never as "this pro is not licensed": there is no license number
 * on earth whose absence from a malformed response proves anything.
 *
 * A record is only well-formed if it carries a usable `primaryStatusCode`;
 * without a status there is nothing to decide CURRENT-ness from.
 */
export function parseDcaLicenseRecord(data: unknown): DcaLicenseRecord | null {
  const full = fullLicenseDetailOf(data)
  if (!full) return null

  const lic = firstOf(full.getLicenseDetails)
  if (!isRecord(lic)) return null

  const statusCode = stringOrNull(lic.primaryStatusCode)
  if (!statusCode) return null

  const licNumber = stringOrNull(lic.licNumber)

  return {
    licNumber: licNumber ? licNumber.toUpperCase() : null,
    statusCode,
    expDate: stringOrNull(lic.expDate),
    issueDate: stringOrNull(lic.issueDate),
  }
}

export type DcaNameDetails = {
  firstName: string | null
  lastName: string | null
}

/**
 * The licensee name attached to the same search answer. Government record PII —
 * only surface it to a caller entitled to see it.
 */
export function parseDcaNameDetails(data: unknown): DcaNameDetails | null {
  const full = fullLicenseDetailOf(data)
  if (!full) return null

  const nameRoot = firstOf(full.getNameDetails)
  if (!isRecord(nameRoot)) return null

  const nameBlock = firstOf(nameRoot.individualNameDetails)
  if (!isRecord(nameBlock)) return null

  return {
    firstName: stringOrNull(nameBlock.firstName),
    lastName: stringOrNull(nameBlock.lastName),
  }
}

/** DCA reports a live license as some variant of "CURRENT". */
export function isCurrentStatusCode(statusCode: string): boolean {
  return statusCode.toUpperCase().includes('CURRENT')
}
