// app/api/v1/client/self-profile/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn((status: number, message: string) => ({ status, message })),
  jsonOk: vi.fn((body: unknown, status = 200) => ({ status, body })),
  readJsonRecord: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/readJsonRecord', () => ({
  readJsonRecord: mocks.readJsonRecord,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: mocks.findUnique, update: mocks.update },
  },
}))

import { GET, PATCH } from './route'

type Res = { status: number; message?: string; body?: unknown }

const UPDATED_AT = new Date('2026-07-07T10:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({
    ok: true,
    clientId: 'client_1',
    user: { id: 'user_1' },
  })
  mocks.findUnique.mockResolvedValue({
    selfProfile: { hair_type: 'curly', junk_key: 'x' },
    selfProfileUpdatedAt: UPDATED_AT,
  })
  mocks.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      selfProfile:
        data.selfProfile && typeof data.selfProfile === 'object'
          ? data.selfProfile
          : null,
      selfProfileUpdatedAt: data.selfProfileUpdatedAt ?? null,
    }),
  )
})

async function patch(body: Record<string, unknown>): Promise<Res> {
  mocks.readJsonRecord.mockResolvedValue(body)
  return (await PATCH(
    new Request('http://test/api/v1/client/self-profile', { method: 'PATCH' }),
  )) as Res
}

describe('GET /api/v1/client/self-profile', () => {
  it('returns the normalized profile (unknown keys never leak)', async () => {
    const res = (await GET()) as Res

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      selfProfile: { hair_type: 'curly' },
      updatedAt: UPDATED_AT.toISOString(),
    })
  })

  it('404s when the client profile row is missing', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const res = (await GET()) as Res
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/client/self-profile', () => {
  it('rejects an invalid field value without writing', async () => {
    const res = await patch({ hair_type: 'gigantic' })

    expect(res.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects unknown interest values without writing', async () => {
    const res = await patch({ interests: ['hair', 'zzz'] })

    expect(res.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('merges valid fields into the existing profile and stamps updatedAt', async () => {
    const res = await patch({ skin_type: 'dry', interests: ['nails'] })

    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const updateArg = mocks.update.mock.calls[0]?.[0] as {
      data: { selfProfile: unknown; selfProfileUpdatedAt: unknown }
    }
    expect(updateArg.data.selfProfile).toEqual({
      hair_type: 'curly',
      skin_type: 'dry',
      interests: ['nails'],
    })
    expect(updateArg.data.selfProfileUpdatedAt).toBeInstanceOf(Date)
  })

  it('clears a field with null and stores SQL NULL when nothing remains', async () => {
    mocks.findUnique.mockResolvedValue({
      selfProfile: { hair_type: 'curly' },
      selfProfileUpdatedAt: UPDATED_AT,
    })

    const res = await patch({ hair_type: null })

    expect(res.status).toBe(200)
    const updateArg = mocks.update.mock.calls[0]?.[0] as {
      data: { selfProfile: unknown }
    }
    // Prisma.DbNull sentinel — anything but a plain object profile.
    expect(updateArg.data.selfProfile).not.toEqual({ hair_type: 'curly' })
  })

  it('404s when the client profile row is missing', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const res = await patch({ hair_type: 'curly' })
    expect(res.status).toBe(404)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
