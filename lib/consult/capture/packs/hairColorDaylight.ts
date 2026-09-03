// lib/consult/capture/packs/hairColorDaylight.ts
//
// The HAIR family's shot pack — the founder pilot's full-analysis pack, moved
// here UNCHANGED when the consult became service-aware. Its wire id
// ('hair-color-daylight'), version, keys, titles and instructions are pinned
// by stored ConsultCapture rows, by the database CHECKs and by the iOS
// contract fixtures, so a change here is a new pack version, never an edit.
//
// Four hair views plus three face views, in the fixed evidence order the
// analysis engine sends to the provider. Every view carries the
// daylight / colour-fidelity requirement because colour observations are only
// trustworthy in unfiltered indirect daylight.

import { defineShots, type ConsultCapturePackDefinition } from '../types'

export const HAIR_COLOR_CAPTURE_PACK_ID = 'hair-color-daylight' as const
export const HAIR_COLOR_CAPTURE_PACK_VERSION = 2
export const HAIR_COLOR_CAPTURE_SCHEMA_VERSION = 1

export const HAIR_COLOR_CAPTURE_SHOT_KEYS = [
  'hair_back',
  'hair_left',
  'hair_right',
  'hair_crown',
  'face_front',
  'face_side',
  'eyes_closeup',
] as const

export type HairColorCaptureShotKey =
  (typeof HAIR_COLOR_CAPTURE_SHOT_KEYS)[number]

export const FACE_FRONT_SHOT = {
  key: 'face_front',
  title: 'Face front',
  instruction:
    'Face the camera straight on in indirect daylight with a relaxed, neutral expression. Pull hair off your face so your hairline, brows, eyes, and jawline are fully visible. No filters.',
  requirement: 'REQUIRED',
  acceptance:
    'Accept only when one full front-facing face is clearly represented with hairline, brows, both eyes, and jawline visible and unobstructed, focus and exposure are usable, no beauty filter is apparent, and indirect daylight preserves color. Use VIEW_MISMATCH when the face is missing, obstructed, or not front-facing.',
} as const

export const FACE_SIDE_SHOT = {
  key: 'face_side',
  title: 'Profile',
  instruction:
    'Turn fully to one side in indirect daylight. Keep your profile—forehead, nose, lips, chin, and jawline—sharp and unobstructed, with hair tucked behind your ear.',
  requirement: 'REQUIRED',
  acceptance:
    'Accept only when a full side profile is clearly represented with forehead, nose, lips, chin, and jawline visible in silhouette, focus and exposure are usable, no beauty filter is apparent, and indirect daylight preserves color. Use VIEW_MISMATCH when the profile is missing or partial.',
} as const

export const EYES_CLOSEUP_SHOT = {
  key: 'eyes_closeup',
  title: 'Eyes & brows',
  instruction:
    'Fill the frame with both eyes and brows, looking straight at the camera with eyes open, in indirect daylight. Keep lashes, lids, and full brows sharp.',
  requirement: 'REQUIRED',
  acceptance:
    'Accept only when both open eyes and both full brows fill most of the frame in sharp focus, exposure is usable, no beauty filter is apparent, and indirect daylight preserves color. Use VIEW_MISMATCH when eyes or brows are cropped, closed, or obstructed.',
} as const

export const HAIR_COLOR_CAPTURE_PACK: ConsultCapturePackDefinition = Object.freeze({
  id: HAIR_COLOR_CAPTURE_PACK_ID,
  categorySlug: 'hair-color',
  version: HAIR_COLOR_CAPTURE_PACK_VERSION,
  schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
  shots: defineShots([
    {
      key: 'hair_back',
      title: 'Hair back',
      instruction:
        'Face away from the camera in indirect daylight. Frame the full back canvas—color, roots, lengths, and ends—with sharp edges.',
      requirement: 'REQUIRED',
      acceptance:
        'Accept only when the full back of the hair is clearly represented, the relevant hair and roots are sufficiently visible, focus and exposure are usable, and indirect daylight preserves color.',
    },
    {
      key: 'hair_left',
      title: 'Left side',
      instruction:
        'Turn the left side toward the camera in indirect daylight. Show roots through ends without filters or warm indoor light.',
      requirement: 'REQUIRED',
      acceptance:
        'Accept only when the left side of the hair is clearly represented, the relevant hair and roots are sufficiently visible, focus and exposure are usable, and indirect daylight preserves color.',
    },
    {
      key: 'hair_right',
      title: 'Right side',
      instruction:
        'Turn the right side toward the camera in indirect daylight. Show roots through ends without filters or warm indoor light.',
      requirement: 'REQUIRED',
      acceptance:
        'Accept only when the right side of the hair is clearly represented, the relevant hair and roots are sufficiently visible, focus and exposure are usable, and indirect daylight preserves color.',
    },
    {
      key: 'hair_crown',
      title: 'Crown',
      instruction:
        'Angle the crown toward the camera in indirect daylight. Keep the roots, part, and surrounding hair sharp and fully visible.',
      requirement: 'REQUIRED',
      acceptance:
        'Accept only when the crown, part, and surrounding roots are clearly represented, focus and exposure are usable, and indirect daylight preserves color.',
    },
    FACE_FRONT_SHOT,
    FACE_SIDE_SHOT,
    EYES_CLOSEUP_SHOT,
  ]),
})

const SHOT_KEYS = new Set<string>(HAIR_COLOR_CAPTURE_SHOT_KEYS)

export function isHairColorCaptureShotKey(
  value: unknown,
): value is HairColorCaptureShotKey {
  return typeof value === 'string' && SHOT_KEYS.has(value)
}
