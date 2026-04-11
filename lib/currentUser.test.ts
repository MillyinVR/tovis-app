import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockCookies = vi.hoisted(() => vi.fn())
const mockVerifyToken = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}))

vi.mock('./auth', () => ({
  verifyToken: mockVerifyToken,
}))

vi.mock('./prisma', () => ({
  prisma: mockPrisma,
}))

import { getCurrentUser, currentUserSelect } from './currentUser'

function makeDbUser(args?: {
  id?: string
  role?: Role
  authVersion?: number
  phoneVerifiedAt?: Date | null
  emailVerifiedAt?: Date | null
}) {
  const role = args?.role ?? Role.CLIENT
  const phoneVerifiedAt =
    args?.phoneVerifiedAt === undefined
      ? new Date('2026-04-08T10:00:00.000Z')
      : args.phoneVerifiedAt
  const emailVerifiedAt =
    args?.emailVerifiedAt === undefined
      ? new Date('2026-04-08T10:05:00.000Z')
      : args.emailVerifiedAt

  return {
    id: args?.id ?? 'user_1',
    email: 'user@example.com',
    phone: '+15551234567',
    role,
    authVersion: args?.authVersion ?? 1,
    phoneVerifiedAt,
    emailVerifiedAt,
    clientProfile:
      role === Role.CLIENT
        ? {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
            phoneVerifiedAt,
          }
        : null,
    professionalProfile:
      role === Role.PRO
        ? {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            timeZone: 'America/Los_Angeles',
            location: null,
            phoneVerifiedAt,
          }
        : null,
  }
}

describe('lib/currentUser', () => {
  beforeEach(() => {
    mockCookies.mockReset()
    mockVerifyToken.mockReset()
    mockPrisma.user.findUnique.mockReset()

    mockCookies.mockResolvedValue({
      get: vi.fn(() => undefined),
    })
    mockVerifyToken.mockReturnValue(null)
  })

  it('returns null when the auth cookie is missing', async () => {
    const result = await getCurrentUser()

    expect(result).toBeNull()
    expect(mockVerifyToken).not.toHaveBeenCalled()
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('returns null when token verification fails', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'bad_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue(null)

    const result = await getCurrentUser()

    expect(result).toBeNull()
    expect(mockVerifyToken).toHaveBeenCalledWith('bad_token')
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('returns null when the user no longer exists', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'good_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(null)

    const result = await getCurrentUser()

    expect(result).toBeNull()
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      select: currentUserSelect,
    })
  })

  it('returns null when token authVersion does not match the database user authVersion', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'stale_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({
        authVersion: 2,
      }),
    )

    const result = await getCurrentUser()

    expect(result).toBeNull()
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      select: currentUserSelect,
    })
  })

  it('returns the current user with derived verification booleans when the token matches the database user', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'good_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({
        role: Role.CLIENT,
        authVersion: 1,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    )

    const result = await getCurrentUser()

    expect(result).toEqual({
      id: 'user_1',
      email: 'user@example.com',
      phone: '+15551234567',
      role: Role.CLIENT,
      authVersion: 1,
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      emailVerifiedAt: null,
      sessionKind: 'VERIFICATION',
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      clientProfile: {
        id: 'client_1',
        firstName: 'Tori',
        lastName: 'Morales',
        avatarUrl: null,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      },
      professionalProfile: null,
    })
  })

  it('returns a fully verified PRO user correctly', async () => {
    mockCookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'tovis_token' ? { value: 'good_token' } : undefined,
      ),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.PRO,
      sessionKind: 'ACTIVE',
      authVersion: 3,
    })
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({
        role: Role.PRO,
        authVersion: 3,
      }),
    )

    const result = await getCurrentUser()

    expect(result).toEqual({
      id: 'user_1',
      email: 'user@example.com',
      phone: '+15551234567',
      role: Role.PRO,
      authVersion: 3,
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      sessionKind: 'ACTIVE',
      isPhoneVerified: true,
      isEmailVerified: true,
      isFullyVerified: true,
      clientProfile: null,
      professionalProfile: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        handle: 'tovisstudio',
        avatarUrl: null,
        timeZone: 'America/Los_Angeles',
        location: null,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      },
    })
  })
})