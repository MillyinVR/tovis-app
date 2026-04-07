import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientNotificationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prismaScheduledFindMany: vi.fn(),
  prismaScheduledUpdateMany: vi.fn(),
  prismaTransaction: vi.fn(),

  txScheduledFindFirst: vi.fn(),
  txScheduledUpdate: vi.fn(),

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

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

import { GET, POST } from './route'

const tx = {
  scheduledClientNotification: {
    findFirst: mocks.txScheduledFindFirst,
    update: mocks.txScheduledUpdate,
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

    delete process.env.CRON_SECRET
    process.env.INTERNAL_JOB_SECRET = 'test-secret'

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )
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
    const scheduledFor = new Date('2026-04-13T17:00:00.000Z')
    const runAt = new Date('2026-04-06T17:00:00.000Z')

    mocks.prismaScheduledFindMany.mockResolvedValue([
      {
        id: 'sched_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        type: ClientNotificationType.APPOINTMENT_REMINDER,
        runAt,
        href: '/client/bookings/booking_1?step=overview',
        dedupeKey: 'CLIENT_REMINDER:ONE_WEEK:booking_1',
        data: {
          reminderKind: 'ONE_WEEK',
          bookingId: 'booking_1',
          scheduledFor: scheduledFor.toISOString(),
          timeZone: 'UTC',
          serviceName: 'Haircut',
          professionalName: 'Tori',
        },
      },
    ])

    mocks.txScheduledFindFirst.mockResolvedValue({ id: 'sched_1' })
    mocks.upsertClientNotification.mockResolvedValue({ id: 'notif_1' })
    mocks.txScheduledUpdate.mockResolvedValue({ id: 'sched_1' })

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
        type: ClientNotificationType.APPOINTMENT_REMINDER,
        cancelledAt: null,
        processedAt: null,
        runAt: {
          lte: expect.any(Date),
        },
      },
      orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
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

    expect(mocks.upsertClientNotification).toHaveBeenCalledWith({
      tx,
      clientId: 'client_1',
      bookingId: 'booking_1',
      type: ClientNotificationType.APPOINTMENT_REMINDER,
      title: 'Appointment reminder',
      body: expect.stringContaining('in one week'),
      dedupeKey: 'CLIENT_REMINDER:ONE_WEEK:booking_1',
      href: '/client/bookings/booking_1?step=overview',
      data: {
        reminderKind: 'ONE_WEEK',
        bookingId: 'booking_1',
        scheduledFor: scheduledFor.toISOString(),
        timeZone: 'UTC',
        serviceName: 'Haircut',
        professionalName: 'Tori',
      },
    })

    expect(mocks.txScheduledUpdate).toHaveBeenCalledWith({
      where: { id: 'sched_1' },
      data: {
        processedAt: expect.any(Date),
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
      failedCount: 0,
      failed: [],
    })
  })

  it('skips a row that is no longer due inside the transaction', async () => {
    mocks.prismaScheduledFindMany.mockResolvedValue([
      {
        id: 'sched_2',
        clientId: 'client_1',
        bookingId: 'booking_2',
        type: ClientNotificationType.APPOINTMENT_REMINDER,
        runAt: new Date('2026-04-06T17:00:00.000Z'),
        href: '/client/bookings/booking_2?step=overview',
        dedupeKey: 'CLIENT_REMINDER:DAY_BEFORE:booking_2',
        data: {
          reminderKind: 'DAY_BEFORE',
          bookingId: 'booking_2',
          scheduledFor: '2026-04-07T17:00:00.000Z',
          timeZone: 'UTC',
        },
      },
    ])

    mocks.txScheduledFindFirst.mockResolvedValue(null)

    const response = await GET(
      makeRequest({
        method: 'GET',
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
    expect(mocks.txScheduledUpdate).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 1,
      failedCount: 0,
      failed: [],
    })
  })

  it('marks failed rows and reports failures on POST', async () => {
    mocks.prismaScheduledFindMany.mockResolvedValue([
      {
        id: 'sched_3',
        clientId: 'client_9',
        bookingId: 'booking_9',
        type: ClientNotificationType.APPOINTMENT_REMINDER,
        runAt: new Date('2026-04-06T17:00:00.000Z'),
        href: '/client/bookings/booking_9?step=overview',
        dedupeKey: 'CLIENT_REMINDER:DAY_BEFORE:booking_9',
        data: {
          reminderKind: 'DAY_BEFORE',
          bookingId: 'booking_9',
          scheduledFor: '2026-04-07T17:00:00.000Z',
          timeZone: 'UTC',
        },
      },
    ])

    mocks.txScheduledFindFirst.mockResolvedValue({ id: 'sched_3' })
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
        id: 'sched_3',
        processedAt: null,
      },
      data: {
        failedAt: expect.any(Date),
        lastError: 'Reminder delivery failed',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      failed: [
        {
          id: 'sched_3',
          error: 'Reminder delivery failed',
        },
      ],
    })
  })
})