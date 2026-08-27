import type {
  ConsultCaptureShotDTO,
  ConsultCaptureShotPackDTO,
} from '@/lib/dto/consult'

// The pack id is a legacy-stable wire identifier pinned by the iOS contract
// fixtures (renaming it opens a cross-repo red window); `version: 2` is what
// marks this as the full-analysis pack.
export const HAIR_COLOR_CAPTURE_PACK_ID = 'hair-color-daylight' as const
export const HAIR_COLOR_CAPTURE_PACK_VERSION = 2
export const HAIR_COLOR_CAPTURE_SCHEMA_VERSION = 1

// Lives here (not captureStorage, which is server-only) because the browser
// wizard downscales photos against the same cap the storage boundary enforces.
// Mirrored by the DB CHECK constraints ("maxBytes"/"sizeBytes" BETWEEN 1 AND
// 5000000) and iOS ConsultService.maximumPhotoBytes.
export const CONSULT_CAPTURE_MAX_BYTES = 5_000_000

/**
 * Pack v2 (full-analysis): the four hair views from pack v1 plus three face
 * views. Order is the fixed evidence order the analysis engine sends to the
 * provider. The exported identifiers keep their HAIR_COLOR_ prefix so pack v2
 * did not have to rename every call site in the same change; the pack itself
 * is the full-analysis pack.
 */
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

function shot(
  key: HairColorCaptureShotKey,
  title: string,
  instruction: string,
): ConsultCaptureShotDTO {
  return {
    key,
    title,
    instruction,
    requirement: 'REQUIRED',
  }
}
/**
 * Full-analysis shot pack. The hair instructions reuse the approved camera
 * pack's framing; every view carries the daylight/color-fidelity requirement
 * because color observations (hair level and tone, undertone, contrast,
 * seasonal palette) are only trustworthy in unfiltered indirect daylight.
 */
export const HAIR_COLOR_CAPTURE_PACK: ConsultCaptureShotPackDTO = Object.freeze({
  id: HAIR_COLOR_CAPTURE_PACK_ID,
  categorySlug: 'hair-color',
  version: HAIR_COLOR_CAPTURE_PACK_VERSION,
  schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
  shots: Object.freeze([
    shot(
      'hair_back',
      'Hair back',
      'Face away from the camera in indirect daylight. Frame the full back canvas—color, roots, lengths, and ends—with sharp edges.',
    ),
    shot(
      'hair_left',
      'Left side',
      'Turn the left side toward the camera in indirect daylight. Show roots through ends without filters or warm indoor light.',
    ),
    shot(
      'hair_right',
      'Right side',
      'Turn the right side toward the camera in indirect daylight. Show roots through ends without filters or warm indoor light.',
    ),
    shot(
      'hair_crown',
      'Crown',
      'Angle the crown toward the camera in indirect daylight. Keep the roots, part, and surrounding hair sharp and fully visible.',
    ),
    shot(
      'face_front',
      'Face front',
      'Face the camera straight on in indirect daylight with a relaxed, neutral expression. Pull hair off your face so your hairline, brows, eyes, and jawline are fully visible. No filters.',
    ),
    shot(
      'face_side',
      'Profile',
      'Turn fully to one side in indirect daylight. Keep your profile—forehead, nose, lips, chin, and jawline—sharp and unobstructed, with hair tucked behind your ear.',
    ),
    shot(
      'eyes_closeup',
      'Eyes & brows',
      'Fill the frame with both eyes and brows, looking straight at the camera with eyes open, in indirect daylight. Keep lashes, lids, and full brows sharp.',
    ),
  ]),
})

const SHOT_KEYS = new Set<string>(HAIR_COLOR_CAPTURE_SHOT_KEYS)

export function isHairColorCaptureShotKey(
  value: unknown,
): value is HairColorCaptureShotKey {
  return typeof value === 'string' && SHOT_KEYS.has(value)
}
