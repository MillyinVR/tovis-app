// app/api/internal/jobs/client-reminders/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import {
  applyConfirmationAskToReminderContent,
  cancelDueAppointmentReminder,
  rescheduleDueAppointmentReminder,
  validateDueAppointmentReminder,
} from '@/lib/notifications/appointmentReminders'
import { clientConfirmationLoopEnabled } from '@/lib/booking/clientConfirmationLoop'
import { armAppointmentConfirmationAsk } from '@/lib/booking/writeBoundary'
import { validateDueReviewRequest } from '@/lib/notifications/reviewRequests'
import { validateDueDepositReminder } from '@/lib/notifications/depositReminders'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'
import { prisma } from '@/lib/prisma'
import { NotificationEventKey, Prisma } from '@prisma/client'
import { captureScheduledJobException } from '@/lib/observability/scheduledJobEvents'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

const DEFAULT_TAKE = 100
const MAX_TAKE = 250

const DUE_REMINDER_ORDER_BY = [
  { runAt: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ScheduledClientNotificationOrderByWithRelationInput[]

// Every scheduled-client-notification kind this cron drains. Each kind pairs
// with a drain-time validator that re-derives canonical state (PROCESS /
// SKIP / CANCEL) before the inbox row is created.
const DRAINED_EVENT_KEYS = [
  NotificationEventKey.APPOINTMENT_REMINDER,
  NotificationEventKey.REVIEW_REQUESTED,
  NotificationEventKey.DEPOSIT_REMINDER,
] as const

const dueReminderCandidateSelect = {
  id: true,
  eventKey: true,
} satisfies Prisma.ScheduledClientNotificationSelect

type DueReminderCandidate = Prisma.ScheduledClientNotificationGetPayload<{
  select: typeof dueReminderCandidateSelect
}>

type ProcessReminderResult =
  | {
      id: string
      status: 'processed'
    }
  | {
      id: string
      status: 'skipped'
    }
  | {
      id: string
      status: 'cancelled'
      reason: string
    }
  | {
      id: string
      status: 'rescheduled'
      runAt: string
      reason: string
    }
  | {
      id: string
      status: 'failed'
      error: string
    }

function readTake(req: Request): number {
  const url = new URL(req.url)
  const raw = url.searchParams.get('take')
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TAKE

  if (!Number.isFinite(parsed)) return DEFAULT_TAKE
  return Math.max(1, Math.min(MAX_TAKE, parsed))
}

async function markReminderProcessedIfPending(args: {
  tx: Prisma.TransactionClient
  rowId: string
  processedAt: Date
}): Promise<boolean> {
  const result = await args.tx.scheduledClientNotification.updateMany({
    where: {
      id: args.rowId,
      cancelledAt: null,
      processedAt: null,
    },
    data: {
      processedAt: args.processedAt,
      failedAt: null,
      lastError: null,
    },
  })

  return result.count === 1
}

async function markReminderRetryableFailureIfPending(args: {
  rowId: string
  error: string
}): Promise<boolean> {
  const result = await prisma.scheduledClientNotification.updateMany({
    where: {
      id: args.rowId,
      cancelledAt: null,
      processedAt: null,
    },
    data: {
      failedAt: null,
      lastError: args.error,
    },
  })

  return result.count === 1
}

const GENERIC_REMINDER_PROCESS_ERROR = 'Failed to process scheduled reminder'

function getSafeReminderProcessError(): string {
  return GENERIC_REMINDER_PROCESS_ERROR
}

async function processReminder(args: {
  rowId: string
  eventKey: NotificationEventKey
  now: Date
}): Promise<ProcessReminderResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const validation =
        args.eventKey === NotificationEventKey.REVIEW_REQUESTED
          ? await validateDueReviewRequest({
              tx,
              scheduledClientNotificationId: args.rowId,
              now: args.now,
            })
          : args.eventKey === NotificationEventKey.DEPOSIT_REMINDER
            ? await validateDueDepositReminder({
                tx,
                scheduledClientNotificationId: args.rowId,
                now: args.now,
              })
            : await validateDueAppointmentReminder({
                tx,
                scheduledClientNotificationId: args.rowId,
                now: args.now,
              })

      if (validation.action === 'SKIP') {
        return {
          id: args.rowId,
          status: 'skipped',
        }
      }

      if (validation.action === 'CANCEL') {
        await cancelDueAppointmentReminder({
          tx,
          scheduledClientNotificationId: args.rowId,
          reason: validation.reason,
          cancelledAt: args.now,
        })

        return {
          id: args.rowId,
          status: 'cancelled',
          reason: validation.reason,
        }
      }

      // Only the appointment-reminder validator can return this: the booking
      // moved and the row is now firing early, so re-arm it at the canonical
      // instant instead of cancelling a reminder nothing would ever re-plan.
      if (validation.action === 'RESCHEDULE') {
        await rescheduleDueAppointmentReminder({
          tx,
          scheduledClientNotificationId: validation.rowId,
          runAt: validation.runAt,
          data: validation.data,
        })

        return {
          id: validation.rowId,
          status: 'rescheduled',
          runAt: validation.runAt.toISOString(),
          reason: validation.reason,
        }
      }

      // K12: an appointment reminder is where the confirmation ASK goes out.
      // Arm it in the same transaction — stamp clientConfirmationRequestedAt
      // (first ask only), mint the APPOINTMENT_CONFIRMATION token, and point
      // the reminder at the public action page instead of the login-gated
      // booking view (one href for every channel — whoever holds the message
      // holds the token, by design, the card's accepted premise). Flag off,
      // or a booking that is no longer askable, sends the reminder exactly as
      // pre-K12.
      let reminderHref = validation.href
      let reminderContent = validation.notification

      if (
        args.eventKey === NotificationEventKey.APPOINTMENT_REMINDER &&
        clientConfirmationLoopEnabled()
      ) {
        const armed = await armAppointmentConfirmationAsk({
          tx,
          bookingId: validation.bookingId,
          now: args.now,
        })

        if (armed) {
          reminderHref = armed.href
          reminderContent = applyConfirmationAskToReminderContent(
            reminderContent,
          )
        }
      }

      await upsertClientNotification({
        tx,
        clientId: validation.clientId,
        bookingId: validation.bookingId,
        eventKey: args.eventKey,
        title: reminderContent.title,
        body: reminderContent.body,
        dedupeKey: validation.dedupeKey,
        href: reminderHref,
        data: reminderContent.data,
      })

      const markedProcessed = await markReminderProcessedIfPending({
        tx,
        rowId: validation.rowId,
        processedAt: args.now,
      })

      if (!markedProcessed) {
        return {
          id: validation.rowId,
          status: 'skipped',
        }
      }

      return {
        id: validation.rowId,
        status: 'processed',
      }
    })
  } catch (err: unknown) {
const message = getSafeReminderProcessError()

const markedRetryableFailure =
  await markReminderRetryableFailureIfPending({
    rowId: args.rowId,
    error: message,
  })

    if (!markedRetryableFailure) {
      return {
        id: args.rowId,
        status: 'skipped',
      }
    }

    return {
      id: args.rowId,
      status: 'failed',
      error: message,
    }
  }
}

async function loadDueRows(args: {
  now: Date
  take: number
}): Promise<DueReminderCandidate[]> {
  return prisma.scheduledClientNotification.findMany({
    where: {
      eventKey: { in: [...DRAINED_EVENT_KEYS] },
      cancelledAt: null,
      processedAt: null,
      failedAt: null,
      runAt: {
        lte: args.now,
      },
    },
    orderBy: DUE_REMINDER_ORDER_BY,
    take: args.take,
    select: dueReminderCandidateSelect,
  })
}

async function runJob(req: Request) {
  const secret = getInternalJobSecret()
  if (!secret) {
    return jsonFail(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  const now = new Date()
  const take = readTake(req)
  const dueRows = await loadDueRows({
    now,
    take,
  })

  const results: ProcessReminderResult[] = []

  /**
   * Deliberately sequential:
   * - predictable database load
   * - easier transaction behavior reasoning
   * - safer for internal cron jobs than blasting N transactions at once
   */
  for (const row of dueRows) {
    results.push(
      await processReminder({
        rowId: row.id,
        eventKey: row.eventKey,
        now,
      }),
    )
  }

  const processedCount = results.filter(
    (row) => row.status === 'processed',
  ).length

  const skippedCount = results.filter(
    (row) => row.status === 'skipped',
  ).length

  const cancelled = results.filter(
    (row): row is Extract<ProcessReminderResult, { status: 'cancelled' }> =>
      row.status === 'cancelled',
  )

  const rescheduled = results.filter(
    (row): row is Extract<ProcessReminderResult, { status: 'rescheduled' }> =>
      row.status === 'rescheduled',
  )

  const failed = results.filter(
    (row): row is Extract<ProcessReminderResult, { status: 'failed' }> =>
      row.status === 'failed',
  )

  return jsonOk({
    scannedCount: dueRows.length,
    processedCount,
    skippedCount,
    cancelledCount: cancelled.length,
    rescheduledCount: rescheduled.length,
    failedCount: failed.length,
    cancelled: cancelled.map((row) => ({
      id: row.id,
      reason: row.reason,
    })),
    rescheduled: rescheduled.map((row) => ({
      id: row.id,
      runAt: row.runAt,
      reason: row.reason,
    })),
    failed: failed.map((row) => ({
      id: row.id,
      error: row.error,
    })),
  })
}

async function handleJobRequest(req: Request, method: 'GET' | 'POST') {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error(`${method} /api/internal/jobs/client-reminders error`, {
      error: safeError(err),
    })
    // Nothing else notices this sweep going dark. It CREATES the appointment
    // reminders, review requests and deposit reminders that the delivery-health
    // probe later measures, and a probe over a queue that was never filled
    // reports healthy. The first symptom is a client who was never reminded.
    captureScheduledJobException({
      error: err,
      job: '/api/internal/jobs/client-reminders',
      event: 'CLIENT_REMINDERS_SWEEP_ERROR',
    })

    return jsonFail(500, 'Internal server error')
  }
}

export async function GET(req: Request) {
  return handleJobRequest(req, 'GET')
}

export async function POST(req: Request) {
  return handleJobRequest(req, 'POST')
}