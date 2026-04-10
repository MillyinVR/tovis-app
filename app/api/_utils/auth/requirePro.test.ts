import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())

vi.mock('./requireUser', () => ({
  requireUser: mockRequireUser,
}))

import { requirePro } from './requirePro'

function makeProUser(args?: {
  professionalProfile?:
    | {
        id: string
        businessName: string | null
        handle: string | null
        avatarUrl: string | null
        timeZone: string | null
        location: string | null
      }
    | null
}) {
  return {
    id: 'user_1',
    email: 'pro@example.com',
    phone: '+15551234567',
    role: Role.PRO,
    sessionKind: 'ACTIVE' as const,
    phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: true,
    clientProfile: null,
    professionalProfile:
      args?.professionalProfile === undefined
        ? {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            timeZone: 'America/Los_Angeles',
            location: null,
          }
        : args.professionalProfile,
  }
}

describe('app/api/_utils/auth/requirePro', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
  })

  it('calls requireUser with the PRO role', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeProUser(),
    })

    await requirePro()

    expect(mockRequireUser).toHaveBeenCalledWith({
      roles: [Role.PRO],
    })
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })

    mockRequireUser.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await requirePro()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure result')
    expect(result.res).toBe(res)
    expect(result.res.status).toBe(401)
  })

  it('returns 403 when the authenticated pro user is missing a professional profile', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeProUser({
        professionalProfile: null,
      }),
    })

    const result = await requirePro()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure result')
    expect(result.res.status).toBe(403)
  })

  it('returns ok with userId, professionalId, and proId for a valid pro user', async () => {
    const user = makeProUser()

    mockRequireUser.mockResolvedValue({
      ok: true,
      user,
    })

    const result = await requirePro()

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected success result')

    expect(result.user).toEqual(user)
    expect(result.userId).toBe('user_1')
    expect(result.professionalId).toBe('pro_1')
    expect(result.proId).toBe('pro_1')
  })
})