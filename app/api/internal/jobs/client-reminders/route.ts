import { jsonFail, jsonOk } from '@/app/api/_utils'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'
import { prisma } from '@/lib/prisma'
import { ClientNotificationType, type Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const DEFAULT_TAKE = 100
const MAX_TAKE = 250

type ReminderKind = 'ONE_WEEK' | 'DAY_BEFORE' | 'UNKNOWN'

type DueReminderRow = {
  id: string
  clientId: string
  bookingId: string | null
  type: ClientNotificationType
  runAt: Date
  href: string
  dedupeKey: string | null
  data: Prisma.JsonValue | null
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
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

function formatWhen(date: Date | null, timeZone: string | null): string | null {
  if (!date) return null

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

function parseReminderPayload(data: Prisma.JsonValue | null): {
  reminderKind: ReminderKind
  scheduledFor: Date | null
  timeZone: string | null
  serviceName: string | null
  professionalName: string | null
} {
  if (!isRecord(data)) {
    return {
      reminderKind: 'UNKNOWN',
      scheduledFor: null,
      timeZone: null,
      serviceName: null,
      professionalName: null,
    }
  }

  const rawKind =
    readString(data.reminderKind) ??
    readString(data.kind) ??
    readString(data.reminderType)

  const reminderKind: ReminderKind =
    rawKind === 'ONE_WEEK' || rawKind === 'DAY_BEFORE' ? rawKind : 'UNKNOWN'

  return {
    reminderKind,
    scheduledFor:
      readDate(data.scheduledFor) ??
      readDate(data.appointmentAt) ??
      readDate(data.startsAt),
    timeZone: readString(data.timeZone),
    serviceName:
      readString(data.serviceName) ??
      readString(data.bookingTitle) ??
      readString(data.title),
    professionalName:
      readString(data.professionalName) ??
      readString(data.businessName) ??
      readString(data.proName),
  }
}

function buildReminderContent(row: DueReminderRow): {
  title: string
  body: string
  data: Prisma.InputJsonValue
} {
  const parsed = parseReminderPayload(row.data)
  const whenLabel = formatWhen(parsed.scheduledFor, parsed.timeZone)

  const subject = parsed.serviceName ? ` for ${parsed.serviceName}` : ''
  const withPro = parsed.professionalName ? ` with ${parsed.professionalName}` : ''
  const onWhen = whenLabel ? ` on ${whenLabel}` : ''

  if (parsed.reminderKind === 'ONE_WEEK') {
    return {
      title: 'Appointment reminder',
      body: `Reminder: your appointment${subject} is in one week${onWhen}${withPro}.`,
      data: {
        reminderKind: 'ONE_WEEK',
        bookingId: row.bookingId,
        scheduledFor: parsed.scheduledFor?.toISOString() ?? null,
        timeZone: parsed.timeZone,
        serviceName: parsed.serviceName,
        professionalName: parsed.professionalName,
      },
    }
  }

  if (parsed.reminderKind === 'DAY_BEFORE') {
    return {
      title: 'Appointment tomorrow',
      body: `Reminder: your appointment${subject} is tomorrow${onWhen}${withPro}.`,
      data: {
        reminderKind: 'DAY_BEFORE',
        bookingId: row.bookingId,
        scheduledFor: parsed.scheduledFor?.toISOString() ?? null,
        timeZone: parsed.timeZone,
        serviceName: parsed.serviceName,
        professionalName: parsed.professionalName,
      },
    }
  }

  return {
    title: 'Appointment reminder',
    body: `Reminder: you have an upcoming appointment${subject}${onWhen}${withPro}.`,
    data: {
      reminderKind: 'UNKNOWN',
      bookingId: row.bookingId,
      scheduledFor: parsed.scheduledFor?.toISOString() ?? null,
      timeZone: parsed.timeZone,
      serviceName: parsed.serviceName,
      professionalName: parsed.professionalName,
    },
  }
}

async function processReminder(row: DueReminderRow): Promise<{
  id: string
  status: 'processed' | 'skipped' | 'failed'
  error?: string
}> {
  const notification = buildReminderContent(row)
  const dedupeKey = row.dedupeKey ?? `SCHEDULED_CLIENT_NOTIFICATION:${row.id}`
  const href =
    readString(row.href) ??
    (row.bookingId ? `/client/bookings/${row.bookingId}?step=overview` : '')

  try {
    const result = await prisma.$transaction(async (tx) => {
      const stillDue = await tx.scheduledClientNotification.findFirst({
        where: {
          id: row.id,
          cancelledAt: null,
          processedAt: null,
        },
        select: { id: true },
      })

      if (!stillDue) {
        return { status: 'skipped' as const }
      }

      await upsertClientNotification({
        tx,
        clientId: row.clientId,
        bookingId: row.bookingId,
        type: ClientNotificationType.APPOINTMENT_REMINDER,
        title: notification.title,
        body: notification.body,
        dedupeKey,
        href,
        data: notification.data,
      })

      await tx.scheduledClientNotification.update({
        where: { id: row.id },
        data: {
          processedAt: new Date(),
          failedAt: null,
          lastError: null,
        },
      })

      return { status: 'processed' as const }
    })

    return {
      id: row.id,
      status: result.status,
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to process scheduled reminder'

    await prisma.scheduledClientNotification.updateMany({
      where: {
        id: row.id,
        processedAt: null,
      },
      data: {
        failedAt: new Date(),
        lastError: message,
      },
    })

    return {
      id: row.id,
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

  const dueRows: DueReminderRow[] = await prisma.scheduledClientNotification.findMany({
    where: {
      type: ClientNotificationType.APPOINTMENT_REMINDER,
      cancelledAt: null,
      processedAt: null,
      runAt: {
        lte: now,
      },
    },
    orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take,
    select: {
      id: true,
      clientId: true,
      bookingId: true,
      type: true,
      runAt: true,
      href: true,
      dedupeKey: true,
      data: true,
    },
  })

  const results = await Promise.all(dueRows.map((row) => processReminder(row)))

  const processedCount = results.filter((row) => row.status === 'processed').length
  const skippedCount = results.filter((row) => row.status === 'skipped').length
  const failed = results.filter((row) => row.status === 'failed')

  return jsonOk({
    scannedCount: dueRows.length,
    processedCount,
    skippedCount,
    failedCount: failed.length,
    failed: failed.map((row) => ({
      id: row.id,
      error: row.error ?? 'Unknown error',
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