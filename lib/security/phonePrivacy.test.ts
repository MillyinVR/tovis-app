// lib/security/phonePrivacy.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// Mock the AEAD primitives so the suite needs no real keyring (mirrors
// notesPrivacy.test.ts / addressEncryption.test.ts).
const mocks = vi.hoisted(() => {
  const plaintextByCiphertext = new Map<string, string>()
  let nextCiphertextId = 1

  const encryptAead = vi.fn((args: { plaintext: string; keyVersion: string }) => {
    const ciphertext = `mock_ciphertext_${nextCiphertextId}`
    nextCiphertextId += 1
    plaintextByCiphertext.set(ciphertext, args.plaintext)
    return {
      v: 1,
      keyVersion: args.keyVersion,
      nonce: 'mock_nonce',
      ciphertext,
      tag: 'mock_tag',
    }
  })

  const decryptAead = vi.fn((args: { envelope: { ciphertext?: unknown } }) => {
    const ciphertext =
      typeof args.envelope.ciphertext === 'string' ? args.envelope.ciphertext : ''
    const plaintext = plaintextByCiphertext.get(ciphertext)
    if (plaintext === undefined) throw new Error('mock decrypt: unknown ciphertext')
    return plaintext
  })

  const isAeadEnvelopeV1 = vi.fn(
    (value: unknown): boolean =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { ciphertext?: unknown }).ciphertext === 'string',
  )

  const captureException = vi.fn()

  return { encryptAead, decryptAead, isAeadEnvelopeV1, captureException }
})

vi.mock('@/lib/security/crypto/aead', () => ({
  encryptAead: mocks.encryptAead,
  decryptAead: mocks.decryptAead,
  isAeadEnvelopeV1: mocks.isAeadEnvelopeV1,
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
}))

import {
  buildPhoneEncryptionWriteData,
  encryptedPhoneInput,
  readEncryptedPhoneOrFallback,
} from './phonePrivacy'

afterEach(() => {
  vi.clearAllMocks()
})

describe('encryptedPhoneInput', () => {
  it('returns Prisma.DbNull for null / undefined / blank / non-string input', () => {
    expect(encryptedPhoneInput(null)).toBe(Prisma.DbNull)
    expect(encryptedPhoneInput(undefined)).toBe(Prisma.DbNull)
    expect(encryptedPhoneInput('')).toBe(Prisma.DbNull)
    expect(encryptedPhoneInput('   ')).toBe(Prisma.DbNull)
    expect(encryptedPhoneInput(15551234567)).toBe(Prisma.DbNull)
  })

  it('returns a phone envelope for a real number', () => {
    const input = encryptedPhoneInput('+15551234567')
    expect(input).not.toBe(Prisma.DbNull)
    expect(input).toMatchObject({ v: 1, keyVersion: 'phone-aead-v1' })
  })

  it('is fail-soft: on an encryption error it captures and returns DbNull (no throw)', () => {
    mocks.encryptAead.mockImplementationOnce(() => {
      throw new Error('Missing required env PII_AEAD_KEYS_JSON')
    })
    expect(encryptedPhoneInput('+15551234567')).toBe(Prisma.DbNull)
    expect(mocks.captureException).toHaveBeenCalledTimes(1)
  })
})

describe('buildPhoneEncryptionWriteData', () => {
  it('omits phoneEncrypted when phone is undefined (leave DB unchanged)', () => {
    expect(buildPhoneEncryptionWriteData({})).toEqual({})
    expect(buildPhoneEncryptionWriteData({ phone: undefined })).toEqual({})
  })

  it('sets the envelope when phone is provided', () => {
    const data = buildPhoneEncryptionWriteData({ phone: '+15551234567' })
    expect(data.phoneEncrypted).toMatchObject({ v: 1, keyVersion: 'phone-aead-v1' })
  })

  it('clears (DbNull) when phone is provided but blank', () => {
    expect(buildPhoneEncryptionWriteData({ phone: '' })).toEqual({
      phoneEncrypted: Prisma.DbNull,
    })
  })
})

describe('readEncryptedPhoneOrFallback', () => {
  it('decrypts the envelope when present (ignores the plaintext fallback)', () => {
    const envelope = encryptedPhoneInput('+15551234567')
    expect(readEncryptedPhoneOrFallback(envelope, 'STALE')).toBe('+15551234567')
  })

  it('falls back to plaintext for a not-yet-backfilled row', () => {
    expect(readEncryptedPhoneOrFallback(null, '+15550000000')).toBe('+15550000000')
    expect(readEncryptedPhoneOrFallback(Prisma.DbNull, '+15550000000')).toBe(
      '+15550000000',
    )
  })

  it('returns null when both envelope and fallback are absent', () => {
    expect(readEncryptedPhoneOrFallback(null, null)).toBeNull()
  })
})
