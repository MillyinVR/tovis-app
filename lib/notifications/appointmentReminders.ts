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
  getZonedParts,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'

export type AppointmentReminderKind = 'ONE_WEEK' | 'DAY_BEFORE'

export type AppointmentReminderPayload = {
  reminderKind: AppointmentReminderKind
  bookingId: string
  scheduledFor: string
  timeZone: string
  serviceName: string
  professionalName: string | null
}

export type AppointmentReminderContent = {
  title: string
  body: string
  data: Prisma.InputJsonValue
}

export type ValidateDueAppointmentReminderResult =
  | {
      action: 'PROCESS'
      rowId: string
      clientId: string
      bookingId: string
      dedupeKey: string
      href: string
      notification: AppointmentReminderContent
    }
  | {
      action: 'SKIP'
    }
  | {
      action: 'CANCEL'
      reason: string
    }

type AppointmentReminderPlanItem = {
  kind: AppointmentReminderKind
  dedupeKey: string
  runAt: Date
  payload: AppointmentReminderPayload
}

const APPOINTMENT_REMINDER_KINDS: readonly AppointmentReminderKind[] = [
  'ONE_WEEK',
  'DAY_BEFORE',
]

const APPOINTMENT_REMINDER_OFFSET_DAYS: Record<
  AppointmentReminderKind,
  number
> = {
  ONE_WEEK: 7,
  DAY_BEFORE: 1,
}

/**
 * Be explicit.
 * We do not silently schedule reminders for every non-terminal booking state.
 * If product rules change later, change this constant intentionally.
 */
const REMINDER_ELIGIBLE_BOOKING_STATUSES = new Set<BookingStatus>([
  BookingStatus.ACCEPTED,
])

const BOOKING_REMINDER_SELECT = {
  id: true,
  clientId: true,
  scheduledFor: true,
  status: true,
  finishedAt: true,
  locationTimeZone: true,
  service: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.BookingSelect

const DUE_APPOINTMENT_REMINDER_SELECT = {
  id: true,
  clientId: true,
  bookingId: true,
  eventKey: true,
  runAt: true,
  href: true,
  dedupeKey: true,
  data: true,
  cancelledAt: true,
  processedAt: true,
} satisfies Prisma.ScheduledClientNotificationSelect

type BookingReminderRecord = Prisma.BookingGetPayload<{
  select: typeof BOOKING_REMINDER_SELECT
}>

type DueAppointmentReminderRow = Prisma.ScheduledClientNotificationGetPayload<{
  select: typeof DUE_APPOINTMENT_REMINDER_SELECT
}>

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeDateOrNull(value: Date | null | undefined): Date | null {
  if (!(value instanceof Date)) return null
  return Number.isNaN(value.getTime()) ? null : value
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function normalizeNowOrThrow(value: Date | undefined, fieldName: string): Date {
  const normalized = value ?? new Date()
  if (!(normalized instanceof Date) || Number.isNaN(normalized.getTime())) {
    throw new Error(`appointmentReminders: invalid ${fieldName}`)
  }

  return normalized
}

function resolveAppointmentReminderTimeZone(
  value: string | null | undefined,
): string {
  return sanitizeTimeZone(value, DEFAULT_TIME_ZONE)
}

function shiftLocalCalendarDate(args: {
  year: number
  month: number
  day: number
  daysToSubtract: number
}): {
  year: number
  month: number
  day: number
} {
  const shifted = new Date(
    Date.UTC(args.year, args.month - 1, args.day, 12, 0, 0, 0),
  )

  shifted.setUTCDate(shifted.getUTCDate() - args.daysToSubtract)

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function formatWhen(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: DEFAULT_TIME_ZONE,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

function makeAppointmentReminderDedupeKey(
  bookingId: string,
  kind: AppointmentReminderKind,
): string {
  return `CLIENT_REMINDER:${kind}:${bookingId}`
}

function buildAppointmentReminderHref(bookingId: string): string {
  return `/client/bookings/${bookingId}?step=overview`
}

export function buildAppointmentReminderPayload(args: {
  bookingId: string
  kind: AppointmentReminderKind
  scheduledFor: Date
  timeZone: string
  serviceName?: string | null
  professionalName?: string | null
}): AppointmentReminderPayload {
  const scheduledFor = normalizeDateOrNull(args.scheduledFor)
  if (!scheduledFor) {
    throw new Error('buildAppointmentReminderPayload: invalid scheduledFor')
  }

  return {
    reminderKind: args.kind,
    bookingId: args.bookingId,
    scheduledFor: scheduledFor.toISOString(),
    timeZone: resolveAppointmentReminderTimeZone(args.timeZone),
    serviceName: normalizeOptionalString(args.serviceName) ?? 'Appointment',
    professionalName: normalizeOptionalString(args.professionalName),
  }
}

export function parseAppointmentReminderPayload(
  data: Prisma.JsonValue | null,
): AppointmentReminderPayload | null {
  if (!isRecord(data)) return null

  const reminderKind = readString(data.reminderKind)
  if (reminderKind !== 'ONE_WEEK' && reminderKind !== 'DAY_BEFORE') {
    return null
  }

  const bookingId = readString(data.bookingId)
  if (!bookingId) return null

  const scheduledFor = readDate(data.scheduledFor)
  if (!scheduledFor) return null

  const rawTimeZone = readString(data.timeZone)
  if (!rawTimeZone || !isValidIanaTimeZone(rawTimeZone)) {
    return null
  }

  return {
    reminderKind,
    bookingId,
    scheduledFor: scheduledFor.toISOString(),
    timeZone: sanitizeTimeZone(rawTimeZone, DEFAULT_TIME_ZONE),
    serviceName: readString(data.serviceName) ?? 'Appointment',
    professionalName: readString(data.professionalName),
  }
}

export function buildAppointmentReminderContent(
  payload: AppointmentReminderPayload,
): AppointmentReminderContent {
  const scheduledFor = new Date(payload.scheduledFor)
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new Error('buildAppointmentReminderContent: invalid scheduledFor')
  }

  const whenLabel = formatWhen(scheduledFor, payload.timeZone)
  const subject = payload.serviceName
    ? ` for ${payload.serviceName}`
    : ''
  const withPro = payload.professionalName
    ? ` with ${payload.professionalName}`
    : ''
  const onWhen = whenLabel ? ` on ${whenLabel}` : ''

  if (payload.reminderKind === 'ONE_WEEK') {
    return {
      title: 'Appointment reminder',
      body: `Reminder: your appointment${subject} is in one week${onWhen}${withPro}.`,
      data: payload,
    }
  }

  return {
    title: 'Appointment tomorrow',
    body: `Reminder: your appointment${subject} is tomorrow${onWhen}${withPro}.`,
    data: payload,
  }
}

function isBookingEligibleForAppointmentReminders(
  booking: BookingReminderRecord,
): boolean {
  if (!booking.clientId) return false

  const scheduledFor = normalizeDateOrNull(booking.scheduledFor)
  if (!scheduledFor) return false

  if (booking.finishedAt) return false
  if (!REMINDER_ELIGIBLE_BOOKING_STATUSES.has(booking.status)) return false

  return true
}

export function computeAppointmentReminderRunAt(args: {
  scheduledFor: Date
  timeZone: string
  kind: AppointmentReminderKind
}): Date | null {
  const scheduledFor = normalizeDateOrNull(args.scheduledFor)
  if (!scheduledFor) return null

  const timeZone = resolveAppointmentReminderTimeZone(args.timeZone)
  const zonedScheduledFor = getZonedParts(scheduledFor, timeZone)

  const shiftedDate = shiftLocalCalendarDate({
    year: zonedScheduledFor.year,
    month: zonedScheduledFor.month,
    day: zonedScheduledFor.day,
    daysToSubtract: APPOINTMENT_REMINDER_OFFSET_DAYS[args.kind],
  })

  return zonedTimeToUtc({
    timeZone,
    year: shiftedDate.year,
    month: shiftedDate.month,
    day: shiftedDate.day,
    hour: zonedScheduledFor.hour,
    minute: zonedScheduledFor.minute,
    second: zonedScheduledFor.second,
  })
}

function payloadsMatch(
  left: AppointmentReminderPayload,
  right: AppointmentReminderPayload,
): boolean {
  return (
    left.reminderKind === right.reminderKind &&
    left.bookingId === right.bookingId &&
    left.scheduledFor === right.scheduledFor &&
    left.timeZone === right.timeZone &&
    left.serviceName === right.serviceName &&
    left.professionalName === right.professionalName
  )
}

function buildReminderPlanItem(args: {
  booking: BookingReminderRecord
  kind: AppointmentReminderKind
}): AppointmentReminderPlanItem | null {
  const { booking, kind } = args

  if (!isBookingEligibleForAppointmentReminders(booking)) {
    return null
  }

  const scheduledFor = normalizeDateOrNull(booking.scheduledFor)
  if (!scheduledFor) return null

  const timeZone = resolveAppointmentReminderTimeZone(
    booking.locationTimeZone,
  )

  const runAt = computeAppointmentReminderRunAt({
    scheduledFor,
    timeZone,
    kind,
  })

  if (!runAt) return null

  return {
    kind,
    dedupeKey: makeAppointmentReminderDedupeKey(booking.id, kind),
    runAt,
    payload: buildAppointmentReminderPayload({
      bookingId: booking.id,
      kind,
      scheduledFor,
      timeZone,
      serviceName: booking.service?.name ?? 'Appointment',
      /**
       * Intentionally null for now.
       * This file should only include professionalName once booking-query truth
       * provides a canonical source for it.
       */
      professionalName: null,
    }),
  }
}

export function planBookingAppointmentReminders(args: {
  booking: BookingReminderRecord
  now?: Date
}): AppointmentReminderPlanItem[] {
  if (!isBookingEligibleForAppointmentReminders(args.booking)) {
    return []
  }

  const now = normalizeNowOrThrow(args.now, 'now')
  const plan: AppointmentReminderPlanItem[] = []

  for (const kind of APPOINTMENT_REMINDER_KINDS) {
    const item = buildReminderPlanItem({
      booking: args.booking,
      kind,
    })
    if (!item) continue
    if (item.runAt.getTime() <= now.getTime()) continue

    plan.push(item)
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

async function loadDueAppointmentReminderRow(args: {
  tx: Prisma.TransactionClient
  scheduledClientNotificationId: string
}): Promise<DueAppointmentReminderRow | null> {
  return args.tx.scheduledClientNotification.findUnique({
    where: { id: args.scheduledClientNotificationId },
    select: DUE_APPOINTMENT_REMINDER_SELECT,
  })
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
  now?: Date
}): Promise<void> {
  const booking = await loadBookingForReminderSync({
    tx: args.tx,
    bookingId: args.bookingId,
  })

  await cancelBookingAppointmentReminders({
    tx: args.tx,
    bookingId: booking.id,
  })

  const plan = planBookingAppointmentReminders({
    booking,
    now: args.now,
  })

  if (plan.length === 0) return

  const href = buildAppointmentReminderHref(booking.id)

  for (const item of plan) {
    await scheduleClientNotification({
      tx: args.tx,
      clientId: booking.clientId,
      bookingId: booking.id,
      eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      runAt: item.runAt,
      dedupeKey: item.dedupeKey,
      href,
      data: item.payload,
    })
  }
}

export async function validateDueAppointmentReminder(args: {
  tx: Prisma.TransactionClient
  scheduledClientNotificationId: string
  now?: Date
}): Promise<ValidateDueAppointmentReminderResult> {
  const now = normalizeNowOrThrow(args.now, 'now')

  const row = await loadDueAppointmentReminderRow({
    tx: args.tx,
    scheduledClientNotificationId: args.scheduledClientNotificationId,
  })

  if (!row) {
    return { action: 'SKIP' }
  }

  if (row.eventKey !== NotificationEventKey.APPOINTMENT_REMINDER) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled notification has the wrong event key.',
    }
  }

  if (row.cancelledAt || row.processedAt) {
    return { action: 'SKIP' }
  }

  if (row.runAt.getTime() > now.getTime()) {
    return { action: 'SKIP' }
  }

  if (!row.bookingId) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled reminder is missing bookingId.',
    }
  }

  const booking = await args.tx.booking.findUnique({
    where: { id: row.bookingId },
    select: BOOKING_REMINDER_SELECT,
  })

  if (!booking) {
    return {
      action: 'CANCEL',
      reason: 'Linked booking no longer exists.',
    }
  }

  if (!isBookingEligibleForAppointmentReminders(booking)) {
    return {
      action: 'CANCEL',
      reason: 'Linked booking is no longer eligible for appointment reminders.',
    }
  }

  if (row.clientId !== booking.clientId) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled reminder clientId does not match linked booking.',
    }
  }

  const parsedPayload = parseAppointmentReminderPayload(row.data)
  if (!parsedPayload) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled reminder payload is not in canonical format.',
    }
  }

  if (parsedPayload.bookingId !== booking.id) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled reminder payload bookingId does not match linked booking.',
    }
  }

  const planned = buildReminderPlanItem({
    booking,
    kind: parsedPayload.reminderKind,
  })

  if (!planned) {
    return {
      action: 'CANCEL',
      reason: 'Linked booking no longer has a valid canonical reminder plan.',
    }
  }

  if (row.dedupeKey !== planned.dedupeKey) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled reminder dedupeKey does not match canonical reminder state.',
    }
  }

  if (row.runAt.getTime() !== planned.runAt.getTime()) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled reminder runAt no longer matches canonical reminder state.',
    }
  }

  if (!payloadsMatch(parsedPayload, planned.payload)) {
    return {
      action: 'CANCEL',
      reason: 'Scheduled reminder payload no longer matches canonical booking state.',
    }
  }

  return {
    action: 'PROCESS',
    rowId: row.id,
    clientId: row.clientId,
    bookingId: booking.id,
    dedupeKey: planned.dedupeKey,
    href: buildAppointmentReminderHref(booking.id),
    notification: buildAppointmentReminderContent(planned.payload),
  }
}

export async function cancelDueAppointmentReminder(args: {
  tx: Prisma.TransactionClient
  scheduledClientNotificationId: string
  reason: string
  cancelledAt?: Date
}): Promise<void> {
  const cancelledAt = normalizeNowOrThrow(args.cancelledAt, 'cancelledAt')

  await args.tx.scheduledClientNotification.updateMany({
    where: {
      id: args.scheduledClientNotificationId,
      cancelledAt: null,
      processedAt: null,
    },
    data: {
      cancelledAt,
      lastError: args.reason,
    },
  })
}