// app/api/v1/blocks/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )

  const jsonFail = vi.fn(
    (status: number, message: string, extra?: Record<string, unknown> | null) =>
      new Response(JSON.stringify({ ok: false, error: message, ...(extra ?? {}) }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )

  const prisma = {
    userBlock: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  }

  return {
    jsonOk,
    jsonFail,
    prisma,
    requireUser: vi.fn(),
    resolveBlockTargetByHandle: vi.fn(),
    resolveBlockTargetByProfessionalId: vi.fn(),
    loadBlockedAccounts: vi.fn(),
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
  requireUser: mocks.requireUser,
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

vi.mock('@/lib/blocks/blockTargets', () => ({
  resolveBlockTargetByHandle: mocks.resolveBlockTargetByHandle,
  resolveBlockTargetByProfessionalId: mocks.resolveBlockTargetByProfessionalId,
  loadBlockedAccounts: mocks.loadBlockedAccounts,
}))

vi.mock('@/lib/security/logging', () => ({ safeError: (e: unknown) => e }))

import { GET, POST } from './route'
import { DELETE } from './[blockId]/route'

const VIEWER = { ok: true as const, user: { id: 'viewer_1' } }

function postRequest(body: unknown) {
  return new Request('http://test/api/v1/blocks', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function deleteCtx(blockId: string) {
  return { params: Promise.resolve({ blockId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUser.mockResolvedValue(VIEWER)
  mocks.prisma.userBlock.create.mockResolvedValue({ id: 'block_1' })
  mocks.prisma.userBlock.deleteMany.mockResolvedValue({ count: 1 })
  mocks.loadBlockedAccounts.mockResolvedValue([])
  mocks.resolveBlockTargetByHandle.mockResolvedValue({
    userId: 'target_1',
    handle: 'nadia',
    displayName: '@nadia',
    avatarUrl: null,
  })
})

describe('POST /api/v1/blocks', () => {
  it('blocks by handle and returns the row id the Unblock control needs', async () => {
    const res = await POST(postRequest({ handle: 'nadia' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      blockId: 'block_1',
      handle: 'nadia',
      displayName: '@nadia',
      blocked: true,
    })
    expect(mocks.prisma.userBlock.create).toHaveBeenCalledWith({
      data: { blockerUserId: 'viewer_1', blockedUserId: 'target_1' },
      select: { id: true },
    })
  })

  it('blocks by professionalId — a pro is reached by id, and their handle is nullable', async () => {
    mocks.resolveBlockTargetByProfessionalId.mockResolvedValue({
      userId: 'pro_user',
      handle: '',
      displayName: 'Studio Nine',
      avatarUrl: null,
    })

    const res = await POST(postRequest({ professionalId: 'pro_1' }))

    expect(res.status).toBe(200)
    expect(mocks.resolveBlockTargetByProfessionalId).toHaveBeenCalledWith(
      mocks.prisma,
      'pro_1',
    )
    expect(mocks.resolveBlockTargetByHandle).not.toHaveBeenCalled()
  })

  it('refuses a self-block, which would erase the viewer from their own feeds', async () => {
    mocks.resolveBlockTargetByHandle.mockResolvedValue({
      userId: 'viewer_1',
      handle: 'me',
      displayName: '@me',
      avatarUrl: null,
    })

    const res = await POST(postRequest({ handle: 'me' }))

    expect(res.status).toBe(400)
    expect(mocks.prisma.userBlock.create).not.toHaveBeenCalled()
  })

  it('is idempotent: a re-block returns the EXISTING row id, not an error', async () => {
    mocks.prisma.userBlock.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )
    mocks.prisma.userBlock.findUnique.mockResolvedValue({ id: 'existing_block' })

    const res = await POST(postRequest({ handle: 'nadia' }))

    expect(res.status).toBe(200)
    // Without the id the caller cannot render Unblock, so a swallowed P2002
    // must still resolve the row rather than returning a bare ok.
    await expect(res.json()).resolves.toMatchObject({ blockId: 'existing_block' })
  })

  it('404s an unknown handle', async () => {
    mocks.resolveBlockTargetByHandle.mockResolvedValue(null)
    const res = await POST(postRequest({ handle: 'ghost' }))
    expect(res.status).toBe(404)
  })

  it('400s when no target is named', async () => {
    const res = await POST(postRequest({}))
    expect(res.status).toBe(400)
    expect(mocks.prisma.userBlock.create).not.toHaveBeenCalled()
  })

  it('requires a signed-in user', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      res: new Response(null, { status: 401 }),
    })
    const res = await POST(postRequest({ handle: 'nadia' }))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/blocks', () => {
  it('lists only the blocks the viewer MADE', async () => {
    mocks.loadBlockedAccounts.mockResolvedValue([
      { blockId: 'b1', handle: 'nadia', displayName: '@nadia', avatarUrl: null },
    ])

    const res = await GET()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      blocks: [
        { blockId: 'b1', handle: 'nadia', displayName: '@nadia', avatarUrl: null },
      ],
    })
    expect(mocks.loadBlockedAccounts).toHaveBeenCalledWith(mocks.prisma, {
      userId: 'viewer_1',
    })
  })
})

describe('DELETE /api/v1/blocks/[blockId]', () => {
  it('scopes the delete to the viewer\'s own block row', async () => {
    const res = await DELETE(new Request('http://test'), deleteCtx('block_1'))

    expect(res.status).toBe(200)
    // 🔴 blockerUserId in the WHERE is what stops any signed-in user lifting
    // someone else's block by guessing an id. A `delete` by id alone would.
    expect(mocks.prisma.userBlock.deleteMany).toHaveBeenCalledWith({
      where: { id: 'block_1', blockerUserId: 'viewer_1' },
    })
  })

  it('is idempotent and does not distinguish "not yours" from "already gone"', async () => {
    mocks.prisma.userBlock.deleteMany.mockResolvedValue({ count: 0 })

    const res = await DELETE(new Request('http://test'), deleteCtx('someone_elses'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      blockId: 'someone_elses',
      blocked: false,
    })
  })

  it('400s a missing block id', async () => {
    const res = await DELETE(new Request('http://test'), deleteCtx('  '))
    expect(res.status).toBe(400)
    expect(mocks.prisma.userBlock.deleteMany).not.toHaveBeenCalled()
  })
})
