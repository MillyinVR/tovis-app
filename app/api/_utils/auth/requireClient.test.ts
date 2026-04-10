import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())

vi.mock('./requireUser', () => ({
  requireUser: mockRequireUser,
}))

import { requireClient } from './requireClient'

function makeClientUser(args?: {
  clientProfile?:
    | {
        id: string
        firstName: string | null
        lastName: string | null
        avatarUrl: string | null
      }
    | null
}) {
  return {
    id: 'user_1',
    email: 'client@example.com',
    phone: '+15551234567',
    role: Role.CLIENT,
    sessionKind: 'ACTIVE' as const,
    phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: true,
    clientProfile:
      args?.clientProfile === undefined
        ? {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
          }
        : args.clientProfile,
    professionalProfile: null,
  }
}

describe('app/api/_utils/auth/requireClient', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
  })

  it('calls requireUser with the CLIENT role', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeClientUser(),
    })

    await requireClient()

    expect(mockRequireUser).toHaveBeenCalledWith({
      roles: [Role.CLIENT],
    })
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })

    mockRequireUser.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await requireClient()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure result')
    expect(result.res).toBe(res)
    expect(result.res.status).toBe(401)
  })

  it('returns 403 when the authenticated client user is missing a client profile', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeClientUser({
        clientProfile: null,
      }),
    })

    const result = await requireClient()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure result')
    expect(result.res.status).toBe(403)
  })

  it('returns ok with clientId for a valid client user', async () => {
    const user = makeClientUser()

    mockRequireUser.mockResolvedValue({
      ok: true,
      user,
    })

    const result = await requireClient()

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected success result')

    expect(result.user).toEqual(user)
    expect(result.clientId).toBe('client_1')
  })
})