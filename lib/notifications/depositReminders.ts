// lib/notifications/depositReminders.ts
//
// New-client discovery-deposit nudge (M5). A discovery booking is created
// occupying the pro's calendar with depositStatus=PENDING BEFORE the client pays
// the deposit; if they never complete checkout, the unpaid-deposit auto-release
// sweep (lib/booking/depositReleaseSweep.ts) frees the slot after the deadline.
// This reminder nudges the client to finish the deposit BEFORE that happens.
//
// Scheduled once at booking creation via the same ScheduledClientNotification
// machinery as review requests / appointment reminders (dedupe per booking), to
// fire `lead` hours before the release deadline (createdAt + deadline - lead).
// The client-reminders cron drains it, re-validating canonical state at drain
// time so a paid / cancelled / already-released booking never nudges.

import {
  BookingDepositStatus,
  BookingStatus,
  NotificationEventKey,
  type Prisma,
} from '@prisma/client'

import { depositReminderOffsetMs } from '@/lib/booking/depositDeadline'
import { formatMoneyFromUnknown } from '@/lib/money'
import { scheduleClientNotification } from '@/lib/notifications/clientNotifications'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'

export type DepositReminderContent = {
  title: string
  body: string
  data: { bookingId: string }
}

export type ValidateDueDepositReminderResult =
  | {
      action: 'PROCESS'
      rowId: string
      clientId: string
      bookingId: string
      eventKey: typeof NotificationEventKey.DEPOSIT_REMINDER
      dedupeKey: string
      href: string
      notification: DepositReminderContent
    }
  | { action: 'SKIP' }
  | { action: 'CANCEL'; reason: string }

export function buildDepositReminderDedupeKey(bookingId: string): string {
  return `DEPOSIT_REMINDER:${bookingId}`
}

// ?step=overview anchors the ClientDepositCard (the "Pay deposit" CTA).
export function buildDepositReminderHref(bookingId: string): string {
  return `/client/bookings/${bookingId}?step=overview`
}

const DEPOSIT_REMINDER_BOOKING_SELECT = {
  id: true,
  clientId: true,
  status: true,
  depositStatus: true,
  depositAmount: true,
  scheduledFor: true,
  service: { select: { name: true } },
  professional: {
    // Sanctioned display-name fragment (lib/privacy) — keeps raw name-field
    // selects out of this module per check-pii-plaintext-reads.
    select: professionalPublicDisplayNameSelect,
  },
} satisfies Prisma.BookingSelect

type DepositReminderBookingRow = Prisma.BookingGetPayload<{
  select: typeof DEPOSIT_REMINDER_BOOKING_SELECT
}>

export function buildDepositReminderContent(args: {
  bookingId: string
  professionalName: string | null
  depositAmount: Prisma.Decimal | string | number | null
}): DepositReminderContent {
  const name = args.professionalName?.trim() || null
  const amount = formatMoneyFromUnknown(args.depositAmount)

  const title = amount ? `Finish your ${amount} deposit` : 'Finish your deposit'

  const withWhom = name ? ` with ${name}` : ''
  const body =
    `Your booking${withWhom} isn't secured until the deposit is paid. ` +
    `Complete it soon to keep your appointment — the hold is released if it stays unpaid.`

  return { title, body, data: { bookingId: args.bookingId } }
}

function professionalNameForBooking(
  booking: DepositReminderBookingRow,
): string | null {
  return formatProfessionalPublicDisplayName(booking.professional) || null
}

function isReleasableStatus(status: BookingStatus): boolean {
  return status === BookingStatus.PENDING || status === BookingStatus.ACCEPTED
}

/**
 * Schedules the deposit nudge. Call from the finalize transaction right after a
 * discovery-deposit booking is created. Self-validating and never throws: it
 * no-ops for any booking that isn't a still-unpaid, still-occupying, future
 * deposit booking, so it is safe to call unconditionally.
 */
export async function scheduleDepositReminderOnBooking(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  now: Date
}): Promise<void> {
  const booking = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: DEPOSIT_REMINDER_BOOKING_SELECT,
  })

  if (!booking) return
  if (booking.depositStatus !== BookingDepositStatus.PENDING) return
  if (!isReleasableStatus(booking.status)) return

  const runAt = new Date(args.now.getTime() + depositReminderOffsetMs())

  // Never schedule a nudge at/after the appointment itself — a last-minute
  // booking whose deadline offset lands past the appointment gets no reminder
  // (the release sweep still handles the slot).
  if (runAt.getTime() >= booking.scheduledFor.getTime()) return

  await scheduleClientNotification({
    tx: args.tx,
    clientId: booking.clientId,
    bookingId: booking.id,
    eventKey: NotificationEventKey.DEPOSIT_REMINDER,
    runAt,
    dedupeKey: buildDepositReminderDedupeKey(booking.id),
    href: buildDepositReminderHref(booking.id),
    data: { bookingId: booking.id },
  })
}

const DUE_DEPOSIT_REMINDER_ROW_SELECT = {
  id: true,
  eventKey: true,
  clientId: true,
  bookingId: true,
  runAt: true,
  cancelledAt: true,
  processedAt: true,
} satisfies Prisma.ScheduledClientNotificationSelect

/**
 * Drain-time re-validation: canonical state wins over whatever was true when the
 * row was scheduled. Mirrors validateDueAppointmentReminder's PROCESS/SKIP/CANCEL
 * contract so the client-reminders cron treats every kind uniformly.
 */
export async function validateDueDepositReminder(args: {
  tx: Prisma.TransactionClient
  scheduledClientNotificationId: string
  now: Date
}): Promise<ValidateDueDepositReminderResult> {
  const row = await args.tx.scheduledClientNotification.findUnique({
    where: { id: args.scheduledClientNotificationId },
    select: DUE_DEPOSIT_REMINDER_ROW_SELECT,
  })

  if (!row) return { action: 'SKIP' }

  if (row.eventKey !== NotificationEventKey.DEPOSIT_REMINDER) {
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
      reason: 'Scheduled deposit reminder is missing bookingId.',
    }
  }

  const booking = await args.tx.booking.findUnique({
    where: { id: row.bookingId },
    select: DEPOSIT_REMINDER_BOOKING_SELECT,
  })

  if (!booking) {
    return { action: 'CANCEL', reason: 'Linked booking no longer exists.' }
  }

  if (row.clientId !== booking.clientId) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled deposit reminder clientId does not match booking.',
    }
  }

  if (booking.depositStatus !== BookingDepositStatus.PENDING) {
    // Paid, refunded, or no longer a deposit booking — nothing to nudge.
    return { action: 'CANCEL', reason: 'Deposit is no longer pending.' }
  }

  if (!isReleasableStatus(booking.status)) {
    return {
      action: 'CANCEL',
      reason: 'Booking is no longer holding a slot.',
    }
  }

  if (booking.scheduledFor.getTime() <= args.now.getTime()) {
    return { action: 'CANCEL', reason: 'Appointment has already passed.' }
  }

  return {
    action: 'PROCESS',
    rowId: row.id,
    clientId: row.clientId,
    bookingId: booking.id,
    eventKey: NotificationEventKey.DEPOSIT_REMINDER,
    dedupeKey: buildDepositReminderDedupeKey(booking.id),
    href: buildDepositReminderHref(booking.id),
    notification: buildDepositReminderContent({
      bookingId: booking.id,
      professionalName: professionalNameForBooking(booking),
      depositAmount: booking.depositAmount,
    }),
  }
}
