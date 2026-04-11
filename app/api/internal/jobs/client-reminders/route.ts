import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  cancelDueAppointmentReminder,
  validateDueAppointmentReminder,
} from '@/lib/notifications/appointmentReminders'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'
import { prisma } from '@/lib/prisma'
import { NotificationEventKey } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_TAKE = 100
const MAX_TAKE = 250

type DueReminderCandidate = {
  id: string
}

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

function getJobSecret(): string | null {
  const raw = process.env.INTERNAL_JOB_SECRET ?? process.env.CRON_SECRET ?? null
  if (!raw) return null

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isAuthorizedJobRequest(req: Request): boolean {
  const secret = getJobSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true

  const internalHeader = req.headers.get('x-internal-job-secret')
  if (internalHeader === secret) return true

  return false
}

async function processReminder(args: {
  rowId: string
  now: Date
}): Promise<ProcessReminderResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const validation = await validateDueAppointmentReminder({
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
        })

        return {
          id: args.rowId,
          status: 'cancelled',
          reason: validation.reason,
        }
      }

      await upsertClientNotification({
        tx,
        clientId: validation.clientId,
        bookingId: validation.bookingId,
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        title: validation.notification.title,
        body: validation.notification.body,
        dedupeKey: validation.dedupeKey,
        href: validation.href,
        data: validation.notification.data,
      })

      await tx.scheduledClientNotification.update({
        where: { id: validation.rowId },
        data: {
          processedAt: args.now,
          failedAt: null,
          lastError: null,
        },
      })

      return {
        id: validation.rowId,
        status: 'processed',
      }
    })
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to process scheduled reminder'

    await prisma.scheduledClientNotification.updateMany({
      where: {
        id: args.rowId,
        cancelledAt: null,
        processedAt: null,
      },
      data: {
        failedAt: new Date(),
        lastError: message,
      },
    })

    return {
      id: args.rowId,
      status: 'failed',
      error: message,
    }
  }
}

async function runJob(req: Request) {
  const secret = getJobSecret()
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

  const dueRows: DueReminderCandidate[] =
    await prisma.scheduledClientNotification.findMany({
      where: {
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        cancelledAt: null,
        processedAt: null,
        failedAt: null,
        runAt: {
          lte: now,
        },
      },
      orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: {
        id: true,
      },
    })

  const results: ProcessReminderResult[] = []

  /**
   * Deliberately sequential:
   * - predictable database load
   * - easier lock behavior reasoning
   * - safer for internal cron jobs than blasting N transactions at once
   */
  for (const row of dueRows) {
    results.push(
      await processReminder({
        rowId: row.id,
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

  const failed = results.filter(
    (row): row is Extract<ProcessReminderResult, { status: 'failed' }> =>
      row.status === 'failed',
  )

  return jsonOk({
    scannedCount: dueRows.length,
    processedCount,
    skippedCount,
    cancelledCount: cancelled.length,
    failedCount: failed.length,
    cancelled: cancelled.map((row) => ({
      id: row.id,
      reason: row.reason,
    })),
    failed: failed.map((row) => ({
      id: row.id,
      error: row.error,
    })),
  })
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('GET /api/internal/jobs/client-reminders error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('POST /api/internal/jobs/client-reminders error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}