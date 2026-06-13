// lib/security/notesEncryption.ts

import {
  decryptAead,
  encryptAead,
  isAeadEnvelopeV1,
  type AeadEnvelopeV1,
} from '@/lib/security/crypto/aead'

/**
 * AEAD encryption boundary for Tier-3 health-adjacent free-text notes:
 * allergy detail, consultation notes, the client's consultation message, and
 * the closeout-audit snapshots of those. See
 * docs/security/ticket-encrypt-tier3-health-notes.md.
 *
 * Mirrors lib/security/addressEncryption.ts:
 *   - one canonical key version (rotation-ready via the keyVersion column)
 *   - a fixed domain-separation associated-data constant
 *   - a JSON-safe wrapper envelope stored in a `*Encrypted` JSONB column
 *   - strict reads with no silent plaintext fallback
 *
 * Unlike addresses there is no normalized sub-field payload — a note is a
 * single opaque string. Empty / blank / absent notes are NOT encrypted (they
 * stay null) so an absent note never yields a ciphertext envelope.
 *
 * Required env: PII_AEAD_KEYS_JSON must contain a NOTES_KEY_VERSION key.
 */

export const NOTES_KEY_VERSION = 'notes-aead-v1' as const
export const NOTES_AEAD_ASSOCIATED_DATA = 'tovis:notes-privacy:v1' as const
const NOTES_AEAD_ALGORITHM = 'aes-256-gcm-v1' as const

export type EncryptedNotesEnvelopeV1 = {
  v: 1
  algorithm: typeof NOTES_AEAD_ALGORITHM
  keyVersion: typeof NOTES_KEY_VERSION
  ciphertext: AeadEnvelopeV1
}

function normalizeNote(value: string | null | undefined): string | null {
  if (value == null) return null
  // Decide null-vs-encrypt on the trimmed value, but preserve the original
  // content (internal + outer whitespace) so notes are never silently mangled.
  return value.trim().length > 0 ? value : null
}

/**
 * Encrypt a single note. Returns null for empty / blank / absent input so the
 * caller stores NULL in the `*Encrypted` column rather than an envelope of "".
 */
export function buildNotesEnvelope(
  value: string | null | undefined,
): EncryptedNotesEnvelopeV1 | null {
  const note = normalizeNote(value)
  if (note === null) return null

  const ciphertext = encryptAead({
    plaintext: note,
    keyVersion: NOTES_KEY_VERSION,
    associatedData: NOTES_AEAD_ASSOCIATED_DATA,
  })

  return {
    v: 1,
    algorithm: NOTES_AEAD_ALGORITHM,
    keyVersion: NOTES_KEY_VERSION,
    ciphertext,
  }
}

export function isEncryptedNotesEnvelopeV1(
  value: unknown,
): value is EncryptedNotesEnvelopeV1 {
  if (!isRecord(value)) return false

  return (
    value.v === 1 &&
    value.algorithm === NOTES_AEAD_ALGORITHM &&
    value.keyVersion === NOTES_KEY_VERSION &&
    isAeadEnvelopeV1(value.ciphertext)
  )
}

/**
 * Decrypt a notes envelope back to plaintext. Throws on a malformed envelope or
 * a failed authentication tag — no silent fallback (mirrors the address boundary).
 */
export function readNotesEnvelope(value: EncryptedNotesEnvelopeV1): string {
  if (!isEncryptedNotesEnvelopeV1(value)) {
    throw new Error('Invalid notes privacy envelope')
  }

  return decryptAead({
    envelope: value.ciphertext,
    associatedData: NOTES_AEAD_ASSOCIATED_DATA,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
