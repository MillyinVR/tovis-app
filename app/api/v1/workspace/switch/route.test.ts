import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockSetSessionCookie = vi.hoisted(() => vi.fn())
const mockResolveTenant = vi.hoisted(() => vi.fn())
const mockPrisma = vi.hoisted(() => ({
  clientProfile: { findFirst: vi.fn(), create: vi.fn() },
}))

vi.mock('@/lib/currentUser', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/lib/auth', () => ({ createActiveToken: mockCreateActiveToken }))
vi.mock('@/app/api/_utils/auth/sessionCookie', () => ({
  setSessionCookie: mockSetSessionCookie,
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: mockResolveTenant,
}))
vi.mock('@/lib/security/contactLookup', () => ({
  buildClientProfileContactLookupData: () => ({}),
}))
vi.mock('@/lib/security/phonePrivacy', () => ({
  buildPhoneEncryptionWriteData: () => ({}),
}))

import { POST } from './route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/workspace/switch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_1',
    email: 'user@example.com',
    phone: '+15551234567',
    authVersion: 4,
    role: Role.ADMIN,
    homeRole: Role.ADMIN,
    sessionKind: 'ACTIVE',
    isFullyVerified: true,
    clientProfile: null,
    professionalProfile: null,
    ...overrides,
  }
}

describe('POST /api/v1/workspace/switch', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockCreateActiveToken.mockReset().mockReturnValue('minted_token')
    mockSetSessionCookie.mockReset()
    mockResolveTenant.mockReset().mockResolvedValue({ tenantId: 'tenant_root' })
    mockPrisma.clientProfile.findFirst.mockReset().mockResolvedValue(null)
    mockPrisma.clientProfile.create.mockReset().mockResolvedValue({ id: 'cp_new' })
  })

  it('401s when not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await POST(request({ workspace: 'CLIENT' }))
    expect(res.status).toBe(401)
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
  })

  it('403s when the session is not active', async () => {
    mockGetCurrentUser.mockResolvedValue(
      activeUser({ sessionKind: 'VERIFICATION' }),
    )
    const res = await POST(request({ workspace: 'CLIENT' }))
    expect(res.status).toBe(403)
  })

  it('400s on an unknown workspace', async () => {
    mockGetCurrentUser.mockResolvedValue(activeUser())
    const res = await POST(request({ workspace: 'SUPERUSER' }))
    expect(res.status).toBe(400)
  })

  it('403s when the user is not entitled to the target workspace', async () => {
    // A pure client cannot switch to ADMIN.
    mockGetCurrentUser.mockResolvedValue(
      activeUser({
        role: Role.CLIENT,
        homeRole: Role.CLIENT,
        clientProfile: { id: 'cp_1' },
      }),
    )
    const res = await POST(request({ workspace: 'ADMIN' }))
    expect(res.status).toBe(403)
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
  })

  it('switches an admin to an existing client workspace without creating a profile', async () => {
    mockGetCurrentUser.mockResolvedValue(
      activeUser({ clientProfile: { id: 'cp_1' } }),
    )

    const res = await POST(request({ workspace: 'CLIENT' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      workspace: 'CLIENT',
      href: '/client',
    })
    expect(mockPrisma.clientProfile.create).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: 'CLIENT',
      authVersion: 4,
    })
    expect(mockSetSessionCookie).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'minted_token' }),
    )
  })

  it('auto-provisions a ClientProfile when an admin switches to client without one', async () => {
    mockGetCurrentUser.mockResolvedValue(activeUser({ clientProfile: null }))

    const res = await POST(request({ workspace: 'CLIENT' }))

    expect(res.status).toBe(200)
    expect(mockPrisma.clientProfile.findFirst).toHaveBeenCalled()
    expect(mockPrisma.clientProfile.create).toHaveBeenCalledTimes(1)
    expect(mockSetSessionCookie).toHaveBeenCalled()
  })

  it('switches a licensed admin to the pro workspace', async () => {
    mockGetCurrentUser.mockResolvedValue(
      activeUser({
        professionalProfile: { verificationStatus: 'APPROVED' },
      }),
    )

    const res = await POST(request({ workspace: 'PRO' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ href: '/pro/calendar' })
    expect(mockPrisma.clientProfile.create).not.toHaveBeenCalled()
  })
})
