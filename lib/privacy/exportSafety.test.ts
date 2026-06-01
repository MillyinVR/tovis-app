// lib/privacy/exportSafety.test.ts

import { describe, expect, it } from 'vitest'

import {
  UnsafePrivacyExportError,
  assertSafePrivacyExportPayload,
  findUnsafePrivacyExportPaths,
} from './exportSafety'

describe('exportSafety', () => {
  it('allows a normal sanitized privacy export payload', () => {
    const payload = {
      exportedAt: '2026-05-31T12:00:00.000Z',
      subject: {
        userId: 'user_1',
        clientProfileId: 'client_1',
        professionalProfileId: null,
      },
      data: {
        user: {
          id: 'user_1',
          email: 'person@example.com',
          phone: '+16195551234',
          role: 'CLIENT',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        clientProfile: {
          id: 'client_1',
          firstName: 'Tori',
          lastName: 'Morales',
        },
        bookingsAsClient: [
          {
            id: 'booking_1',
            scheduledFor: '2026-06-01T12:00:00.000Z',
            status: 'COMPLETED',
            subtotalSnapshot: '100',
          },
        ],
      },
      limitations: ['Storage object bytes are separate.'],
    }

    expect(findUnsafePrivacyExportPaths(payload)).toEqual([])
    expect(() => assertSafePrivacyExportPayload(payload)).not.toThrow()
  })

  it('reports unsafe exact keys with paths', () => {
    const payload = {
      data: {
        user: {
          id: 'user_1',
          password: 'stored_hash',
          emailHashV2: 'hmac_email_hash',
        },
        mediaAssets: [
          {
            id: 'media_1',
            storageBucket: 'media-private',
            storagePath: 'private/user/file.jpg',
          },
        ],
      },
    }

    expect(findUnsafePrivacyExportPaths(payload)).toEqual([
      {
        path: '$.data.user.password',
        reason: 'unsafe_key',
      },
      {
        path: '$.data.user.emailHashV2',
        reason: 'unsafe_key',
      },
      {
        path: '$.data.mediaAssets[0].storageBucket',
        reason: 'unsafe_key',
      },
      {
        path: '$.data.mediaAssets[0].storagePath',
        reason: 'unsafe_key',
      },
    ])
  })

  it('reports unsafe pattern keys', () => {
    const payload = {
      data: {
        notificationDeliveries: [
          {
            id: 'delivery_1',
            providerMessageId: 'provider_1',
            leaseToken: 'lease_secret',
          },
        ],
        address: {
          encryptedClientAddressSnapshotJson: {
            v: 1,
            ciphertext: 'abc',
          },
        },
      },
    }

    expect(findUnsafePrivacyExportPaths(payload)).toEqual([
      {
        path: '$.data.notificationDeliveries[0].providerMessageId',
        reason: 'unsafe_key',
      },
      {
        path: '$.data.notificationDeliveries[0].leaseToken',
        reason: 'unsafe_key',
      },
      {
        path: '$.data.address.encryptedClientAddressSnapshotJson',
        reason: 'unsafe_key',
      },
    ])
  })

  it('reports unsafe string values even when keys look safe', () => {
    const payload = {
      data: {
        diagnostic: 'Bearer abc.def.ghi',
        providerText: 'sk_live_123456789',
        signedUrl:
          'https://storage.example.com/object.jpg?token=abc&signature=def',
      },
    }

    expect(findUnsafePrivacyExportPaths(payload)).toEqual([
      {
        path: '$.data.diagnostic',
        reason: 'unsafe_string',
      },
      {
        path: '$.data.providerText',
        reason: 'unsafe_string',
      },
        {
        path: '$.data.signedUrl',
        reason: 'unsafe_string',
        },
    ])
  })

  it('throws an UnsafePrivacyExportError with violations', () => {
    const payload = {
      data: {
        user: {
          id: 'user_1',
          tokenHash: 'token_hash',
        },
      },
    }

    expect(() => assertSafePrivacyExportPayload(payload)).toThrow(
      UnsafePrivacyExportError,
    )

    try {
      assertSafePrivacyExportPayload(payload)
      throw new Error('Expected assertSafePrivacyExportPayload to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafePrivacyExportError)

      const unsafeError = error as UnsafePrivacyExportError
      expect(unsafeError.violations).toEqual([
        {
          path: '$.data.user.tokenHash',
          reason: 'unsafe_key',
        },
      ])
    }
  })

  it('reports circular references defensively', () => {
    const payload: Record<string, unknown> = {
      data: {
        user: {
          id: 'user_1',
        },
      },
    }

    payload.self = payload

    expect(findUnsafePrivacyExportPaths(payload)).toEqual([
      {
        path: '$.self',
        reason: 'circular_reference',
      },
    ])
  })

  it('caps reported violations so failures stay readable', () => {
    const payload = {
      data: Object.fromEntries(
        Array.from({ length: 60 }, (_, index) => [
          `tokenHash${index}`,
          `secret_${index}`,
        ]),
      ),
    }

    const violations = findUnsafePrivacyExportPaths(payload)

    expect(violations).toHaveLength(50)
    expect(violations[0]).toEqual({
      path: '$.data.tokenHash0',
      reason: 'unsafe_key',
    })
  })
})