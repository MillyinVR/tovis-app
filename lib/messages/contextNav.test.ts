import { MessageThreadContextType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { resolveThreadContextNav } from './contextNav'

describe('resolveThreadContextNav', () => {
  it('links a BOOKING thread at its dual-role receipt, for either viewer', () => {
    for (const viewerIsThreadPro of [true, false]) {
      expect(
        resolveThreadContextNav({
          contextType: MessageThreadContextType.BOOKING,
          contextId: 'ctx_1',
          bookingId: 'bk_1',
          viewerIsThreadPro,
        }),
      ).toEqual({ href: '/booking/bk_1', cta: 'View booking' })
    }
  })

  it('drops the BOOKING link when the bookingId pointer was nulled', () => {
    expect(
      resolveThreadContextNav({
        contextType: MessageThreadContextType.BOOKING,
        contextId: 'ctx_1',
        bookingId: null,
        viewerIsThreadPro: false,
      }),
    ).toEqual({ href: null, cta: null })
  })

  it('links a PRO_PROFILE thread at the pro for a CLIENT viewer', () => {
    expect(
      resolveThreadContextNav({
        contextType: MessageThreadContextType.PRO_PROFILE,
        contextId: 'pro_1',
        bookingId: null,
        viewerIsThreadPro: false,
      }),
    ).toEqual({ href: '/professionals/pro_1', cta: 'View profile' })
  })

  // The reported bug: a PRO_PROFILE thread's contextId is the thread's own
  // professional, so this link pointed the viewing PRO at their own public
  // profile. Their counterparty is the client — reached via "View client chart",
  // not this link — so the pro gets no context link here at all.
  it('gives the thread PRO no "View profile" link — it would be their own', () => {
    expect(
      resolveThreadContextNav({
        contextType: MessageThreadContextType.PRO_PROFILE,
        contextId: 'pro_1',
        bookingId: null,
        viewerIsThreadPro: true,
      }),
    ).toEqual({ href: null, cta: null })
  })

  it('gives SERVICE / OFFERING / WAITLIST threads no link', () => {
    for (const contextType of [
      MessageThreadContextType.SERVICE,
      MessageThreadContextType.OFFERING,
      MessageThreadContextType.WAITLIST,
    ]) {
      expect(
        resolveThreadContextNav({
          contextType,
          contextId: 'ctx_1',
          bookingId: 'bk_1',
          viewerIsThreadPro: false,
        }),
      ).toEqual({ href: null, cta: null })
    }
  })

  it('escapes ids into the href', () => {
    expect(
      resolveThreadContextNav({
        contextType: MessageThreadContextType.BOOKING,
        contextId: 'ctx_1',
        bookingId: 'bk/1 2',
        viewerIsThreadPro: false,
      }).href,
    ).toBe('/booking/bk%2F1%202')
  })
})
