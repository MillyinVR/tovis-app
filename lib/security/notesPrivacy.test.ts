// lib/security/notesPrivacy.test.ts

import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// Mock the AEAD primitives so the suite does not depend on a real keyring
// (mirrors lib/security/addressEncryption.test.ts). The mock keeps a
// plaintext<->ciphertext map so round-trips are exact.
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

  return { encryptAead, decryptAead, isAeadEnvelopeV1 }
})

vi.mock('@/lib/security/crypto/aead', () => ({
  encryptAead: mocks.encryptAead,
  decryptAead: mocks.decryptAead,
  isAeadEnvelopeV1: mocks.isAeadEnvelopeV1,
}))

import { encryptedNoteInput, readEncryptedNoteOrFallback } from './notesPrivacy'

describe('encryptedNoteInput', () => {
  it('returns Prisma.DbNull for null / undefined / blank input (never an empty envelope)', () => {
    expect(encryptedNoteInput(null)).toBe(Prisma.DbNull)
    expect(encryptedNoteInput(undefined)).toBe(Prisma.DbNull)
    expect(encryptedNoteInput('')).toBe(Prisma.DbNull)
    expect(encryptedNoteInput('   ')).toBe(Prisma.DbNull)
  })

  it('returns a notes envelope for real content', () => {
    const input = encryptedNoteInput('Latex — severe')
    expect(input).not.toBe(Prisma.DbNull)
    expect(input).toMatchObject({ v: 1, keyVersion: 'notes-aead-v1' })
  })
})

describe('readEncryptedNoteOrFallback', () => {
  it('decrypts the envelope when present (ignores the plaintext fallback)', () => {
    const envelope = encryptedNoteInput('Allergic to formaldehyde')
    expect(readEncryptedNoteOrFallback(envelope, 'STALE_PLAINTEXT')).toBe(
      'Allergic to formaldehyde',
    )
  })

  it('falls back to plaintext for a not-yet-backfilled row (null envelope)', () => {
    expect(readEncryptedNoteOrFallback(null, 'legacy plaintext note')).toBe(
      'legacy plaintext note',
    )
    expect(readEncryptedNoteOrFallback(Prisma.DbNull, 'legacy plaintext note')).toBe(
      'legacy plaintext note',
    )
  })

  it('returns null when both envelope and fallback are absent', () => {
    expect(readEncryptedNoteOrFallback(null, null)).toBeNull()
  })

  it('round-trips write -> read for a realistic note', () => {
    const note = 'Prefers fragrance-free; reacted to sulfates last visit.'
    const stored = encryptedNoteInput(note)
    expect(readEncryptedNoteOrFallback(stored, null)).toBe(note)
  })
})
