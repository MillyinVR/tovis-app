import { describe, expect, it } from 'vitest'

import { CHART_PHOTO_TAKE, chartPhotoWhere } from '@/lib/clients/chartPhotoQuery'

// The web timeline and the native chart read the same photos through this.
// Their hand-copied clauses had drifted, and one of the two divergences was an
// access-matrix hole rather than cosmetic — pin both.

describe('chartPhotoWhere', () => {
  const where = chartPhotoWhere({ clientId: 'client_1', proId: 'pro_1' })

  it('reads IMAGES only', () => {
    // The API had no mediaType filter, so a session VIDEO came back as a photo.
    expect(where.mediaType).toBe('IMAGE')
  })

  it('is scoped to this client, through the booking', () => {
    expect(where.booking).toEqual({ clientId: 'client_1' })
  })

  it("shows another pro's work ONLY once the client made the review public", () => {
    // The API's review branch was `{ reviewId: { not: null } }` with no
    // visibility condition: a review photo the client had NOT published was
    // readable on device by a pro who did not shoot it.
    expect(where.OR).toEqual([
      { professionalId: 'pro_1' },
      { visibility: 'PUBLIC', reviewId: { not: null } },
    ])
  })

  it('has one take ceiling for both surfaces', () => {
    expect(CHART_PHOTO_TAKE).toBe(500)
  })
})
