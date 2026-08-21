import { describe, expect, it, vi } from 'vitest'

import { buildClientIdempotencyKey } from '@/lib/idempotency/client'

// The hold key's `action` is built inline at two call sites (the booking drawer
// and the opening claim). Both encode every field that distinguishes the
// request, and this pins WHY: the key buckets on 60 seconds, and the server
// answers a key reused with a different body with 409. So if two different
// slots collapsed to one key, a client picking a second time within the minute
// would be refused mid-booking. That is a worse bug than the double-tap this
// whole change exists to fix.
function holdAction(parts: Array<string | null>): string {
  return parts.map((p) => p ?? '').join('|')
}

function key(action: string, offeringId = 'offering_1'): string {
  return buildClientIdempotencyKey({ scope: 'hold', entityId: offeringId, action })
}

describe('the hold idempotency key', () => {
  it('is stable for the same slot — that is what makes a double-tap a replay', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T12:00:00.000Z'))

    const a = key(holdAction(['2026-08-22T17:00:00.000Z', 'SALON', 'loc_1', '', '']))
    const b = key(holdAction(['2026-08-22T17:00:00.000Z', 'SALON', 'loc_1', '', '']))

    expect(a).toBe(b)
    vi.useRealTimers()
  })

  it('differs for a different TIME', () => {
    expect(key(holdAction(['2026-08-22T17:00:00.000Z', 'SALON', 'loc_1', '', '']))).not.toBe(
      key(holdAction(['2026-08-22T18:00:00.000Z', 'SALON', 'loc_1', '', ''])),
    )
  })

  it('differs for a different LOCATION TYPE', () => {
    expect(key(holdAction(['2026-08-22T17:00:00.000Z', 'SALON', 'loc_1', '', '']))).not.toBe(
      key(holdAction(['2026-08-22T17:00:00.000Z', 'MOBILE', '', 'addr_1', ''])),
    )
  })

  it('differs for a different SALON location', () => {
    expect(key(holdAction(['2026-08-22T17:00:00.000Z', 'SALON', 'loc_1', '', '']))).not.toBe(
      key(holdAction(['2026-08-22T17:00:00.000Z', 'SALON', 'loc_2', '', ''])),
    )
  })

  it('differs for a different MOBILE address', () => {
    expect(key(holdAction(['2026-08-22T17:00:00.000Z', 'MOBILE', '', 'addr_1', '']))).not.toBe(
      key(holdAction(['2026-08-22T17:00:00.000Z', 'MOBILE', '', 'addr_2', ''])),
    )
  })

  it('differs for a reschedule of a different booking', () => {
    expect(key(holdAction(['2026-08-22T17:00:00.000Z', 'SALON', 'loc_1', '', 'bk_1']))).not.toBe(
      key(holdAction(['2026-08-22T17:00:00.000Z', 'SALON', 'loc_1', '', 'bk_2'])),
    )
  })

  it('differs for a different OFFERING', () => {
    const action = holdAction(['2026-08-22T17:00:00.000Z', 'SALON', 'loc_1', '', ''])
    expect(key(action, 'offering_1')).not.toBe(key(action, 'offering_2'))
  })
})
