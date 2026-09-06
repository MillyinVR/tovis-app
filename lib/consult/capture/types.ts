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

/**
 * How much a quality finding COSTS on this shot — the second half of the
 * question `framing` started, and the one P7a needed a new answer to.
 *
 * `GUIDED` is the pack behaviour that has always shipped: the photo is an
 * analysis input first, so anything that makes it a worse input rejects it and
 * asks for a retake. `framing` still decides whether a colour finding is one of
 * those things (B3).
 *
 * `WARN_ONLY` is the early photo (P7a). It is taken at the spark, in bed, in
 * whatever light is on, from the camera or the roll, and its job is to unlock a
 * booking — not to be the colour evidence. So every finding that still leaves a
 * person in the frame rides along as a WARNING on an accepted capture, and only
 * an image with no readable subject at all is refused. `framing` is not
 * consulted: a cast is a warning here whatever the composition, because the
 * stage never asked for a composition.
 *
 * Required, not optional, so a new shot cannot forget to say which it is.
 */
export type ConsultCaptureShotGate = 'GUIDED' | 'WARN_ONLY'

export type ConsultCaptureShotDefinition = ConsultCaptureShotDTO & {
  /**
   * The sentence the quality gate is given for this view: what must be
   * visible for the photo to be a usable input. Every rule ends on the
   * daylight / colour-fidelity requirement; that part is universal.
   */
  readonly acceptance: string
  /** See `ConsultCaptureShotFraming`. Never on the wire; server-only. */
  readonly framing: ConsultCaptureShotFraming
  /** See `ConsultCaptureShotGate`. Never on the wire; server-only. */
  readonly gate: ConsultCaptureShotGate
}

/**
 * Is a colour finding on this view a rejection, or only a warning? The single
 * place the question is answered, derived from the shot's own spec.
 *
 * A `WARN_ONLY` shot tolerates a cast whatever its framing — see
 * `ConsultCaptureShotGate`.
 */
export function shotToleratesColorCast(
  shot: ConsultCaptureShotDefinition,
): boolean {
  return shot.gate === 'WARN_ONLY' || shot.framing === 'TIGHT_CROP'
}

/**
 * The ONE finding that still refuses a `WARN_ONLY` shot: there is no readable
 * subject in the frame at all.
 *
 * Deliberately not a list of "bad" codes. Blur, exposure, an odd crop and a
 * warm lamp are all things the early photo is expected to arrive with (Tori,
 * 2026-09-05) — they become warnings. `HAIR_NOT_VISIBLE` is a warning too: a
 * person under a hood is still a person the pro can book, and the guided pack
 * asks for hair properly later. Corrupt bytes and a provider moderation refusal
 * never reach here — both throw in `captureVision` before a row is written.
 */
export const CONSULT_WARN_ONLY_REJECTING_REASON_CODE = 'SUBJECT_NOT_VISIBLE'

/**
 * May a capture of this shot be ACCEPTED carrying this warning?
 *
 * The single answer, shared by the gate that produces a result
 * (`sanitizeConsultCaptureQuality`) and the write boundary that stores one
 * (`recordConsultCaptureQuality`). They asked the same question in two places
 * before; a `WARN_ONLY` shot made the two answers differ, and a boundary that
 * disagrees with its own gate refuses valid work with a 5xx.
 */
export function shotMayWarn(
  shot: ConsultCaptureShotDefinition,
  warningCode: string,
): boolean {
  if (warningCode === 'PASS') return false
  if (shot.gate === 'WARN_ONLY') {
    return warningCode !== CONSULT_WARN_ONLY_REJECTING_REASON_CODE
  }
  // A GUIDED shot downgrades the two colour findings, and only where a cast is
  // as likely to be the subject as the room.
  return (
    shotToleratesColorCast(shot) &&
    (warningCode === 'WARM_INDOOR_LIGHT' || warningCode === 'COLOR_CAST')
  )
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
