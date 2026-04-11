import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockHashPassword = vi.hoisted(() => vi.fn())
const mockValidatePassword = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  passwordResetToken: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  user: {
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/auth', () => ({
  hashPassword: mockHashPassword,
}))

vi.mock('@/lib/passwordPolicy', () => ({
  validatePassword: mockValidatePassword,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  },
  jsonFail(status: number, error: string, extras?: Record<string, unknown>) {
    return new Response(JSON.stringify({ ok: false, error, ...(extras ?? {}) }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  },
  pickString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
  },
  enforceRateLimit: mockEnforceRateLimit,
  rateLimitIdentity: mockRateLimitIdentity,
}))

import { POST } from './route'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/password-reset/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: 'localhost:3000',
    },
    body: JSON.stringify(body),
  })
}

describe('app/api/auth/password-reset/confirm/route', () => {
  beforeEach(() => {
    mockRateLimitIdentity.mockReset()
    mockEnforceRateLimit.mockReset()
    mockHashPassword.mockReset()
    mockValidatePassword.mockReset()

    mockPrisma.passwordResetToken.findUnique.mockReset()
    mockPrisma.passwordResetToken.update.mockReset()
    mockPrisma.user.update.mockReset()
    mockPrisma.$transaction.mockReset()

    mockRateLimitIdentity.mockResolvedValue('ip:test')
    mockEnforceRateLimit.mockResolvedValue(null)
    mockValidatePassword.mockReturnValue(null)
    mockHashPassword.mockResolvedValue('hashed_password')

    mockPrisma.user.update.mockResolvedValue({ id: 'user_1' })
    mockPrisma.passwordResetToken.update.mockResolvedValue({ id: 'prt_1' })
    mockPrisma.$transaction.mockResolvedValue([
      { id: 'user_1' },
      { id: 'prt_1' },
    ])
  })

  it('passes through the rate-limit response unchanged', async () => {
    const rateLimitRes = new Response(null, { status: 429 })
    mockEnforceRateLimit.mockResolvedValue(rateLimitRes)

    const result = await POST(
      makeRequest({
        token: 'reset_token',
        password: 'NewPassword123!',
      }),
    )

    expect(mockRateLimitIdentity).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:password-reset-confirm',
      identity: 'ip:test',
    })

    expect(result).toBe(rateLimitRes)
    expect(result.status).toBe(429)
  })

  it('returns 400 when required fields are missing', async () => {
    const result = await POST(
      makeRequest({
        token: '',
        password: '',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing required fields.',
      code: 'MISSING_FIELDS',
    })

    expect(mockPrisma.passwordResetToken.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 when the password is too weak', async () => {
    mockValidatePassword.mockReturnValue('Use at least 8 characters.')

    const result = await POST(
      makeRequest({
        token: 'reset_token',
        password: 'short',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Use at least 8 characters.',
      code: 'WEAK_PASSWORD',
    })

    expect(mockPrisma.passwordResetToken.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 when the token is invalid', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null)

    const result = await POST(
      makeRequest({
        token: 'bad_token',
        password: 'NewPassword123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'This reset link is invalid or has expired.',
      code: 'INVALID_TOKEN',
    })

    expect(mockPrisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String) },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    })
  })

  it('returns 400 when the token has already been used', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      usedAt: new Date('2026-04-08T10:00:00.000Z'),
    })

    const result = await POST(
      makeRequest({
        token: 'used_token',
        password: 'NewPassword123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'This reset link has already been used.',
      code: 'TOKEN_USED',
    })

    expect(mockHashPassword).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the token is expired', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      usedAt: null,
    })

    const result = await POST(
      makeRequest({
        token: 'expired_token',
        password: 'NewPassword123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'This reset link is invalid or has expired.',
      code: 'TOKEN_EXPIRED',
    })

    expect(mockHashPassword).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('updates the password and marks the token used when the token is valid', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      usedAt: null,
    })

    const result = await POST(
      makeRequest({
        token: 'good_token',
        password: 'NewPassword123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({ ok: true })

    expect(mockHashPassword).toHaveBeenCalledWith('NewPassword123!')

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        password: 'hashed_password',
        authVersion: { increment: 1 },
      },
      select: { id: true },
    })

    expect(mockPrisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'prt_1' },
      data: { usedAt: expect.any(Date) },
      select: { id: true },
    })

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    const txArg = mockPrisma.$transaction.mock.calls[0]?.[0]
    expect(Array.isArray(txArg)).toBe(true)
    expect(txArg).toHaveLength(2)
  })

  it('returns 500 when an unexpected error occurs', async () => {
    mockPrisma.passwordResetToken.findUnique.mockRejectedValue(
      new Error('database exploded'),
    )

    const result = await POST(
      makeRequest({
        token: 'good_token',
        password: 'NewPassword123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Internal server error',
      code: 'INTERNAL',
    })
  })
})