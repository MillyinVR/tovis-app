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
import { shotMayWarn } from './types'

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
      // P7a-1: a member of no pack, but a stored capture and an analysis
      // input, so it is part of the evidence vocabulary. Appended last so the
      // hair pack's seven keep the order the analysis engine has always sent.
      'early_photo',
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

  // B3. The gate must not carry a list of close-up keys, and the flag must not
  // drift away from the sentence it is a summary of: a shot is a tight crop
  // exactly when its own acceptance rule asks the subject to FILL the frame.
  describe('shot framing', () => {
    const everyShot = CONSULT_CAPTURE_PACKS.flatMap((pack) => pack.shots)

    it('declares a framing on every registered shot', () => {
      for (const shot of everyShot) {
        expect(['FULL_VIEW', 'TIGHT_CROP']).toContain(shot.framing)
      }
    })

    it('marks TIGHT_CROP on exactly the shots whose acceptance rule asks the subject to fill the frame', () => {
      const askedToFill = everyShot
        .filter((shot) => /fills? most of the frame/.test(shot.acceptance))
        .map((shot) => shot.key)
      const tight = everyShot
        .filter((shot) => shot.framing === 'TIGHT_CROP')
        .map((shot) => shot.key)

      expect(new Set(tight)).toEqual(new Set(askedToFill))
      expect(new Set(tight)).toEqual(new Set(['eyes_closeup', 'area_closeup']))
    })

    it('names every full view — hair, face and the area in context', () => {
      const full = everyShot
        .filter((shot) => shot.framing === 'FULL_VIEW')
        .map((shot) => shot.key)
      expect(new Set(full)).toEqual(
        new Set([
          'hair_back',
          'hair_left',
          'hair_right',
          'hair_crown',
          'face_front',
          'face_side',
          'area_wide',
        ]),
      )
    })
  })

  // 2026-09-07: warm light and colour cast warn on EVERY shot. The old rule
  // split on `framing`, which made `face_front` unpassable in a warm-lit room
  // while `eyes_closeup` passed in the same minute (prod consult
  // cmtoma65j0002l9040bpit3v6, four refusals over two days).
  describe('colour findings never refuse a shot', () => {
    const everyShot = CONSULT_CAPTURE_PACKS.flatMap((pack) => pack.shots)

    it('lets every registered shot carry both colour findings as warnings', () => {
      for (const shot of everyShot) {
        expect(shotMayWarn(shot, 'WARM_INDOOR_LIGHT')).toBe(true)
        expect(shotMayWarn(shot, 'COLOR_CAST')).toBe(true)
      }
    })

    it('still refuses the unreadable frames on a guided shot', () => {
      const guided = everyShot.filter((shot) => shot.gate === 'GUIDED')
      expect(guided.length).toBeGreaterThan(0)
      for (const shot of guided) {
        for (const code of [
          'SUBJECT_NOT_VISIBLE',
          'VIEW_MISMATCH',
          'BLURRY',
          'TOO_DARK',
          'TOO_BRIGHT',
          'HAIR_NOT_VISIBLE',
          'OTHER_QUALITY_FAILURE',
        ]) {
          expect(shotMayWarn(shot, code)).toBe(false)
        }
      }
    })

    it('never treats PASS as a warning', () => {
      for (const shot of everyShot) {
        expect(shotMayWarn(shot, 'PASS')).toBe(false)
      }
    })
  })
})
