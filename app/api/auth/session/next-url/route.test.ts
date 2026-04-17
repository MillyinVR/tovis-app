// app/api/auth/session/next-url/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockUserFindUnique = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
    },
  },
}))

import { GET } from './route'

describe('app/api/auth/session/next-url/route', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
    mockUserFindUnique.mockReset()
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })

    mockRequireUser.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await GET()

    expect(mockRequireUser).toHaveBeenCalledWith({
      allowVerificationSession: true,
    })
    expect(result).toBe(res)
    expect(result.status).toBe(401)
    expect(mockUserFindUnique).not.toHaveBeenCalled()
  })

  it('allows verification-session auth and returns the recovered internal nextUrl', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'user_1',
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
      },
    })

    mockUserFindUnique.mockResolvedValue({
      tapIntents: [
        {
          payloadJson: {
            nextUrl: '/claim/tok_1',
          },
        },
      ],
    })

    const result = await GET()
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(mockRequireUser).toHaveBeenCalledWith({
      allowVerificationSession: true,
    })

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      select: {
        tapIntents: {
          where: {
            expiresAt: { gt: expect.any(Date) },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            payloadJson: true,
          },
        },
      },
    })

    expect(body).toEqual({
      ok: true,
      nextUrl: '/claim/tok_1',
    })
  })

  it('returns null when the user record is not found', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'missing_user',
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
      },
    })

    mockUserFindUnique.mockResolvedValue(null)

    const result = await GET()
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      nextUrl: null,
    })
  })

  it('returns null when there is no tap intent to recover from', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'user_2',
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
      },
    })

    mockUserFindUnique.mockResolvedValue({
      tapIntents: [],
    })

    const result = await GET()
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      nextUrl: null,
    })
  })

  it('returns null when payloadJson does not contain nextUrl', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'user_3',
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
      },
    })

    mockUserFindUnique.mockResolvedValue({
      tapIntents: [
        {
          payloadJson: {
            intent: 'CLAIM_INVITE',
          },
        },
      ],
    })

    const result = await GET()
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      nextUrl: null,
    })
  })

  it('returns null for external nextUrl values', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'user_4',
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
      },
    })

    mockUserFindUnique.mockResolvedValue({
      tapIntents: [
        {
          payloadJson: {
            nextUrl: 'https://evil.example.com/pwn',
          },
        },
      ],
    })

    const result = await GET()
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      nextUrl: null,
    })
  })

  it('returns null for protocol-relative nextUrl values', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'user_5',
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
      },
    })

    mockUserFindUnique.mockResolvedValue({
      tapIntents: [
        {
          payloadJson: {
            nextUrl: '//evil.example.com/pwn',
          },
        },
      ],
    })

    const result = await GET()
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      nextUrl: null,
    })
  })

  it('returns null for blank nextUrl values', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'user_6',
        role: Role.CLIENT,
        sessionKind: 'VERIFICATION',
      },
    })

    mockUserFindUnique.mockResolvedValue({
      tapIntents: [
        {
          payloadJson: {
            nextUrl: '   ',
          },
        },
      ],
    })

    const result = await GET()
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      nextUrl: null,
    })
  })
})