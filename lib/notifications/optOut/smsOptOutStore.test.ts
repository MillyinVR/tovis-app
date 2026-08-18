// lib/notifications/optOut/smsOptOutStore.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearContactLookupHmacKeyringCacheForTests,
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  phoneLookupHashV2,
} from '@/lib/security/crypto/hashLookup'

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')

const mockSmsOptOut = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
}))

const mockPrisma = vi.hoisted(() => ({
  smsOptOut: mockSmsOptOut,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import {
  isPhoneOptedOutOfSms,
  recordSmsOptEvent,
} from './smsOptOutStore'

// Set before computing the fixture hash below — phoneLookupHashV2 throws
// without a keyring, and this needs the SAME hash the store itself computes.
process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
  [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
})

const NORMALIZED_PHONE = '+15551234567'
const PHONE_HASH = phoneLookupHashV2(NORMALIZED_PHONE)?.hash

if (!PHONE_HASH) {
  throw new Error('smsOptOutStore.test.ts: failed to compute fixture hash')
}

describe('lib/notifications/optOut/smsOptOutStore', () => {
  beforeEach(() => {
    process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
      [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
    })
    clearContactLookupHmacKeyringCacheForTests()

    mockSmsOptOut.upsert.mockReset()
    mockSmsOptOut.findUnique.mockReset()
  })

  describe('recordSmsOptEvent', () => {
    it('upserts an opted-out row on STOP, keyed by the phone lookup hash', async () => {
      const occurredAt = new Date('2026-08-18T12:00:00.000Z')
      mockSmsOptOut.upsert.mockResolvedValueOnce({ id: 'opt_1' })

      const result = await recordSmsOptEvent({
        phone: '(555) 123-4567',
        kind: 'STOP',
        keyword: 'STOP',
        occurredAt,
      })

      expect(result).toEqual({ ok: true })
      expect(mockSmsOptOut.upsert).toHaveBeenCalledWith({
        where: { phoneHashV2: PHONE_HASH },
        create: {
          phoneHashV2: PHONE_HASH,
          phone: NORMALIZED_PHONE,
          optedOutAt: occurredAt,
          lastKeyword: 'STOP',
          lastEventAt: occurredAt,
        },
        update: {
          phone: NORMALIZED_PHONE,
          optedOutAt: occurredAt,
          lastKeyword: 'STOP',
          lastEventAt: occurredAt,
        },
      })
    })

    it('clears optedOutAt on START rather than deleting the row', async () => {
      const occurredAt = new Date('2026-08-18T12:05:00.000Z')
      mockSmsOptOut.upsert.mockResolvedValueOnce({ id: 'opt_1' })

      await recordSmsOptEvent({
        phone: NORMALIZED_PHONE,
        kind: 'START',
        keyword: 'START',
        occurredAt,
      })

      expect(mockSmsOptOut.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ optedOutAt: null }),
          update: expect.objectContaining({ optedOutAt: null }),
        }),
      )
    })

    it('routes through a transaction client when provided', async () => {
      const tx = { smsOptOut: { upsert: vi.fn().mockResolvedValue({}) } }

      await recordSmsOptEvent({
        phone: NORMALIZED_PHONE,
        kind: 'STOP',
        keyword: 'STOP',
        occurredAt: new Date(),
        tx: tx as never,
      })

      expect(tx.smsOptOut.upsert).toHaveBeenCalledTimes(1)
      expect(mockSmsOptOut.upsert).not.toHaveBeenCalled()
    })

    it('returns INVALID_PHONE for an unparseable phone without touching the DB', async () => {
      const result = await recordSmsOptEvent({
        phone: 'not-a-phone',
        kind: 'STOP',
        keyword: 'STOP',
        occurredAt: new Date(),
      })

      expect(result).toEqual({ ok: false, code: 'INVALID_PHONE' })
      expect(mockSmsOptOut.upsert).not.toHaveBeenCalled()
    })
  })

  describe('isPhoneOptedOutOfSms', () => {
    it('returns true when the stored row has a non-null optedOutAt', async () => {
      mockSmsOptOut.findUnique.mockResolvedValueOnce({
        optedOutAt: new Date('2026-08-18T12:00:00.000Z'),
      })

      const result = await isPhoneOptedOutOfSms({ phone: NORMALIZED_PHONE })

      expect(result).toBe(true)
      expect(mockSmsOptOut.findUnique).toHaveBeenCalledWith({
        where: { phoneHashV2: PHONE_HASH },
        select: { optedOutAt: true },
      })
    })

    it('returns false when the row exists but optedOutAt is null (re-opted-in)', async () => {
      mockSmsOptOut.findUnique.mockResolvedValueOnce({ optedOutAt: null })

      const result = await isPhoneOptedOutOfSms({ phone: NORMALIZED_PHONE })

      expect(result).toBe(false)
    })

    it('returns false when no row exists for the phone', async () => {
      mockSmsOptOut.findUnique.mockResolvedValueOnce(null)

      const result = await isPhoneOptedOutOfSms({ phone: NORMALIZED_PHONE })

      expect(result).toBe(false)
    })

    it('returns false for a null/blank phone without querying the DB', async () => {
      expect(await isPhoneOptedOutOfSms({ phone: null })).toBe(false)
      expect(await isPhoneOptedOutOfSms({ phone: '' })).toBe(false)
      expect(mockSmsOptOut.findUnique).not.toHaveBeenCalled()
    })
  })
})
