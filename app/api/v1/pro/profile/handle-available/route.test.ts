// app/api/v1/pro/profile/handle-available/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const requirePro = vi.fn()

  const prisma = {
    professionalProfile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  }

  return { jsonOk, requirePro, prisma }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { GET } from './route'

function makeRequest(handle: string) {
  return new Request(
    `http://localhost/api/v1/pro/profile/handle-available?handle=${encodeURIComponent(handle)}`,
  )
}

async function call(handle: string) {
  const res = await GET(makeRequest(handle))
  return (await res.json()) as {
    status: string
    message: string
    suggestions?: string[]
  }
}

describe('GET /api/v1/pro/profile/handle-available', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(null)
    mocks.prisma.professionalProfile.findMany.mockResolvedValue([])
  })

  it('401s when not an authed pro', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: new Response('no', { status: 401 }),
    })
    const res = await GET(makeRequest('jane'))
    expect(res.status).toBe(401)
  })

  it('returns invalid for a format-bad handle without hitting the DB', async () => {
    const body = await call('ab')
    expect(body.status).toBe('invalid')
    expect(mocks.prisma.professionalProfile.findUnique).not.toHaveBeenCalled()
  })

  it('returns reserved for a reserved word', async () => {
    const body = await call('admin')
    expect(body.status).toBe('reserved')
  })

  it('returns available when no row owns the handle', async () => {
    const body = await call('janesmith')
    expect(body.status).toBe('available')
  })

  it('returns yours when the handle is the caller’s own', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({ id: 'pro_1' })
    const body = await call('janesmith')
    expect(body.status).toBe('yours')
  })

  it('returns taken (with suggestions) when another pro owns it', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({ id: 'pro_2' })
    const body = await call('janesmith')
    expect(body.status).toBe('taken')
    expect(Array.isArray(body.suggestions)).toBe(true)
  })
})
