// lib/notifications/reviewRequests.ts
//
// Automated post-visit review request (the review flywheel's collection leg).
// When a booking completes (the single COMPLETED transition in
// lib/booking/writeBoundary.ts → maybeCompleteBookingCloseout), we schedule a
// REVIEW_REQUESTED client notification a few hours out via the same
// ScheduledClientNotification machinery as appointment reminders; the
// client-reminders cron drains it. Idempotent per booking via dedupeKey, and
// re-validated at drain time (booking still COMPLETED, client claimed, no
// review written yet) so a stale request never fires.
import {
  BookingStatus,
  ClientClaimStatus,
  NotificationEventKey,
  type Prisma,
} from '@prisma/client'

import { scheduleClientNotification } from '@/lib/notifications/clientNotifications'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

export const REVIEW_REQUEST_DELAY_MS = 4 * 60 * 60 * 1000

export type ReviewRequestContent = {
  title: string
  body: string
  data: { bookingId: string }
}

export type ValidateDueReviewRequestResult =
  | {
      action: 'PROCESS'
      rowId: string
      clientId: string
      bookingId: string
      eventKey: typeof NotificationEventKey.REVIEW_REQUESTED
      dedupeKey: string
      href: string
      notification: ReviewRequestContent
    }
  | { action: 'SKIP' }
  | { action: 'CANCEL'; reason: string }

export function buildReviewRequestDedupeKey(bookingId: string): string {
  return `REVIEW_REQUEST:${bookingId}`
}

// #review anchors the ReviewSection on the client booking page.
export function buildReviewRequestHref(bookingId: string): string {
  return `/client/bookings/${bookingId}#review`
}

const REVIEW_REQUEST_PRO_SELECT = {
  businessName: true,
  firstName: true,
  lastName: true,
  handle: true,
  nameDisplay: true,
} satisfies Prisma.ProfessionalProfileSelect

const REVIEW_REQUEST_BOOKING_SELECT = {
  id: true,
  clientId: true,
  status: true,
  client: {
    select: { claimStatus: true },
  },
  professional: {
    select: REVIEW_REQUEST_PRO_SELECT,
  },
} satisfies Prisma.BookingSelect

type ReviewRequestBookingRow = Prisma.BookingGetPayload<{
  select: typeof REVIEW_REQUEST_BOOKING_SELECT
}>

export function buildReviewRequestContent(args: {
  bookingId: string
  professionalName: string | null
}): ReviewRequestContent {
  const name = args.professionalName?.trim() || null

  return {
    title: 'How was your visit?',
    body: name
      ? `Leave a quick review for ${name} — it helps others find great pros.`
      : 'Leave a quick review — it helps others find great pros.',
    data: { bookingId: args.bookingId },
  }
}

function professionalNameForBooking(
  booking: ReviewRequestBookingRow,
): string | null {
  return formatProfessionalPublicDisplayName(booking.professional) || null
}

/**
 * Schedules the post-visit review request. Call from the COMPLETED
 * transition, inside the same transaction. No-ops (never throws) for
 * bookings that can't produce a review: missing/uncompleted bookings and
 * unclaimed clients (no account to sign in and review with).
 */
export async function scheduleReviewRequestOnCompletion(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  now: Date
}): Promise<void> {
  const booking = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: REVIEW_REQUEST_BOOKING_SELECT,
  })

  if (!booking) return
  if (booking.status !== BookingStatus.COMPLETED) return
  if (booking.client.claimStatus !== ClientClaimStatus.CLAIMED) return

  await scheduleClientNotification({
    tx: args.tx,
    clientId: booking.clientId,
    bookingId: booking.id,
    eventKey: NotificationEventKey.REVIEW_REQUESTED,
    runAt: new Date(args.now.getTime() + REVIEW_REQUEST_DELAY_MS),
    dedupeKey: buildReviewRequestDedupeKey(booking.id),
    href: buildReviewRequestHref(booking.id),
    data: { bookingId: booking.id },
  })
}

const DUE_REVIEW_REQUEST_ROW_SELECT = {
  id: true,
  eventKey: true,
  clientId: true,
  bookingId: true,
  runAt: true,
  cancelledAt: true,
  processedAt: true,
} satisfies Prisma.ScheduledClientNotificationSelect

/**
 * Drain-time re-validation: canonical state wins over whatever was true when
 * the row was scheduled. Mirrors validateDueAppointmentReminder's
 * PROCESS/SKIP/CANCEL contract so the client-reminders cron can treat both
 * event kinds uniformly.
 */
export async function validateDueReviewRequest(args: {
  tx: Prisma.TransactionClient
  scheduledClientNotificationId: string
  now: Date
}): Promise<ValidateDueReviewRequestResult> {
  const row = await args.tx.scheduledClientNotification.findUnique({
    where: { id: args.scheduledClientNotificationId },
    select: DUE_REVIEW_REQUEST_ROW_SELECT,
  })

  if (!row) return { action: 'SKIP' }

  if (row.eventKey !== NotificationEventKey.REVIEW_REQUESTED) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled notification has the wrong event key.',
    }
  }

  if (row.cancelledAt || row.processedAt) return { action: 'SKIP' }
  if (row.runAt.getTime() > args.now.getTime()) return { action: 'SKIP' }

  if (!row.bookingId) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled review request is missing bookingId.',
    }
  }

  const booking = await args.tx.booking.findUnique({
    where: { id: row.bookingId },
    select: REVIEW_REQUEST_BOOKING_SELECT,
  })

  if (!booking) {
    return { action: 'CANCEL', reason: 'Linked booking no longer exists.' }
  }

  if (booking.status !== BookingStatus.COMPLETED) {
    return { action: 'CANCEL', reason: 'Linked booking is not completed.' }
  }

  if (row.clientId !== booking.clientId) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled review request clientId does not match booking.',
    }
  }

  if (booking.client.claimStatus !== ClientClaimStatus.CLAIMED) {
    return {
      action: 'CANCEL',
      reason: 'Client account is not claimed.',
    }
  }

  const existingReview = await args.tx.review.findFirst({
    where: { bookingId: booking.id },
    select: { id: true },
  })

  if (existingReview) {
    return {
      action: 'CANCEL',
      reason: 'A review already exists for this booking.',
    }
  }

  return {
    action: 'PROCESS',
    rowId: row.id,
    clientId: row.clientId,
    bookingId: booking.id,
    eventKey: NotificationEventKey.REVIEW_REQUESTED,
    dedupeKey: buildReviewRequestDedupeKey(booking.id),
    href: buildReviewRequestHref(booking.id),
    notification: buildReviewRequestContent({
      bookingId: booking.id,
      professionalName: professionalNameForBooking(booking),
    }),
  }
}
