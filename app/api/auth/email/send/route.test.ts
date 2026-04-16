import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockEnforceEmailVerificationLimits = vi.hoisted(() => vi.fn())
const mockGetAppUrlFromRequest = vi.hoisted(() => vi.fn())
const mockIssueAndSendEmailVerification = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('@/lib/auth/emailVerification', () => ({
  enforceEmailVerificationLimits: mockEnforceEmailVerificationLimits,
  getAppUrlFromRequest: mockGetAppUrlFromRequest,
  issueAndSendEmailVerification: mockIssueAndSendEmailVerification,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
  captureAuthException: mockCaptureAuthException,
}))

import { POST } from './route'

function makeUser(args?: {
  role?: Role
  email?: string
  authVersion?: number
  emailVerifiedAt?: Date | null
  phoneVerifiedAt?: Date | null
  sessionKind?: 'ACTIVE' | 'VERIFICATION'
}) {
  const role = args?.role ?? Role.CLIENT
  const emailVerifiedAt =
    args?.emailVerifiedAt === undefined ? null : args.emailVerifiedAt
  const phoneVerifiedAt =
    args?.phoneVerifiedAt === undefined ? null : args.phoneVerifiedAt

  return {
    id: 'user_1',
    email: args?.email ?? 'user@example.com',
    phone: '+15551234567',
    role,
    authVersion: args?.authVersion ?? 1,
    sessionKind: args?.sessionKind ?? 'VERIFICATION',
    phoneVerifiedAt,
    emailVerifiedAt,
    isPhoneVerified: Boolean(phoneVerifiedAt),
    isEmailVerified: Boolean(emailVerifiedAt),
    isFullyVerified: Boolean(phoneVerifiedAt && emailVerifiedAt),
    clientProfile:
      role === Role.CLIENT
        ? {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
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
          }
        : null,
  }
}

function makeRequest(body?: unknown) {
  return new Request('http://localhost/api/auth/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

describe('app/api/auth/email/send/route', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
    mockEnforceEmailVerificationLimits.mockReset()
    mockGetAppUrlFromRequest.mockReset()
    mockIssueAndSendEmailVerification.mockReset()
    mockLogAuthEvent.mockReset()
    mockCaptureAuthException.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })

    mockRequireUser.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await POST(makeRequest())

    expect(mockRequireUser).toHaveBeenCalledWith({
      allowVerificationSession: true,
    })
    expect(result).toBe(res)
    expect(result.status).toBe(401)
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns alreadyVerified when the email is already verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        emailVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        phoneVerifiedAt: null,
      }),
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      alreadyVerified: true,
      isPhoneVerified: false,
      isEmailVerified: true,
      isFullyVerified: false,
    })

    expect(mockEnforceEmailVerificationLimits).not.toHaveBeenCalled()
    expect(mockIssueAndSendEmailVerification).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the email address is missing', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        email: '   ',
      }),
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Email address missing.',
      code: 'EMAIL_REQUIRED',
    })

    expect(mockEnforceEmailVerificationLimits).not.toHaveBeenCalled()
    expect(mockIssueAndSendEmailVerification).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 500 when the app URL cannot be resolved', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockGetAppUrlFromRequest.mockReturnValue(null)

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'App URL is not configured.',
      code: 'APP_URL_MISSING',
    })

    expect(mockEnforceEmailVerificationLimits).not.toHaveBeenCalled()
    expect(mockIssueAndSendEmailVerification).not.toHaveBeenCalled()

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'error',
      event: 'auth.email.send.app_url_missing',
      route: 'auth.email.send',
      userId: 'user_1',
      email: 'user@example.com',
      code: 'APP_URL_MISSING',
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 429 and Retry-After when resend is rate limited', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockGetAppUrlFromRequest.mockReturnValue('http://localhost:3000')
    mockEnforceEmailVerificationLimits.mockResolvedValue({
      ok: false,
      retryAfterSeconds: 60,
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(429)
    expect(result.headers.get('Retry-After')).toBe('60')
    expect(body).toEqual({
      ok: false,
      error: 'Too many requests. Try again shortly.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60,
    })

    expect(mockIssueAndSendEmailVerification).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('issues and sends the email verification when allowed', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        phoneVerifiedAt: new Date('2026-04-08T09:00:00.000Z'),
      }),
    })
    mockGetAppUrlFromRequest.mockReturnValue('http://localhost:3000')
    mockEnforceEmailVerificationLimits.mockResolvedValue({
      ok: true,
      retryAfterSeconds: 0,
    })
    mockIssueAndSendEmailVerification.mockResolvedValue({
      id: 'evt_1',
      expiresAt: new Date('2026-04-09T09:00:00.000Z'),
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      sent: true,
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      nextUrl: null,
    })

    expect(mockEnforceEmailVerificationLimits).toHaveBeenCalledWith('user_1')
    expect(mockIssueAndSendEmailVerification).toHaveBeenCalledWith({
      userId: 'user_1',
      email: 'user@example.com',
      appUrl: 'http://localhost:3000',
      next: null,
      intent: null,
      inviteToken: null,
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('passes claim handoff context into resend verification emails', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        phoneVerifiedAt: new Date('2026-04-08T09:00:00.000Z'),
      }),
    })
    mockGetAppUrlFromRequest.mockReturnValue('http://localhost:3000')
    mockEnforceEmailVerificationLimits.mockResolvedValue({
      ok: true,
      retryAfterSeconds: 0,
    })
    mockIssueAndSendEmailVerification.mockResolvedValue({
      id: 'evt_2',
      expiresAt: new Date('2026-04-09T09:00:00.000Z'),
    })

    const request = makeRequest({
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
    })

    const result = await POST(request)
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      sent: true,
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      nextUrl: '/claim/tok_1',
    })

    expect(mockIssueAndSendEmailVerification).toHaveBeenCalledWith({
      userId: 'user_1',
      email: 'user@example.com',
      appUrl: 'http://localhost:3000',
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns EMAIL_NOT_CONFIGURED when provider env is missing', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockGetAppUrlFromRequest.mockReturnValue('http://localhost:3000')
    mockEnforceEmailVerificationLimits.mockResolvedValue({
      ok: true,
      retryAfterSeconds: 0,
    })
    mockIssueAndSendEmailVerification.mockRejectedValue(
      new Error('Missing env var: POSTMARK_SERVER_TOKEN'),
    )

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Email provider is not configured.',
      code: 'EMAIL_NOT_CONFIGURED',
    })

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.email.send.failed',
      route: 'auth.email.send',
      provider: 'postmark',
      code: 'EMAIL_NOT_CONFIGURED',
      userId: 'user_1',
      email: 'user@example.com',
      error: expect.any(Error),
    })
  })

  it('returns EMAIL_SEND_FAILED for other send failures', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockGetAppUrlFromRequest.mockReturnValue('http://localhost:3000')
    mockEnforceEmailVerificationLimits.mockResolvedValue({
      ok: true,
      retryAfterSeconds: 0,
    })
    mockIssueAndSendEmailVerification.mockRejectedValue(
      new Error('Postmark timeout'),
    )

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Could not send verification email.',
      code: 'EMAIL_SEND_FAILED',
    })

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.email.send.failed',
      route: 'auth.email.send',
      provider: 'postmark',
      code: 'EMAIL_SEND_FAILED',
      userId: 'user_1',
      email: 'user@example.com',
      error: expect.any(Error),
    })
  })
})