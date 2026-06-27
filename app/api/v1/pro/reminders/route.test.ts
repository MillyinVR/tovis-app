// app/api/v1/pro/reminders/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReminderType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  reminderFindMany: vi.fn(),
  reminderCreate: vi.fn(),
  requireProBooking: vi.fn(),
  assertProCanViewClient: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminder: {
      findMany: mocks.reminderFindMany,
      create: mocks.reminderCreate,
    },
  },
}))

vi.mock('@/app/api/_utils/auth/requireProBooking', () => ({
  requireProBooking: mocks.requireProBooking,
}))

vi.mock('@/lib/clientVisibility', () => ({
  assertProCanViewClient: mocks.assertProCanViewClient,
}))

import { GET, POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeFormRequest(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new Request('http://localhost/api/v1/pro/reminders', {
    method: 'POST',
    body: form,
    headers,
  })
}

const PRO_ID = 'pro_1'
const VALID_FIELDS = {
  title: 'Follow up',
  dueAt: '2026-07-01T10:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: PRO_ID,
    proId: PRO_ID,
    user: { id: 'user_1' },
  })

  mocks.jsonFail.mockImplementation(
    (status: number, error: string, extra?: Record<string, unknown>) =>
      makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
  )
  mocks.jsonOk.mockImplementation((payload: unknown, status = 200) =>
    makeJsonResponse(status, {
      ok: true,
      ...(typeof payload === 'object' && payload !== null ? payload : {}),
    }),
  )

  mocks.requireProBooking.mockResolvedValue({
    ok: true,
    booking: { id: 'booking_1', clientId: 'client_1' },
  })
  mocks.assertProCanViewClient.mockResolvedValue({ ok: true })
  mocks.reminderCreate.mockResolvedValue({ id: 'reminder_1' })
})

describe('GET /api/v1/pro/reminders', () => {
  it('returns the auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, { ok: false, error: 'Unauthorized' })
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const res = await GET()

    expect(res).toBe(authRes)
    expect(mocks.reminderFindMany).not.toHaveBeenCalled()
  })

  it('lists the authenticated pro reminders scoped to that pro', async () => {
    mocks.reminderFindMany.mockResolvedValueOnce([{ id: 'reminder_1' }])

    const res = await GET()

    expect(mocks.reminderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { professionalId: PRO_ID } }),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      reminders: [{ id: 'reminder_1' }],
    })
  })
})

describe('POST /api/v1/pro/reminders', () => {
  it('returns the auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, { ok: false, error: 'Unauthorized' })
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const res = await POST(makeFormRequest(VALID_FIELDS))

    expect(res).toBe(authRes)
    expect(mocks.reminderCreate).not.toHaveBeenCalled()
  })

  it('rejects a missing title', async () => {
    const res = await POST(makeFormRequest({ dueAt: VALID_FIELDS.dueAt }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Title is required.',
    })
  })

  it('rejects a missing due date', async () => {
    const res = await POST(makeFormRequest({ title: 'Follow up' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Due date/time is required.',
    })
  })

  it('rejects an invalid due date', async () => {
    const res = await POST(
      makeFormRequest({ title: 'Follow up', dueAt: 'not-a-date' }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid due date/time.',
    })
  })

  it('forbids attaching to a client the pro cannot view', async () => {
    mocks.assertProCanViewClient.mockResolvedValueOnce({ ok: false })

    const res = await POST(
      makeFormRequest({ ...VALID_FIELDS, clientId: 'client_other' }),
    )

    expect(mocks.assertProCanViewClient).toHaveBeenCalledWith(
      PRO_ID,
      'client_other',
    )
    expect(res.status).toBe(403)
    expect(mocks.reminderCreate).not.toHaveBeenCalled()
  })

  it('returns the ownership 404 when the booking is not owned by the pro', async () => {
    mocks.requireProBooking.mockResolvedValueOnce({
      ok: false,
      res: makeJsonResponse(404, { ok: false, error: 'Booking not found.' }),
    })

    const res = await POST(
      makeFormRequest({ ...VALID_FIELDS, bookingId: 'booking_foreign' }),
    )

    expect(mocks.requireProBooking).toHaveBeenCalledWith(
      'booking_foreign',
      PRO_ID,
      { id: true, clientId: true },
    )
    expect(res.status).toBe(404)
    expect(mocks.reminderCreate).not.toHaveBeenCalled()
  })

  it('rejects a booking that belongs to a different client than supplied', async () => {
    mocks.requireProBooking.mockResolvedValueOnce({
      ok: true,
      booking: { id: 'booking_1', clientId: 'client_actual' },
    })

    const res = await POST(
      makeFormRequest({
        ...VALID_FIELDS,
        clientId: 'client_1',
        bookingId: 'booking_1',
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Booking does not belong to that client.',
    })
    expect(mocks.reminderCreate).not.toHaveBeenCalled()
  })

  it('creates the reminder and returns 201 for an API (json) request', async () => {
    const res = await POST(
      makeFormRequest({
        ...VALID_FIELDS,
        body: 'bring inspo photos',
        clientId: 'client_1',
        bookingId: 'booking_1',
        type: 'follow_up',
      }),
    )

    expect(mocks.reminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          professionalId: PRO_ID,
          clientId: 'client_1',
          bookingId: 'booking_1',
          title: 'Follow up',
          body: 'bring inspo photos',
        }),
      }),
    )
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ ok: true, id: 'reminder_1' })
  })

  it('falls back to GENERAL for an unknown reminder type', async () => {
    await POST(makeFormRequest({ ...VALID_FIELDS, type: 'totally-bogus' }))

    expect(mocks.reminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: ReminderType.GENERAL }),
      }),
    )
  })

  it('redirects a browser (text/html) form submission', async () => {
    const res = await POST(
      makeFormRequest(VALID_FIELDS, { accept: 'text/html' }),
    )

    expect(res.status).toBe(303)
    expect(mocks.reminderCreate).toHaveBeenCalled()
  })
})
