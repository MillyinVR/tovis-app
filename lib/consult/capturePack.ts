// lib/consult/capturePack.ts
//
// The hair pack's historical entry point. The pack itself now lives in
// lib/consult/capture/packs/hairColorDaylight.ts beside the other families'
// packs, resolved per session through lib/consult/capture/registry.ts. These
// exports keep their exact values for the callers and tests that still name
// the hair pack directly; new code resolves the pack from the session's
// service profile (lib/consult/serviceProfile.ts).

export {
  HAIR_COLOR_CAPTURE_PACK,
  HAIR_COLOR_CAPTURE_PACK_ID,
  HAIR_COLOR_CAPTURE_PACK_VERSION,
  HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
  HAIR_COLOR_CAPTURE_SHOT_KEYS,
  isHairColorCaptureShotKey,
  type HairColorCaptureShotKey,
} from './capture/packs/hairColorDaylight'

export const CONSULT_CAPTURE_MAX_BYTES = 5_000_000
