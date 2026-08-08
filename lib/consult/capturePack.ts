import type {
  ConsultCaptureShotDTO,
  ConsultCaptureShotPackDTO,
} from '@/lib/dto/consult'

export const HAIR_COLOR_CAPTURE_PACK_ID = 'hair-color-daylight' as const
export const HAIR_COLOR_CAPTURE_PACK_VERSION = 1
export const HAIR_COLOR_CAPTURE_SCHEMA_VERSION = 1

export const HAIR_COLOR_CAPTURE_SHOT_KEYS = [
  'hair_back',
  'hair_left',
  'hair_right',
  'hair_crown',
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
 * Founder-pilot shot pack. The back instruction reuses the approved camera
 * pack's "Back canvas" framing; every view adds the daylight/color-fidelity
 * requirement that is specific to hair-color analysis.
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
  ]),
})

const SHOT_KEYS = new Set<string>(HAIR_COLOR_CAPTURE_SHOT_KEYS)

export function isHairColorCaptureShotKey(
  value: unknown,
): value is HairColorCaptureShotKey {
  return typeof value === 'string' && SHOT_KEYS.has(value)
}
