// lib/profiles/socialLinks.test.ts
import { describe, expect, it } from 'vitest'

import {
  instagramUrl,
  normalizeSocialHandle,
  normalizeWebsiteUrl,
  tiktokUrl,
} from './socialLinks'

describe('normalizeSocialHandle', () => {
  it('strips the leading @ and whitespace', () => {
    expect(normalizeSocialHandle('@tori.hair')).toBe('tori.hair')
    expect(normalizeSocialHandle('  tori_hair ')).toBe('tori_hair')
  })

  it('rejects empty, spaced, and out-of-charset input', () => {
    expect(normalizeSocialHandle('')).toBeNull()
    expect(normalizeSocialHandle('@')).toBeNull()
    expect(normalizeSocialHandle('tori hair')).toBeNull()
    expect(normalizeSocialHandle('tori/hair')).toBeNull()
    expect(normalizeSocialHandle('x'.repeat(31))).toBeNull()
  })
})

describe('normalizeWebsiteUrl', () => {
  it('prepends https:// when the scheme is missing', () => {
    expect(normalizeWebsiteUrl('toribeauty.com')).toBe('https://toribeauty.com/')
    expect(normalizeWebsiteUrl('http://toribeauty.com/book')).toBe(
      'http://toribeauty.com/book',
    )
  })

  it('rejects non-http schemes, dotless hosts, and empty input', () => {
    expect(normalizeWebsiteUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeWebsiteUrl('ftp://toribeauty.com')).toBeNull()
    expect(normalizeWebsiteUrl('localhost')).toBeNull()
    expect(normalizeWebsiteUrl('')).toBeNull()
    expect(normalizeWebsiteUrl(`https://${'x'.repeat(200)}.com`)).toBeNull()
  })
})

describe('deep links', () => {
  it('builds instagram and tiktok URLs from bare handles', () => {
    expect(instagramUrl('tori.hair')).toBe('https://instagram.com/tori.hair')
    expect(tiktokUrl('tori.hair')).toBe('https://www.tiktok.com/@tori.hair')
  })
})
