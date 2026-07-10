// app/api/v1/pro/reminders/[id]/complete/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  reminderFindUnique: vi.fn(),
  reminderUpdate: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: (v: unknown) => (typeof v === 'string' && v ? v : null),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminder: {
      findUnique: mocks.reminderFindUnique,
      update: mocks.reminderUpdate,
    },
  },
}))

vi.mock('@/app/api/_utils/routeContext', () => ({
  resolveRouteParams: (ctx: { params: Promise<{ id: string }> }) => ctx.params,
}))

import { POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/pro/reminders/reminder_1/complete',
    { method: 'POST', headers },
  )
}

const PRO_ID = 'pro_1'
const ctx = { params: Promise.resolve({ id: 'reminder_1' }) }

beforeEach(() => {
  vi.clearAllMocks()

  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: PRO_ID,
    proId: PRO_ID,
    user: { id: 'user_1' },
  })

  mocks.jsonFail.mockImplementation((status: number, error: string) =>
    makeJsonResponse(status, { ok: false, error }),
  )
  mocks.jsonOk.mockImplementation((payload: unknown, status = 200) =>
    makeJsonResponse(status, {
      ok: true,
      ...(typeof payload === 'object' && payload !== null ? payload : {}),
    }),
  )

  mocks.reminderFindUnique.mockResolvedValue({
    id: 'reminder_1',
    professionalId: PRO_ID,
  })
  mocks.reminderUpdate.mockResolvedValue({ id: 'reminder_1' })
})

describe('POST /api/v1/pro/reminders/[id]/complete', () => {
  it('returns the auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, { ok: false, error: 'Unauthorized' })
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const res = await POST(makeRequest(), ctx)

    expect(res).toBe(authRes)
    expect(mocks.reminderUpdate).not.toHaveBeenCalled()
  })

  it('404s when the reminder belongs to a different pro', async () => {
    mocks.reminderFindUnique.mockResolvedValueOnce({
      id: 'reminder_1',
      professionalId: 'pro_other',
    })

    const res = await POST(makeRequest(), ctx)

    expect(res.status).toBe(404)
    expect(mocks.reminderUpdate).not.toHaveBeenCalled()
  })

  it('404s when the reminder does not exist', async () => {
    mocks.reminderFindUnique.mockResolvedValueOnce(null)

    const res = await POST(makeRequest(), ctx)

    expect(res.status).toBe(404)
    expect(mocks.reminderUpdate).not.toHaveBeenCalled()
  })

  it('completes and returns the id as JSON for an API (json) request', async () => {
    const res = await POST(makeRequest({ accept: 'application/json' }), ctx)

    expect(mocks.reminderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reminder_1' },
        data: expect.objectContaining({ completedAt: expect.any(Date) }),
      }),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, id: 'reminder_1' })
  })

  it('redirects a browser (text/html) form submission with 303', async () => {
    const res = await POST(makeRequest({ accept: 'text/html' }), ctx)

    // 303 (not the NextResponse.redirect default of 307) so the browser follows
    // up with a GET of the page instead of re-POSTing to the page route.
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('/pro/reminders')
    expect(mocks.reminderUpdate).toHaveBeenCalled()
  })
})
