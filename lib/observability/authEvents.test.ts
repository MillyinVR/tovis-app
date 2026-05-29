// lib/observability/authEvents.test.ts
import * as Sentry from '@sentry/nextjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  emailLookupHash,
  legacySha256Hex,
  phoneLookupHash,
} from '@/lib/security/crypto/hashLookup'

import { captureAuthException, logAuthEvent } from './authEvents'

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn(),
  captureException: vi.fn(),
}))

function readLoggedJson(
  spy: ReturnType<typeof vi.spyOn>,
): Record<string, unknown> {
  const firstArg = spy.mock.calls[0]?.[0]

  if (typeof firstArg !== 'string') {
    throw new Error('Expected first logged argument to be a JSON string.')
  }

  return JSON.parse(firstArg) as Record<string, unknown>
}

function shortHash(hash: string | null): string | null {
  return hash ? hash.slice(0, 12) : null
}

describe('authEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs hashed user identifiers instead of raw email, phone, userId, or verificationId', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    logAuthEvent({
      level: 'info',
      event: 'auth.login_failed',
      route: 'POST /api/auth/login',
      provider: 'credentials',
      code: 'INVALID_CREDENTIALS',
      userId: 'user_123',
      email: 'Tori.Example@Example.com',
      phone: '+15551234567',
      verificationId: 'verify_123',
      message:
        'Login failed for Tori.Example@Example.com with phone +15551234567',
    })

    expect(infoSpy).toHaveBeenCalledTimes(1)

    const payload = readLoggedJson(infoSpy)
    const serialized = JSON.stringify(payload)

    expect(payload).toMatchObject({
      app: 'tovis-app',
      namespace: 'auth',
      level: 'info',
      event: 'auth.login_failed',
      route: 'POST /api/auth/login',
      provider: 'credentials',
      code: 'INVALID_CREDENTIALS',
    })

    expect(payload.userIdHash).toBe(shortHash(legacySha256Hex('user_123')))
    expect(payload.emailHash).toBe(
      shortHash(emailLookupHash('Tori.Example@Example.com')),
    )
    expect(payload.phoneHash).toBe(shortHash(phoneLookupHash('+15551234567')))
    expect(payload.verificationIdHash).toBe(
      shortHash(legacySha256Hex('verify_123')),
    )

    expect(serialized).not.toContain('user_123')
    expect(serialized).not.toContain('Tori.Example@Example.com')
    expect(serialized).not.toContain('tori.example@example.com')
    expect(serialized).not.toContain('+15551234567')
    expect(serialized).not.toContain('verify_123')

    expect(payload.message).toBe(
      'Login failed for [redacted-email] with phone [redacted-phone-or-id]',
    )

    infoSpy.mockRestore()
  })

  it('returns null contact hashes for malformed email and phone values without logging raw values', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    logAuthEvent({
      level: 'info',
      event: 'auth.malformed_contact',
      route: 'POST /api/auth/test',
      email: 'not-an-email',
      phone: '123',
      message: 'Malformed contact input rejected',
    })

    expect(infoSpy).toHaveBeenCalledTimes(1)

    const payload = readLoggedJson(infoSpy)
    const serialized = JSON.stringify(payload)

    expect(payload.emailHash).toBeNull()
    expect(payload.phoneHash).toBeNull()
    expect(serialized).not.toContain('not-an-email')
    expect(serialized).not.toContain('"123"')

    infoSpy.mockRestore()
  })

  it('redacts sensitive meta fields recursively before logging', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    logAuthEvent({
      level: 'warn',
      event: 'auth.verification_failed',
      route: 'POST /api/auth/email/verify',
      meta: {
        token: 'raw_token_123',
        password: 'secret-password',
        code: '123456',
        email: 'client@example.com',
        phone: '+15551234567',
        signedUrl: 'https://signed.example/private.jpg?token=abc',
        storagePath: 'media-private/bookings/booking_1/before/photo.jpg',
        safeCount: 2,
        nested: {
          accessToken: 'nested_token_123',
          addressLine1: '123 Main St',
          safeEnum: 'EXPIRED',
        },
      },
    })

    expect(warnSpy).toHaveBeenCalledTimes(1)

    const payload = readLoggedJson(warnSpy)
    const serialized = JSON.stringify(payload)

    expect(payload.token).toBe('[redacted]')
    expect(payload.password).toBe('[redacted]')
    expect(payload.code).toBe('[redacted]')
    expect(payload.email).toBe('[redacted]')
    expect(payload.phone).toBe('[redacted]')
    expect(payload.signedUrl).toBe('[redacted]')
    expect(payload.storagePath).toBe('[redacted]')
    expect(payload.safeCount).toBe(2)

    expect(payload.nested).toMatchObject({
      accessToken: '[redacted]',
      addressLine1: '[redacted]',
      safeEnum: 'EXPIRED',
    })

    expect(serialized).not.toContain('raw_token_123')
    expect(serialized).not.toContain('secret-password')
    expect(serialized).not.toContain('123456')
    expect(serialized).not.toContain('client@example.com')
    expect(serialized).not.toContain('+15551234567')
    expect(serialized).not.toContain('https://signed.example')
    expect(serialized).not.toContain('media-private/bookings')

    warnSpy.mockRestore()
  })

  it('captures auth exceptions with hashed context, sanitized Sentry exception, and sanitized structured log metadata', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const setTag = vi.fn()
    const setContext = vi.fn()

    const withScopeMock = vi.mocked(Sentry.withScope)
    const captureExceptionMock = vi.mocked(Sentry.captureException)

    type MockSentryScope = {
      setTag: (key: string, value: string) => void
      setContext: (key: string, context: Record<string, unknown>) => void
    }

    withScopeMock.mockImplementation((callback: unknown) => {
      if (typeof callback !== 'function') {
        throw new Error('Expected Sentry.withScope to receive a callback.')
      }

      const scope: MockSentryScope = {
        setTag,
        setContext,
      }

      callback(scope)
    })

    const error = new Error(
      'Failed auth for user@example.com phone +15551234567 token=raw_token_1',
    )

    captureAuthException({
      error,
      event: 'auth.register_failed',
      route: 'POST /api/auth/register',
      provider: 'credentials',
      code: 'REGISTER_FAILED',
      userId: 'user_456',
      email: 'user@example.com',
      phone: '+15551234567',
      verificationId: 'verification_456',
      meta: {
        token: 'raw_token_2',
        safeReason: 'duplicate_email',
        nested: {
          phone: '+15557654321',
          safeState: 'FAILED',
        },
      },
    })

    expect(Sentry.withScope).toHaveBeenCalledTimes(1)
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)

    const capturedError = captureExceptionMock.mock.calls[0]?.[0]

    expect(capturedError).toBeInstanceOf(Error)
    expect(capturedError).not.toBe(error)
    expect((capturedError as Error).name).toBe('Error')
    expect((capturedError as Error).message).toBe(
      'Failed auth for [redacted-email] phone [redacted-phone-or-id] token=[redacted]',
    )

    const serializedCapturedError = JSON.stringify({
      name: (capturedError as Error).name,
      message: (capturedError as Error).message,
      stack: (capturedError as Error).stack,
    })

    expect(serializedCapturedError).not.toContain('user@example.com')
    expect(serializedCapturedError).not.toContain('+15551234567')
    expect(serializedCapturedError).not.toContain('raw_token_1')

    expect(setTag).toHaveBeenCalledWith('area', 'auth')
    expect(setTag).toHaveBeenCalledWith('auth.event', 'auth.register_failed')
    expect(setTag).toHaveBeenCalledWith('auth.route', 'POST /api/auth/register')
    expect(setTag).toHaveBeenCalledWith('auth.provider', 'credentials')
    expect(setTag).toHaveBeenCalledWith('auth.code', 'REGISTER_FAILED')

    expect(setContext).toHaveBeenCalledTimes(1)

    const contextPayload = setContext.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >
    const serializedContext = JSON.stringify(contextPayload)

    expect(contextPayload.userIdHash).toBe(
      shortHash(legacySha256Hex('user_456')),
    )
    expect(contextPayload.emailHash).toBe(
      shortHash(emailLookupHash('user@example.com')),
    )
    expect(contextPayload.phoneHash).toBe(
      shortHash(phoneLookupHash('+15551234567')),
    )
    expect(contextPayload.verificationIdHash).toBe(
      shortHash(legacySha256Hex('verification_456')),
    )
    expect(contextPayload.errorName).toBe('Error')
    expect(contextPayload.errorMessage).toBe(
      'Failed auth for [redacted-email] phone [redacted-phone-or-id] token=[redacted]',
    )
    expect(contextPayload.token).toBe('[redacted]')
    expect(contextPayload.safeReason).toBe('duplicate_email')
    expect(contextPayload.nested).toMatchObject({
      phone: '[redacted]',
      safeState: 'FAILED',
    })

    expect(serializedContext).not.toContain('user_456')
    expect(serializedContext).not.toContain('user@example.com')
    expect(serializedContext).not.toContain('+15551234567')
    expect(serializedContext).not.toContain('+15557654321')
    expect(serializedContext).not.toContain('verification_456')
    expect(serializedContext).not.toContain('raw_token_1')
    expect(serializedContext).not.toContain('raw_token_2')

    expect(errorSpy).toHaveBeenCalledTimes(1)

    const loggedPayload = readLoggedJson(errorSpy)
    const serializedLog = JSON.stringify(loggedPayload)

    expect(loggedPayload.message).toBe(
      'Failed auth for [redacted-email] phone [redacted-phone-or-id] token=[redacted]',
    )
    expect(loggedPayload.errorName).toBe('Error')
    expect(loggedPayload.errorMessage).toBe(
      'Failed auth for [redacted-email] phone [redacted-phone-or-id] token=[redacted]',
    )
    expect(loggedPayload.token).toBe('[redacted]')
    expect(loggedPayload.safeReason).toBe('duplicate_email')

    expect(serializedLog).not.toContain('user_456')
    expect(serializedLog).not.toContain('user@example.com')
    expect(serializedLog).not.toContain('+15551234567')
    expect(serializedLog).not.toContain('+15557654321')
    expect(serializedLog).not.toContain('verification_456')
    expect(serializedLog).not.toContain('raw_token_1')
    expect(serializedLog).not.toContain('raw_token_2')

    errorSpy.mockRestore()
  })

  it('redacts unsafe auth event codes that look like one-time codes or secrets', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    logAuthEvent({
      level: 'warn',
      event: 'auth.otp_failed',
      route: 'POST /api/auth/verify',
      code: '123456',
    })

    const payload = readLoggedJson(warnSpy)

    expect(payload.code).toBe('[redacted]')

    warnSpy.mockRestore()
  })

  it('keeps safe enum-style auth event codes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    logAuthEvent({
      level: 'warn',
      event: 'auth.login_failed',
      route: 'POST /api/auth/login',
      code: 'INVALID_CREDENTIALS',
    })

    const payload = readLoggedJson(warnSpy)

    expect(payload.code).toBe('INVALID_CREDENTIALS')

    warnSpy.mockRestore()
  })

  it('does not throw when meta contains arrays, dates, errors, nulls, or undefined values', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(() => {
      logAuthEvent({
        level: 'info',
        event: 'auth.meta_shape_test',
        route: 'POST /api/auth/test',
        meta: {
          at: new Date('2026-05-22T12:00:00.000Z'),
          errors: [new Error('Nested error for user@example.com')],
          empty: null,
          missing: undefined,
          nested: {
            deeper: {
              deepest: {
                value: 'safe',
              },
            },
          },
        },
      })
    }).not.toThrow()

    expect(infoSpy).toHaveBeenCalledTimes(1)

    const payload = readLoggedJson(infoSpy)

    expect(payload.at).toBe('2026-05-22T12:00:00.000Z')
    expect(payload.empty).toBeNull()
    expect(payload).not.toHaveProperty('missing')

    infoSpy.mockRestore()
  })
})