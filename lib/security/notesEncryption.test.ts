// lib/security/notesEncryption.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { clearAeadKeyringCacheForTests } from '@/lib/security/crypto/aead'
import {
  NOTES_KEY_VERSION,
  buildNotesEnvelope,
  isEncryptedNotesEnvelopeV1,
  readNotesEnvelope,
} from '@/lib/security/notesEncryption'

const originalKeyring = process.env.PII_AEAD_KEYS_JSON

beforeEach(() => {
  process.env.PII_AEAD_KEYS_JSON = JSON.stringify({
    [NOTES_KEY_VERSION]: randomBytes(32).toString('base64'),
  })
  clearAeadKeyringCacheForTests()
})

afterAll(() => {
  if (originalKeyring === undefined) {
    delete process.env.PII_AEAD_KEYS_JSON
  } else {
    process.env.PII_AEAD_KEYS_JSON = originalKeyring
  }
  clearAeadKeyringCacheForTests()
})

describe('lib/security/notesEncryption.ts', () => {
  it('round-trips a note through encrypt/decrypt', () => {
    const note = 'Severe latex allergy. Use nitrile gloves only.'

    const envelope = buildNotesEnvelope(note)

    expect(envelope).not.toBeNull()
    expect(isEncryptedNotesEnvelopeV1(envelope)).toBe(true)
    expect(readNotesEnvelope(envelope!)).toBe(note)
  })

  it('never exposes the plaintext inside the envelope', () => {
    const note = 'Reacts to PPD hair dye'

    const envelope = buildNotesEnvelope(note)!

    const serialized = JSON.stringify(envelope)
    expect(serialized).not.toContain('PPD')
    expect(serialized).not.toContain(note)
  })

  it('uses a fresh nonce + ciphertext per call but decrypts to the same value', () => {
    const note = 'same note'

    const a = buildNotesEnvelope(note)!
    const b = buildNotesEnvelope(note)!

    expect(a.ciphertext.nonce).not.toBe(b.ciphertext.nonce)
    expect(a.ciphertext.ciphertext).not.toBe(b.ciphertext.ciphertext)
    expect(readNotesEnvelope(a)).toBe(note)
    expect(readNotesEnvelope(b)).toBe(note)
  })

  it('returns null for empty / blank / absent notes', () => {
    expect(buildNotesEnvelope(null)).toBeNull()
    expect(buildNotesEnvelope(undefined)).toBeNull()
    expect(buildNotesEnvelope('')).toBeNull()
    expect(buildNotesEnvelope('   ')).toBeNull()
  })

  it('preserves internal whitespace and unicode content', () => {
    const note = '  Line 1\n  Line 2 — café, 日本語  '

    const envelope = buildNotesEnvelope(note)!

    expect(readNotesEnvelope(envelope)).toBe(note)
  })

  it('rejects a tampered ciphertext on read (authentication tag fails)', () => {
    const envelope = buildNotesEnvelope('secret note')!

    const tampered = {
      ...envelope,
      ciphertext: {
        ...envelope.ciphertext,
        ciphertext: Buffer.from('tampered ciphertext').toString('base64'),
      },
    }

    expect(() => readNotesEnvelope(tampered)).toThrow()
  })

  it('guards non-envelope values', () => {
    expect(isEncryptedNotesEnvelopeV1({ foo: 'bar' })).toBe(false)
    expect(isEncryptedNotesEnvelopeV1(null)).toBe(false)
    expect(isEncryptedNotesEnvelopeV1('nope')).toBe(false)
  })
})
