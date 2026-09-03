import { describe, expect, it } from 'vitest'

import { defaultClientConsultCaptureCopy } from '@/lib/brand/defaultClientConsultCaptureCopy'
import { AREA_CAPTURE_PACK } from '@/lib/consult/capture/packs/areaDaylight'
import { FACE_CAPTURE_PACK } from '@/lib/consult/capture/packs/faceDaylight'
import { HAIR_COLOR_CAPTURE_PACK } from '@/lib/consult/capture/packs/hairColorDaylight'

import { describeConsultCapturePack, formatConsultCaptureIntro } from './captureCopy'

const copy = defaultClientConsultCaptureCopy

describe('formatConsultCaptureIntro', () => {
  it('reads the hair pack exactly as the pilot copy did', () => {
    expect(formatConsultCaptureIntro(copy, HAIR_COLOR_CAPTURE_PACK)).toBe(
      'Seven daylight photos: four of your hair and three of your face. Each one is checked right away, and if one can’t be used you’ll see why. You can run the analysis without all seven — anything the missing photos would have shown just comes back as unknown.',
    )
  })

  it('names the face pack’s three views and its own count', () => {
    const intro = formatConsultCaptureIntro(copy, FACE_CAPTURE_PACK)
    expect(intro).toMatch(/^Three daylight photos: three of your face\./)
    expect(intro).toContain('without all three')
    expect(intro).not.toContain('hair')
    expect(intro).not.toContain('seven')
  })

  it('describes the area pack by what it photographs, not by hair', () => {
    const intro = formatConsultCaptureIntro(copy, AREA_CAPTURE_PACK)
    expect(intro).toMatch(
      /^Three daylight photos: the area you’d like treated, and your face\./,
    )
    expect(intro).toContain('without all three')
    expect(intro).not.toContain('hair')
  })

  it('counts views off the shot keys, never the pack id', () => {
    expect(describeConsultCapturePack(HAIR_COLOR_CAPTURE_PACK)).toEqual({
      total: 7,
      hair: 4,
      face: 3,
      area: 0,
    })
    expect(describeConsultCapturePack(AREA_CAPTURE_PACK)).toEqual({
      total: 3,
      hair: 0,
      face: 1,
      area: 2,
    })
  })

  it('falls back to digits past ten so a large future pack still reads', () => {
    const shots = Array.from({ length: 12 }, (_, index) => ({
      key: 'face_front' as const,
      title: `View ${index}`,
      instruction: '',
      requirement: 'REQUIRED' as const,
    }))
    expect(formatConsultCaptureIntro(copy, { shots })).toMatch(/^12 daylight photos/)
  })
})
