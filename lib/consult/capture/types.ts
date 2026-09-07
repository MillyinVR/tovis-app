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
 * How much of the world a view is asking for.
 *
 * `FULL_VIEW` is a shot composed at arm's length or further: a head, a
 * profile, a whole treatment area in its surroundings. There is background in
 * the frame.
 *
 * `TIGHT_CROP` is a shot whose acceptance spec asks the subject to FILL the
 * frame — eyes and brows edge to edge, a nail bed or a patch of skin filling
 * the frame. There is almost no background left.
 *
 * 🔴 It no longer decides what a COLOUR finding costs. Until 2026-09-07 a warm
 * or cast reading rejected a `FULL_VIEW` and only warned on a `TIGHT_CROP`;
 * warm light now warns on every shot (Tori, 2026-09-07 — see
 * `CONSULT_COLOR_FINDING_WARNING_CODES`). What survives is what this property
 * always literally described: how much of the world the view asks for. Two
 * live readers — P3's on-device crop (it is on the wire as
 * `ConsultCaptureShotFramingDTO`) and the composition sentence the quality
 * gate is given, which helps it judge whether the requested VIEW is there.
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
 * analysis input first, so anything that leaves it UNREADABLE rejects it and
 * asks for a retake. A colour finding is no longer one of those things on any
 * shot — see `CONSULT_COLOR_FINDING_WARNING_CODES`.
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
  /** See `ConsultCaptureShotFraming`. On the wire, for P3's on-device crop. */
  readonly framing: ConsultCaptureShotFraming
  /** See `ConsultCaptureShotGate`. Never on the wire; server-only. */
  readonly gate: ConsultCaptureShotGate
}

/**
 * The two findings that describe the LIGHT rather than the photograph, and
 * never refuse a capture on any shot (Tori, 2026-09-07).
 *
 * 🔴 The rule this replaced rejected a warm reading on every `FULL_VIEW`. It
 * was defensible — colour fidelity really is the point of those frames — and
 * in practice it made the consult impossible to finish indoors: prod session
 * `cmtoma65j0002l9040bpit3v6` failed `face_front` FOUR times across two days
 * on `WARM_INDOOR_LIGHT`, in the same room where `eyes_closeup` passed thirty
 * seconds earlier carrying the same finding as a warning. A gate a client
 * cannot pass in her own home is not a quality bar, it is a wall.
 *
 * What replaces it is not "accept anything": the warning is still RECORDED, it
 * still reaches the analysis (which widens its confidence and can answer
 * UNKNOWN), it still reaches the pro brief, and the plan says so out loud when
 * most frames carried it. The client is told, and asked — not blocked.
 *
 * Rejection is now reserved for a frame that cannot be READ at all: the
 * subject or view missing, blur, or exposure past legibility.
 */
export const CONSULT_COLOR_FINDING_WARNING_CODES = [
  'WARM_INDOOR_LIGHT',
  'COLOR_CAST',
] as const

export function isConsultColorFindingCode(value: string): boolean {
  return CONSULT_COLOR_FINDING_WARNING_CODES.some(
    (candidate) => candidate === value,
  )
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
  // A GUIDED shot downgrades the two colour findings, on every framing.
  return isConsultColorFindingCode(warningCode)
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
