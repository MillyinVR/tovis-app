import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  emailVerificationToken: {
    findFirst: vi.fn(),
    count: vi.fn(),
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
  buildVerifyEmailUrl,
  createEmailVerificationToken,
  enforceEmailVerificationLimits,
  getAppUrlFromRequest,
  issueAndSendEmailVerification,
  markEmailVerificationTokenUsed,
  sendVerificationEmail,
  EMAIL_VERIFICATION_COOLDOWN_SECONDS,
} from './emailVerification'

const ORIGINAL_ENV = { ...process.env }

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

describe('lib/auth/emailVerification', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }

    resetMockGroup(mockPrisma.emailVerificationToken)
    mockLogAuthEvent.mockReset()
    mockFetch.mockReset()

    vi.stubGlobal('fetch', mockFetch)

    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(null)
    mockPrisma.emailVerificationToken.count.mockResolvedValue(0)
    mockPrisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.emailVerificationToken.create.mockResolvedValue({
      id: 'evt_1',
      expiresAt: new Date('2026-04-20T12:00:00.000Z'),
    })
    mockPrisma.emailVerificationToken.update.mockResolvedValue({
      id: 'evt_1',
    })
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('prefers NEXT_PUBLIC_APP_URL when resolving the app URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.tovis.app///'

    const request = new Request('http://localhost/api/auth/email/send', {
      headers: {
        host: 'localhost:3000',
        'x-forwarded-proto': 'http',
      },
    })

    expect(getAppUrlFromRequest(request)).toBe('https://app.tovis.app')
  })

  it('falls back to forwarded host/proto when NEXT_PUBLIC_APP_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_APP_URL

    const request = new Request('http://localhost/api/auth/email/send', {
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'app.tovis.app',
        'x-forwarded-proto': 'https',
      },
    })

    expect(getAppUrlFromRequest(request)).toBe('https://app.tovis.app')
  })

  it('builds the verify email URL and only keeps safe optional params', () => {
    const url = buildVerifyEmailUrl({
      appUrl: 'https://app.tovis.app',
      verificationId: 'evt_123',
      token: 'token_abc',
      next: '/verify-phone?from=email',
      intent: 'complete-signup',
      inviteToken: 'invite_123',
    })

    expect(url).toBe(
      'https://app.tovis.app/verify-email?verificationId=evt_123&token=token_abc&next=%2Fverify-phone%3Ffrom%3Demail&intent=complete-signup&inviteToken=invite_123',
    )
  })

  it('drops unsafe next values when building the verify email URL', () => {
    const url = buildVerifyEmailUrl({
      appUrl: 'https://app.tovis.app',
      verificationId: 'evt_123',
      token: 'token_abc',
      next: 'https://evil.example.com/nope',
      intent: 'complete-signup',
    })

    expect(url).toBe(
      'https://app.tovis.app/verify-email?verificationId=evt_123&token=token_abc&intent=complete-signup',
    )
  })

  it('returns cooldown limits when a recent verification token already exists', async () => {
    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue({
      id: 'evt_recent',
    })

    const result = await enforceEmailVerificationLimits('user_1')

    expect(result).toEqual({
      ok: false,
      retryAfterSeconds: EMAIL_VERIFICATION_COOLDOWN_SECONDS,
    })

    expect(mockPrisma.emailVerificationToken.count).not.toHaveBeenCalled()
  })

  it('returns hourly-cap limits when too many tokens were issued recently', async () => {
    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(null)
    mockPrisma.emailVerificationToken.count.mockResolvedValue(5)

    const result = await enforceEmailVerificationLimits('user_1')

    expect(result).toEqual({
      ok: false,
      retryAfterSeconds: 600,
    })
  })

  it('creates a fresh token and invalidates prior unused email verification tokens', async () => {
    const result = await createEmailVerificationToken({
      userId: 'user_1',
      email: 'user@example.com',
    })

    expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        purpose: 'EMAIL_VERIFY',
        usedAt: null,
      },
      data: { usedAt: expect.any(Date) },
    })

    expect(mockPrisma.emailVerificationToken.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        purpose: 'EMAIL_VERIFY',
        email: 'user@example.com',
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      },
      select: {
        id: true,
        expiresAt: true,
      },
    })

    expect(result.id).toBe('evt_1')
    expect(result.expiresAt).toEqual(new Date('2026-04-20T12:00:00.000Z'))
    expect(result.token).toMatch(/^[a-f0-9]{64}$/)
  })

  it('marks a verification token used', async () => {
    await markEmailVerificationTokenUsed({
      id: 'evt_1',
      usedAt: new Date('2026-04-20T13:00:00.000Z'),
    })

    expect(mockPrisma.emailVerificationToken.update).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      data: { usedAt: new Date('2026-04-20T13:00:00.000Z') },
    })
  })

  it('sends a verification email through Postmark', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_token'
    process.env.POSTMARK_FROM_EMAIL = 'hello@tovis.app'
    process.env.POSTMARK_MESSAGE_STREAM = 'outbound'

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ErrorCode: 0, Message: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await sendVerificationEmail({
      to: 'user@example.com',
      verifyUrl: 'https://app.tovis.app/verify-email?token=abc',
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
      Subject: 'Verify your email for TOVIS',
      TextBody: expect.stringContaining(
        'Verify your email to finish setting up your TOVIS account.',
      ),
      HtmlBody: expect.stringContaining('Verify your email'),
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
      sendVerificationEmail({
        to: 'user@example.com',
        verifyUrl: 'https://app.tovis.app/verify-email?token=abc',
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
      sendVerificationEmail({
        to: 'user@example.com',
        verifyUrl: 'https://app.tovis.app/verify-email?token=abc',
      }),
    ).rejects.toThrow('Inactive recipient.')
  })

  it('issues, sends, and logs a successful verification email event', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_token'
    process.env.POSTMARK_FROM_EMAIL = 'hello@tovis.app'

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ErrorCode: 0, Message: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await issueAndSendEmailVerification({
      userId: 'user_1',
      email: 'user@example.com',
      appUrl: 'https://app.tovis.app',
      next: '/verify-phone',
      intent: 'complete-signup',
      inviteToken: 'invite_123',
    })

    expect(result).toEqual({
      id: 'evt_1',
      expiresAt: new Date('2026-04-20T12:00:00.000Z'),
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.email.send.success',
      route: 'auth.email.send',
      provider: 'postmark',
      userId: 'user_1',
      email: 'user@example.com',
      verificationId: 'evt_1',
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
      issueAndSendEmailVerification({
        userId: 'user_1',
        email: 'user@example.com',
        appUrl: 'https://app.tovis.app',
      }),
    ).rejects.toThrow('Postmark outage')

    expect(mockPrisma.emailVerificationToken.update).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      data: { usedAt: expect.any(Date) },
    })

    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })
})