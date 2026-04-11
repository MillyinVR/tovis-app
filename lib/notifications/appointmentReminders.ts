import {
  BookingStatus,
  NotificationEventKey,
  Prisma,
} from '@prisma/client'

import {
  cancelScheduledClientNotificationsForBooking,
  scheduleClientNotification,
} from '@/lib/notifications/clientNotifications'
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'

export type AppointmentReminderKind = 'ONE_WEEK' | 'DAY_BEFORE'

type AppointmentReminderPlanItem = {
  kind: AppointmentReminderKind
  dedupeKey: string
  runAt: Date
}

const APPOINTMENT_REMINDER_KINDS: AppointmentReminderKind[] = [
  'ONE_WEEK',
  'DAY_BEFORE',
]

const BOOKING_REMINDER_SELECT = {
  id: true,
  clientId: true,
  scheduledFor: true,
  status: true,
  finishedAt: true,
  locationTimeZone: true,
  clientTimeZoneAtBooking: true,
  service: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.BookingSelect

type BookingReminderRecord = Prisma.BookingGetPayload<{
  select: typeof BOOKING_REMINDER_SELECT
}>

function makeAppointmentReminderDedupeKey(
  bookingId: string,
  kind: AppointmentReminderKind,
): string {
  return `CLIENT_REMINDER:${kind}:${bookingId}`
}

function resolveAppointmentReminderTimeZone(
  value: string | null | undefined,
): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw && isValidIanaTimeZone(raw)) {
    return sanitizeTimeZone(raw, DEFAULT_TIME_ZONE)
  }
  return DEFAULT_TIME_ZONE
}

function computeAppointmentReminderRunAt(args: {
  scheduledFor: Date
  kind: AppointmentReminderKind
}): Date | null {
  const offsetMs =
    args.kind === 'ONE_WEEK'
      ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000

  const runAt = new Date(args.scheduledFor.getTime() - offsetMs)
  return Number.isNaN(runAt.getTime()) ? null : runAt
}

function isBookingEligibleForAppointmentReminders(
  booking: BookingReminderRecord,
): boolean {
  if (!booking.clientId) return false
  if (!(booking.scheduledFor instanceof Date)) return false
  if (Number.isNaN(booking.scheduledFor.getTime())) return false

  if (booking.status === BookingStatus.CANCELLED) return false
  if (booking.status === BookingStatus.COMPLETED) return false
  if (booking.finishedAt) return false

  return true
}

function planBookingAppointmentReminders(
  booking: BookingReminderRecord,
): AppointmentReminderPlanItem[] {
  if (!isBookingEligibleForAppointmentReminders(booking)) {
    return []
  }

  const now = Date.now()
  const plan: AppointmentReminderPlanItem[] = []

  for (const kind of APPOINTMENT_REMINDER_KINDS) {
    const runAt = computeAppointmentReminderRunAt({
      scheduledFor: booking.scheduledFor,
      kind,
    })

    if (!runAt) continue
    if (runAt.getTime() <= now) continue

    plan.push({
      kind,
      dedupeKey: makeAppointmentReminderDedupeKey(booking.id, kind),
      runAt,
    })
  }

  return plan
}

async function loadBookingForReminderSync(args: {
  tx: Prisma.TransactionClient
  bookingId: string
}): Promise<BookingReminderRecord> {
  const booking = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: BOOKING_REMINDER_SELECT,
  })

  if (!booking) {
    throw new Error(
      `Booking ${args.bookingId} not found while syncing appointment reminders.`,
    )
  }

  return booking
}

export async function cancelBookingAppointmentReminders(args: {
  tx: Prisma.TransactionClient
  bookingId: string
}): Promise<void> {
  const booking = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      id: true,
      clientId: true,
    } satisfies Prisma.BookingSelect,
  })

  if (!booking?.clientId) return

  await cancelScheduledClientNotificationsForBooking({
    tx: args.tx,
    bookingId: booking.id,
    clientId: booking.clientId,
    eventKeys: [NotificationEventKey.APPOINTMENT_REMINDER],
    onlyPending: true,
  })
}

export async function syncBookingAppointmentReminders(args: {
  tx: Prisma.TransactionClient
  bookingId: string
}): Promise<void> {
  const booking = await loadBookingForReminderSync({
    tx: args.tx,
    bookingId: args.bookingId,
  })

  await cancelScheduledClientNotificationsForBooking({
    tx: args.tx,
    bookingId: booking.id,
    clientId: booking.clientId,
    eventKeys: [NotificationEventKey.APPOINTMENT_REMINDER],
    onlyPending: true,
  })

  const plan = planBookingAppointmentReminders(booking)
  if (plan.length === 0) return

  const href = `/client/bookings/${booking.id}?step=overview`
  const timeZone = resolveAppointmentReminderTimeZone(
    booking.locationTimeZone ?? booking.clientTimeZoneAtBooking,
  )
  const serviceName = booking.service?.name?.trim() || 'Appointment'

  for (const item of plan) {
    await scheduleClientNotification({
      tx: args.tx,
      clientId: booking.clientId,
      bookingId: booking.id,
      eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      runAt: item.runAt,
      dedupeKey: item.dedupeKey,
      href,
      data: {
        reminderKind: item.kind,
        bookingId: booking.id,
        scheduledFor: booking.scheduledFor.toISOString(),
        timeZone,
        serviceName,
        professionalName: null,
      },
    })
  }
}