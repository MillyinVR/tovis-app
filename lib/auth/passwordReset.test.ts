// lib/auth/passwordReset.test.ts
import crypto from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  passwordResetToken: {
    updateMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
}))

import {
  buildPasswordResetToken,
  buildPasswordResetUrl,
  createPasswordResetToken,
  getPasswordResetAppUrlFromRequest,
  getPasswordResetRequestIp,
  issueAndSendPasswordReset,
  markPasswordResetTokenUsed,
  parsePasswordResetToken,
  sendPasswordResetEmail,
} from './passwordReset'

const ORIGINAL_ENV = { ...process.env }

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

describe('lib/auth/passwordReset', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }

    resetMockGroup(mockPrisma.passwordResetToken)
    mockLogAuthEvent.mockReset()
    mockFetch.mockReset()

    vi.stubGlobal('fetch', mockFetch)

    mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.passwordResetToken.create.mockResolvedValue({
      id: 'prt_1',
      expiresAt: new Date('2026-04-20T12:00:00.000Z'),
    })
    mockPrisma.passwordResetToken.update.mockResolvedValue({
      id: 'prt_1',
    })
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('prefers NEXT_PUBLIC_APP_URL when resolving the password reset app URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.tovis.app///'

    const request = new Request(
      'http://localhost/api/auth/password-reset/request',
      {
        headers: {
          host: 'localhost:3000',
          'x-forwarded-proto': 'http',
        },
      },
    )

    expect(getPasswordResetAppUrlFromRequest(request)).toBe(
      'https://app.tovis.app',
    )
  })

  it('falls back to forwarded host/proto when NEXT_PUBLIC_APP_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_APP_URL

    const request = new Request(
      'http://localhost/api/auth/password-reset/request',
      {
        headers: {
          host: 'localhost:3000',
          'x-forwarded-host': 'app.tovis.app',
          'x-forwarded-proto': 'https',
        },
      },
    )

    expect(getPasswordResetAppUrlFromRequest(request)).toBe(
      'https://app.tovis.app',
    )
  })

  it('builds the password reset token from token id and secret', () => {
    const token = buildPasswordResetToken({
      tokenId: 'prt_1',
      secret: 'abcdef123456',
    })

    expect(token).toBe('prt_1.abcdef123456')
  })

  it('parses a password reset token into token id and secret', () => {
    expect(parsePasswordResetToken('prt_1.abcdef123456')).toEqual({
      tokenId: 'prt_1',
      secret: 'abcdef123456',
    })
  })

  it('returns null when the password reset token format is invalid', () => {
    expect(parsePasswordResetToken(null)).toBeNull()
    expect(parsePasswordResetToken('')).toBeNull()
    expect(parsePasswordResetToken('prt_1')).toBeNull()
    expect(parsePasswordResetToken('.abcdef')).toBeNull()
    expect(parsePasswordResetToken('prt_1.')).toBeNull()
  })

  it('builds the password reset URL', () => {
    const url = buildPasswordResetUrl({
      appUrl: 'https://app.tovis.app',
      token: 'prt_1.abcdef123456',
    })

    expect(url).toBe('https://app.tovis.app/reset-password/prt_1.abcdef123456')
  })

  it('extracts the first forwarded IP for password reset requests', () => {
    const request = new Request(
      'http://localhost/api/auth/password-reset/request',
      {
        headers: {
          'x-forwarded-for': '198.51.100.20, 10.0.0.2',
        },
      },
    )

    expect(getPasswordResetRequestIp(request)).toBe('198.51.100.20')
  })

  it('returns null when no forwarded IP is present', () => {
    const request = new Request(
      'http://localhost/api/auth/password-reset/request',
    )

    expect(getPasswordResetRequestIp(request)).toBeNull()
  })

  it('creates a fresh password reset token, hashes only the secret, and invalidates prior unused tokens', async () => {
    const result = await createPasswordResetToken({
      userId: 'user_1',
      ip: '198.51.100.20',
      userAgent: 'Vitest Agent',
    })

    expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        usedAt: null,
      },
      data: { usedAt: expect.any(Date) },
    })

    const parsed = parsePasswordResetToken(result.token)
    expect(parsed).not.toBeNull()

    expect(result.id).toBe('prt_1')
    expect(result.expiresAt).toEqual(new Date('2026-04-20T12:00:00.000Z'))
    expect(result.token).toMatch(/^prt_1\.[a-f0-9]{64}$/)

    expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        tokenHash: sha256(parsed!.secret),
        expiresAt: expect.any(Date),
        ip: '198.51.100.20',
        userAgent: 'Vitest Agent',
      },
      select: {
        id: true,
        expiresAt: true,
      },
    })
  })

  it('marks a password reset token used', async () => {
    await markPasswordResetTokenUsed({
      id: 'prt_1',
      usedAt: new Date('2026-04-20T13:00:00.000Z'),
    })

    expect(mockPrisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'prt_1' },
      data: { usedAt: new Date('2026-04-20T13:00:00.000Z') },
    })
  })

  it('sends a password reset email through Postmark', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_token'
    process.env.POSTMARK_FROM_EMAIL = 'hello@tovis.app'
    process.env.POSTMARK_MESSAGE_STREAM = 'outbound'

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ErrorCode: 0, Message: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await sendPasswordResetEmail({
      to: 'user@example.com',
      resetUrl: 'https://app.tovis.app/reset-password/prt_1.abcdef123456',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.postmarkapp.com/email',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': 'pm_test_token',
        }),
      }),
    )

    const fetchCall = mockFetch.mock.calls[0]?.[1]
    const payload = JSON.parse(String(fetchCall?.body))

    expect(payload).toEqual({
      From: 'hello@tovis.app',
      To: 'user@example.com',
      Subject: 'Reset your TOVIS password',
      TextBody: expect.stringContaining(
        'We received a request to reset your TOVIS password.',
      ),
      HtmlBody: expect.stringContaining('Reset your password'),
      MessageStream: 'outbound',
    })
  })

  it('throws a useful error when Postmark returns a non-200 response', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_token'
    process.env.POSTMARK_FROM_EMAIL = 'hello@tovis.app'

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ Message: 'Sender signature not found.' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      sendPasswordResetEmail({
        to: 'user@example.com',
        resetUrl: 'https://app.tovis.app/reset-password/prt_1.abcdef123456',
      }),
    ).rejects.toThrow('Sender signature not found.')
  })

  it('throws when Postmark responds with a non-zero ErrorCode', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_token'
    process.env.POSTMARK_FROM_EMAIL = 'hello@tovis.app'

    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ErrorCode: 406,
          Message: 'Inactive recipient.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    await expect(
      sendPasswordResetEmail({
        to: 'user@example.com',
        resetUrl: 'https://app.tovis.app/reset-password/prt_1.abcdef123456',
      }),
    ).rejects.toThrow('Inactive recipient.')
  })

  it('issues, sends, and logs a successful password reset email event', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_token'
    process.env.POSTMARK_FROM_EMAIL = 'hello@tovis.app'

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ErrorCode: 0, Message: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await issueAndSendPasswordReset({
      userId: 'user_1',
      email: 'user@example.com',
      appUrl: 'https://app.tovis.app',
      ip: '198.51.100.20',
      userAgent: 'Vitest Agent',
    })

    expect(result).toEqual({
      id: 'prt_1',
      expiresAt: new Date('2026-04-20T12:00:00.000Z'),
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.password_reset.email_send.success',
      route: 'auth.passwordReset.request',
      provider: 'postmark',
      userId: 'user_1',
      email: 'user@example.com',
      verificationId: 'prt_1',
    })
  })

  it('marks the token used and rethrows when sending the email fails', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_token'
    process.env.POSTMARK_FROM_EMAIL = 'hello@tovis.app'

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ Message: 'Postmark outage' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      issueAndSendPasswordReset({
        userId: 'user_1',
        email: 'user@example.com',
        appUrl: 'https://app.tovis.app',
      }),
    ).rejects.toThrow('Postmark outage')

    expect(mockPrisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'prt_1' },
      data: { usedAt: expect.any(Date) },
    })

    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })
})