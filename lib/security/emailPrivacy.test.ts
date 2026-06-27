// lib/security/emailPrivacy.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// Mock the AEAD primitives so the suite needs no real keyring (mirrors
// phonePrivacy.test.ts / notesPrivacy.test.ts).
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
  buildEmailEncryptionWriteData,
  encryptedEmailInput,
  readEncryptedEmailOrFallback,
} from './emailPrivacy'

afterEach(() => {
  vi.clearAllMocks()
})

describe('encryptedEmailInput', () => {
  it('returns Prisma.DbNull for null / undefined / blank / non-string input', () => {
    expect(encryptedEmailInput(null)).toBe(Prisma.DbNull)
    expect(encryptedEmailInput(undefined)).toBe(Prisma.DbNull)
    expect(encryptedEmailInput('')).toBe(Prisma.DbNull)
    expect(encryptedEmailInput('   ')).toBe(Prisma.DbNull)
    expect(encryptedEmailInput(12345)).toBe(Prisma.DbNull)
  })

  it('returns an email envelope for a real address', () => {
    const input = encryptedEmailInput('user@example.com')
    expect(input).not.toBe(Prisma.DbNull)
    expect(input).toMatchObject({ v: 1, keyVersion: 'email-aead-v1' })
  })

  it('is fail-soft: on an encryption error it captures and returns DbNull (no throw)', () => {
    mocks.encryptAead.mockImplementationOnce(() => {
      throw new Error('Missing required env PII_AEAD_KEYS_JSON')
    })
    expect(encryptedEmailInput('user@example.com')).toBe(Prisma.DbNull)
    expect(mocks.captureException).toHaveBeenCalledTimes(1)
  })
})

describe('buildEmailEncryptionWriteData', () => {
  it('omits emailEncrypted when email is undefined (leave DB unchanged)', () => {
    expect(buildEmailEncryptionWriteData({})).toEqual({})
    expect(buildEmailEncryptionWriteData({ email: undefined })).toEqual({})
  })

  it('sets the envelope when email is provided', () => {
    const data = buildEmailEncryptionWriteData({ email: 'user@example.com' })
    expect(data.emailEncrypted).toMatchObject({ v: 1, keyVersion: 'email-aead-v1' })
  })

  it('clears (DbNull) when email is provided but blank', () => {
    expect(buildEmailEncryptionWriteData({ email: '' })).toEqual({
      emailEncrypted: Prisma.DbNull,
    })
  })
})

describe('readEncryptedEmailOrFallback', () => {
  it('decrypts the envelope when present (ignores the plaintext fallback)', () => {
    const envelope = encryptedEmailInput('user@example.com')
    expect(readEncryptedEmailOrFallback(envelope, 'STALE')).toBe('user@example.com')
  })

  it('falls back to plaintext for a not-yet-backfilled row', () => {
    expect(readEncryptedEmailOrFallback(null, 'fallback@example.com')).toBe(
      'fallback@example.com',
    )
    expect(
      readEncryptedEmailOrFallback(Prisma.DbNull, 'fallback@example.com'),
    ).toBe('fallback@example.com')
  })

  it('returns null when both envelope and fallback are absent', () => {
    expect(readEncryptedEmailOrFallback(null, null)).toBeNull()
  })
})
