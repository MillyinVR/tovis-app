import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  captureAuthException: mockCaptureAuthException,
}))

import { requireUser } from './requireUser'

type MockUserArgs = {
  role?: Role
  sessionKind?: 'ACTIVE' | 'VERIFICATION'
  phoneVerifiedAt?: Date | null
  emailVerifiedAt?: Date | null
  clientProfile?: {
    id: string
    firstName: string | null
    lastName: string | null
    avatarUrl: string | null
  } | null
  professionalProfile?: {
    id: string
    businessName: string | null
    handle: string | null
    avatarUrl: string | null
    timeZone: string | null
    location: string | null
  } | null
}

function makeMockUser(args: MockUserArgs = {}) {
  const role = args.role ?? Role.CLIENT
  const phoneVerifiedAt =
    args.phoneVerifiedAt === undefined
      ? new Date('2026-04-08T10:00:00.000Z')
      : args.phoneVerifiedAt
  const emailVerifiedAt =
    args.emailVerifiedAt === undefined
      ? new Date('2026-04-08T10:05:00.000Z')
      : args.emailVerifiedAt

  const clientProfile =
    args.clientProfile === undefined
      ? role === Role.CLIENT
        ? {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
          }
        : null
      : args.clientProfile

  const professionalProfile =
    args.professionalProfile === undefined
      ? role === Role.PRO
        ? {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            timeZone: 'America/Los_Angeles',
            location: null,
          }
        : null
      : args.professionalProfile

  return {
    id: 'user_1',
    email: 'user@example.com',
    phone: '+15551234567',
    role,
    sessionKind: args.sessionKind ?? 'ACTIVE',
    phoneVerifiedAt,
    emailVerifiedAt,
    isPhoneVerified: Boolean(phoneVerifiedAt),
    isEmailVerified: Boolean(emailVerifiedAt),
    isFullyVerified: Boolean(phoneVerifiedAt && emailVerifiedAt),
    clientProfile,
    professionalProfile,
  }
}

describe('app/api/_utils/auth/requireUser', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockCaptureAuthException.mockReset()
  })

  it('returns 500 when getCurrentUser throws', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('boom'))

    const result = await requireUser()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure result')
    expect(result.res.status).toBe(500)

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.require_user.current_user_failed',
      route: 'auth.requireUser',
      code: 'INTERNAL',
      error: expect.any(Error),
    })
  })

  it('returns 401 when no user is present', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    const result = await requireUser()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure result')
    expect(result.res.status).toBe(401)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 403 when the user role is not allowed', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeMockUser({
        role: Role.CLIENT,
      }),
    )

    const result = await requireUser({ roles: [Role.PRO] })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure result')
    expect(result.res.status).toBe(403)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 403 for a verification-only session by default', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeMockUser({
        sessionKind: 'VERIFICATION',
        phoneVerifiedAt: null,
      }),
    )

    const result = await requireUser()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure result')
    expect(result.res.status).toBe(403)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('allows a verification-only session when explicitly enabled', async () => {
    const user = makeMockUser({
      role: Role.CLIENT,
      sessionKind: 'VERIFICATION',
      phoneVerifiedAt: null,
    })
    mockGetCurrentUser.mockResolvedValue(user)

    const result = await requireUser({
      roles: [Role.CLIENT],
      allowVerificationSession: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected success result')
    expect(result.user).toEqual(user)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 403 for an active session that is not fully verified', async () => {
    mockGetCurrentUser.mockResolvedValue(
      makeMockUser({
        sessionKind: 'ACTIVE',
        emailVerifiedAt: null,
      }),
    )

    const result = await requireUser()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure result')
    expect(result.res.status).toBe(403)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns ok for a fully verified active user', async () => {
    const user = makeMockUser({
      role: Role.PRO,
      sessionKind: 'ACTIVE',
    })
    mockGetCurrentUser.mockResolvedValue(user)

    const result = await requireUser({ roles: [Role.PRO] })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected success result')
    expect(result.user).toEqual(user)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })
})