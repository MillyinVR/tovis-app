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

/**
 * How much of the world a view is asking for — the property the quality gate
 * reads to decide how much a colour finding is worth on this shot.
 *
 * `FULL_VIEW` is a shot composed at arm's length or further: a head, a
 * profile, a whole treatment area in its surroundings. There is background in
 * the frame, so a warm or cast reading really is a reading of the ROOM, and
 * colour fidelity is the point of the photo. A cast is a rejection.
 *
 * `TIGHT_CROP` is a shot whose acceptance spec asks the subject to FILL the
 * frame — eyes and brows edge to edge, a nail bed or a patch of skin filling
 * the frame. There is almost no background left to read the light off, so the
 * average colour of that frame is mostly skin; a warm reading is as likely to
 * be the person as the lamp. Rejecting on it refuses a perfectly usable
 * close-up (bug B3). A cast is recorded as a WARNING on the accepted result
 * instead — unless the requested view is not visible, which is its own
 * rejection and outranks any colour finding.
 *
 * Required, not optional, so a new pack cannot forget to say which it is:
 * the compiler asks the question at the one place that knows the answer, the
 * shot's own spec. The gate never carries a list of keys.
 */
export type ConsultCaptureShotFraming = 'FULL_VIEW' | 'TIGHT_CROP'

export type ConsultCaptureShotDefinition = ConsultCaptureShotDTO & {
  /**
   * The sentence the quality gate is given for this view: what must be
   * visible for the photo to be a usable input. Every rule ends on the
   * daylight / colour-fidelity requirement; that part is universal.
   */
  readonly acceptance: string
  /** See `ConsultCaptureShotFraming`. Never on the wire; server-only. */
  readonly framing: ConsultCaptureShotFraming
}

/**
 * Is a colour finding on this view a rejection, or only a warning? The single
 * place the question is answered, derived from the shot's own spec.
 */
export function shotToleratesColorCast(
  shot: ConsultCaptureShotDefinition,
): boolean {
  return shot.framing === 'TIGHT_CROP'
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
