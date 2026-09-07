// lib/consult/prepDeadline.ts
//
// P7a-4 — "are the safety answers in, and by when do they have to be?", asked
// once, for every surface that needs it.
//
// The Sept 5 flow moved the safety questions from before the BOOKING to before
// the CHAIR (docs/consult/tovis-ai-consult-handoff.md, "Safety answers exist
// before the chair, not before booking"). That is a strictly better offer to
// the client — she books the spark in bed and answers the serious questions
// when she has the room for them — but it only works if something makes the
// deadline real. Without one, "before the chair" degrades to "never", and the
// pro finds out in the chair that she is colouring over box dye.
//
// So this file owns three sentences and nothing else:
//
//   1. WHICH questions are the safety ones, per the pack version this session
//      is pinned to.
//   2. WHEN they are due — the appointment minus the category's N.
//   3. WHETHER they are in.
//
// Every consumer (the client's reminders, the pro's booking panel, the pro's
// day-of flag, the thread's "prep complete" bubble) reads this. That is
// deliberate: a client told she is done while her pro reads "prep incomplete"
// is the exact failure a shared plan exists to prevent.

import 'server-only'

import { BookingStatus, ConsultRevisionKind, Prisma } from '@prisma/client'

import { addElapsedHours } from '@/lib/time'

import { resolveConsultSessionIntakeState } from './intake/registry'
import type { ConsultIntakePackDefinition } from './intake/types'
import { CONSULT_OPEN_WINDOW_SELECT, consultLinkedBooking } from './openWindow'
import { CONSULT_NON_COLOR_TREATMENT_KEYS } from './safetyRouting'
import {
  CONSULT_SERVICE_PROFILE_CATEGORY_SELECT,
  resolveConsultServiceProfile,
} from './serviceProfile'

/**
 * The intake keys that are SAFETY keys, across every pack and every version.
 *
 * Keyed on the QUESTION rather than the pack, because that is how this repo's
 * safety rules already work: a kept question keeps its key and option values
 * byte-identical across versions, which is what lets one policy
 * (lib/consult/safetyFlags.ts) and one database mirror serve v2 and v3 alike
 * (lib/consult/intake/types.ts, `dietedIntakePack`). A set of keys therefore
 * needs no per-version maintenance — intersecting it with the pack the session
 * is PINNED to yields that version's safety questions and nothing else.
 *
 * The colour treatment-history keys are imported rather than retyped so the
 * two lists cannot drift.
 *
 * Per family, this resolves to:
 *   * hair-color v3 — box dye, lightening, henna/plant dye, other chemical,
 *     prior reaction (the five the P7a-4 brief names).
 *   * hair-color v2 (still pinned by production rows) — those five plus the
 *     perm, relaxer/texturizer and keratin questions v3 folded away.
 *   * hair-general v2 — chemical history, lightening, prior reaction.
 *   * general-service v2 — recent treatment timing, skin sensitivity, known
 *     allergies, prior reaction.
 */
export const CONSULT_PREP_SAFETY_QUESTION_KEYS: ReadonlySet<string> = new Set([
  // Every pack asks this one. It is the question that routes a patch test.
  'prior_reaction',
  // Colour chemistry: what is already on the hair.
  'box_dye_history',
  'prior_lightening',
  ...CONSULT_NON_COLOR_TREATMENT_KEYS,
  // hair-general's single folded treatment question.
  'chemical_history',
  // general-service (every non-hair family).
  'recent_treatment_timing',
  'skin_sensitivity',
  'known_allergies',
])

/**
 * Booking states that carry no prep deadline.
 *
 * CANCELLED and NO_SHOW mean the appointment is not going to happen, so there
 * is nothing to be ready for. COMPLETED and IN_PROGRESS are deliberately NOT
 * here: the deadline for an appointment that has already started is in the
 * past, which is exactly what the pro's day-of flag reads.
 */
const CONSULT_PREP_DEAD_BOOKING_STATUSES = new Set<BookingStatus>([
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
])

/**
 * One outstanding safety question, in the client's own words.
 *
 * The LABEL travels, not just the key: the pro's booking has to show "the
 * missing items", and a pro reading `henna_plant_dye_history` has been shown a
 * field name, not a question (the rule P5g's follow-up prompt spells out — an
 * internal code is never client- or pro-facing copy).
 */
export type ConsultPrepMissingItemDTO = {
  questionKey: string
  question: string
}

export type ConsultPrepState = {
  /**
   * When the safety answers are due — the appointment minus the category's N.
   *
   * Null means there is no appointment to measure from: the spark has not been
   * booked yet, or its booking was cancelled. Prep is not overdue in that
   * state, it is simply not yet on a clock.
   */
  deadlineAt: Date | null
  /** True once every safety question the pinned pack asks has an answer. */
  complete: boolean
  /** The outstanding ones, in pack order. Empty when `complete`. */
  missing: ConsultPrepMissingItemDTO[]
  /** How many safety questions this pack asks at all. */
  requiredCount: number
  /** The pack version the answers were counted against. */
  packId: string
  packVersion: number
}

/**
 * Everything the prep rule reads. Spread into a caller's select so a caller
 * cannot forget a field — the same discipline `CONSULT_OPEN_WINDOW_SELECT`
 * uses, and it includes that select because the deadline is measured from the
 * appointment `consultLinkedBooking` resolves.
 */
export const CONSULT_PREP_SESSION_SELECT = {
  ...CONSULT_OPEN_WINDOW_SELECT,
  id: true,
  // 🔴 WIDENS the anchor select's `serviceCategory: { select: { slug } }`.
  // The spread has to come FIRST and these overrides second: the profile needs
  // the family and the id, and a narrower select landing on top would resolve
  // every consult as if it had no category at all.
  serviceCategory: { select: CONSULT_SERVICE_PROFILE_CATEGORY_SELECT },
  // 🔴 Both booking selects are MERGED, not replaced — the same discipline
  // lib/consult/thread.ts uses on this select. `locationTimeZone` is added for
  // the reminders (a deadline is rendered as a date in the client's own zone,
  // and the appointment's zone is the one she is thinking in). Dropping the
  // spread here would silently take `status` and `scheduledFor` away from
  // `consultLinkedBooking`, which is the whole deadline.
  booking: {
    select: { ...CONSULT_OPEN_WINDOW_SELECT.booking.select, locationTimeZone: true },
  },
  inspiredBookings: {
    ...CONSULT_OPEN_WINDOW_SELECT.inspiredBookings,
    select: {
      ...CONSULT_OPEN_WINDOW_SELECT.inspiredBookings.select,
      locationTimeZone: true,
    },
  },
} satisfies Prisma.ConsultSessionSelect

export type ConsultPrepSession = Prisma.ConsultSessionGetPayload<{
  select: typeof CONSULT_PREP_SESSION_SELECT
}>

/**
 * The safety questions THIS pack asks, in the order the client meets them.
 *
 * Derived from the pack rather than listed per pack, so a pack version that
 * adds a safety question starts requiring it with no second edit, and one that
 * drops a question stops asking for an answer nobody will ever be shown a
 * field for.
 */
export function consultPrepSafetyQuestions(
  pack: ConsultIntakePackDefinition,
): ConsultIntakePackDefinition['questions'] {
  return pack.questions.filter((question) =>
    CONSULT_PREP_SAFETY_QUESTION_KEYS.has(question.key),
  )
}

/**
 * The deadline for one appointment instant, or null when there is none.
 *
 * Exported for the reminder planner, which needs the deadline before it has a
 * prep state to hang it on.
 */
export function consultPrepDeadlineAt(args: {
  scheduledFor: Date
  prepDeadlineHours: number
}): Date {
  return addElapsedHours(args.scheduledFor, -args.prepDeadlineHours)
}

/**
 * Prep state from a loaded session plus its intake revision payloads.
 *
 * The pure half, so every test can drive it without a database and so the
 * client thread, the pro panel and the reminder validator provably share one
 * rule rather than three that agree today.
 *
 * 🔴 `not-sure` COUNTS AS ANSWERED. The handoff makes "I don't remember" an
 * honest answer that hands the follow-up to the pro, and the safety policy
 * already maps it to a real outcome — `CHEMICAL_HISTORY_UNKNOWN`,
 * `REACTION_HISTORY_UNKNOWN`, and a routed strand test
 * (lib/consult/safetyRouting.ts, `hasUnknownChemicalHistory`). Treating it as
 * missing would nag a client who has told us the truth, and would hide from
 * the pro that the uncertainty is itself the finding.
 */
export function deriveConsultPrepState(args: {
  session: ConsultPrepSession
  /** INTAKE revision payloads, NEWEST FIRST. */
  intakePayloads: readonly unknown[]
}): ConsultPrepState {
  const profile = resolveConsultServiceProfile(args.session.serviceCategory)
  const { pack, payload } = resolveConsultSessionIntakeState(
    profile.intakePack,
    args.intakePayloads,
  )

  const answers = payload?.answers ?? {}
  const safetyQuestions = consultPrepSafetyQuestions(pack)
  const missing: ConsultPrepMissingItemDTO[] = []
  for (const question of safetyQuestions) {
    // An empty string is not an answer. `not-sure` is (see above).
    if (answers[question.key]) continue
    missing.push({ questionKey: question.key, question: question.label })
  }

  const booking = consultLinkedBooking(args.session)
  // No live appointment → no clock. `consultLinkedBooking` returns the booking
  // whatever became of it, so a CANCELLED one is filtered here rather than
  // producing a deadline for an appointment that will not happen.
  const deadlineAt =
    booking && !CONSULT_PREP_DEAD_BOOKING_STATUSES.has(booking.status)
      ? consultPrepDeadlineAt({
          scheduledFor: booking.scheduledFor,
          prepDeadlineHours: profile.prepDeadlineHours,
        })
      : null

  return {
    deadlineAt,
    complete: missing.length === 0,
    missing,
    requiredCount: safetyQuestions.length,
    packId: pack.id,
    packVersion: pack.version,
  }
}

/**
 * Prep state for one consult, read from the database.
 *
 * Takes a `tx` because every caller already has one — the reminder planner
 * runs inside the booking commit, and the pro's panel inside the page's read
 * transaction.
 */
export async function loadConsultPrepState(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<{ session: ConsultPrepSession; prep: ConsultPrepState } | null> {
  const session = await tx.consultSession.findUnique({
    where: { id: consultSessionId },
    select: CONSULT_PREP_SESSION_SELECT,
  })
  if (!session) return null

  const revisions = await tx.consultRevision.findMany({
    where: { consultSessionId, kind: ConsultRevisionKind.INTAKE },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    select: { payload: true },
  })

  return {
    session,
    prep: deriveConsultPrepState({
      session,
      intakePayloads: revisions.map((revision) => revision.payload),
    }),
  }
}
