// lib/security/auditRedaction.test.ts

import { describe, expect, it } from 'vitest'

import {
  isAddressPrivacyEnvelopeLike,
  redactAuditChangeSet,
  redactAuditPayload,
} from './auditRedaction'

describe('auditRedaction', () => {
  it('redacts exact sensitive keys from audit objects', () => {
    const result = redactAuditPayload({
      bookingId: 'booking_123',
      status: 'COMPLETED',
      email: 'client@example.com',
      phone: '+14155550123',
      token: 'secret-token',
      password: 'super-secret',
      signedUrl: 'https://example.com/private?token=abc',
      street: '123 Main St',
      city: 'Los Angeles',
      postalCode: '90001',
      note: 'Client has sensitive notes',
      stripePaymentIntentId: 'pi_123',
    })

    expect(result).toEqual({
      bookingId: 'booking_123',
      status: 'COMPLETED',
      email: '[REDACTED]',
      phone: '[REDACTED]',
      token: '[REDACTED]',
      password: '[REDACTED]',
      signedUrl: '[REDACTED]',
      street: '[REDACTED]',
      city: '[REDACTED]',
      postalCode: '[REDACTED]',
      note: '[REDACTED]',
      stripePaymentIntentId: '[REDACTED]',
    })
  })

  it('redacts sensitive keys by pattern', () => {
    const result = redactAuditPayload({
      bookingId: 'booking_123',
      clientEmailAddress: 'client@example.com',
      clientPhoneNumber: '+14155550123',
      consultationNoteBody: 'Very private consultation text',
      aftercareSummaryText: 'Very private aftercare text',
      privateMediaUrl: 'https://cdn.example.com/media-private/object.jpg',
      refresh_token: 'refresh-token',
      api_key: 'api-key',
    })

    expect(result).toEqual({
      bookingId: 'booking_123',
      clientEmailAddress: '[REDACTED]',
      clientPhoneNumber: '[REDACTED]',
      consultationNoteBody: '[REDACTED]',
      aftercareSummaryText: '[REDACTED]',
      privateMediaUrl: '[REDACTED]',
      refresh_token: '[REDACTED]',
      api_key: '[REDACTED]',
    })
  })

  it('redacts sensitive string values even when keys look harmless', () => {
    const result = redactAuditPayload({
      safeLabel: 'Client email is client@example.com',
      providerMessage: 'Bearer abc.def.ghi',
      jwtText: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
      stripeText: 'sk_live_123456789',
      phoneText: 'Call me at (415) 555-0123',
      storageText: 'media-private/profiles/secret.jpg',
      signedUrlText:
        'https://storage.example.com/object.jpg?token=abc&expires=999',
    })

    expect(result).toEqual({
      safeLabel: '[REDACTED]',
      providerMessage: '[REDACTED]',
      jwtText: '[REDACTED]',
      stripeText: '[REDACTED]',
      phoneText: '[REDACTED]',
      storageText: '[REDACTED]',
      signedUrlText: '[REDACTED]',
    })
  })

  it('preserves safe operational fields while redacting timestamp-like string fields only when they match sensitive patterns', () => {
    const result = redactAuditPayload({
      bookingId: 'booking_123',
      professionalId: 'pro_123',
      clientId: 'client_123',
      action: 'BOOKING_COMPLETED',
      status: 'COMPLETED',
      previousStatus: 'IN_PROGRESS',
      nextStatus: 'COMPLETED',
      retryable: false,
      attempt: 2,
      durationMs: 123,
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(result).toEqual({
      bookingId: 'booking_123',
      professionalId: 'pro_123',
      clientId: 'client_123',
      action: 'BOOKING_COMPLETED',
      status: 'COMPLETED',
      previousStatus: 'IN_PROGRESS',
      nextStatus: 'COMPLETED',
      retryable: false,
      attempt: 2,
      durationMs: 123,
      createdAt: '2026-05-25T12:00:00.000Z',
    })
  })

  it('summarizes address privacy envelopes when passed directly', () => {
    const envelope = {
      v: 1,
      algorithm: 'plaintext-json-expand-phase',
      keyVersion: 'address-expand-phase-v1',
      street: '123 Main St',
      street2: 'Apt 4',
      city: 'Los Angeles',
      region: 'CA',
      postalCode: '90001',
      country: 'US',
      lat: 34.052235,
      lng: -118.243683,
      label: 'Home',
    }

    expect(isAddressPrivacyEnvelopeLike(envelope)).toBe(true)

    expect(redactAuditPayload(envelope)).toEqual({
      redacted: true,
      reason: 'address_privacy_envelope',
      algorithm: 'plaintext-json-expand-phase',
      keyVersion: 'address-expand-phase-v1',
    })
  })

  it('supports numeric address envelope key versions', () => {
    const envelope = {
      v: 1,
      algorithm: 'aes-256-gcm',
      keyVersion: 1,
      street: '123 Main St',
      city: 'Los Angeles',
      postalCode: '90001',
    }

    expect(isAddressPrivacyEnvelopeLike(envelope)).toBe(true)

    expect(redactAuditPayload(envelope)).toEqual({
      redacted: true,
      reason: 'address_privacy_envelope',
      algorithm: 'aes-256-gcm',
      keyVersion: 1,
    })
  })

  it('redacts encrypted address snapshot fields completely when the containing key is sensitive', () => {
    const envelope = {
      v: 1,
      algorithm: 'plaintext-json-expand-phase',
      keyVersion: 'address-expand-phase-v1',
      street: '123 Main St',
      street2: 'Apt 4',
      city: 'Los Angeles',
      region: 'CA',
      postalCode: '90001',
      country: 'US',
      lat: 34.052235,
      lng: -118.243683,
      label: 'Home',
    }

    const result = redactAuditPayload({
      bookingId: 'booking_123',
      encryptedClientAddressSnapshotJson: envelope,
    })

    expect(result).toEqual({
      bookingId: 'booking_123',
      encryptedClientAddressSnapshotJson: '[REDACTED]',
    })
  })

  it('redacts nested sensitive values in arrays and objects', () => {
    const result = redactAuditPayload({
      bookingId: 'booking_123',
      events: [
        {
          type: 'EMAIL_SENT',
          email: 'client@example.com',
        },
        {
          type: 'MEDIA_LINK_CREATED',
          payload: {
            url: 'https://storage.example.com/media-private/file.jpg?token=abc',
            objectKey: 'media-private/file.jpg',
          },
        },
      ],
    })

    expect(result).toEqual({
      bookingId: 'booking_123',
      events: [
        {
          type: 'EMAIL_SENT',
          email: '[REDACTED]',
        },
        {
          type: 'MEDIA_LINK_CREATED',
          payload: {
            url: '[REDACTED]',
            objectKey: '[REDACTED]',
          },
        },
      ],
    })
  })

  it('redacts old and new values in an audit change set', () => {
    const result = redactAuditChangeSet({
      oldValue: {
        status: 'PENDING',
        email: 'old@example.com',
      },
      newValue: {
        status: 'CONFIRMED',
        email: 'new@example.com',
      },
    })

    expect(result).toEqual({
      oldValue: {
        status: 'PENDING',
        email: '[REDACTED]',
      },
      newValue: {
        status: 'CONFIRMED',
        email: '[REDACTED]',
      },
    })
  })

  it('truncates long safe strings instead of dropping them entirely', () => {
    const longString = 'a'.repeat(600)

    const result = redactAuditPayload({
      safeDiagnostic: longString,
    })

    expect(result).toEqual({
      safeDiagnostic: `${'a'.repeat(500)}[TRUNCATED]`,
    })
  })

  it('limits large arrays and marks truncation', () => {
    const result = redactAuditPayload({
      values: Array.from({ length: 55 }, (_, index) => index),
    })

    expect(result).toEqual({
      values: [
        ...Array.from({ length: 50 }, (_, index) => index),
        '[TRUNCATED]',
      ],
    })
  })

  it('limits object keys and records the number of truncated keys', () => {
    const payload = Object.fromEntries(
      Array.from({ length: 105 }, (_, index) => [`safeKey${index}`, index]),
    )

    const result = redactAuditPayload(payload)

    expect(result).toHaveProperty('__truncatedKeys', 5)
    expect(Object.keys(result as Record<string, unknown>)).toHaveLength(101)
  })

  it('redacts non-json top-level values defensively', () => {
    expect(redactAuditPayload(undefined)).toBe('[REDACTED]')
    expect(redactAuditPayload(Symbol('secret'))).toBe('[REDACTED]')
    expect(redactAuditPayload(() => 'secret')).toBe('[REDACTED]')
  })

  it('redacts non-json object values defensively when encountered inside objects', () => {
    const result = redactAuditPayload({
      safe: 'value',
      weird: undefined,
      callback: () => 'secret',
    })

    expect(result).toEqual({
      safe: 'value',
      weird: '[REDACTED]',
      callback: '[REDACTED]',
    })
  })

  it('does not classify random metadata objects as address privacy envelopes', () => {
    const value = {
      status: 'ok',
      source: 'booking_audit',
      retryable: false,
    }

    expect(isAddressPrivacyEnvelopeLike(value)).toBe(false)
  })

  it('does not throw for circular non-json objects', () => {
    const circular: Record<string, unknown> = {
      safe: 'value',
    }
    circular.self = circular

    expect(() => redactAuditPayload(circular)).not.toThrow()
    expect(redactAuditPayload(circular)).toBe('[REDACTED]')
  })
})