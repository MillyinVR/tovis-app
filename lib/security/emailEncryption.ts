// lib/security/emailEncryption.ts
//
// AEAD encryption boundary for email addresses at rest. Mirrors
// lib/security/phoneEncryption.ts:
//   - one canonical key version (rotation-ready via keyVersion)
//   - a fixed domain-separation associated-data constant (distinct from phone)
//   - a JSON-safe envelope stored in a `*Encrypted` JSONB column
//   - strict reads with no silent plaintext fallback
//
// Email is ALSO independently hashed for lookup (emailHashV2); this module only
// covers the encrypted-at-rest copy of the displayable value. The hash path is
// untouched. Empty/blank/absent emails are NOT encrypted (they stay null).
//
// Required env: PII_AEAD_KEYS_JSON must contain an EMAIL_KEY_VERSION key.

import { isRecord } from '@/lib/guards'
import {
  decryptAead,
  encryptAead,
  isAeadEnvelopeV1,
  type AeadEnvelopeV1,
} from '@/lib/security/crypto/aead'

export const EMAIL_KEY_VERSION = 'email-aead-v1' as const
export const EMAIL_AEAD_ASSOCIATED_DATA = 'tovis:email-privacy:v1' as const
const EMAIL_AEAD_ALGORITHM = 'aes-256-gcm-v1' as const

export type EncryptedEmailEnvelopeV1 = {
  v: 1
  algorithm: typeof EMAIL_AEAD_ALGORITHM
  keyVersion: typeof EMAIL_KEY_VERSION
  ciphertext: AeadEnvelopeV1
}

// Blank/absent -> null, otherwise the value verbatim. This is NOT email
// normalization (the stored plaintext is already normalized at write time, and
// the envelope must match it byte-for-byte) — just a presence check.
function nonBlankEmail(value: string | null | undefined): string | null {
  if (value == null) return null
  return value.trim().length > 0 ? value : null
}

/**
 * Encrypt an email value. Returns null for empty / blank / absent input so the
 * caller stores NULL in the `*Encrypted` column rather than an envelope of "".
 * Throws if the keyring is missing EMAIL_KEY_VERSION (callers on critical paths
 * should go through emailPrivacy.encryptedEmailInput, which is fail-soft).
 */
export function buildEmailEnvelope(
  value: string | null | undefined,
): EncryptedEmailEnvelopeV1 | null {
  const email = nonBlankEmail(value)
  if (email === null) return null

  const ciphertext = encryptAead({
    plaintext: email,
    keyVersion: EMAIL_KEY_VERSION,
    associatedData: EMAIL_AEAD_ASSOCIATED_DATA,
  })

  return {
    v: 1,
    algorithm: EMAIL_AEAD_ALGORITHM,
    keyVersion: EMAIL_KEY_VERSION,
    ciphertext,
  }
}

export function isEncryptedEmailEnvelopeV1(
  value: unknown,
): value is EncryptedEmailEnvelopeV1 {
  if (!isRecord(value)) return false

  return (
    value.v === 1 &&
    value.algorithm === EMAIL_AEAD_ALGORITHM &&
    value.keyVersion === EMAIL_KEY_VERSION &&
    isAeadEnvelopeV1(value.ciphertext)
  )
}

/**
 * Decrypt an email envelope. Throws on a malformed envelope or a failed
 * authentication tag — no silent fallback (mirrors the phone/address boundary).
 */
export function readEmailEnvelope(value: EncryptedEmailEnvelopeV1): string {
  if (!isEncryptedEmailEnvelopeV1(value)) {
    throw new Error('Invalid email privacy envelope')
  }

  return decryptAead({
    envelope: value.ciphertext,
    associatedData: EMAIL_AEAD_ASSOCIATED_DATA,
  })
}
