// lib/security/phoneEncryption.ts
//
// AEAD encryption boundary for phone numbers at rest. Mirrors
// lib/security/notesEncryption.ts / addressEncryption.ts:
//   - one canonical key version (rotation-ready via keyVersion)
//   - a fixed domain-separation associated-data constant (distinct from notes)
//   - a JSON-safe envelope stored in a `*Encrypted` JSONB column
//   - strict reads with no silent plaintext fallback
//
// Phone is ALSO independently hashed for lookup (phoneHashV2); this module only
// covers the encrypted-at-rest copy of the displayable value. The hash path is
// untouched. Empty/blank/absent phones are NOT encrypted (they stay null).
//
// Required env: PII_AEAD_KEYS_JSON must contain a PHONE_KEY_VERSION key.

import { isRecord } from '@/lib/guards'
import {
  decryptAead,
  encryptAead,
  isAeadEnvelopeV1,
  type AeadEnvelopeV1,
} from '@/lib/security/crypto/aead'

export const PHONE_KEY_VERSION = 'phone-aead-v1' as const
export const PHONE_AEAD_ASSOCIATED_DATA = 'tovis:phone-privacy:v1' as const
const PHONE_AEAD_ALGORITHM = 'aes-256-gcm-v1' as const

export type EncryptedPhoneEnvelopeV1 = {
  v: 1
  algorithm: typeof PHONE_AEAD_ALGORITHM
  keyVersion: typeof PHONE_KEY_VERSION
  ciphertext: AeadEnvelopeV1
}

// Blank/absent -> null, otherwise the value verbatim. This is NOT phone
// normalization (the stored plaintext is already normalized at write time, and
// the envelope must match it byte-for-byte) — just a presence check, so it does
// not belong in contactNormalization.ts.
function nonBlankPhone(value: string | null | undefined): string | null {
  if (value == null) return null
  return value.trim().length > 0 ? value : null
}

/**
 * Encrypt a phone value. Returns null for empty / blank / absent input so the
 * caller stores NULL in the `*Encrypted` column rather than an envelope of "".
 * Throws if the keyring is missing PHONE_KEY_VERSION (callers on critical paths
 * should go through phonePrivacy.encryptedPhoneInput, which is fail-soft).
 */
export function buildPhoneEnvelope(
  value: string | null | undefined,
): EncryptedPhoneEnvelopeV1 | null {
  const phone = nonBlankPhone(value)
  if (phone === null) return null

  const ciphertext = encryptAead({
    plaintext: phone,
    keyVersion: PHONE_KEY_VERSION,
    associatedData: PHONE_AEAD_ASSOCIATED_DATA,
  })

  return {
    v: 1,
    algorithm: PHONE_AEAD_ALGORITHM,
    keyVersion: PHONE_KEY_VERSION,
    ciphertext,
  }
}

export function isEncryptedPhoneEnvelopeV1(
  value: unknown,
): value is EncryptedPhoneEnvelopeV1 {
  if (!isRecord(value)) return false

  return (
    value.v === 1 &&
    value.algorithm === PHONE_AEAD_ALGORITHM &&
    value.keyVersion === PHONE_KEY_VERSION &&
    isAeadEnvelopeV1(value.ciphertext)
  )
}

/**
 * Decrypt a phone envelope. Throws on a malformed envelope or a failed
 * authentication tag — no silent fallback (mirrors the address/notes boundary).
 */
export function readPhoneEnvelope(value: EncryptedPhoneEnvelopeV1): string {
  if (!isEncryptedPhoneEnvelopeV1(value)) {
    throw new Error('Invalid phone privacy envelope')
  }

  return decryptAead({
    envelope: value.ciphertext,
    associatedData: PHONE_AEAD_ASSOCIATED_DATA,
  })
}
