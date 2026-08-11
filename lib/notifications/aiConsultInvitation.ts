import { NotificationEventKey, Prisma } from '@prisma/client'

import {
  isAiConsultC6ExposureEnabledForPro,
  isAiConsultC6ExposurePossible,
} from '@/lib/consult/access'
import {
  AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
  evaluateAiConsultBookingEligibility,
} from '@/lib/consult/eligibility'
import {
  reEngagementBudgetWindowStart,
  resolveReEngagementBudget,
} from '@/lib/notifications/reEngagementBudget'
import {
  loadMutedClientsForEvent,
  loadReEngagementBudgetCounts,
} from '@/lib/notifications/reEngagementLedger'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'

export type AiConsultInvitationResult =
  | 'CREATED'
  | 'FEATURE_BLOCKED'
  | 'BOOKING_INELIGIBLE'
  | 'ALREADY_HAS_CONSULT'
  | 'ALREADY_INVITED'
  | 'MUTED'
  | 'BUDGET_EXHAUSTED'

const EVENT_KEY = NotificationEventKey.AI_CONSULT_INVITATION

/**
 * Adds the optional C6 consult invitation beside a booking confirmation.
 * Caller and helper share one transaction, so the invite cannot outlive a
 * rolled-back confirmation. The per-client row lock serializes pooled-budget
 * spend across simultaneous booking confirmations.
 */
export async function maybeCreateAiConsultInvitation(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  clientId: string
  now: Date
}): Promise<AiConsultInvitationResult> {
  if (!isAiConsultC6ExposurePossible()) return 'FEATURE_BLOCKED'

  const booking = await args.tx.booking.findFirst({
    where: { id: args.bookingId, clientId: args.clientId },
    select: {
      ...AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
      sourceConsultSessionId: true,
      consultSession: { select: { id: true } },
    },
  })
  if (!booking) return 'BOOKING_INELIGIBLE'

  if (!isAiConsultC6ExposureEnabledForPro(booking.professionalId)) {
    return 'FEATURE_BLOCKED'
  }
  if (!evaluateAiConsultBookingEligibility(booking, args.now).eligible) {
    return 'BOOKING_INELIGIBLE'
  }
  if (booking.consultSession || booking.sourceConsultSessionId) {
    return 'ALREADY_HAS_CONSULT'
  }

  await args.tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "ClientProfile"
    WHERE "id" = ${args.clientId}
    FOR UPDATE
  `)

  const dedupeKey = `AI_CONSULT_INVITATION:${args.bookingId}`
  const existing = await args.tx.clientNotification.findFirst({
    where: { clientId: args.clientId, eventKey: EVENT_KEY, dedupeKey },
    select: { id: true },
  })
  if (existing) return 'ALREADY_INVITED'

  const muted = await loadMutedClientsForEvent(args.tx, {
    clientIds: [args.clientId],
    eventKey: EVENT_KEY,
  })
  if (muted.has(args.clientId)) return 'MUTED'

  const budgetCounts = await loadReEngagementBudgetCounts(args.tx, {
    clientIds: [args.clientId],
    windowStart: reEngagementBudgetWindowStart(args.now),
  })
  const budget = resolveReEngagementBudget({
    recentSendCount: budgetCounts.get(args.clientId) ?? 0,
  })
  if (!budget.allowed) return 'BUDGET_EXHAUSTED'

  await upsertClientNotification({
    tx: args.tx,
    clientId: args.clientId,
    bookingId: args.bookingId,
    eventKey: EVENT_KEY,
    title: 'Prepare for your color appointment',
    body: 'Share your hair-color goals before your visit so you and your professional can discuss the direction together.',
    href: `/client/bookings/${args.bookingId}`,
    dedupeKey,
    data: {
      bookingId: args.bookingId,
      action: 'START_AI_CONSULT',
    },
  })

  return 'CREATED'
}
