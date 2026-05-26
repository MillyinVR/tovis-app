// lib/security/crypto/aead.ts

/**
 * Canonical AEAD encryption helpers.
 *
 * This module is intentionally small and strict:
 * - AES-256-GCM for authenticated encryption
 * - versioned keys from env
 * - explicit associated data
 * - JSON-safe envelope
 * - no silent fallback to plaintext
 *
 * Intended first consumers:
 * - address privacy envelopes
 * - future Tier-2 identity field encryption
 *
 * Required env:
 * - PII_AEAD_KEYS_JSON
 *
 * Example:
 * {
 *   "address-aead-v1": "base64-encoded-32-byte-key",
 *   "identity-aead-v1": "base64-encoded-32-byte-key"
 * }
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm-v1'
const NODE_CIPHER = 'aes-256-gcm'
const KEY_LENGTH_BYTES = 32
const NONCE_LENGTH_BYTES = 12
const AUTH_TAG_LENGTH_BYTES = 16

const KEY_ENV_NAME = 'PII_AEAD_KEYS_JSON'

export type AeadAlgorithm = typeof ALGORITHM

export type AeadEnvelopeV1 = {
  readonly v: 1
  readonly algorithm: AeadAlgorithm
  readonly keyVersion: string
  readonly nonce: string
  readonly ciphertext: string
  readonly authTag: string
}

export type EncryptAeadInput = {
  readonly plaintext: string
  readonly keyVersion: string
  readonly associatedData: string
}

export type DecryptAeadInput = {
  readonly envelope: AeadEnvelopeV1
  readonly associatedData: string
}

type Keyring = ReadonlyMap<string, Buffer>

let cachedKeyring: Keyring | null = null
let cachedRawEnv: string | null = null

export function getAeadAlgorithm(): AeadAlgorithm {
  return ALGORITHM
}

export function encryptAead(input: EncryptAeadInput): AeadEnvelopeV1 {
  const key = getAeadKey(input.keyVersion)
  const nonce = randomBytes(NONCE_LENGTH_BYTES)

  const cipher = createCipheriv(NODE_CIPHER, key, nonce, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  })

  cipher.setAAD(Buffer.from(input.associatedData, 'utf8'))

  const ciphertext = Buffer.concat([
    cipher.update(input.plaintext, 'utf8'),
    cipher.final(),
  ])

  const authTag = cipher.getAuthTag()

  return {
    v: 1,
    algorithm: ALGORITHM,
    keyVersion: input.keyVersion,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

export function decryptAead(input: DecryptAeadInput): string {
  assertAeadEnvelope(input.envelope)

  const key = getAeadKey(input.envelope.keyVersion)
  const nonce = decodeBase64Field(input.envelope.nonce, 'nonce')
  const ciphertext = decodeBase64Field(input.envelope.ciphertext, 'ciphertext')
  const authTag = decodeBase64Field(input.envelope.authTag, 'authTag')

  if (nonce.length !== NONCE_LENGTH_BYTES) {
    throw new Error(`Invalid AEAD nonce length: ${nonce.length}`)
  }

  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(`Invalid AEAD auth tag length: ${authTag.length}`)
  }

  const decipher = createDecipheriv(NODE_CIPHER, key, nonce, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  })

  decipher.setAAD(Buffer.from(input.associatedData, 'utf8'))
  decipher.setAuthTag(authTag)

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return plaintext.toString('utf8')
}

export function isAeadEnvelopeV1(value: unknown): value is AeadEnvelopeV1 {
  if (!isRecord(value)) return false

  return (
    value.v === 1 &&
    value.algorithm === ALGORITHM &&
    typeof value.keyVersion === 'string' &&
    value.keyVersion.length > 0 &&
    typeof value.nonce === 'string' &&
    value.nonce.length > 0 &&
    typeof value.ciphertext === 'string' &&
    value.ciphertext.length > 0 &&
    typeof value.authTag === 'string' &&
    value.authTag.length > 0
  )
}

export function assertAeadEnvelope(value: unknown): asserts value is AeadEnvelopeV1 {
  if (!isAeadEnvelopeV1(value)) {
    throw new Error('Invalid AEAD envelope')
  }
}

export function clearAeadKeyringCacheForTests(): void {
  cachedKeyring = null
  cachedRawEnv = null
}

function getAeadKey(keyVersion: string): Buffer {
  if (keyVersion.length === 0) {
    throw new Error('Missing AEAD key version')
  }

  const keyring = readKeyring()
  const key = keyring.get(keyVersion)

  if (!key) {
    throw new Error(`Missing AEAD key for key version: ${keyVersion}`)
  }

  return key
}

function readKeyring(): Keyring {
  const rawEnv = process.env[KEY_ENV_NAME]

  if (!rawEnv || rawEnv.trim().length === 0) {
    throw new Error(`Missing required env ${KEY_ENV_NAME}`)
  }

  if (cachedKeyring && cachedRawEnv === rawEnv) {
    return cachedKeyring
  }

  const parsed = parseKeyringEnv(rawEnv)

  cachedKeyring = parsed
  cachedRawEnv = rawEnv

  return parsed
}

function parseKeyringEnv(rawEnv: string): Keyring {
  const parsed: unknown = JSON.parse(rawEnv)

  if (!isRecord(parsed)) {
    throw new Error(`${KEY_ENV_NAME} must be a JSON object`)
  }

  const entries = Object.entries(parsed)
  const keyring = new Map<string, Buffer>()

  for (const [keyVersion, rawKey] of entries) {
    if (keyVersion.trim().length === 0) {
      throw new Error(`${KEY_ENV_NAME} contains an empty key version`)
    }

    if (typeof rawKey !== 'string') {
      throw new Error(`${KEY_ENV_NAME}.${keyVersion} must be a base64 string`)
    }

    const key = Buffer.from(rawKey, 'base64')

    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `${KEY_ENV_NAME}.${keyVersion} must decode to ${KEY_LENGTH_BYTES} bytes`,
      )
    }

    keyring.set(keyVersion, key)
  }

  if (keyring.size === 0) {
    throw new Error(`${KEY_ENV_NAME} must contain at least one key`)
  }

  return keyring
}

function decodeBase64Field(value: string, fieldName: string): Buffer {
  const decoded = Buffer.from(value, 'base64')

  if (decoded.length === 0) {
    throw new Error(`Invalid AEAD ${fieldName}`)
  }

  return decoded
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}