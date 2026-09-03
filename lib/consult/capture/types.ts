// lib/consult/capture/types.ts
//
// A capture (shot) pack as the SERVER owns it: the wire DTO the client renders
// (id, versions, shots with titles and instructions) plus what the wire never
// carries — the per-shot acceptance rule the vision gate is told
// (lib/consult/captureVision.ts). Every pack in lib/consult/capture/packs/ is
// one of these; the registry resolves one per service family.

import type {
  ConsultCaptureShotDTO,
  ConsultCaptureShotPackDTO,
} from '@/lib/dto/consult'

export type ConsultCaptureShotDefinition = ConsultCaptureShotDTO & {
  /**
   * The sentence the quality gate is given for this view: what must be
   * visible for the photo to be a usable input. Every rule ends on the
   * daylight / colour-fidelity requirement; that part is universal.
   */
  readonly acceptance: string
}

export type ConsultCapturePackDefinition = Readonly<
  Omit<ConsultCaptureShotPackDTO, 'shots'>
> & {
  readonly shots: readonly ConsultCaptureShotDefinition[]
}

/** Contextual typing for inline shot literals — keeps `requirement` a literal. */
export function defineShots(
  shots: readonly ConsultCaptureShotDefinition[],
): readonly ConsultCaptureShotDefinition[] {
  return Object.freeze([...shots])
}

export function capturePackShotKeys(
  pack: ConsultCapturePackDefinition,
): string[] {
  return pack.shots.map((shot) => shot.key)
}
