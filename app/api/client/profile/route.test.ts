// app/api/client/profile/route.test.ts
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

import { PATCH } from './route'

type Res = { status: number; message?: string; body?: unknown }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({
    ok: true,
    clientId: 'client_1',
    user: { id: 'user_1' },
  })
  mocks.findUnique.mockResolvedValue({
    id: 'client_1',
    handle: null,
    isPublicProfile: false,
    publicBio: null,
  })
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'client_1',
    handle: data.handle ?? null,
    isPublicProfile: data.isPublicProfile ?? false,
    publicBio: data.publicBio ?? null,
  }))
})

async function patch(body: Record<string, unknown>): Promise<Res> {
  mocks.readJsonRecord.mockResolvedValue(body)
  return (await PATCH(new Request('http://test/api/client/profile', { method: 'PATCH' }))) as Res
}

describe('PATCH /api/client/profile', () => {
  it('rejects an invalid handle', async () => {
    const res = await patch({ handle: 'no' }) // too short
    expect(res.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects a reserved handle', async () => {
    const res = await patch({ handle: 'admin' })
    expect(res.status).toBe(400)
    expect(res.message).toMatch(/reserved/i)
  })

  it('rejects going public without a handle', async () => {
    const res = await patch({ isPublicProfile: true })
    expect(res.status).toBe(400)
    expect(res.message).toMatch(/handle/i)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('allows going public when a handle is supplied in the same request', async () => {
    const res = await patch({ handle: 'maya-reyes', isPublicProfile: true, publicBio: 'hi' })
    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          handle: 'maya-reyes',
          handleNormalized: 'maya-reyes',
          isPublicProfile: true,
          publicBio: 'hi',
        }),
      }),
    )
  })

  it('allows going public when a handle already exists', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'client_1',
      handle: 'maya-reyes',
      isPublicProfile: false,
      publicBio: null,
    })
    const res = await patch({ isPublicProfile: true })
    expect(res.status).toBe(200)
  })

  it('maps a unique-constraint collision to 409', async () => {
    mocks.update.mockRejectedValue({ code: 'P2002' })
    const res = await patch({ handle: 'taken-handle' })
    expect(res.status).toBe(409)
    expect(res.message).toMatch(/taken/i)
  })

  it('clears the handle with an empty string', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'client_1',
      handle: 'old-handle',
      isPublicProfile: false,
      publicBio: null,
    })
    const res = await patch({ handle: '' })
    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ handle: null, handleNormalized: null }),
      }),
    )
  })
})
