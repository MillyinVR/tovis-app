// app/api/v1/client/consult/[id]/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn((status: number, message: string) => ({ status, message })),
  jsonOk: vi.fn((body: unknown, status = 200) => ({ status, body })),
  findUniqueConsultSession: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    consultSession: { findUnique: mocks.findUniqueConsultSession },
  },
}))

import { GET } from './route'

type Res = { status: number; message?: string; body?: unknown }

const NOW = new Date('2026-08-06T10:00:00.000Z')

const CONSULT_ROW = {
  id: 'consult_1',
  status: 'CREATED' as const,
  bookingId: 'booking_1',
  professionalId: 'pro_allowlisted',
  serviceCategoryId: 'cat_hair_color',
  createdAt: NOW,
}

function get(id: string): Promise<Res> {
  return GET(new Request('http://test/api/v1/client/consult/' + id), {
    params: { id },
  }) as Promise<Res>
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ENABLE_AI_CONSULT = '1'
  mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_1', user: { id: 'user_1' } })
  mocks.findUniqueConsultSession.mockResolvedValue({ ...CONSULT_ROW, clientId: 'client_1' })
})

afterEach(() => {
  delete process.env.ENABLE_AI_CONSULT
})

describe('GET /api/v1/client/consult/[id]', () => {
  it('returns the consult session owned by the caller', async () => {
    const res = await get('consult_1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      consult: {
        id: 'consult_1',
        status: 'CREATED',
        bookingId: 'booking_1',
        professionalId: 'pro_allowlisted',
        serviceCategoryId: 'cat_hair_color',
        createdAt: NOW.toISOString(),
      },
    })
  })

  it('404s when the session does not exist', async () => {
    mocks.findUniqueConsultSession.mockResolvedValue(null)
    const res = await get('missing')
    expect(res.status).toBe(404)
  })

  it('404s (no leak) when the session belongs to another client', async () => {
    mocks.findUniqueConsultSession.mockResolvedValue({ ...CONSULT_ROW, clientId: 'someone_else' })
    const res = await get('consult_1')
    expect(res.status).toBe(404)
  })

  it('404s once the pilot gate is off for the anchoring pro', async () => {
    delete process.env.ENABLE_AI_CONSULT
    mocks.findUniqueConsultSession.mockResolvedValue({
      ...CONSULT_ROW,
      clientId: 'client_1',
      professionalId: 'some-other-pro',
    })
    const res = await get('consult_1')
    expect(res.status).toBe(404)
  })

  it('allows a pro on the pilot allowlist even with the global flag off', async () => {
    delete process.env.ENABLE_AI_CONSULT
    mocks.findUniqueConsultSession.mockResolvedValue({
      ...CONSULT_ROW,
      clientId: 'client_1',
      professionalId: 'cmq9p645v0002jp04fttoatlq',
    })
    const res = await get('consult_1')
    expect(res.status).toBe(200)
  })
})
