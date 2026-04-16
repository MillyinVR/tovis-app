import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockHashPassword = vi.hoisted(() => vi.fn())
const mockValidatePassword = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())
const mockParsePasswordResetToken = vi.hoisted(() => vi.fn())
const mockSha256Hex = vi.hoisted(() => vi.fn())
const mockTimingSafeEqualHex = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  passwordResetToken: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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

vi.mock('@/lib/observability/authEvents', () => ({
  captureAuthException: mockCaptureAuthException,
}))

vi.mock('@/lib/auth/passwordReset', () => ({
  parsePasswordResetToken: mockParsePasswordResetToken,
}))

vi.mock('@/lib/auth/timingSafe', () => ({
  sha256Hex: mockSha256Hex,
  timingSafeEqualHex: mockTimingSafeEqualHex,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk(payload: Record<string, unknown>, status = 200) {
    return new Response(
      JSON.stringify({
        ok: true,
        ...payload,
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  },

  jsonFail(status: number, error: string, extras?: Record<string, unknown>) {
    return new Response(
      JSON.stringify({ ok: false, error, ...(extras ?? {}) }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      },
    )
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
    mockCaptureAuthException.mockReset()
    mockParsePasswordResetToken.mockReset()
    mockSha256Hex.mockReset()
    mockTimingSafeEqualHex.mockReset()

    mockPrisma.passwordResetToken.findUnique.mockReset()
    mockPrisma.passwordResetToken.update.mockReset()
    mockPrisma.passwordResetToken.updateMany.mockReset()
    mockPrisma.user.update.mockReset()
    mockPrisma.$transaction.mockReset()

    mockRateLimitIdentity.mockResolvedValue({
      kind: 'ip',
      id: '203.0.113.10',
    })
    mockEnforceRateLimit.mockResolvedValue(null)
    mockValidatePassword.mockReturnValue(null)
    mockHashPassword.mockResolvedValue('hashed_password')

    mockParsePasswordResetToken.mockReturnValue({
      tokenId: 'prt_1',
      secret: 'secret_abc',
    })
    mockSha256Hex.mockReturnValue('submitted_hash')
    mockTimingSafeEqualHex.mockReturnValue(true)

    mockPrisma.user.update.mockResolvedValue({ id: 'user_1' })
    mockPrisma.passwordResetToken.update.mockResolvedValue({ id: 'prt_1' })
    mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.$transaction.mockResolvedValue([
      { id: 'user_1' },
      { id: 'prt_1' },
      { count: 1 },
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes through the rate-limit response unchanged', async () => {
    const rateLimitRes = new Response(null, { status: 429 })
    mockEnforceRateLimit.mockResolvedValue(rateLimitRes)

    const result = await POST(
      makeRequest({
        token: 'prt_1.secret_abc',
        password: 'NewPassword123!',
      }),
    )

    expect(mockRateLimitIdentity).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:password-reset-confirm',
      identity: { kind: 'ip', id: '203.0.113.10' },
    })

    expect(result).toBe(rateLimitRes)
    expect(result.status).toBe(429)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
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

    expect(mockParsePasswordResetToken).not.toHaveBeenCalled()
    expect(mockPrisma.passwordResetToken.findUnique).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the password is too weak', async () => {
    mockValidatePassword.mockReturnValue('Use at least 8 characters.')

    const result = await POST(
      makeRequest({
        token: 'prt_1.secret_abc',
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

    expect(mockParsePasswordResetToken).not.toHaveBeenCalled()
    expect(mockPrisma.passwordResetToken.findUnique).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the token format is invalid', async () => {
    mockParsePasswordResetToken.mockReturnValue(null)

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

    expect(mockParsePasswordResetToken).toHaveBeenCalledWith('bad_token')
    expect(mockPrisma.passwordResetToken.findUnique).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the token id is not found', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null)

    const result = await POST(
      makeRequest({
        token: 'prt_1.secret_abc',
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
      where: { id: 'prt_1' },
      select: {
        id: true,
        userId: true,
        tokenHash: true,
        attempts: true,
        expiresAt: true,
        usedAt: true,
      },
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the token has already been used', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: 'stored_hash',
      attempts: 0,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      usedAt: new Date('2026-04-08T10:00:00.000Z'),
    })

    const result = await POST(
      makeRequest({
        token: 'prt_1.secret_abc',
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

    expect(mockSha256Hex).not.toHaveBeenCalled()
    expect(mockHashPassword).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('keeps a locked token unusable after usedAt has been set', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: 'stored_hash',
      attempts: 5,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      usedAt: new Date('2026-04-16T12:00:00.000Z'),
    })

    const result = await POST(
      makeRequest({
        token: 'prt_1.secret_abc',
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

    expect(mockSha256Hex).not.toHaveBeenCalled()
    expect(mockHashPassword).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the token is expired', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: 'stored_hash',
      attempts: 0,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      usedAt: null,
    })

    const result = await POST(
      makeRequest({
        token: 'prt_1.secret_abc',
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

    expect(mockSha256Hex).not.toHaveBeenCalled()
    expect(mockHashPassword).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 and increments attempts when the token secret is wrong before lockout', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: 'stored_hash',
      attempts: 3,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      usedAt: null,
    })
    mockTimingSafeEqualHex.mockReturnValue(false)

    const result = await POST(
      makeRequest({
        token: 'prt_1.wrong_secret',
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

    expect(mockSha256Hex).toHaveBeenCalledWith('secret_abc')
    expect(mockTimingSafeEqualHex).toHaveBeenCalledWith(
      'submitted_hash',
      'stored_hash',
    )
    expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'prt_1',
        usedAt: null,
        attempts: 3,
      },
      data: {
        attempts: { increment: 1 },
      },
    })

    expect(mockHashPassword).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('locks the token on the 5th wrong secret attempt', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: 'stored_hash',
      attempts: 4,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      usedAt: null,
    })
    mockTimingSafeEqualHex.mockReturnValue(false)

    const result = await POST(
      makeRequest({
        token: 'prt_1.wrong_secret',
        password: 'NewPassword123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Too many attempts. Please request a new password reset.',
      code: 'TOKEN_LOCKED',
    })

    expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'prt_1',
        usedAt: null,
        attempts: 4,
      },
      data: {
        attempts: { increment: 1 },
        usedAt: expect.any(Date),
      },
    })

    expect(mockHashPassword).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('updates the password, marks the current token used, and invalidates sibling tokens when the token is valid', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: 'stored_hash',
      attempts: 0,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      usedAt: null,
    })
    mockTimingSafeEqualHex.mockReturnValue(true)

    const result = await POST(
      makeRequest({
        token: 'prt_1.secret_abc',
        password: 'NewPassword123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({ ok: true })

    expect(mockSha256Hex).toHaveBeenCalledWith('secret_abc')
    expect(mockTimingSafeEqualHex).toHaveBeenCalledWith(
      'submitted_hash',
      'stored_hash',
    )

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

    expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        usedAt: null,
      },
      data: { usedAt: expect.any(Date) },
    })

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    const txArg = mockPrisma.$transaction.mock.calls[0]?.[0]
    expect(Array.isArray(txArg)).toBe(true)
    expect(txArg).toHaveLength(3)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 500 and captures the exception when an unexpected error occurs', async () => {
    mockPrisma.passwordResetToken.findUnique.mockRejectedValue(
      new Error('database exploded'),
    )

    const result = await POST(
      makeRequest({
        token: 'prt_1.secret_abc',
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

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.password_reset.confirm.failed',
      route: 'auth.passwordReset.confirm',
      code: 'INTERNAL',
      userId: null,
      error: expect.any(Error),
    })
  })
})