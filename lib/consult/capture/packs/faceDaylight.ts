// lib/consult/capture/packs/faceDaylight.ts
//
// The shot pack for the face families — SKIN, BROWS_LASHES and MAKEUP. The
// three face views of the hair pack, byte-identical, and nothing else: a brow
// consult has no use for the back of the head, and reusing the hair pack's
// keys means no database CHECK, no analysis evidence key, and no shipped iOS
// decoder has to learn a new name for this family.

import { defineShots, type ConsultCapturePackDefinition } from '../types'

import {
  EYES_CLOSEUP_SHOT,
  FACE_FRONT_SHOT,
  FACE_SIDE_SHOT,
} from './hairColorDaylight'

export const FACE_CAPTURE_PACK_ID = 'face-daylight' as const
export const FACE_CAPTURE_PACK_VERSION = 1
export const FACE_CAPTURE_SCHEMA_VERSION = 1

export const FACE_CAPTURE_SHOT_KEYS = [
  'face_front',
  'face_side',
  'eyes_closeup',
] as const

export const FACE_CAPTURE_PACK: ConsultCapturePackDefinition = Object.freeze({
  id: FACE_CAPTURE_PACK_ID,
  categorySlug: 'face',
  version: FACE_CAPTURE_PACK_VERSION,
  schemaVersion: FACE_CAPTURE_SCHEMA_VERSION,
  shots: defineShots([FACE_FRONT_SHOT, FACE_SIDE_SHOT, EYES_CLOSEUP_SHOT]),
})
