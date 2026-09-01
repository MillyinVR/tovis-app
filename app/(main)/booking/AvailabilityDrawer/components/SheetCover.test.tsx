// app/(main)/booking/AvailabilityDrawer/components/SheetCover.test.tsx
//
// The sheet's TITLE, which is the only thing this file decides.
//
// Tori, 2026-08-31 (riding B5): on the consult path a look with no name of its
// own must fall back to the brand copy table's "book this look" wording and
// NEVER to the service name — that is the one screen whose whole point is that
// the client is booking an outcome, and B1's rule is that a look never names
// the service that produced it. The named-service door keeps the service name
// it has always shown.
//
// The branch itself lives in `AvailabilityDrawer` (it is the component that
// knows whether there is a `consultId`); what is pinned here is that the cover
// renders exactly what it was handed, in the right order of preference.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import SheetCover from './SheetCover'

const trust = {
  verified: false,
  completedBookings: null,
  rating: null,
  freeCancellationHours: null,
} as const

function render(args: {
  lookName?: string | null
  title: string | null
}): string {
  return renderToStaticMarkup(
    <SheetCover
      cover={
        args.lookName === undefined
          ? null
          : {
              imageUrl: 'https://example.test/look.jpg',
              lookName: args.lookName,
            }
      }
      trust={trust}
      title={args.title}
      proName="Ada"
      proAvatarUrl={null}
      proHref="/professionals/pro_1"
      priceStartingAt={null}
      durationMinutes={null}
      onClose={() => {}}
      closeDisabled={false}
    />,
  )
}

describe('SheetCover title', () => {
  it("prefers the look's own name over anything the caller passed", () => {
    const html = render({ lookName: 'Autumn copper', title: 'Balayage' })
    expect(html).toContain('Autumn copper')
    expect(html).not.toContain('Balayage')
  })

  it('falls back to whatever title the drawer resolved', () => {
    // The consult path hands it the brand copy; the named-service path hands it
    // the service name. This component does not know which, and must not.
    expect(render({ lookName: null, title: 'Book this look' })).toContain(
      'Book this look',
    )
    expect(render({ lookName: null, title: 'Balayage' })).toContain('Balayage')
  })

  it('falls back once more when there is no title at all', () => {
    expect(render({ title: null })).toContain('Book an appointment')
  })
})
