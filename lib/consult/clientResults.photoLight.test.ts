import { ConsultCaptureStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { photoLightFor } from './clientResults'

/**
 * The client reads this as a sentence about her own photographs ("2 of your 3
 * frames were shot in warm light"), so the count has to be the number of VIEWS
 * the reading stands on — not the number of rows the table happens to hold.
 */
describe('photoLightFor', () => {
  const frame = (
    shotKey: string,
    status: ConsultCaptureStatus,
    qualityWarningCode: string | null = null,
  ) => ({ shotKey, status, qualityWarningCode })

  it('counts accepted frames and ignores refused ones', () => {
    expect(
      photoLightFor([
        frame('hair_back', ConsultCaptureStatus.ACCEPTED, 'WARM_INDOOR_LIGHT'),
        frame('hair_left', ConsultCaptureStatus.ACCEPTED),
        frame('hair_right', ConsultCaptureStatus.REJECTED, null),
      ]),
    ).toEqual({ acceptedFrameCount: 2, warmFrameCount: 1, mostFramesWarm: false })
  })

  // 🔴 A REPLACED photo leaves its accepted row behind (purge-marked, then
  // purged). Counting both would tell her the reading saw two frames of one
  // view, and would keep calling her colour warm off the photograph she just
  // replaced. Newest first, one per view.
  it('keeps only the standing frame for a view that was replaced', () => {
    expect(
      photoLightFor([
        frame('early_photo', ConsultCaptureStatus.ACCEPTED),
        frame('early_photo', ConsultCaptureStatus.ACCEPTED, 'WARM_INDOOR_LIGHT'),
      ]),
    ).toEqual({ acceptedFrameCount: 1, warmFrameCount: 0, mostFramesWarm: false })
  })

  // And the other direction: a replacement that was REFUSED leaves her earlier
  // accepted photo standing, and it is still what the plan was read from.
  it('keeps the earlier accepted frame when the replacement was refused', () => {
    expect(
      photoLightFor([
        frame('early_photo', ConsultCaptureStatus.REJECTED),
        frame('early_photo', ConsultCaptureStatus.ACCEPTED, 'WARM_INDOOR_LIGHT'),
      ]),
    ).toEqual({ acceptedFrameCount: 1, warmFrameCount: 1, mostFramesWarm: true })
  })
})
