import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const TEST_NOW = new Date('2026-04-06T17:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaScheduledFindMany: vi.fn(),
  prismaScheduledUpdateMany: vi.fn(),
  prismaTransaction: vi.fn(),

  txScheduledUpdateMany: vi.fn(),

  validateDueAppointmentReminder: vi.fn(),
  cancelDueAppointmentReminder: vi.fn(),

  upsertClientNotification: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (data: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...data }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  jsonFail: (
    status: number,
    error: string,
    extra?: Record<string, unknown>,
  ) =>
    new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scheduledClientNotification: {
      findMany: mocks.prismaScheduledFindMany,
      updateMany: mocks.prismaScheduledUpdateMany,
    },
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  validateDueAppointmentReminder: mocks.validateDueAppointmentReminder,
  cancelDueAppointmentReminder: mocks.cancelDueAppointmentReminder,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

import { GET, POST } from './route'

const tx = {
  scheduledClientNotification: {
    updateMany: mocks.txScheduledUpdateMany,
  },
}

function makeRequest(args?: {
  method?: 'GET' | 'POST'
  search?: string
  headers?: Record<string, string>
}) {
  const method = args?.method ?? 'GET'
  const search = args?.search ?? ''

  return new Request(
    `http://localhost/api/internal/jobs/client-reminders${search}`,
    {
      method,
      headers: args?.headers,
    },
  )
}

describe('app/api/internal/jobs/client-reminders/route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    delete process.env.CRON_SECRET
    process.env.INTERNAL_JOB_SECRET = 'test-secret'

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )

    mocks.txScheduledUpdateMany.mockResolvedValue({ count: 1 })
    mocks.prismaScheduledUpdateMany.mockResolvedValue({ count: 1 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 500 when the internal job secret is not configured', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    })

    expect(mocks.prismaScheduledFindMany).not.toHaveBeenCalled()
  })

  it('returns 401 when the request is unauthorized', async () => {
    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.prismaScheduledFindMany).not.toHaveBeenCalled()
  })

  it('processes due reminder rows on GET', async () => {
    mocks.prismaScheduledFindMany.mockResolvedValue([{ id: 'sched_1' }])

    mocks.validateDueAppointmentReminder.mockResolvedValue({
      action: 'PROCESS',
      rowId: 'sched_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      dedupeKey: 'CLIENT_REMINDER:ONE_WEEK:booking_1',
      href: '/client/bookings/booking_1?step=overview',
      notification: {
        title: 'Appointment reminder',
        body: 'Reminder: your appointment for Haircut is in one week.',
        data: {
          reminderKind: 'ONE_WEEK',
          bookingId: 'booking_1',
          scheduledFor: '2026-04-13T17:00:00.000Z',
          timeZone: 'UTC',
          serviceName: 'Haircut',
          professionalName: 'Tori',
        },
      },
    })

    mocks.upsertClientNotification.mockResolvedValue(undefined)
    mocks.txScheduledUpdateMany.mockResolvedValue({ count: 1 })

    const response = await GET(
      makeRequest({
        method: 'GET',
        search: '?take=5',
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.prismaScheduledFindMany).toHaveBeenCalledWith({
      where: {
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        cancelledAt: null,
        processedAt: null,
        failedAt: null,
        runAt: {
          lte: TEST_NOW,
        },
      },
      orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
      select: {
        id: true,
      },
    })

    expect(mocks.validateDueAppointmentReminder).toHaveBeenCalledWith({
      tx,
      scheduledClientNotificationId: 'sched_1',
      now: TEST_NOW,
    })

    expect(mocks.upsertClientNotification).toHaveBeenCalledWith({
      tx,
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      title: 'Appointment reminder',
      body: 'Reminder: your appointment for Haircut is in one week.',
      dedupeKey: 'CLIENT_REMINDER:ONE_WEEK:booking_1',
      href: '/client/bookings/booking_1?step=overview',
      data: {
        reminderKind: 'ONE_WEEK',
        bookingId: 'booking_1',
        scheduledFor: '2026-04-13T17:00:00.000Z',
        timeZone: 'UTC',
        serviceName: 'Haircut',
        professionalName: 'Tori',
      },
    })

    expect(mocks.txScheduledUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'sched_1',
        cancelledAt: null,
        processedAt: null,
      },
      data: {
        processedAt: TEST_NOW,
        failedAt: null,
        lastError: null,
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
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

  it('treats a lost processed-row race as skipped instead of processed', async () => {
    mocks.prismaScheduledFindMany.mockResolvedValue([{ id: 'sched_race_processed' }])

    mocks.validateDueAppointmentReminder.mockResolvedValue({
      action: 'PROCESS',
      rowId: 'sched_race_processed',
      clientId: 'client_1',
      bookingId: 'booking_1',
      dedupeKey: 'CLIENT_REMINDER:ONE_WEEK:booking_1',
      href: '/client/bookings/booking_1?step=overview',
      notification: {
        title: 'Appointment reminder',
        body: 'Reminder body',
        data: {
          reminderKind: 'ONE_WEEK',
          bookingId: 'booking_1',
          scheduledFor: '2026-04-13T17:00:00.000Z',
          timeZone: 'UTC',
          serviceName: 'Haircut',
          professionalName: null,
        },
      },
    })

    mocks.upsertClientNotification.mockResolvedValue(undefined)
    mocks.txScheduledUpdateMany.mockResolvedValue({ count: 0 })

    const response = await GET(
      makeRequest({
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.txScheduledUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'sched_race_processed',
        cancelledAt: null,
        processedAt: null,
      },
      data: {
        processedAt: TEST_NOW,
        failedAt: null,
        lastError: null,
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
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

  it('skips a row when validation says to skip', async () => {
    mocks.prismaScheduledFindMany.mockResolvedValue([{ id: 'sched_2' }])

    mocks.validateDueAppointmentReminder.mockResolvedValue({
      action: 'SKIP',
    })

    const response = await GET(
      makeRequest({
        method: 'GET',
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.validateDueAppointmentReminder).toHaveBeenCalledWith({
      tx,
      scheduledClientNotificationId: 'sched_2',
      now: TEST_NOW,
    })

    expect(mocks.cancelDueAppointmentReminder).not.toHaveBeenCalled()
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
    expect(mocks.txScheduledUpdateMany).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
    expect(json).toEqual({
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

  it('cancels stale or invalid rows instead of processing them', async () => {
    mocks.prismaScheduledFindMany.mockResolvedValue([{ id: 'sched_3' }])

    mocks.validateDueAppointmentReminder.mockResolvedValue({
      action: 'CANCEL',
      reason: 'Linked booking is no longer eligible for appointment reminders.',
    })

    mocks.cancelDueAppointmentReminder.mockResolvedValue(undefined)

    const response = await GET(
      makeRequest({
        method: 'GET',
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.validateDueAppointmentReminder).toHaveBeenCalledWith({
      tx,
      scheduledClientNotificationId: 'sched_3',
      now: TEST_NOW,
    })

    expect(mocks.cancelDueAppointmentReminder).toHaveBeenCalledWith({
      tx,
      scheduledClientNotificationId: 'sched_3',
      reason: 'Linked booking is no longer eligible for appointment reminders.',
      cancelledAt: TEST_NOW,
    })

    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
    expect(mocks.txScheduledUpdateMany).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 0,
      cancelledCount: 1,
      failedCount: 0,
      cancelled: [
        {
          id: 'sched_3',
          reason: 'Linked booking is no longer eligible for appointment reminders.',
        },
      ],
      failed: [],
    })
  })

  it('marks failed rows and reports failures on POST', async () => {
    mocks.prismaScheduledFindMany.mockResolvedValue([{ id: 'sched_4' }])

    mocks.validateDueAppointmentReminder.mockResolvedValue({
      action: 'PROCESS',
      rowId: 'sched_4',
      clientId: 'client_9',
      bookingId: 'booking_9',
      dedupeKey: 'CLIENT_REMINDER:DAY_BEFORE:booking_9',
      href: '/client/bookings/booking_9?step=overview',
      notification: {
        title: 'Appointment tomorrow',
        body: 'Reminder: your appointment is tomorrow.',
        data: {
          reminderKind: 'DAY_BEFORE',
          bookingId: 'booking_9',
          scheduledFor: '2026-04-07T17:00:00.000Z',
          timeZone: 'UTC',
          serviceName: 'Haircut',
          professionalName: null,
        },
      },
    })

    mocks.upsertClientNotification.mockRejectedValue(
      new Error('Reminder delivery failed'),
    )
    mocks.prismaScheduledUpdateMany.mockResolvedValue({ count: 1 })

    const response = await POST(
      makeRequest({
        method: 'POST',
        headers: {
          'x-internal-job-secret': 'test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.prismaScheduledUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'sched_4',
        cancelledAt: null,
        processedAt: null,
      },
      data: {
        failedAt: null,
        lastError: 'Reminder delivery failed',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 0,
      cancelledCount: 0,
      failedCount: 1,
      cancelled: [],
      failed: [
        {
          id: 'sched_4',
          error: 'Reminder delivery failed',
        },
      ],
    })
  })

  it('treats a lost failed-row race as skipped instead of failed', async () => {
    mocks.prismaScheduledFindMany.mockResolvedValue([{ id: 'sched_race_failed' }])

    mocks.validateDueAppointmentReminder.mockResolvedValue({
      action: 'PROCESS',
      rowId: 'sched_race_failed',
      clientId: 'client_9',
      bookingId: 'booking_9',
      dedupeKey: 'CLIENT_REMINDER:DAY_BEFORE:booking_9',
      href: '/client/bookings/booking_9?step=overview',
      notification: {
        title: 'Appointment tomorrow',
        body: 'Reminder: your appointment is tomorrow.',
        data: {
          reminderKind: 'DAY_BEFORE',
          bookingId: 'booking_9',
          scheduledFor: '2026-04-07T17:00:00.000Z',
          timeZone: 'UTC',
          serviceName: 'Haircut',
          professionalName: null,
        },
      },
    })

    mocks.upsertClientNotification.mockRejectedValue(
      new Error('Reminder delivery failed'),
    )
    mocks.prismaScheduledUpdateMany.mockResolvedValue({ count: 0 })

    const response = await POST(
      makeRequest({
        method: 'POST',
        headers: {
          'x-internal-job-secret': 'test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.prismaScheduledUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'sched_race_failed',
        cancelledAt: null,
        processedAt: null,
      },
      data: {
        failedAt: null,
        lastError: 'Reminder delivery failed',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
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

  it('clamps take to the max allowed value', async () => {
    mocks.prismaScheduledFindMany.mockResolvedValue([])

    const response = await GET(
      makeRequest({
        method: 'GET',
        search: '?take=999',
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.prismaScheduledFindMany).toHaveBeenCalledWith({
      where: {
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        cancelledAt: null,
        processedAt: null,
        failedAt: null,
        runAt: {
          lte: TEST_NOW,
        },
      },
      orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 250,
      select: {
        id: true,
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
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
})