// lib/security/phonePrivacy.ts
//
// Prisma-facing dual-write / dual-read boundary for encrypted-at-rest phone
// numbers (User.phone, ClientProfile.phone). Keeps Prisma typing out of the
// pure crypto module (phoneEncryption.ts) and centralizes the expand→contract
// burn-in behavior.
//
// CRITICAL-PATH NOTE: phone writes run on the registration / phone-correction
// path. encryptedPhoneInput is therefore FAIL-SOFT — if the keyring is
// misconfigured it must NOT break signup. During the expand phase the plaintext
// column is still written (the source of truth), and the backfill re-encrypts
// any row whose envelope is missing, so a soft failure is fully recoverable. It
// is surfaced loudly (console + Sentry) so misconfiguration is caught fast.
// After the contract migration (plaintext dropped) this should become fail-hard.

import { Prisma } from '@prisma/client'
import * as Sentry from '@sentry/nextjs'

import {
  buildPhoneEnvelope,
  isEncryptedPhoneEnvelopeV1,
  readPhoneEnvelope,
} from '@/lib/security/phoneEncryption'
import { safeError } from '@/lib/security/logging'
import { toPrismaJson } from '@/lib/typed/prismaJson'

type PhoneEncryptedInput = Prisma.InputJsonValue | typeof Prisma.DbNull

function coercePhone(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Map a phone value to a Prisma `Json?` input for the `phoneEncrypted` column.
 * Envelope for real content, `Prisma.DbNull` for blank/absent. Fail-soft so an
 * encryption error logs + captures and returns `Prisma.DbNull`, letting the
 * write (e.g. user registration) still succeed with plaintext intact.
 */
export function encryptedPhoneInput(value: unknown): PhoneEncryptedInput {
  try {
    const envelope = buildPhoneEnvelope(coercePhone(value))
    return envelope ? toPrismaJson(envelope) : Prisma.DbNull
  } catch (error) {
    console.error(
      'encryptedPhoneInput failed; storing null envelope (plaintext retained)',
      safeError(error),
    )
    Sentry.captureException(error)
    return Prisma.DbNull
  }
}

/**
 * Dual-write helper mirroring buildContactLookupData's contract:
 * - `phone` omitted / undefined  -> return {} (leave the DB column unchanged)
 * - `phone` provided             -> write the envelope (or DbNull when blank)
 *
 * Spread alongside buildUserContactLookupData / buildClientProfileContactLookupData
 * at every phone write site so the encrypted copy tracks the hash exactly.
 */
export function buildPhoneEncryptionWriteData(input: {
  phone?: unknown
}): { phoneEncrypted?: PhoneEncryptedInput } {
  if (input.phone === undefined) return {}
  return { phoneEncrypted: encryptedPhoneInput(input.phone) }
}

/**
 * Dual-read boundary for the burn-in period. Prefers the envelope, falls back
 * to plaintext for not-yet-backfilled rows. Throws only on a forged/malformed
 * envelope (via readPhoneEnvelope) — never returns ciphertext.
 */
export function readEncryptedPhoneOrFallback(
  encrypted: unknown,
  plaintextFallback: string | null,
): string | null {
  if (isEncryptedPhoneEnvelopeV1(encrypted)) {
    return readPhoneEnvelope(encrypted)
  }
  return plaintextFallback
}
