// lib/security/crypto/aead.test.ts

import { randomBytes } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  assertAeadEnvelope,
  clearAeadKeyringCacheForTests,
  decryptAead,
  encryptAead,
  getAeadAlgorithm,
  isAeadEnvelopeV1,
  type AeadEnvelopeV1,
} from './aead'

const KEY_VERSION = 'address-aead-v1'
const OTHER_KEY_VERSION = 'address-aead-v2'
const ASSOCIATED_DATA = 'ClientAddress:client_address_123'

function makeBase64Key(): string {
  return randomBytes(32).toString('base64')
}

function setKeyring(keys: Record<string, string>): void {
  process.env.PII_AEAD_KEYS_JSON = JSON.stringify(keys)
  clearAeadKeyringCacheForTests()
}

describe('aead', () => {
  const originalKeyring = process.env.PII_AEAD_KEYS_JSON

  beforeEach(() => {
    setKeyring({
      [KEY_VERSION]: makeBase64Key(),
      [OTHER_KEY_VERSION]: makeBase64Key(),
    })
  })

  afterEach(() => {
    if (typeof originalKeyring === 'string') {
      process.env.PII_AEAD_KEYS_JSON = originalKeyring
    } else {
      delete process.env.PII_AEAD_KEYS_JSON
    }

    clearAeadKeyringCacheForTests()
  })

  it('encrypts and decrypts a plaintext value', () => {
    const plaintext = JSON.stringify({
      street: '123 Main St',
      city: 'Los Angeles',
      postalCode: '90001',
    })

    const envelope = encryptAead({
      plaintext,
      keyVersion: KEY_VERSION,
      associatedData: ASSOCIATED_DATA,
    })

    expect(envelope).toMatchObject({
      v: 1,
      algorithm: getAeadAlgorithm(),
      keyVersion: KEY_VERSION,
    })

    expect(envelope.nonce).toEqual(expect.any(String))
    expect(envelope.ciphertext).toEqual(expect.any(String))
    expect(envelope.authTag).toEqual(expect.any(String))
    expect(envelope.ciphertext).not.toContain('123 Main St')
    expect(envelope.ciphertext).not.toContain('Los Angeles')
    expect(isAeadEnvelopeV1(envelope)).toBe(true)

    const decrypted = decryptAead({
      envelope,
      associatedData: ASSOCIATED_DATA,
    })

    expect(decrypted).toBe(plaintext)
  })

  it('produces different ciphertext for the same plaintext because the nonce is random', () => {
    const plaintext = 'same plaintext'

    const first = encryptAead({
      plaintext,
      keyVersion: KEY_VERSION,
      associatedData: ASSOCIATED_DATA,
    })

    const second = encryptAead({
      plaintext,
      keyVersion: KEY_VERSION,
      associatedData: ASSOCIATED_DATA,
    })

    expect(first.nonce).not.toBe(second.nonce)
    expect(first.ciphertext).not.toBe(second.ciphertext)

    expect(
      decryptAead({
        envelope: first,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toBe(plaintext)

    expect(
      decryptAead({
        envelope: second,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toBe(plaintext)
  })

  it('fails decryption when associated data changes', () => {
    const envelope = encryptAead({
      plaintext: 'secret value',
      keyVersion: KEY_VERSION,
      associatedData: ASSOCIATED_DATA,
    })

    expect(() =>
      decryptAead({
        envelope,
        associatedData: 'ClientAddress:different_record',
      }),
    ).toThrow()
  })

  it('fails decryption when ciphertext is tampered with', () => {
    const envelope = encryptAead({
      plaintext: 'secret value',
      keyVersion: KEY_VERSION,
      associatedData: ASSOCIATED_DATA,
    })

    const tamperedEnvelope: AeadEnvelopeV1 = {
      ...envelope,
      ciphertext: Buffer.from('tampered ciphertext').toString('base64'),
    }

    expect(() =>
      decryptAead({
        envelope: tamperedEnvelope,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toThrow()
  })

  it('fails decryption when auth tag is tampered with', () => {
    const envelope = encryptAead({
      plaintext: 'secret value',
      keyVersion: KEY_VERSION,
      associatedData: ASSOCIATED_DATA,
    })

    const tamperedEnvelope: AeadEnvelopeV1 = {
      ...envelope,
      authTag: randomBytes(16).toString('base64'),
    }

    expect(() =>
      decryptAead({
        envelope: tamperedEnvelope,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toThrow()
  })

  it('fails when the key version is missing from the keyring', () => {
    setKeyring({
      [KEY_VERSION]: makeBase64Key(),
    })

    const envelope: AeadEnvelopeV1 = {
      v: 1,
      algorithm: getAeadAlgorithm(),
      keyVersion: 'missing-key-version',
      nonce: randomBytes(12).toString('base64'),
      ciphertext: randomBytes(32).toString('base64'),
      authTag: randomBytes(16).toString('base64'),
    }

    expect(() =>
      decryptAead({
        envelope,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toThrow('Missing AEAD key for key version: missing-key-version')
  })

  it('throws when keyring env is missing', () => {
    delete process.env.PII_AEAD_KEYS_JSON
    clearAeadKeyringCacheForTests()

    expect(() =>
      encryptAead({
        plaintext: 'secret value',
        keyVersion: KEY_VERSION,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toThrow('Missing required env PII_AEAD_KEYS_JSON')
  })

  it('throws when keyring env is not a JSON object', () => {
    process.env.PII_AEAD_KEYS_JSON = '[]'
    clearAeadKeyringCacheForTests()

    expect(() =>
      encryptAead({
        plaintext: 'secret value',
        keyVersion: KEY_VERSION,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toThrow('PII_AEAD_KEYS_JSON must be a JSON object')
  })

  it('throws when a configured key is not base64 for 32 bytes', () => {
    process.env.PII_AEAD_KEYS_JSON = JSON.stringify({
      [KEY_VERSION]: Buffer.from('too short').toString('base64'),
    })
    clearAeadKeyringCacheForTests()

    expect(() =>
      encryptAead({
        plaintext: 'secret value',
        keyVersion: KEY_VERSION,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toThrow('PII_AEAD_KEYS_JSON.address-aead-v1 must decode to 32 bytes')
  })

  it('throws when keyring has no keys', () => {
    process.env.PII_AEAD_KEYS_JSON = JSON.stringify({})
    clearAeadKeyringCacheForTests()

    expect(() =>
      encryptAead({
        plaintext: 'secret value',
        keyVersion: KEY_VERSION,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toThrow('PII_AEAD_KEYS_JSON must contain at least one key')
  })

  it('validates AEAD envelope shape', () => {
    const envelope = encryptAead({
      plaintext: 'secret value',
      keyVersion: KEY_VERSION,
      associatedData: ASSOCIATED_DATA,
    })

    expect(isAeadEnvelopeV1(envelope)).toBe(true)

    expect(
      isAeadEnvelopeV1({
        ...envelope,
        algorithm: 'plaintext-json-expand-phase',
      }),
    ).toBe(false)

    expect(
      isAeadEnvelopeV1({
        ...envelope,
        keyVersion: '',
      }),
    ).toBe(false)

    expect(
      isAeadEnvelopeV1({
        ...envelope,
        nonce: '',
      }),
    ).toBe(false)

    expect(isAeadEnvelopeV1(null)).toBe(false)
    expect(isAeadEnvelopeV1('not an envelope')).toBe(false)
  })

  it('asserts AEAD envelope shape', () => {
    const envelope = encryptAead({
      plaintext: 'secret value',
      keyVersion: KEY_VERSION,
      associatedData: ASSOCIATED_DATA,
    })

    expect(() => assertAeadEnvelope(envelope)).not.toThrow()
    expect(() => assertAeadEnvelope({})).toThrow('Invalid AEAD envelope')
  })

  it('uses the latest env value after clearing the test cache', () => {
    const originalPlaintext = 'secret value'

    const envelope = encryptAead({
      plaintext: originalPlaintext,
      keyVersion: KEY_VERSION,
      associatedData: ASSOCIATED_DATA,
    })

    const firstKeyring = process.env.PII_AEAD_KEYS_JSON
    expect(typeof firstKeyring).toBe('string')

    setKeyring({
      [KEY_VERSION]: makeBase64Key(),
    })

    expect(() =>
      decryptAead({
        envelope,
        associatedData: ASSOCIATED_DATA,
      }),
    ).toThrow()
  })
})