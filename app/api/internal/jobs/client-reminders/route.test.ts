import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const NOW = new Date('2026-04-13T18:30:00.000Z')

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  scheduledClientNotificationFindMany: vi.fn(),
  scheduledClientNotificationUpdateMany: vi.fn(),
  transaction: vi.fn(),

  validateDueAppointmentReminder: vi.fn(),
  cancelDueAppointmentReminder: vi.fn(),
  validateDueReviewRequest: vi.fn(),
  upsertClientNotification: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scheduledClientNotification: {
      findMany: mocks.scheduledClientNotificationFindMany,
      updateMany: mocks.scheduledClientNotificationUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  validateDueAppointmentReminder: mocks.validateDueAppointmentReminder,
  cancelDueAppointmentReminder: mocks.cancelDueAppointmentReminder,
}))

vi.mock('@/lib/notifications/reviewRequests', () => ({
  validateDueReviewRequest: mocks.validateDueReviewRequest,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { GET, POST } from './route'

type Tx = {
  scheduledClientNotification: {
    updateMany: typeof mocks.scheduledClientNotificationUpdateMany
  }
}

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeRequest(args?: {
  method?: 'GET' | 'POST'
  url?: string
  authorization?: string
  internalSecret?: string
}): Request {
  const headers = new Headers()

  if (args?.authorization) {
    headers.set('authorization', args.authorization)
  }

  if (args?.internalSecret) {
    headers.set('x-internal-job-secret', args.internalSecret)
  }

  return new Request(
    args?.url ?? 'http://localhost/api/internal/jobs/client-reminders',
    {
      method: args?.method ?? 'GET',
      headers,
    },
  )
}

function makeTx(): Tx {
  return {
    scheduledClientNotification: {
      updateMany: mocks.scheduledClientNotificationUpdateMany,
    },
  }
}

function makeSendValidation(overrides?: Partial<{
  rowId: string
  clientId: string
  bookingId: string
  dedupeKey: string
  href: string
}>) {
  return {
    action: 'SEND' as const,
    rowId: overrides?.rowId ?? 'reminder_1',
    clientId: overrides?.clientId ?? 'client_1',
    bookingId: overrides?.bookingId ?? 'booking_1',
    dedupeKey:
      overrides?.dedupeKey ?? 'appointment-reminder:booking_1:client_1',
    href: overrides?.href ?? '/client/bookings/booking_1',
    notification: {
      title: 'Appointment reminder',
      body: 'Your appointment is coming up.',
      data: {
        bookingId: overrides?.bookingId ?? 'booking_1',
      },
    },
  }
}

describe('app/api/internal/jobs/client-reminders/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET
    process.env.INTERNAL_JOB_SECRET = 'job_secret_1'

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, {
        ok: false,
        error,
      }),
    )

    mocks.jsonOk.mockImplementation((data: Record<string, unknown>) =>
      makeJsonResponse(200, {
        ok: true,
        ...data,
      }),
    )

    mocks.scheduledClientNotificationFindMany.mockResolvedValue([])

    mocks.transaction.mockImplementation(
      async (callback: (tx: Tx) => Promise<unknown>) => callback(makeTx()),
    )

    mocks.validateDueAppointmentReminder.mockResolvedValue(makeSendValidation())

    mocks.cancelDueAppointmentReminder.mockResolvedValue(undefined)
    mocks.upsertClientNotification.mockResolvedValue({
      id: 'client_notification_1',
    })

    mocks.scheduledClientNotificationUpdateMany.mockResolvedValue({
      count: 1,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET
  })

  it('GET returns 500 when no job secret is configured', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    })

    expect(mocks.scheduledClientNotificationFindMany).not.toHaveBeenCalled()
  })

  it('GET returns 401 when request is unauthorized', async () => {
    const result = await GET(makeRequest())

    expect(result.status).toBe(401)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.scheduledClientNotificationFindMany).not.toHaveBeenCalled()
  })

  it('GET loads due reminders with default take and returns empty summary', async () => {
    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.scheduledClientNotificationFindMany).toHaveBeenCalledWith({
      where: {
        eventKey: {
          in: [
            NotificationEventKey.APPOINTMENT_REMINDER,
            NotificationEventKey.REVIEW_REQUESTED,
            NotificationEventKey.DEPOSIT_REMINDER,
          ],
        },
        cancelledAt: null,
        processedAt: null,
        failedAt: null,
        runAt: {
          lte: NOW,
        },
      },
      orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        eventKey: true,
      },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      cancelledCount: 0,
      failedCount: 0,
      cancelled: [],
      failed: [],
    })
  })

  it('GET clamps take query param to the maximum', async () => {
    await GET(
      makeRequest({
        url: 'http://localhost/api/internal/jobs/client-reminders?take=999',
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.scheduledClientNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 250,
      }),
    )
  })

  it('POST accepts x-internal-job-secret and runs the same job path', async () => {
    const result = await POST(
      makeRequest({
        method: 'POST',
        internalSecret: 'job_secret_1',
      }),
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      cancelledCount: 0,
      failedCount: 0,
      cancelled: [],
      failed: [],
    })
  })

  it('processes a due SEND reminder, creates notification, and marks row processed', async () => {
    mocks.scheduledClientNotificationFindMany.mockResolvedValueOnce([
      { id: 'reminder_1', eventKey: NotificationEventKey.APPOINTMENT_REMINDER },
    ])

    mocks.validateDueAppointmentReminder.mockResolvedValueOnce(
      makeSendValidation(),
    )

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.validateDueAppointmentReminder).toHaveBeenCalledWith({
      tx: expect.any(Object),
      scheduledClientNotificationId: 'reminder_1',
      now: NOW,
    })

    expect(mocks.upsertClientNotification).toHaveBeenCalledWith({
      tx: expect.any(Object),
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      title: 'Appointment reminder',
      body: 'Your appointment is coming up.',
      dedupeKey: 'appointment-reminder:booking_1:client_1',
      href: '/client/bookings/booking_1',
      data: {
        bookingId: 'booking_1',
      },
    })

    expect(mocks.scheduledClientNotificationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'reminder_1',
        cancelledAt: null,
        processedAt: null,
      },
      data: {
        processedAt: NOW,
        failedAt: null,
        lastError: null,
      },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 1,
      skippedCount: 0,
      cancelledCount: 0,
      failedCount: 0,
      cancelled: [],
      failed: [],
    })
  })

  it('routes a due REVIEW_REQUESTED row through the review-request validator', async () => {
    mocks.scheduledClientNotificationFindMany.mockResolvedValueOnce([
      { id: 'review_req_1', eventKey: NotificationEventKey.REVIEW_REQUESTED },
    ])

    mocks.validateDueReviewRequest.mockResolvedValueOnce({
      action: 'PROCESS',
      rowId: 'review_req_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.REVIEW_REQUESTED,
      dedupeKey: 'REVIEW_REQUEST:booking_1',
      href: '/client/bookings/booking_1#review',
      notification: {
        title: 'How was your visit?',
        body: 'Leave a quick review — it helps others find great pros.',
        data: { bookingId: 'booking_1' },
      },
    })

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.validateDueReviewRequest).toHaveBeenCalledWith({
      tx: expect.any(Object),
      scheduledClientNotificationId: 'review_req_1',
      now: NOW,
    })
    expect(mocks.validateDueAppointmentReminder).not.toHaveBeenCalled()

    expect(mocks.upsertClientNotification).toHaveBeenCalledWith({
      tx: expect.any(Object),
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.REVIEW_REQUESTED,
      title: 'How was your visit?',
      body: 'Leave a quick review — it helps others find great pros.',
      dedupeKey: 'REVIEW_REQUEST:booking_1',
      href: '/client/bookings/booking_1#review',
      data: { bookingId: 'booking_1' },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toMatchObject({
      ok: true,
      scannedCount: 1,
      processedCount: 1,
      skippedCount: 0,
      cancelledCount: 0,
      failedCount: 0,
      cancelled: [],
      failed: [],
    })
  })

  it('skips a due reminder when validation returns SKIP', async () => {
    mocks.scheduledClientNotificationFindMany.mockResolvedValueOnce([
      { id: 'reminder_skip_1', eventKey: NotificationEventKey.APPOINTMENT_REMINDER },
    ])

    mocks.validateDueAppointmentReminder.mockResolvedValueOnce({
      action: 'SKIP',
    })

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
    expect(mocks.cancelDueAppointmentReminder).not.toHaveBeenCalled()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 1,
      cancelledCount: 0,
      failedCount: 0,
      cancelled: [],
      failed: [],
    })
  })

  it('cancels a due reminder when validation returns CANCEL', async () => {
    mocks.scheduledClientNotificationFindMany.mockResolvedValueOnce([
      { id: 'reminder_cancel_1', eventKey: NotificationEventKey.APPOINTMENT_REMINDER },
    ])

    mocks.validateDueAppointmentReminder.mockResolvedValueOnce({
      action: 'CANCEL',
      reason: 'BOOKING_CANCELLED',
    })

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.cancelDueAppointmentReminder).toHaveBeenCalledWith({
      tx: expect.any(Object),
      scheduledClientNotificationId: 'reminder_cancel_1',
      reason: 'BOOKING_CANCELLED',
      cancelledAt: NOW,
    })

    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 0,
      cancelledCount: 1,
      failedCount: 0,
      cancelled: [
        {
          id: 'reminder_cancel_1',
          reason: 'BOOKING_CANCELLED',
        },
      ],
      failed: [],
    })
  })

  it('skips when processed marker update loses the race', async () => {
    mocks.scheduledClientNotificationFindMany.mockResolvedValueOnce([
      { id: 'reminder_race_1', eventKey: NotificationEventKey.APPOINTMENT_REMINDER },
    ])

    mocks.validateDueAppointmentReminder.mockResolvedValueOnce(
      makeSendValidation({
        rowId: 'reminder_race_1',
      }),
    )

    mocks.scheduledClientNotificationUpdateMany.mockResolvedValueOnce({
      count: 0,
    })

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.upsertClientNotification).toHaveBeenCalled()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 1,
      cancelledCount: 0,
      failedCount: 0,
      cancelled: [],
      failed: [],
    })
  })

  it('marks retryable failure with a generic error when processing throws', async () => {
    mocks.scheduledClientNotificationFindMany.mockResolvedValueOnce([
      { id: 'reminder_failed_1', eventKey: NotificationEventKey.APPOINTMENT_REMINDER },
    ])

    mocks.validateDueAppointmentReminder.mockRejectedValueOnce(
      new Error('validation exploded for tori@example.com token secret_123'),
    )

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.scheduledClientNotificationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'reminder_failed_1',
        cancelledAt: null,
        processedAt: null,
      },
      data: {
        failedAt: null,
        lastError: 'Failed to process scheduled reminder',
      },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 0,
      cancelledCount: 0,
      failedCount: 1,
      cancelled: [],
      failed: [
        {
          id: 'reminder_failed_1',
          error: 'Failed to process scheduled reminder',
        },
      ],
    })
  })

  it('returns skipped when retryable failure marker loses the race', async () => {
    mocks.scheduledClientNotificationFindMany.mockResolvedValueOnce([
      { id: 'reminder_failed_race_1', eventKey: NotificationEventKey.APPOINTMENT_REMINDER },
    ])

    mocks.validateDueAppointmentReminder.mockRejectedValueOnce(
      new Error('validation exploded'),
    )

    mocks.scheduledClientNotificationUpdateMany.mockResolvedValueOnce({
      count: 0,
    })

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 1,
      cancelledCount: 0,
      failedCount: 0,
      cancelled: [],
      failed: [],
    })
  })

  it('GET logs safely and returns generic 500 when loading due rows throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('db failed for tori@example.com token secret_123')
    mocks.scheduledClientNotificationFindMany.mockRejectedValueOnce(thrown)

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'GET /api/internal/jobs/client-reminders error',
      {
        error: {
          name: 'Error',
          message: 'db failed for tori@example.com token secret_123',
        },
      },
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })

  it('POST logs safely and returns generic 500 when loading due rows throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('post db failed for token secret_123')
    mocks.scheduledClientNotificationFindMany.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeRequest({
        method: 'POST',
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/internal/jobs/client-reminders error',
      {
        error: {
          name: 'Error',
          message: 'post db failed for token secret_123',
        },
      },
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })
})