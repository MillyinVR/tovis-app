import { ConsultServiceFamily } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { AREA_CAPTURE_PACK } from './packs/areaDaylight'
import { FACE_CAPTURE_PACK } from './packs/faceDaylight'
import { HAIR_COLOR_CAPTURE_PACK } from './packs/hairColorDaylight'
import {
  CONSULT_ALL_CAPTURE_SHOT_KEYS,
  CONSULT_CAPTURE_PACKS,
  CONSULT_MAX_CAPTURE_SHOTS,
  findConsultCapturePack,
  findConsultCaptureShot,
  isConsultCaptureShotKey,
  packHasShot,
  resolveConsultCapturePack,
} from './registry'

describe('consult capture registry', () => {
  it('keeps the hair pack byte-stable and registers the two family packs beside it', () => {
    expect(HAIR_COLOR_CAPTURE_PACK).toMatchObject({
      id: 'hair-color-daylight',
      categorySlug: 'hair-color',
      version: 2,
      schemaVersion: 1,
    })
    expect(HAIR_COLOR_CAPTURE_PACK.shots.map((shot) => shot.key)).toEqual([
      'hair_back',
      'hair_left',
      'hair_right',
      'hair_crown',
      'face_front',
      'face_side',
      'eyes_closeup',
    ])
    expect(CONSULT_CAPTURE_PACKS.map((pack) => pack.id)).toEqual([
      'hair-color-daylight',
      'face-daylight',
      'area-daylight',
    ])
    for (const pack of CONSULT_CAPTURE_PACKS) {
      expect(findConsultCapturePack(pack.id)).toBe(pack)
      expect(new Set(pack.shots.map((shot) => shot.key)).size).toBe(pack.shots.length)
      for (const shot of pack.shots) {
        expect(shot.requirement).toBe('REQUIRED')
        // Every rule ends on the daylight requirement — colour fidelity is universal.
        expect(shot.acceptance).toMatch(/indirect daylight preserves color/)
      }
    }
    expect(findConsultCapturePack('nowhere')).toBeNull()
  })

  it('resolves by family: hair → the hair pack, face families → face, everything else → area', () => {
    expect(
      resolveConsultCapturePack({ categorySlug: 'cuts', family: ConsultServiceFamily.HAIR }),
    ).toBe(HAIR_COLOR_CAPTURE_PACK)
    // The colour category keeps the hair pack whatever family it is filed under.
    expect(
      resolveConsultCapturePack({
        categorySlug: 'hair-color',
        family: ConsultServiceFamily.OTHER,
      }),
    ).toBe(HAIR_COLOR_CAPTURE_PACK)
    for (const family of [
      ConsultServiceFamily.SKIN,
      ConsultServiceFamily.BROWS_LASHES,
      ConsultServiceFamily.MAKEUP,
    ]) {
      expect(resolveConsultCapturePack({ categorySlug: 'x', family })).toBe(FACE_CAPTURE_PACK)
    }
    for (const family of [
      ConsultServiceFamily.NAILS,
      ConsultServiceFamily.BODY,
      ConsultServiceFamily.OTHER,
    ]) {
      expect(resolveConsultCapturePack({ categorySlug: 'x', family })).toBe(AREA_CAPTURE_PACK)
    }
  })

  it('the face pack reuses the hair pack’s face shots so no new key is minted for it', () => {
    expect(FACE_CAPTURE_PACK.shots.map((shot) => shot.key)).toEqual([
      'face_front',
      'face_side',
      'eyes_closeup',
    ])
    for (const shot of FACE_CAPTURE_PACK.shots) {
      expect(HAIR_COLOR_CAPTURE_PACK.shots).toContain(shot)
    }
    expect(AREA_CAPTURE_PACK.shots.map((shot) => shot.key)).toEqual([
      'area_wide',
      'area_closeup',
      'face_front',
    ])
  })

  it('exposes the union vocabulary, the largest pack, and per-key lookups', () => {
    expect(CONSULT_ALL_CAPTURE_SHOT_KEYS).toEqual([
      'hair_back',
      'hair_left',
      'hair_right',
      'hair_crown',
      'face_front',
      'face_side',
      'eyes_closeup',
      'area_wide',
      'area_closeup',
    ])
    expect(CONSULT_MAX_CAPTURE_SHOTS).toBe(7)
    expect(isConsultCaptureShotKey('area_wide')).toBe(true)
    expect(isConsultCaptureShotKey('hands_front')).toBe(false)
    expect(findConsultCaptureShot('area_closeup')?.title).toBe('Close up')
    expect(findConsultCaptureShot('face_front')?.title).toBe('Face front')
    expect(findConsultCaptureShot('nope')).toBeNull()
    expect(packHasShot(AREA_CAPTURE_PACK, 'hair_back')).toBe(false)
    expect(packHasShot(AREA_CAPTURE_PACK, 'face_front')).toBe(true)
    expect(packHasShot(HAIR_COLOR_CAPTURE_PACK, 'area_wide')).toBe(false)
  })
})
