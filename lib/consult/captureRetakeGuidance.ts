// What a slot SAYS when the same photo is refused twice.
//
// 🔴 Why this exists. On 2026-09-07 a client retook `face_front` and reported
// that the retake "never finished" — the slot showed Uploading and then went
// back to exactly what it showed before. The chain was in fact perfect: fresh
// keys, a fresh paid verdict on the new bytes, a fresh row. The screen simply
// showed no EVIDENCE that it had happened. A second refusal that is
// byte-indistinguishable from the first reads as a broken app, not as an
// answer, and the client's next move is to press the same button again.
//
// So a repeat says three things a first attempt does not: which attempt this
// is, that the finding RECURRED ("this one's warm too"), and a DIFFERENT thing
// to try — because repeating the advice she has already followed is what makes
// it look like nothing was read.

import type { ConsultCaptureQualityReasonCodeDTO } from '@/lib/dto/consult'

/**
 * The short name of a finding, for the "this one's ___ too" sentence. Kept
 * separate from the full reason sentence: that one is a whole explanation and
 * cannot be dropped into the middle of another sentence.
 */
const REASON_SHORT_NAME: Readonly<
  Record<ConsultCaptureQualityReasonCodeDTO, string>
> = {
  PASS: 'fine',
  WARM_INDOOR_LIGHT: 'warm',
  COLOR_CAST: 'tinted',
  VIEW_MISMATCH: 'the wrong view',
  HAIR_NOT_VISIBLE: 'missing the hair',
  SUBJECT_NOT_VISIBLE: 'missing the view',
  BLURRY: 'blurry',
  TOO_DARK: 'dark',
  TOO_BRIGHT: 'bright',
  OTHER_QUALITY_FAILURE: 'not usable',
}

/**
 * A DIFFERENT next step for a finding that has now happened twice.
 *
 * Deliberately not the model's retake tip. That tip is regenerated per call and
 * genuinely differs in wording each time — but it is advice about the SAME
 * thing, and a client who has just followed it needs a different lever, not the
 * same lever rephrased. These are the levers.
 *
 * The two colour codes keep an entry because rejected rows carrying them exist
 * in production history; new ones cannot be written (they are warnings now).
 */
const REPEAT_NEXT_STEP: Readonly<
  Record<ConsultCaptureQualityReasonCodeDTO, string | null>
> = {
  PASS: null,
  WARM_INDOOR_LIGHT:
    'Try again near a window in daylight — indoor bulbs are warmer than they look.',
  COLOR_CAST:
    'Try again near a window in daylight, away from coloured walls or a lit screen.',
  VIEW_MISMATCH:
    'This view is hard to get alone — try asking someone to take it for you.',
  HAIR_NOT_VISIBLE:
    'Try pulling your hair forward over one shoulder so it is fully in frame.',
  SUBJECT_NOT_VISIBLE:
    'Try asking someone to take this one for you, or use a mirror and the back camera.',
  BLURRY:
    'Try resting your phone against something steady, then tap the screen to focus before you shoot.',
  TOO_DARK: 'Try turning on more light, or moving to a brighter room.',
  TOO_BRIGHT:
    'Try turning so the light falls ON you rather than behind you.',
  OTHER_QUALITY_FAILURE: 'Try once more from a little further back.',
}

export type ConsultSlotRetakeGuidance = {
  /** "Attempt 3" — null on the first attempt, because it adds nothing there. */
  attemptLabel: string | null
  /**
   * "This one's warm too." — only when the SAME finding refused the previous
   * attempt. Null on a first refusal, or when this refusal is a different one
   * (which is progress, and saying "too" would be wrong).
   */
  repeatedLine: string | null
  /**
   * What to try. The escalated lever on a repeat, otherwise the server's own
   * tip for this frame.
   */
  nextStep: string | null
}

/**
 * `attemptCount` is how many verdicts this slot has had INCLUDING this one, so
 * a first refusal is 1 and the label starts at 2.
 */
export function consultSlotRetakeGuidance(slot: {
  qualityReasonCode: ConsultCaptureQualityReasonCodeDTO | null
  previousReasonCode: ConsultCaptureQualityReasonCodeDTO | null
  retakeTip: string | null
  attemptCount: number
}): ConsultSlotRetakeGuidance {
  const reason = slot.qualityReasonCode
  const repeated =
    reason !== null &&
    reason !== 'PASS' &&
    slot.previousReasonCode === reason
  return {
    attemptLabel: slot.attemptCount > 1 ? `Attempt ${slot.attemptCount}` : null,
    repeatedLine: repeated
      ? `This one’s ${REASON_SHORT_NAME[reason]} too.`
      : null,
    // On a repeat the lever replaces the tip; otherwise the model's own
    // sentence, which is specific to the frame it actually looked at.
    nextStep: repeated
      ? REPEAT_NEXT_STEP[reason] ?? slot.retakeTip
      : slot.retakeTip,
  }
}
