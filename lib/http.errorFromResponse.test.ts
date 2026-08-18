// lib/http.errorFromResponse.test.ts
import { describe, expect, it } from 'vitest'

import { errorFromResponse, HTTP_STATUS_COPY } from '@/lib/http'

function res(status: number): Response {
  return new Response(null, { status })
}

describe('errorFromResponse', () => {
  it('prefers the payload error over every status branch', () => {
    expect(
      errorFromResponse(res(409), { error: 'That time was just taken.' }, {
        byStatus: { 409: 'never shown' },
        fallback: 'never shown either',
      }),
    ).toBe('That time was just taken.')
  })

  it('falls back to `message` when `error` is absent, and trims both', () => {
    expect(errorFromResponse(res(500), { message: '  internal detail  ' })).toBe(
      'internal detail',
    )
    expect(errorFromResponse(res(500), { error: '  spaced  ' })).toBe('spaced')
  })

  it('reads `error` BEFORE `message` — the wire carries both, and only `error` is written for a person', () => {
    // The booking envelope: jsonFail(status, userMessage, { …, message }).
    expect(
      errorFromResponse(res(409), {
        error: 'That time is no longer available.',
        message: 'TIME_BLOCKED: overlapping hold hld_123',
      }),
    ).toBe('That time is no longer available.')
  })

  it('treats an empty or whitespace-only error as absent', () => {
    expect(errorFromResponse(res(403), { error: '' })).toBe(
      'Request failed (403).',
    )
    expect(
      errorFromResponse(
        res(403),
        { error: '   ' },
        { byStatus: HTTP_STATUS_COPY },
      ),
    ).toBe(HTTP_STATUS_COPY[403])
  })

  it('uses byStatus only for the status actually returned', () => {
    const byStatus = { ...HTTP_STATUS_COPY, 409: 'Pick another time.' }
    expect(errorFromResponse(res(409), null, { byStatus })).toBe(
      'Pick another time.',
    )
    expect(errorFromResponse(res(401), null, { byStatus })).toBe(
      'Please log in to continue.',
    )
    // 418 is not in the map — the fallback takes over, not a neighbouring entry.
    expect(errorFromResponse(res(418), null, { byStatus })).toBe(
      'Request failed (418).',
    )
  })

  it('defaults the fallback to the status line, and honours an explicit one', () => {
    expect(errorFromResponse(res(500), null)).toBe('Request failed (500).')
    expect(
      errorFromResponse(res(500), null, { fallback: 'Could not save.' }),
    ).toBe('Could not save.')
  })

  it('survives a body that is not a record', () => {
    expect(errorFromResponse(res(400), undefined)).toBe('Request failed (400).')
    expect(errorFromResponse(res(400), 'plain text')).toBe(
      'Request failed (400).',
    )
    expect(errorFromResponse(res(400), ['nope'])).toBe('Request failed (400).')
  })

  it('ignores `userMessage`, which never reaches the wire under that key', () => {
    expect(
      errorFromResponse(res(409), { userMessage: 'internal name for the copy' }),
    ).toBe('Request failed (409).')
  })
})

describe('HTTP_STATUS_COPY', () => {
  it('is frozen, so a caller cannot mutate the shared map', () => {
    expect(Object.isFrozen(HTTP_STATUS_COPY)).toBe(true)
  })
})
