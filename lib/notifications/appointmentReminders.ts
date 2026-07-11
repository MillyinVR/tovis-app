import {
  BookingStatus,
  NotificationEventKey,
  Prisma,
} from '@prisma/client'

import { asTrimmedString, isRecord } from '@/lib/guards'
import { formatBookingServicesLabel } from '@/lib/booking/serviceLabel'
import {
  cancelScheduledClientNotificationsForBooking,
  scheduleClientNotification,
} from '@/lib/notifications/clientNotifications'
import { resolveEnabledReminderOffsetMinutes } from '@/lib/reminderSettings/settings'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getZonedParts,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/time'

export type AppointmentReminderPayload = {
  /**
   * Lead time in minutes before the appointment. Whole-day leads are a multiple
   * of 1440 (fire at the appointment's own local wall-clock time N days earlier,
   * DST-safe); sub-day leads are a multiple of 60 (an exact instant offset).
   */
  offsetMinutes: number
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
  offsetMinutes: number
  dedupeKey: string
  runAt: Date
  payload: AppointmentReminderPayload
}

const MINUTES_PER_DAY = 1440
const MINUTES_PER_HOUR = 60

// Legacy symbolic reminder kinds (pre-offsetMinutes). Kept only to map old
// scheduled-notification payloads onto minutes at read time (defense-in-depth
// alongside the one-shot deploy migration that rewrites pending rows).
const LEGACY_REMINDER_KIND_MINUTES: Record<string, number> = {
  ONE_WEEK: 10080,
  THREE_DAYS: 4320,
  DAY_BEFORE: 1440,
}

/**
 * The relative-when phrase + tomorrow flag for a reminder's client-facing copy,
 * derived from its lead time. Whole-day leads read "tomorrow" / "in one week" /
 * "in N days"; hour leads read "in N hours"; anything finer reads "in N minutes".
 */
function humanizeLeadTime(offsetMinutes: number): {
  relativeWhen: string
  isTomorrow: boolean
} {
  if (offsetMinutes % MINUTES_PER_DAY === 0) {
    const days = offsetMinutes / MINUTES_PER_DAY
    if (days === 1) return { relativeWhen: 'tomorrow', isTomorrow: true }
    if (days === 7) return { relativeWhen: 'in one week', isTomorrow: false }
    return { relativeWhen: `in ${days} days`, isTomorrow: false }
  }

  if (offsetMinutes % MINUTES_PER_HOUR === 0) {
    const hours = offsetMinutes / MINUTES_PER_HOUR
    return {
      relativeWhen: `in ${hours} hour${hours === 1 ? '' : 's'}`,
      isTomorrow: false,
    }
  }

  return {
    relativeWhen: `in ${offsetMinutes} minute${offsetMinutes === 1 ? '' : 's'}`,
    isTomorrow: false,
  }
}

function readOffsetMinutes(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
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
  professionalId: true,
  scheduledFor: true,
  status: true,
  finishedAt: true,
  locationTimeZone: true,
  service: {
    select: {
      name: true,
    },
  },
  serviceItems: {
    select: {
      itemType: true,
      sortOrder: true,
      service: { select: { name: true } },
    },
    orderBy: { sortOrder: 'asc' },
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

function normalizeDateOrNull(value: Date | null | undefined): Date | null {
  if (!(value instanceof Date)) return null
  return Number.isNaN(value.getTime()) ? null : value
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

function formatTimeOnly(date: Date, timeZone: string): string {
  // sanitizeTimeZone falls back to DEFAULT_TIME_ZONE for an invalid tz, matching
  // the previous try/catch behavior; formatInTimeZone keeps the default locale.
  return formatInTimeZone(date, sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE), {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function makeAppointmentReminderDedupeKey(
  bookingId: string,
  offsetMinutes: number,
): string {
  // The `M` prefix guarantees new minute-keyed keys never collide with the old
  // textual-kind keys (CLIENT_REMINDER:ONE_WEEK:… etc.).
  return `CLIENT_REMINDER:M${offsetMinutes}:${bookingId}`
}

function buildAppointmentReminderHref(bookingId: string): string {
  return `/client/bookings/${bookingId}?step=overview`
}

export function buildAppointmentReminderPayload(args: {
  bookingId: string
  offsetMinutes: number
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
    offsetMinutes: args.offsetMinutes,
    bookingId: args.bookingId,
    scheduledFor: scheduledFor.toISOString(),
    timeZone: resolveAppointmentReminderTimeZone(args.timeZone),
    serviceName: asTrimmedString(args.serviceName) ?? 'Appointment',
    professionalName: asTrimmedString(args.professionalName),
  }
}

export function parseAppointmentReminderPayload(
  data: Prisma.JsonValue | null,
): AppointmentReminderPayload | null {
  if (!isRecord(data)) return null

  // Prefer the canonical minutes field; fall back to the legacy symbolic kind so
  // a reminder scheduled before the offsetMinutes cutover still validates.
  const offsetMinutes =
    readOffsetMinutes(data.offsetMinutes) ??
    LEGACY_REMINDER_KIND_MINUTES[readString(data.reminderKind) ?? ''] ??
    null
  if (offsetMinutes == null) return null

  const bookingId = readString(data.bookingId)
  if (!bookingId) return null

  const scheduledFor = readDate(data.scheduledFor)
  if (!scheduledFor) return null

  const rawTimeZone = readString(data.timeZone)
  if (!rawTimeZone || !isValidIanaTimeZone(rawTimeZone)) {
    return null
  }

  return {
    offsetMinutes,
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

  // Personalized, "Reminder:"-free copy (§12 NC1 #13). The relative phrase comes
  // from the lead time; the clock time comes from the appointment. A "manage"
  // nudge closes every reminder so the client always knows they can reschedule.
  const serviceLabel = payload.serviceName?.trim() || 'appointment'
  const withPro = payload.professionalName?.trim()
    ? ` with ${payload.professionalName.trim()}`
    : ''
  const timeLabel = formatTimeOnly(scheduledFor, payload.timeZone)
  const atTime = timeLabel ? ` at ${timeLabel}` : ''
  const manageNudge = ' Need to change it? Tap to manage.'

  const { relativeWhen, isTomorrow } = humanizeLeadTime(payload.offsetMinutes)

  const title = isTomorrow ? 'Appointment tomorrow' : 'Appointment reminder'

  return {
    title,
    body: `Your ${serviceLabel}${withPro} is ${relativeWhen}${atTime}.${manageNudge}`,
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
  offsetMinutes: number
}): Date | null {
  const scheduledFor = normalizeDateOrNull(args.scheduledFor)
  if (!scheduledFor) return null

  const timeZone = resolveAppointmentReminderTimeZone(args.timeZone)

  // Sub-day leads fire at an exact instant offset before the appointment.
  if (args.offsetMinutes % MINUTES_PER_DAY !== 0) {
    return new Date(scheduledFor.getTime() - args.offsetMinutes * 60_000)
  }

  // Whole-day leads preserve the appointment's own local wall-clock time N
  // calendar days earlier (DST-safe).
  const zonedScheduledFor = getZonedParts(scheduledFor, timeZone)

  const shiftedDate = shiftLocalCalendarDate({
    year: zonedScheduledFor.year,
    month: zonedScheduledFor.month,
    day: zonedScheduledFor.day,
    daysToSubtract: args.offsetMinutes / MINUTES_PER_DAY,
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
    left.offsetMinutes === right.offsetMinutes &&
    left.bookingId === right.bookingId &&
    left.scheduledFor === right.scheduledFor &&
    left.timeZone === right.timeZone &&
    left.serviceName === right.serviceName &&
    left.professionalName === right.professionalName
  )
}

function buildReminderPlanItem(args: {
  booking: BookingReminderRecord
  offsetMinutes: number
}): AppointmentReminderPlanItem | null {
  const { booking, offsetMinutes } = args

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
    offsetMinutes,
  })

  if (!runAt) return null

  return {
    offsetMinutes,
    dedupeKey: makeAppointmentReminderDedupeKey(booking.id, offsetMinutes),
    runAt,
    payload: buildAppointmentReminderPayload({
      bookingId: booking.id,
      offsetMinutes,
      scheduledFor,
      timeZone,
      serviceName: formatBookingServicesLabel(
        (booking.serviceItems ?? []).map((item) => ({
          name: item.service?.name,
          itemType: item.itemType,
        })),
        booking.service?.name ?? null,
      ),
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
  enabledOffsetMinutes: readonly number[]
  now?: Date
}): AppointmentReminderPlanItem[] {
  if (!isBookingEligibleForAppointmentReminders(args.booking)) {
    return []
  }

  const now = normalizeNowOrThrow(args.now, 'now')
  const plan: AppointmentReminderPlanItem[] = []

  // enabledOffsetMinutes is already deduped + sorted longest-lead first by the
  // settings resolver; keep that as the canonical schedule order.
  const seen = new Set<number>()
  for (const offsetMinutes of args.enabledOffsetMinutes) {
    if (seen.has(offsetMinutes)) continue
    seen.add(offsetMinutes)

    const item = buildReminderPlanItem({
      booking: args.booking,
      offsetMinutes,
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

  const enabledOffsetMinutes = await resolveEnabledReminderOffsetMinutes({
    professionalId: booking.professionalId,
    db: args.tx,
  })

  const plan = planBookingAppointmentReminders({
    booking,
    enabledOffsetMinutes,
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

  // The pro may have turned this offset off (or disabled reminders) since the
  // row was scheduled — drop it rather than send a reminder they no longer want.
  const enabledOffsetMinutes = await resolveEnabledReminderOffsetMinutes({
    professionalId: booking.professionalId,
    db: args.tx,
  })

  if (!enabledOffsetMinutes.includes(parsedPayload.offsetMinutes)) {
    return {
      action: 'CANCEL',
      reason:
        'Linked pro no longer schedules this appointment reminder offset.',
    }
  }

  const planned = buildReminderPlanItem({
    booking,
    offsetMinutes: parsedPayload.offsetMinutes,
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