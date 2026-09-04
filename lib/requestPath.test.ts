// lib/requestPath.test.ts
import { describe, expect, it } from 'vitest'

import { pathWithQueryFromHeaders, pathnameFromHeaders } from './requestPath'

function h(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

describe('lib/requestPath', () => {
  describe('pathnameFromHeaders', () => {
    it('prefers x-pathname, then the legacy fallbacks, then the caller default', () => {
      expect(
        pathnameFromHeaders(
          h({ 'x-pathname': '/pro/calendar', 'next-url': '/pro/other' }),
          '/pro',
        ),
      ).toBe('/pro/calendar')

      expect(pathnameFromHeaders(h({ 'next-url': '/pro/services' }), '/pro')).toBe(
        '/pro/services',
      )

      expect(pathnameFromHeaders(h({}), '/pro')).toBe('/pro')
    })

    it('never carries the query string', () => {
      expect(
        pathnameFromHeaders(
          h({ 'x-pathname': '/pro/calendar', 'x-search': '?day=2026-09-03' }),
          '/pro',
        ),
      ).toBe('/pro/calendar')
    })
  })

  describe('pathWithQueryFromHeaders', () => {
    it('reassembles pathname + query', () => {
      expect(
        pathWithQueryFromHeaders(
          h({
            'x-pathname': '/client/bookings/booking_1',
            'x-search': '?step=aftercare',
          }),
          '/client',
        ),
      ).toBe('/client/bookings/booking_1?step=aftercare')
    })

    it('returns the bare path when there is no query', () => {
      expect(
        pathWithQueryFromHeaders(
          h({ 'x-pathname': '/client/bookings', 'x-search': '' }),
          '/client',
        ),
      ).toBe('/client/bookings')
    })

    it('ignores a query header that is not a query string', () => {
      expect(
        pathWithQueryFromHeaders(
          h({ 'x-pathname': '/client/bookings', 'x-search': 'step=aftercare' }),
          '/client',
        ),
      ).toBe('/client/bookings')
    })

    it('falls back when no header carries a pathname', () => {
      expect(pathWithQueryFromHeaders(h({ 'x-search': '?step=aftercare' }), '/client')).toBe(
        '/client',
      )
    })

    it('refuses a forged protocol-relative path rather than returning it', () => {
      expect(
        pathWithQueryFromHeaders(h({ 'x-current-path': '//evil.example' }), '/client'),
      ).toBe('/client')

      expect(
        pathWithQueryFromHeaders(
          h({ 'x-current-path': 'https://evil.example/x' }),
          '/client',
        ),
      ).toBe('/client')
    })
  })
})
