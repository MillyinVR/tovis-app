// lib/consult/capture/packs/areaDaylight.ts
//
// The shot pack for every family whose subject is neither hair nor the face
// as a whole — NAILS, BODY and OTHER, including a family nobody has modelled
// yet. Two views of the treatment area (in context, then close) plus the
// front-facing face view the styling profile reads from. The two area keys are
// NEW wire values: the database CHECKs, the analysis evidence enum and the
// iOS shot-key decoder all learn them in the same slice.

import { defineShots, type ConsultCapturePackDefinition } from '../types'

import { FACE_FRONT_SHOT } from './hairColorDaylight'

export const AREA_CAPTURE_PACK_ID = 'area-daylight' as const
export const AREA_CAPTURE_PACK_VERSION = 1
export const AREA_CAPTURE_SCHEMA_VERSION = 1

export const AREA_CAPTURE_SHOT_KEYS = [
  'area_wide',
  'area_closeup',
  'face_front',
] as const

export const AREA_CAPTURE_PACK: ConsultCapturePackDefinition = Object.freeze({
  id: AREA_CAPTURE_PACK_ID,
  categorySlug: 'area',
  version: AREA_CAPTURE_PACK_VERSION,
  schemaVersion: AREA_CAPTURE_SCHEMA_VERSION,
  shots: defineShots([
    {
      key: 'area_wide',
      title: 'The area',
      instruction:
        'In indirect daylight, frame the whole area this service is for — both hands, the full brow line, the area of skin — so its shape and surroundings are visible. No filters.',
      requirement: 'REQUIRED',
      acceptance:
        'Accept only when the treatment area is clearly represented in full and in context, focus and exposure are usable, no beauty filter is apparent, and indirect daylight preserves color. Use VIEW_MISMATCH when the area is missing or mostly out of frame.',
      // "In context" — the surroundings are part of what is asked for, so
      // there is room in the frame and the light reading is the room's.
      framing: 'FULL_VIEW',
    },
    {
      key: 'area_closeup',
      title: 'Close up',
      instruction:
        'Move in close in indirect daylight so the surface, edges and current condition of the area fill the frame in sharp focus.',
      requirement: 'REQUIRED',
      acceptance:
        'Accept only when the treatment area fills most of the frame in sharp focus with its surface and edges visible, exposure is usable, no beauty filter is apparent, and indirect daylight preserves color. Use VIEW_MISMATCH when the close-up shows something else.',
      // "Fills most of the frame" — the same skin-filled close-up as the
      // eyes shot, for hands, brows or a patch of skin.
      framing: 'TIGHT_CROP',
    },
    FACE_FRONT_SHOT,
  ]),
})
