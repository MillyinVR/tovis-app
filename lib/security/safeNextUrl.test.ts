// lib/security/safeNextUrl.test.ts
import { describe, expect, it } from 'vitest'

import { nextUrlFromPayloadJson, safeNextUrl } from './safeNextUrl'

describe('safeNextUrl', () => {
  it('accepts a relative same-origin path', () => {
    expect(safeNextUrl('/pro/calendar')).toBe('/pro/calendar')
  })

  it('trims surrounding whitespace', () => {
    expect(safeNextUrl('  /looks  ')).toBe('/looks')
  })

  it('rejects non-string values', () => {
    expect(safeNextUrl(null)).toBeNull()
    expect(safeNextUrl(undefined)).toBeNull()
    expect(safeNextUrl(42)).toBeNull()
    expect(safeNextUrl({ nextUrl: '/looks' })).toBeNull()
  })

  it('rejects empty and whitespace-only strings', () => {
    expect(safeNextUrl('')).toBeNull()
    expect(safeNextUrl('   ')).toBeNull()
  })

  it('rejects external URLs', () => {
    expect(safeNextUrl('https://evil.example.com/phish')).toBeNull()
    expect(safeNextUrl('javascript:alert(1)')).toBeNull()
  })

  it('rejects protocol-relative URLs', () => {
    expect(safeNextUrl('//evil.example.com/phish')).toBeNull()
  })
})

describe('nextUrlFromPayloadJson', () => {
  it('extracts a safe nextUrl from a payload record', () => {
    expect(nextUrlFromPayloadJson({ nextUrl: '/pro/calendar' })).toBe('/pro/calendar')
  })

  it('returns null for non-record payloads', () => {
    expect(nextUrlFromPayloadJson(null)).toBeNull()
    expect(nextUrlFromPayloadJson('nope')).toBeNull()
    expect(nextUrlFromPayloadJson(['/looks'])).toBeNull()
  })

  it('returns null when nextUrl is missing or unsafe', () => {
    expect(nextUrlFromPayloadJson({})).toBeNull()
    expect(nextUrlFromPayloadJson({ nextUrl: 'https://evil.example.com' })).toBeNull()
    expect(nextUrlFromPayloadJson({ nextUrl: '//evil.example.com' })).toBeNull()
  })
})
