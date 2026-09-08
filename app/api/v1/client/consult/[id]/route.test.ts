// app/api/v1/client/consult/[id]/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  deleteSession: vi.fn(),
  enforceRateLimit: vi.fn(),
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

vi.mock('@/lib/consult/clientSessions', () => ({ deleteClientConsultSession: mocks.deleteSession }))
vi.mock('@/app/api/_utils/rateLimit', () => ({ enforceRateLimit: mocks.enforceRateLimit, rateLimitIdentity: async (id: string) => id }))
import { GET, DELETE } from './route'
import { ConsultWriteError } from '@/lib/consult/errors'


type Res = { status: number; message?: string; body?: unknown }

const NOW = new Date('2026-08-06T10:00:00.000Z')

const CONSULT_ROW = {
  id: 'consult_1',
  status: 'CONSENT_REQUIRED' as const,
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
        status: 'CONSENT_REQUIRED',
        bookingId: 'booking_1',
        professionalId: 'pro_allowlisted',
        serviceCategoryId: 'cat_hair_color',
        createdAt: NOW.toISOString(),
      },
    })
  })

  it('serves a LOOK-anchored consult (Book the Look) as the look DTO, not `consult: null`', async () => {
    // The regression: this route ran only the booking mapper, so every consult
    // started from a look answered `{ consult: null }` and the web flow page
    // crashed reading `.status` straight after Book.
    mocks.findUniqueConsultSession.mockResolvedValue({
      ...CONSULT_ROW,
      clientId: 'client_1',
      bookingId: null,
      anchorLookPostId: 'look_1',
    })

    const res = await get('consult_1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      consult: {
        id: 'consult_1',
        status: 'CONSENT_REQUIRED',
        lookPostId: 'look_1',
        professionalId: 'pro_allowlisted',
        serviceCategoryId: 'cat_hair_color',
        createdAt: NOW.toISOString(),
      },
    })
  })

  it('404s rather than answering `consult: null` for a row with neither anchor', async () => {
    mocks.findUniqueConsultSession.mockResolvedValue({
      ...CONSULT_ROW,
      clientId: 'client_1',
      bookingId: null,
      anchorLookPostId: null,
    })

    const res = await get('consult_1')

    expect(res.status).toBe(404)
    expect(mocks.jsonOk).not.toHaveBeenCalled()
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

describe('DELETE owned unbooked consult', () => {
  beforeEach(() => { mocks.enforceRateLimit.mockResolvedValue(null); mocks.deleteSession.mockResolvedValue(undefined) })
  it('uses authenticated identity and the requested consult only', async () => {
    mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_owner', user: { id: 'user_owner' } })
    const result = await DELETE(new Request('http://test'), { params: { id: 'consult_owned' } })
    expect(result).toMatchObject({ status: 200, body: { deleted: true } })
    expect(mocks.deleteSession).toHaveBeenCalledWith({ consultSessionId: 'consult_owned', clientId: 'client_owner', actorUserId: 'user_owner' })
  })
  it('does not delete while authentication or rate limiting refuses the request', async () => {
    mocks.requireClient.mockResolvedValue({ ok: false, res: { status: 401 } })
    expect(await DELETE(new Request('http://test'), { params: { id: 'consult_owned' } })).toMatchObject({ status: 401 })
    expect(mocks.deleteSession).not.toHaveBeenCalled()
    mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_owner', user: { id: 'user_owner' } })
    mocks.enforceRateLimit.mockResolvedValue({ status: 429 })
    expect(await DELETE(new Request('http://test'), { params: { id: 'consult_owned' } })).toMatchObject({ status: 429 })
    expect(mocks.deleteSession).not.toHaveBeenCalled()
  })
  it('refuses appointment-linked consultations', async () => {
    mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_owner', user: { id: 'user_owner' } })
    mocks.deleteSession.mockRejectedValue(new ConsultWriteError('INVALID_STATE', 'Appointment-linked consultation'))
    expect(await DELETE(new Request('http://test'), { params: { id: 'consult_owned' } })).toMatchObject({ status: 409 })
  })
})
