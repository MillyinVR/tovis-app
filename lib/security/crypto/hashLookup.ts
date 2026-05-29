// lib/security/crypto/hashLookup.ts
import { createHash, createHmac } from 'node:crypto'

import {
  normalizeEmailForLookup,
  normalizePhoneForLookup,
} from '@/lib/security/contactNormalization'

const LEGACY_CONTACT_HASH_ALGORITHM = 'sha256' as const
const CONTACT_LOOKUP_HMAC_ALGORITHM = 'sha256' as const

/**
 * Current HMAC key version for contact lookup blind indexes.
 *
 * Keep this numeric because the Prisma schema stores:
 * - User.emailHashKeyVersion Int?
 * - User.phoneHashKeyVersion Int?
 * - ClientProfile.emailHashKeyVersion Int?
 * - ClientProfile.phoneHashKeyVersion Int?
 */
export const CONTACT_LOOKUP_HMAC_KEY_VERSION = 1 as const

const CONTACT_LOOKUP_HMAC_KEYS_ENV = 'PII_LOOKUP_HMAC_KEYS_JSON'

export type ContactLookupHashV2 = {
  hash: string
  keyVersion: number
}

type ContactLookupHmacKeyring = ReadonlyMap<number, Buffer>

let cachedContactLookupHmacKeyring: ContactLookupHmacKeyring | null = null
let cachedContactLookupHmacRawEnv: string | null = null

/**
 * Legacy lowercase SHA-256 hex digest.
 *
 * This is retained only for expand/burn-in compatibility with existing
 * `emailHash` / `phoneHash` columns. Do not use this for new blind indexes.
 */
export function legacySha256Hex(value: string): string {
  return createHash(LEGACY_CONTACT_HASH_ALGORITHM)
    .update(value, 'utf8')
    .digest('hex')
}

/**
 * Backward-compatible alias for existing non-contact token/hash callers.
 *
 * For contact lookup code, prefer `legacyContactLookupHash(...)` or the v2
 * helpers below so the legacy/v2 distinction is explicit.
 */
export function sha256Hex(value: string): string {
  return legacySha256Hex(value)
}

/**
 * Legacy contact lookup hash.
 *
 * This intentionally expects an already-canonical contact value. Callers that
 * start from raw user input should use `emailLookupHash(...)` or
 * `phoneLookupHash(...)`.
 */
export function legacyContactLookupHash(normalizedValue: string): string {
  return legacySha256Hex(normalizedValue)
}

/**
 * HMAC-SHA256 contact lookup hash for v2 blind indexes.
 *
 * The value passed here must already be canonicalized. Callers that start from
 * raw user input should use `emailLookupHashV2(...)` or `phoneLookupHashV2(...)`.
 */
export function contactLookupHmacHex(args: {
  normalizedValue: string
  keyVersion?: number
}): ContactLookupHashV2 {
  const keyVersion = args.keyVersion ?? CONTACT_LOOKUP_HMAC_KEY_VERSION
  const key = getContactLookupHmacKey(keyVersion)

  return {
    hash: createHmac(CONTACT_LOOKUP_HMAC_ALGORITHM, key)
      .update(args.normalizedValue, 'utf8')
      .digest('hex'),
    keyVersion,
  }
}

/**
 * Legacy helper for email lookup hashes.
 *
 * Writes/reads the old SHA-256 `emailHash` value during burn-in.
 */
export function emailLookupHash(value: unknown): string | null {
  const normalized = normalizeEmailForLookup(value)

  return normalized ? legacyContactLookupHash(normalized) : null
}

/**
 * Legacy helper for phone lookup hashes.
 *
 * Writes/reads the old SHA-256 `phoneHash` value during burn-in.
 */
export function phoneLookupHash(value: unknown): string | null {
  const normalized = normalizePhoneForLookup(value)

  return normalized ? legacyContactLookupHash(normalized) : null
}

/**
 * HMAC v2 helper for email lookup hashes.
 *
 * Writes/reads the new `emailHashV2` value.
 */
export function emailLookupHashV2(value: unknown): ContactLookupHashV2 | null {
  const normalized = normalizeEmailForLookup(value)

  return normalized ? contactLookupHmacHex({ normalizedValue: normalized }) : null
}

/**
 * HMAC v2 helper for phone lookup hashes.
 *
 * Writes/reads the new `phoneHashV2` value.
 */
export function phoneLookupHashV2(value: unknown): ContactLookupHashV2 | null {
  const normalized = normalizePhoneForLookup(value)

  return normalized ? contactLookupHmacHex({ normalizedValue: normalized }) : null
}

/**
 * Test-only cache reset for env-backed keyring changes.
 */
export function clearContactLookupHmacKeyringCacheForTests(): void {
  cachedContactLookupHmacKeyring = null
  cachedContactLookupHmacRawEnv = null
}

function getContactLookupHmacKey(keyVersion: number): Buffer {
  const keyring = readContactLookupHmacKeyring()
  const key = keyring.get(keyVersion)

  if (!key) {
    throw new Error(`Missing contact lookup HMAC key version: ${keyVersion}`)
  }

  return key
}

function readContactLookupHmacKeyring(): ContactLookupHmacKeyring {
  const rawEnv = process.env[CONTACT_LOOKUP_HMAC_KEYS_ENV]

  if (!rawEnv || rawEnv.trim().length === 0) {
    throw new Error(`Missing required env ${CONTACT_LOOKUP_HMAC_KEYS_ENV}`)
  }

  if (
    cachedContactLookupHmacKeyring &&
    cachedContactLookupHmacRawEnv === rawEnv
  ) {
    return cachedContactLookupHmacKeyring
  }

  const keyring = parseContactLookupHmacKeyring(rawEnv)

  cachedContactLookupHmacKeyring = keyring
  cachedContactLookupHmacRawEnv = rawEnv

  return keyring
}

function parseContactLookupHmacKeyring(
  rawEnv: string,
): ContactLookupHmacKeyring {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawEnv)
  } catch {
    throw new Error(`${CONTACT_LOOKUP_HMAC_KEYS_ENV} must be valid JSON`)
  }

  if (!isRecord(parsed)) {
    throw new Error(`${CONTACT_LOOKUP_HMAC_KEYS_ENV} must be a JSON object`)
  }

  const keyring = new Map<number, Buffer>()

  for (const [rawKeyVersion, rawKey] of Object.entries(parsed)) {
    const keyVersion = Number(rawKeyVersion)

    if (!Number.isInteger(keyVersion) || keyVersion <= 0) {
      throw new Error(
        `${CONTACT_LOOKUP_HMAC_KEYS_ENV} contains invalid key version: ${rawKeyVersion}`,
      )
    }

    if (typeof rawKey !== 'string') {
      throw new Error(
        `${CONTACT_LOOKUP_HMAC_KEYS_ENV}.${rawKeyVersion} must be a base64 string`,
      )
    }

    const key = Buffer.from(rawKey, 'base64')

    if (key.length !== 32) {
      throw new Error(
        `${CONTACT_LOOKUP_HMAC_KEYS_ENV}.${rawKeyVersion} must decode to 32 bytes`,
      )
    }

    keyring.set(keyVersion, key)
  }

  if (keyring.size === 0) {
    throw new Error(`${CONTACT_LOOKUP_HMAC_KEYS_ENV} must contain at least one key`)
  }

  return keyring
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}