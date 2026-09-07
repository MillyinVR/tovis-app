// lib/notifications/consultPrepReminders.ts
//
// P7a-4 — the escalation that makes the prep deadline real.
//
// Shaped deliberately like lib/notifications/appointmentReminders.ts, because
// that file already solved this problem once and got the hard part right: a
// scheduled row is a GUESS about the future, so nothing it carries may be
// trusted at the moment it fires. Between writing the row and draining it the
// client may have answered everything, the booking may have been cancelled or
// moved, or the appointment may simply have happened. Every one of those makes
// the row wrong, and only one of them (cancellation) has a hook that could
// have cleaned it up.
//
// So the rule here is the same: PLAN eagerly, VALIDATE at drain. The plan is
// what gets the reminder into the queue; the validator is what decides whether
// a due row becomes a notification, gets moved, or is dropped. That is what
// makes "reminders stop when prep completes or the booking is cancelled" true
// even for the cancel path that forgets to call us
// (`cancelImportedBookingIfPristine` does not, and does not have to).
//
// 🔴 The three scheduled stages are measured from the DEADLINE, not from the
// appointment (Tori, 2026-09-06). With hair's N of 48 hours an
// appointment-relative "24 hours before" would land a full day AFTER the
// deadline it is nagging about — a reminder to beat a deadline that has
// already gone. Deadline-relative is the only ordering that escalates.

import 'server-only'

import {
  BookingStatus,
  ConsultRevisionKind,
  NotificationEventKey,
  Prisma,
} from '@prisma/client'

import { defaultClientConsultPrepCopy } from '@/lib/brand/defaultClientConsultPrepCopy'
import type {
  BrandClientConsultPrepCopy,
  BrandClientConsultPrepMessage,
} from '@/lib/brand/types'
import {
  CONSULT_PREP_SESSION_SELECT,
  consultPrepDeadlineAt,
  deriveConsultPrepState,
  type ConsultPrepSession,
  type ConsultPrepState,
} from '@/lib/consult/prepDeadline'
import { consultLinkedBooking } from '@/lib/consult/openWindow'
import { resolveConsultServiceProfile } from '@/lib/consult/serviceProfile'
import { fillConsultThreadCopy } from '@/lib/consult/threadCopy'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import {
  scheduleClientNotification,
  upsertClientNotification,
} from '@/lib/notifications/clientNotifications'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'
import {
  DEFAULT_TIME_ZONE,
  addElapsedHours,
  formatInTimeZone,
  sanitizeTimeZone,
} from '@/lib/time'

/**
 * The escalation, in firing order.
 *
 * BOOKED is emitted immediately rather than scheduled — it is a receipt for
 * something the client just did, and a client who taps Book and hears nothing
 * about prep for five days has been told, by silence, that there is nothing to
 * do. The other three are scheduled rows.
 */
export const CONSULT_PREP_REMINDER_STAGES = [
  'BOOKED',
  'AHEAD',
  'SOON',
  'DUE',
] as const

export type ConsultPrepReminderStage =
  (typeof CONSULT_PREP_REMINDER_STAGES)[number]

/** Hours BEFORE the deadline each scheduled stage fires. `DUE` is the deadline. */
const SCHEDULED_STAGE_LEAD_HOURS: Readonly<
  Record<Exclude<ConsultPrepReminderStage, 'BOOKED'>, number>
> = {
  AHEAD: 72,
  SOON: 24,
  DUE: 0,
}

const STAGE_COPY_KEY: Readonly<
  Record<ConsultPrepReminderStage, keyof BrandClientConsultPrepCopy>
> = {
  BOOKED: 'booked',
  AHEAD: 'ahead',
  SOON: 'soon',
  DUE: 'due',
}

/**
 * Bookings that still owe the client a prep reminder.
 *
 * The same set `resolveConsultSparkLink` calls the link-HOLDING statuses, and
 * for the same reason: while one of these is true there is an appointment to
 * be ready for. A COMPLETED booking is excluded because the chair has already
 * happened, and CANCELLED / NO_SHOW because it never will.
 */
const REMINDABLE_BOOKING_STATUSES = new Set<BookingStatus>([
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
])

export type ConsultPrepReminderPayload = {
  stage: ConsultPrepReminderStage
  consultSessionId: string
  bookingId: string
  /** The deadline this row was planned against, ISO-8601. */
  deadlineAt: string
  timeZone: string
}

export type ConsultPrepReminderContent = {
  title: string
  body: string
  data: Prisma.InputJsonValue
}

type ConsultPrepReminderPlanItem = {
  stage: ConsultPrepReminderStage
  dedupeKey: string
  runAt: Date
  payload: ConsultPrepReminderPayload
}

/**
 * One row per (consult, stage), FOREVER.
 *
 * Keyed on the consult rather than the booking so that a client who cancels
 * and re-books the same spark is not re-nudged through the whole escalation —
 * the consult is the thing being prepared, and she has already been asked. The
 * `@@unique([clientId, dedupeKey])` on ScheduledClientNotification is what
 * turns that into "fires once each".
 */
function prepReminderDedupeKey(
  consultSessionId: string,
  stage: ConsultPrepReminderStage,
): string {
  return `consult-prep:${consultSessionId}:${stage}`
}

function prepReminderHref(consultSessionId: string): string {
  return `/client/consults/${consultSessionId}`
}

/**
 * The client's own zone for rendering the deadline date.
 *
 * The booking's location zone, sanitized — the same source
 * `appointmentReminders` uses, and for the same reason: the appointment's zone
 * is the one the client is thinking in when she reads "due Wednesday".
 */
function resolvePrepReminderTimeZone(value: string | null | undefined): string {
  return sanitizeTimeZone(value) ?? DEFAULT_TIME_ZONE
}

/** The deadline as the client reads it — a date, never a countdown. */
export function formatPrepDeadline(deadlineAt: Date, timeZone: string): string {
  return formatInTimeZone(deadlineAt, timeZone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export function buildConsultPrepReminderContent(args: {
  payload: ConsultPrepReminderPayload
  professionalName: string | null
  copy?: BrandClientConsultPrepCopy
}): ConsultPrepReminderContent {
  const copy = args.copy ?? defaultClientConsultPrepCopy
  const message: BrandClientConsultPrepMessage =
    copy[STAGE_COPY_KEY[args.payload.stage]]

  const slots = {
    pro: args.professionalName,
    deadline: formatPrepDeadline(
      new Date(args.payload.deadlineAt),
      args.payload.timeZone,
    ),
  }

  return {
    title: fillConsultThreadCopy(message.title, slots),
    body: fillConsultThreadCopy(message.body, slots),
    data: {
      stage: args.payload.stage,
      consultSessionId: args.payload.consultSessionId,
      bookingId: args.payload.bookingId,
      deadlineAt: args.payload.deadlineAt,
      timeZone: args.payload.timeZone,
    },
  }
}

export function parseConsultPrepReminderPayload(
  value: unknown,
): ConsultPrepReminderPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const stage = record.stage
  const consultSessionId = record.consultSessionId
  const bookingId = record.bookingId
  const deadlineAt = record.deadlineAt
  const timeZone = record.timeZone
  if (
    typeof stage !== 'string' ||
    !CONSULT_PREP_REMINDER_STAGES.includes(
      stage as ConsultPrepReminderStage,
    ) ||
    typeof consultSessionId !== 'string' ||
    !consultSessionId ||
    typeof bookingId !== 'string' ||
    !bookingId ||
    typeof deadlineAt !== 'string' ||
    Number.isNaN(new Date(deadlineAt).getTime()) ||
    typeof timeZone !== 'string'
  ) {
    return null
  }
  return {
    stage: stage as ConsultPrepReminderStage,
    consultSessionId,
    bookingId,
    deadlineAt,
    timeZone: resolvePrepReminderTimeZone(timeZone),
  }
}

/**
 * The scheduled half of the escalation, given a session and its prep state.
 *
 * Returns nothing at all when there is nothing to remind about: no live
 * appointment, no deadline, or prep already complete. Stages whose instant has
 * already passed are dropped rather than fired late — the same rule
 * `planBookingAppointmentReminders` applies, and the reason is the same: a
 * client who books three days before her appointment should not receive the
 * 72-hours-before nudge retroactively, all at once, on the next cron tick.
 */
export function planConsultPrepReminders(args: {
  session: ConsultPrepSession
  prep: ConsultPrepState
  now: Date
}): ConsultPrepReminderPlanItem[] {
  if (args.prep.complete) return []

  const booking = consultLinkedBooking(args.session)
  if (!booking || !REMINDABLE_BOOKING_STATUSES.has(booking.status)) return []

  const deadlineAt = args.prep.deadlineAt
  if (!deadlineAt) return []

  const timeZone = resolvePrepReminderTimeZone(booking.locationTimeZone)

  const plan: ConsultPrepReminderPlanItem[] = []
  for (const [stage, leadHours] of Object.entries(
    SCHEDULED_STAGE_LEAD_HOURS,
  ) as [Exclude<ConsultPrepReminderStage, 'BOOKED'>, number][]) {
    const runAt = addElapsedHours(deadlineAt, -leadHours)
    if (runAt.getTime() <= args.now.getTime()) continue
    plan.push({
      stage,
      dedupeKey: prepReminderDedupeKey(args.session.id, stage),
      runAt,
      payload: {
        stage,
        consultSessionId: args.session.id,
        bookingId: booking.id,
        deadlineAt: deadlineAt.toISOString(),
        timeZone,
      },
    })
  }
  return plan
}

/**
 * Read the consult, plan the escalation, and write the rows.
 *
 * Cancels the consult's pending rows first, so a reschedule re-plans rather
 * than accumulating. Idempotent: running it twice writes the same dedupe keys.
 */
export async function syncConsultPrepReminders(args: {
  tx: Prisma.TransactionClient
  consultSessionId: string
  now?: Date
}): Promise<{ scheduled: number }> {
  const now = args.now ?? new Date()

  const session = await args.tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: CONSULT_PREP_SESSION_SELECT,
  })
  if (!session) return { scheduled: 0 }

  const revisions = await args.tx.consultRevision.findMany({
    where: { consultSessionId: session.id, kind: ConsultRevisionKind.INTAKE },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    select: { payload: true },
  })
  const prep = deriveConsultPrepState({
    session,
    intakePayloads: revisions.map((revision) => revision.payload),
  })

  await cancelConsultPrepReminders({
    tx: args.tx,
    consultSessionId: session.id,
    clientId: session.clientId,
  })

  const plan = planConsultPrepReminders({ session, prep, now })
  for (const item of plan) {
    await scheduleClientNotification({
      tx: args.tx,
      clientId: session.clientId,
      eventKey: NotificationEventKey.CONSULT_PREP_REMINDER,
      runAt: item.runAt,
      href: prepReminderHref(session.id),
      data: item.payload,
      dedupeKey: item.dedupeKey,
      bookingId: item.payload.bookingId,
    })
  }
  return { scheduled: plan.length }
}

/**
 * Stop the escalation.
 *
 * Called when prep completes and when the booking dies. Scoped to the
 * CONSULT's dedupe keys rather than to the booking id, because a consult's
 * reminders must not survive a booking that has been replaced — and because
 * the "prep complete" case has no booking event to hang off at all.
 */
export async function cancelConsultPrepReminders(args: {
  tx: Prisma.TransactionClient
  consultSessionId: string
  clientId: string
}): Promise<void> {
  await args.tx.scheduledClientNotification.updateMany({
    where: {
      clientId: args.clientId,
      eventKey: NotificationEventKey.CONSULT_PREP_REMINDER,
      dedupeKey: {
        in: CONSULT_PREP_REMINDER_STAGES.map((stage) =>
          prepReminderDedupeKey(args.consultSessionId, stage),
        ),
      },
      cancelledAt: null,
      processedAt: null,
    },
    data: { cancelledAt: new Date(), failedAt: null, lastError: null },
  })
}

/**
 * The immediate "you're booked, and here is the deadline" reminder.
 *
 * Emitted rather than scheduled so it lands with the booking confirmation
 * instead of on the next quarter-hour cron tick. Never throws: a notification
 * that cannot be written must not roll back a booking that succeeded — the
 * same rule `notifyConsultAnalysisRunSettled` keeps.
 */
export async function notifyConsultPrepStarted(args: {
  /**
   * The booking that was just made. The consult is resolved FROM it
   * (`Booking.sourceConsultSessionId`), never from a consult id the caller
   * supplied: the route's `sparkConsultId` is the client's claim, and
   * `resolveConsultSparkLink` may have refused it. Reading the stamped link
   * means this can only ever notify the client whose consult was actually
   * attached — a claim naming someone else's consult resolves to nothing.
   */
  bookingId: string
  copy?: BrandClientConsultPrepCopy
}): Promise<
  | 'SENT'
  | 'SKIPPED_NO_CONSULT'
  | 'SKIPPED_COMPLETE'
  | 'SKIPPED_NO_DEADLINE'
  | 'SKIPPED_ERROR'
> {
  try {
    const linked = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: { sourceConsultSessionId: true },
    })
    if (!linked?.sourceConsultSessionId) return 'SKIPPED_NO_CONSULT'

    const session = await prisma.consultSession.findUnique({
      where: { id: linked.sourceConsultSessionId },
      select: {
        ...CONSULT_PREP_SESSION_SELECT,
        professional: { select: professionalPublicDisplayNameSelect },
      },
    })
    if (!session) return 'SKIPPED_ERROR'

    const revisions = await prisma.consultRevision.findMany({
      where: { consultSessionId: session.id, kind: ConsultRevisionKind.INTAKE },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: { payload: true },
    })
    const prep = deriveConsultPrepState({
      session,
      intakePayloads: revisions.map((revision) => revision.payload),
    })
    if (prep.complete) return 'SKIPPED_COMPLETE'

    const booking = consultLinkedBooking(session)
    if (!booking || !prep.deadlineAt) return 'SKIPPED_NO_DEADLINE'

    const payload: ConsultPrepReminderPayload = {
      stage: 'BOOKED',
      consultSessionId: session.id,
      bookingId: booking.id,
      deadlineAt: prep.deadlineAt.toISOString(),
      timeZone: resolvePrepReminderTimeZone(booking.locationTimeZone),
    }
    const content = buildConsultPrepReminderContent({
      payload,
      professionalName: formatProfessionalPublicDisplayName(
        session.professional,
      ),
      copy: args.copy,
    })

    await upsertClientNotification({
      clientId: session.clientId,
      eventKey: NotificationEventKey.CONSULT_PREP_REMINDER,
      title: content.title,
      body: content.body,
      href: prepReminderHref(session.id),
      data: content.data,
      dedupeKey: prepReminderDedupeKey(session.id, 'BOOKED'),
      bookingId: booking.id,
    })
    return 'SENT'
  } catch (error) {
    console.error(
      '[consult-prep] failed to emit the booked reminder',
      safeError(error),
    )
    return 'SKIPPED_ERROR'
  }
}

// ── Drain-time validation ──────────────────────────────────────────────────

export type ValidateDueConsultPrepReminderResult =
  | {
      action: 'PROCESS'
      rowId: string
      clientId: string
      bookingId: string
      dedupeKey: string
      href: string
      notification: ConsultPrepReminderContent
    }
  | { action: 'SKIP' }
  /**
   * The booking moved after the row was written, so the canonical deadline has
   * moved with it. Re-armed rather than cancelled, for the reason
   * `appointmentReminders` records: cancelling is silent and terminal, and a
   * reschedule that forgot to re-plan would cost the client the reminder
   * entirely.
   */
  | {
      action: 'RESCHEDULE'
      rowId: string
      runAt: Date
      data: ConsultPrepReminderPayload
      reason: string
    }
  | { action: 'CANCEL'; reason: string }

/**
 * Decide what a due row becomes, re-deriving everything from canonical state.
 *
 * This is where "reminders stop when prep completes or the booking is
 * cancelled" is actually guaranteed. The eager cancels are a courtesy that
 * clears the queue early; this is the check that cannot be skipped, because
 * nothing can send a notification without passing through it.
 */
export async function validateDueConsultPrepReminder(args: {
  tx: Prisma.TransactionClient
  scheduledClientNotificationId: string
  now?: Date
  copy?: BrandClientConsultPrepCopy
}): Promise<ValidateDueConsultPrepReminderResult> {
  const now = args.now ?? new Date()
  const { tx } = args

  const row = await tx.scheduledClientNotification.findUnique({
    where: { id: args.scheduledClientNotificationId },
    select: {
      id: true,
      clientId: true,
      eventKey: true,
      dedupeKey: true,
      data: true,
      processedAt: true,
      cancelledAt: true,
    },
  })
  if (
    !row ||
    row.processedAt ||
    row.cancelledAt ||
    row.eventKey !== NotificationEventKey.CONSULT_PREP_REMINDER
  ) {
    return { action: 'SKIP' }
  }

  const payload = parseConsultPrepReminderPayload(row.data)
  if (!payload) {
    return { action: 'CANCEL', reason: 'UNREADABLE_PAYLOAD' }
  }

  const session = await tx.consultSession.findUnique({
    where: { id: payload.consultSessionId },
    select: {
      ...CONSULT_PREP_SESSION_SELECT,
      professional: { select: professionalPublicDisplayNameSelect },
    },
  })
  if (!session || session.clientId !== row.clientId) {
    return { action: 'CANCEL', reason: 'CONSULT_GONE' }
  }

  const revisions = await tx.consultRevision.findMany({
    where: { consultSessionId: session.id, kind: ConsultRevisionKind.INTAKE },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    select: { payload: true },
  })
  const prep = deriveConsultPrepState({
    session,
    intakePayloads: revisions.map((revision) => revision.payload),
  })

  // She answered. Nothing more to say — and saying it anyway would be the app
  // failing to notice the thing it asked her to do.
  if (prep.complete) return { action: 'CANCEL', reason: 'PREP_COMPLETE' }

  const booking = consultLinkedBooking(session)
  if (!booking || !REMINDABLE_BOOKING_STATUSES.has(booking.status)) {
    return { action: 'CANCEL', reason: 'BOOKING_NOT_REMINDABLE' }
  }

  // The appointment has started (or already happened). The deadline is behind
  // us and the pro's day-of flag is the surface that carries it now — a client
  // in the chair does not need a nudge about being ready for the chair.
  if (booking.scheduledFor.getTime() <= now.getTime()) {
    return { action: 'CANCEL', reason: 'APPOINTMENT_STARTED' }
  }

  const profile = resolveConsultServiceProfile(session.serviceCategory)
  const canonicalDeadline = consultPrepDeadlineAt({
    scheduledFor: booking.scheduledFor,
    prepDeadlineHours: profile.prepDeadlineHours,
  })
  const leadHours =
    payload.stage === 'BOOKED'
      ? 0
      : SCHEDULED_STAGE_LEAD_HOURS[
          payload.stage as Exclude<ConsultPrepReminderStage, 'BOOKED'>
        ]
  const canonicalRunAt = addElapsedHours(canonicalDeadline, -leadHours)

  // The booking moved forward: this stage is in the future again.
  if (canonicalRunAt.getTime() > now.getTime()) {
    return {
      action: 'RESCHEDULE',
      rowId: row.id,
      runAt: canonicalRunAt,
      data: {
        ...payload,
        bookingId: booking.id,
        deadlineAt: canonicalDeadline.toISOString(),
        timeZone: resolvePrepReminderTimeZone(
          booking.locationTimeZone ?? payload.timeZone,
        ),
      },
      reason: 'BOOKING_MOVED_LATER',
    }
  }

  const currentPayload: ConsultPrepReminderPayload = {
    ...payload,
    bookingId: booking.id,
    deadlineAt: canonicalDeadline.toISOString(),
    timeZone: resolvePrepReminderTimeZone(
      booking.locationTimeZone ?? payload.timeZone,
    ),
  }

  return {
    action: 'PROCESS',
    rowId: row.id,
    clientId: row.clientId,
    bookingId: booking.id,
    dedupeKey: row.dedupeKey ?? prepReminderDedupeKey(session.id, payload.stage),
    href: prepReminderHref(session.id),
    notification: buildConsultPrepReminderContent({
      payload: currentPayload,
      professionalName: formatProfessionalPublicDisplayName(
        session.professional,
      ),
      copy: args.copy,
    }),
  }
}
