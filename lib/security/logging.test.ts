import { describe, expect, it } from 'vitest'

import {
  safeError,
  safeLogMeta,
  type SafeLogValue,
} from '@/lib/security/logging'

type SafeLogObject = { [key: string]: SafeLogValue }

function expectSafeLogObject(value: SafeLogValue): SafeLogObject {
  expect(value).not.toBeNull()
  expect(Array.isArray(value)).toBe(false)
  expect(typeof value).toBe('object')

  return value as SafeLogObject
}

describe('safeError', () => {
  it('keeps error name and redacts sensitive message content', () => {
    const result = safeError(
      new Error(
        'Failed for tori@example.com token abc123 phone +15551234567 at https://example.com/file.jpg?token=secret',
      ),
    )

    expect(result.name).toBe('Error')
    expect(result.message).not.toContain('tori@example.com')
    expect(result.message).not.toContain('+15551234567')
    expect(result.message).not.toContain('abc123')
    expect(result.message).not.toContain('token=secret')
  })

  it('handles non-Error throws without throwing', () => {
    expect(() => safeError({ token: 'secret_123' })).not.toThrow()

    const result = safeError({ token: 'secret_123' })

    expect(result.name).toBe('NonErrorThrown')
    expect(result.message).not.toContain('secret_123')
  })
})

describe('safeLogMeta', () => {
  it('redacts sensitive keyed fields while preserving safe ids', () => {
    const result = expectSafeLogObject(
      safeLogMeta({
        bookingId: 'booking_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
        token: 'raw_token_123',
        signedUrl: 'https://example.com/private.jpg?token=secret',
        email: 'tori@example.com',
        phone: '+15551234567',
        address: '123 Main St, San Diego, CA',
        notes: 'Private client note',
        nested: {
          providerPayload: {
            raw: 'secret payload',
          },
        },
      }),
    )

    expect(result.bookingId).toBe('booking_1')
    expect(result.clientId).toBe('client_1')
    expect(result.professionalId).toBe('pro_1')
    expect(result.token).toBe('[redacted]')
    expect(result.signedUrl).toBe('[redacted]')
    expect(result.email).toBe('[redacted]')
    expect(result.phone).toBe('[redacted]')
    expect(result.address).toBe('[redacted-address]')
    expect(result.notes).toBe('[redacted-notes]')

    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('raw_token_123')
    expect(serialized).not.toContain('tori@example.com')
    expect(serialized).not.toContain('+15551234567')
    expect(serialized).not.toContain('123 Main St')
    expect(serialized).not.toContain('secret payload')
  })

  it('does not throw on weird input values', () => {
    expect(() =>
      safeLogMeta({
        error: Symbol('nope'),
        list: [new Date('2026-01-01T00:00:00.000Z'), undefined, null],
      }),
    ).not.toThrow()
  })
})