import { describe, expect, it } from 'vitest'

import {
  HAIR_COLOR_CAPTURE_PACK,
  HAIR_COLOR_CAPTURE_PACK_VERSION,
  HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
  HAIR_COLOR_CAPTURE_SHOT_KEYS,
  isHairColorCaptureShotKey,
} from './capturePack'

describe('full-analysis capture pack', () => {
  it('pins one deterministic required daylight pack', () => {
    expect(HAIR_COLOR_CAPTURE_PACK).toMatchObject({
      id: 'hair-color-daylight',
      categorySlug: 'hair-color',
      version: HAIR_COLOR_CAPTURE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    })
    expect(HAIR_COLOR_CAPTURE_PACK_VERSION).toBe(2)
    expect(HAIR_COLOR_CAPTURE_SHOT_KEYS).toEqual([
      'hair_back',
      'hair_left',
      'hair_right',
      'hair_crown',
      'face_front',
      'face_side',
      'eyes_closeup',
    ])
    expect(HAIR_COLOR_CAPTURE_PACK.shots.map((shot) => shot.key)).toEqual(
      HAIR_COLOR_CAPTURE_SHOT_KEYS,
    )
    for (const shot of HAIR_COLOR_CAPTURE_PACK.shots) {
      expect(shot.requirement).toBe('REQUIRED')
      expect(shot.instruction.toLowerCase()).toContain('daylight')
    }
  })

  it('accepts only the seven stable slot identifiers', () => {
    for (const key of HAIR_COLOR_CAPTURE_SHOT_KEYS) {
      expect(isHairColorCaptureShotKey(key)).toBe(true)
    }
    expect(isHairColorCaptureShotKey('brows_front')).toBe(false)
    expect(isHairColorCaptureShotKey('hair_front')).toBe(false)
  })
})
