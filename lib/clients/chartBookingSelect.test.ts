import { describe, expect, it } from 'vitest'

import { RELATIONSHIP_BADGE_SELECT } from '@/lib/booking/relationshipLabel'
import { CHART_BOOKING_SELECT } from '@/lib/clients/chartBookingSelect'

// The chart's booking history is read by TWO surfaces — the web page and the
// native API — and they used to keep two hand-copied selects. They drifted: the
// API's copy never gained K5's `clientRelationshipLabel`, so the NR/NNR/RR/RNR
// mark rendered on web and could not exist on device at all. These pin the
// shared select's job so the same omission can't happen again silently.

describe('CHART_BOOKING_SELECT', () => {
  it('carries the relationship-badge snapshot column', () => {
    for (const column of Object.keys(RELATIONSHIP_BADGE_SELECT)) {
      expect(CHART_BOOKING_SELECT).toHaveProperty(column, true)
    }
  })

  it('carries the columns relationship intelligence derives from', () => {
    // computeRelationshipIntelligence reads lead time (scheduledFor − createdAt),
    // completion, ownership and money off these rows; dropping one degrades the
    // chart's tiles silently rather than failing.
    for (const column of [
      'scheduledFor',
      'createdAt',
      'finishedAt',
      'professionalId',
      'totalAmount',
      'subtotalSnapshot',
      'locationTimeZone',
      'status',
    ]) {
      expect(CHART_BOOKING_SELECT).toHaveProperty(column, true)
    }
  })

  it('does not select the client-relationship inputs it must never re-derive from', () => {
    // The mark is a per-booking SNAPSHOT. If this select ever grew `source` or a
    // history count, a read surface could start deriving the label live — which
    // is exactly what makes a third booking rewrite the first one's mark.
    expect(CHART_BOOKING_SELECT).not.toHaveProperty('source')
    expect(CHART_BOOKING_SELECT).not.toHaveProperty('discoveryProvenance')
  })
})
