// lib/consult/sparkGate.ts
//
// P7a-5 — "may this spark be booked right now?"
//
// The pro answers it per service category: Right away (the default, and today's
// behaviour) or After they finish prep, for pros who will not hold a big-ticket
// slot on an unanswered chemical history (handoff, "Pro opt-in").
//
// ONE rule, read by TWO callers on purpose:
//
//   * lib/consult/thread.ts — so the sticky CTA is disabled and SAYS why;
//   * lib/consult/sparkLink.ts — so a request that never met the button is
//     refused too. A disabled button is not a control. The pro's reason for
//     switching this on is that she does not want the slot taken, and a slot
//     taken by a hand-made POST is just as taken.
//
// 🔴 The gate is prep COMPLETENESS, not the prep DEADLINE. P7a-4 measures its
// deadline from `booking.scheduledFor`, so before the booking exists there is
// no clock — `deriveConsultPrepState` returns `deadlineAt: null` by design. The
// answerable question at the spark is "are the safety answers in", which is the
// same `complete` flag the pro's booking panel, the client's reminders and the
// day-of flag already read. The deadline resumes its ordinary job the moment
// she books.

import 'server-only'

import { ProCategoryBookingGate, type Prisma } from '@prisma/client'

import {
  CATEGORY_DEPOSIT_POLICY_SELECT,
  type CategoryDepositPolicyRow,
} from '@/lib/booking/categoryDeposit'

/** Everything either caller needs off the policy row, in one select. */
export const CONSULT_SPARK_GATE_POLICY_SELECT = CATEGORY_DEPOSIT_POLICY_SELECT

export type ConsultSparkGatePolicy = CategoryDepositPolicyRow

/**
 * Does the pro's setting hold this booking back right now?
 *
 * Pure, and deliberately total over both inputs: a missing policy row is
 * INSTANT, which is what makes "a pro who has set nothing behaves exactly as
 * today" a property of the data rather than a branch someone has to remember.
 */
export function consultSparkGateBlocked(args: {
  policy: Pick<ConsultSparkGatePolicy, 'bookingGate'> | null | undefined
  /** `deriveConsultPrepState().complete` — every safety question answered. */
  prepComplete: boolean
}): boolean {
  const gate = args.policy?.bookingGate ?? ProCategoryBookingGate.INSTANT
  return gate === ProCategoryBookingGate.AFTER_PREP && !args.prepComplete
}

/**
 * The pro's policy for one category, or null when she has set none.
 *
 * Takes a client so it composes inside the finalize transaction as easily as it
 * runs on its own read — the same shape `loadConsultPrepState` uses, and for
 * the same reason: the enforcement copy of this question runs inside a lock
 * that already holds the rows it cares about.
 */
export async function loadConsultSparkGatePolicy(
  db: Pick<Prisma.TransactionClient, 'proCategoryBookingPolicy'>,
  args: { professionalId: string; serviceCategoryId: string | null },
): Promise<ConsultSparkGatePolicy | null> {
  if (!args.serviceCategoryId) return null

  return db.proCategoryBookingPolicy.findUnique({
    where: {
      professionalId_serviceCategoryId: {
        professionalId: args.professionalId,
        serviceCategoryId: args.serviceCategoryId,
      },
    },
    select: CONSULT_SPARK_GATE_POLICY_SELECT,
  })
}
