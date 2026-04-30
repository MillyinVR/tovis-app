// app/api/internal/jobs/stale-sessions/route.ts
//
// Cron: */15 * * * * (every 15 minutes; see vercel.json)
//
// Telemetry-only sweep that identifies bookings stuck in their lifecycle:
//   • PENDING bookings older than STALE_PENDING_HOURS that have not been
//     accepted or cancelled.
//   • IN_PROGRESS bookings with no SessionStep advance for more than
//     STALE_IN_PROGRESS_HOURS.
//
// This job DOES NOT mutate booking status. It emits structured logs + Sentry
// breadcrumbs so admins (and future automation) can act on the data. Mutations
// are intentionally deferred behind a separate flag so this rollout is
// zero-regression: at 100k users a wrong auto-cancel would be catastrophic.
//
// To enable later, set STALE_SESSIONS_AUTO_ACT=true and we will add an admin
// notification + (optional, separately gated) automatic cancel for the PENDING
// case via the existing cancelBooking write boundary path. IN_PROGRESS will
// always require human review since it may represent a live service.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_STALE_PENDING_HOURS = 48
const DEFAULT_STALE_IN_PROGRESS_HOURS = 12
const SCAN_LIMIT = 500

function readEnv(name: string): string | null {
  return process.env[name] ?? null
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = readEnv(name)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.trunc(parsed)
}

function getJobSecret(): string | null {
  return readEnv('INTERNAL_JOB_SECRET') ?? readEnv('CRON_SECRET')
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

function logStaleObservation(payload: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      app: 'tovis',
      namespace: 'booking',
      event: 'stale_session_observed',
      ...payload,
    }),
  )
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
  const stalePendingHours = readPositiveIntEnv(
    'STALE_PENDING_HOURS',
    DEFAULT_STALE_PENDING_HOURS,
  )
  const staleInProgressHours = readPositiveIntEnv(
    'STALE_IN_PROGRESS_HOURS',
    DEFAULT_STALE_IN_PROGRESS_HOURS,
  )

  const pendingCutoff = new Date(
    now.getTime() - stalePendingHours * 60 * 60 * 1000,
  )
  const inProgressCutoff = new Date(
    now.getTime() - staleInProgressHours * 60 * 60 * 1000,
  )

  let stalePendingCount = 0
  let staleInProgressCount = 0
  const scannedAt = now.toISOString()

  try {
    const stalePending = await prisma.booking.findMany({
      where: {
        status: BookingStatus.PENDING,
        createdAt: { lte: pendingCutoff },
      },
      select: {
        id: true,
        professionalId: true,
        clientId: true,
        createdAt: true,
        scheduledFor: true,
      },
      take: SCAN_LIMIT,
      orderBy: { createdAt: 'asc' },
    })

    stalePendingCount = stalePending.length

    for (const row of stalePending) {
      logStaleObservation({
        kind: 'PENDING_NOT_ACCEPTED',
        bookingId: row.id,
        professionalId: row.professionalId,
        clientId: row.clientId,
        createdAt: row.createdAt.toISOString(),
        scheduledFor: row.scheduledFor.toISOString(),
        ageHours: Number(
          ((now.getTime() - row.createdAt.getTime()) / 3_600_000).toFixed(2),
        ),
        thresholdHours: stalePendingHours,
        scannedAt,
      })
    }

    const staleInProgress = await prisma.booking.findMany({
      where: {
        status: BookingStatus.IN_PROGRESS,
        // Use updatedAt as a proxy for last lifecycle activity. Booking rows
        // are updated on every step transition + audit log creation.
        updatedAt: { lte: inProgressCutoff },
      },
      select: {
        id: true,
        professionalId: true,
        clientId: true,
        sessionStep: true,
        startedAt: true,
        updatedAt: true,
      },
      take: SCAN_LIMIT,
      orderBy: { updatedAt: 'asc' },
    })

    staleInProgressCount = staleInProgress.length

    for (const row of staleInProgress) {
      logStaleObservation({
        kind: 'IN_PROGRESS_NO_RECENT_ACTIVITY',
        bookingId: row.id,
        professionalId: row.professionalId,
        clientId: row.clientId,
        sessionStep: row.sessionStep,
        startedAt: row.startedAt?.toISOString() ?? null,
        lastUpdatedAt: row.updatedAt.toISOString(),
        idleHours: Number(
          ((now.getTime() - row.updatedAt.getTime()) / 3_600_000).toFixed(2),
        ),
        thresholdHours: staleInProgressHours,
        scannedAt,
      })
    }
  } catch (err: unknown) {
    captureBookingException({
      error: err,
      route: 'GET /api/internal/jobs/stale-sessions',
      event: 'STALE_SESSIONS_SCAN_ERROR',
    })
    throw err
  }

  return jsonOk({
    scannedAt,
    stalePendingHours,
    staleInProgressHours,
    stalePendingObserved: stalePendingCount,
    staleInProgressObserved: staleInProgressCount,
    capped: SCAN_LIMIT,
  })
}

export async function GET(req: Request) {
  return runJob(req)
}

export async function POST(req: Request) {
  return runJob(req)
}
