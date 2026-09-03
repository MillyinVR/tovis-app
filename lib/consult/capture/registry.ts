// lib/consult/capture/registry.ts
//
// Every shot pack the consult can serve, resolved by SERVICE FAMILY
// (lib/consult/serviceProfile.ts): HAIR gets the seven-shot hair pack, the
// face families get the three face views, everything else — a family nobody
// has modelled yet included — gets the area pack. A pack id stored beside a
// capture is looked up here on read.
//
// The union of every pack's keys is what the database CHECKs, the analysis
// evidence enum and the vision gate's acceptance table are built from, so a
// new pack is registered in ONE place and those follow by construction.

import type { ConsultServiceFamily } from '@prisma/client'

import type { ConsultCaptureShotKeyDTO } from '@/lib/dto/consult'

import { AREA_CAPTURE_PACK } from './packs/areaDaylight'
import { FACE_CAPTURE_PACK } from './packs/faceDaylight'
import { HAIR_COLOR_CAPTURE_PACK } from './packs/hairColorDaylight'
import type {
  ConsultCapturePackDefinition,
  ConsultCaptureShotDefinition,
} from './types'

export const CONSULT_CAPTURE_PACKS: readonly ConsultCapturePackDefinition[] = [
  HAIR_COLOR_CAPTURE_PACK,
  FACE_CAPTURE_PACK,
  AREA_CAPTURE_PACK,
]

const PACKS_BY_ID = new Map(CONSULT_CAPTURE_PACKS.map((pack) => [pack.id, pack]))

const FACE_FAMILIES: ReadonlySet<ConsultServiceFamily> = new Set<ConsultServiceFamily>([
  'SKIN',
  'BROWS_LASHES',
  'MAKEUP',
])

/**
 * The colour category keeps the hair pack whatever family an admin files it
 * under — the same slug override the intake registry applies, so the two
 * packs a session serves can never disagree about what kind of service it is.
 */
export function resolveConsultCapturePack(args: {
  categorySlug: string
  family: ConsultServiceFamily
}): ConsultCapturePackDefinition {
  if (args.categorySlug === HAIR_COLOR_CAPTURE_PACK.categorySlug) {
    return HAIR_COLOR_CAPTURE_PACK
  }
  if (args.family === 'HAIR') return HAIR_COLOR_CAPTURE_PACK
  if (FACE_FAMILIES.has(args.family)) return FACE_CAPTURE_PACK
  return AREA_CAPTURE_PACK
}

export function findConsultCapturePack(
  packId: string,
): ConsultCapturePackDefinition | null {
  return PACKS_BY_ID.get(packId) ?? null
}

/**
 * Every shot key any pack uses, in a stable order: the hair pack's seven
 * first (the order the analysis engine has always sent), then the keys only
 * the area pack adds. This is the evidence-label vocabulary.
 */
export const CONSULT_ALL_CAPTURE_SHOT_KEYS: readonly ConsultCaptureShotKeyDTO[] = (() => {
  const keys: ConsultCaptureShotKeyDTO[] = []
  for (const pack of CONSULT_CAPTURE_PACKS) {
    for (const shot of pack.shots) {
      if (!keys.includes(shot.key)) keys.push(shot.key)
    }
  }
  return keys
})()

const ALL_SHOT_KEYS = new Set<string>(CONSULT_ALL_CAPTURE_SHOT_KEYS)

export function isConsultCaptureShotKey(
  value: unknown,
): value is ConsultCaptureShotKeyDTO {
  return typeof value === 'string' && ALL_SHOT_KEYS.has(value)
}

/** The largest pack: the ceiling on captures one analysis can consume. */
export const CONSULT_MAX_CAPTURE_SHOTS = Math.max(
  ...CONSULT_CAPTURE_PACKS.map((pack) => pack.shots.length),
)

/**
 * A shot's definition by key, whichever pack defines it. A key shared between
 * packs (the face views) is defined identically in each — the face pack reuses
 * the hair pack's shot objects — so the first match is the definition.
 */
export function findConsultCaptureShot(
  shotKey: string,
): ConsultCaptureShotDefinition | null {
  for (const pack of CONSULT_CAPTURE_PACKS) {
    const shot = pack.shots.find((candidate) => candidate.key === shotKey)
    if (shot) return shot
  }
  return null
}

/** Is this key one of the pack's slots? */
export function packHasShot(
  pack: ConsultCapturePackDefinition,
  shotKey: unknown,
): shotKey is ConsultCaptureShotKeyDTO {
  return (
    typeof shotKey === 'string' && pack.shots.some((shot) => shot.key === shotKey)
  )
}
