// lib/consult/prepBadge.ts
//
// P7a-4 — "does this booking's prep still owe the pro something?", as a badge.
//
// Two surfaces render this: the pro's bookings list / calendar card (the day-of
// flag) and the booking detail panel (the list of what is missing). One derived
// state so they cannot disagree — the same reason
// lib/booking/clientConfirmation.ts exists, and the same shape, so the pro's
// screens have one badge vocabulary rather than three.
//
// 🔴 It is NOT a database column. Prep completion is the answers, the pinned
// pack and the appointment, and those already exist; a stored flag would be a
// fourth copy that can go stale the moment a client answers a question.
//
// 🔴 `significant: false` means RENDER NOTHING. Most bookings have no consult
// at all, and a green "prep complete" pill on every appointment in the salon's
// day would be noise that teaches the pro to stop reading pills. Absence is the
// honest display for "there was nothing to prepare".

import type { BadgeTone } from '@/app/_components/ui'

import type { ConsultPrepState } from './prepDeadline'

/**
 * The display states.
 *
 * OVERDUE is separate from INCOMPLETE because the day-of rule is different, not
 * because the answers are: past the deadline the pro is the one who has to act
 * (reach out, or plan around not knowing), and the copy has to say so. Nothing
 * is blocked in either state — the handoff is explicit that an unanswered
 * safety question is "a looked-after moment, not a gate".
 */
export const CONSULT_PREP_BADGE_STATES = [
  'NO_CONSULT',
  'COMPLETE',
  'INCOMPLETE',
  'OVERDUE',
] as const

export type ConsultPrepBadgeState = (typeof CONSULT_PREP_BADGE_STATES)[number]

export type ConsultPrepBadge = {
  kind: ConsultPrepBadgeState
  /** The short display words — what a pill prints. */
  label: string
  /** Plain-words expansion for tooltips and screen readers (never a shape). */
  description: string
  tone: BadgeTone
  /** false = render nothing anywhere. See the module note. */
  significant: boolean
}

const PREP_BADGE_PRESENTATION: Record<
  ConsultPrepBadgeState,
  Omit<ConsultPrepBadge, 'kind'>
> = {
  NO_CONSULT: {
    label: 'No prep',
    description: 'This appointment has no consultation attached.',
    tone: 'neutral',
    significant: false,
  },
  COMPLETE: {
    label: 'Prep complete',
    description:
      'Your client has answered everything needed before the appointment.',
    tone: 'success',
    significant: true,
  },
  INCOMPLETE: {
    label: 'Prep incomplete',
    description:
      'Your client still has questions to answer before the appointment.',
    tone: 'warn',
    significant: true,
  },
  OVERDUE: {
    label: 'Prep overdue',
    description:
      'The questions were due and are still unanswered. The appointment is not blocked — reach out if you need the answers.',
    tone: 'danger',
    significant: true,
  },
}

function badgeOf(kind: ConsultPrepBadgeState): ConsultPrepBadge {
  return { kind, ...PREP_BADGE_PRESENTATION[kind] }
}

/**
 * Prep state → badge.
 *
 * `null` prep means no consult on this booking at all, which is the ordinary
 * case and renders nothing.
 *
 * A deadline that has passed makes an incomplete prep OVERDUE. A prep with no
 * deadline at all (booked-but-cancelled, or not yet booked) stays INCOMPLETE —
 * it cannot be late for an appointment that is not happening.
 */
export function deriveConsultPrepBadge(
  prep: ConsultPrepState | null,
  now = new Date(),
): ConsultPrepBadge {
  if (!prep) return badgeOf('NO_CONSULT')
  if (prep.complete) return badgeOf('COMPLETE')
  if (prep.deadlineAt && prep.deadlineAt.getTime() <= now.getTime()) {
    return badgeOf('OVERDUE')
  }
  return badgeOf('INCOMPLETE')
}
