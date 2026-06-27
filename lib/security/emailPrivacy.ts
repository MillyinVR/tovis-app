// lib/security/emailPrivacy.ts
//
// Prisma-facing dual-write / dual-read boundary for encrypted-at-rest email
// addresses (User.email, ClientProfile.email). Mirrors phonePrivacy.ts: keeps
// Prisma typing out of the pure crypto module (emailEncryption.ts) and
// centralizes the expand→contract burn-in behavior.
//
// CRITICAL-PATH NOTE: email writes run on the registration / login path.
// encryptedEmailInput is therefore FAIL-SOFT — if the keyring is misconfigured
// it must NOT break signup. During the expand phase the plaintext column is
// still written (the source of truth), and the backfill re-encrypts any row
// whose envelope is missing, so a soft failure is fully recoverable. It is
// surfaced loudly (console + Sentry) so misconfiguration is caught fast. After
// the contract migration (plaintext dropped) this should become fail-hard.

import { Prisma } from '@prisma/client'
import * as Sentry from '@sentry/nextjs'

import {
  buildEmailEnvelope,
  isEncryptedEmailEnvelopeV1,
  readEmailEnvelope,
} from '@/lib/security/emailEncryption'
import { safeError } from '@/lib/security/logging'
import { toPrismaJson } from '@/lib/typed/prismaJson'

type EmailEncryptedInput = Prisma.InputJsonValue | typeof Prisma.DbNull

function coerceEmail(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Map an email value to a Prisma `Json?` input for the `emailEncrypted` column.
 * Envelope for real content, `Prisma.DbNull` for blank/absent. Fail-soft so an
 * encryption error logs + captures and returns `Prisma.DbNull`, letting the
 * write (e.g. user registration) still succeed with plaintext intact.
 */
export function encryptedEmailInput(value: unknown): EmailEncryptedInput {
  try {
    const envelope = buildEmailEnvelope(coerceEmail(value))
    return envelope ? toPrismaJson(envelope) : Prisma.DbNull
  } catch (error) {
    console.error(
      'encryptedEmailInput failed; storing null envelope (plaintext retained)',
      safeError(error),
    )
    Sentry.captureException(error)
    return Prisma.DbNull
  }
}

/**
 * Dual-write helper mirroring buildContactLookupData's contract:
 * - `email` omitted / undefined  -> return {} (leave the DB column unchanged)
 * - `email` provided             -> write the envelope (or DbNull when blank)
 *
 * Spread alongside buildUserContactLookupData / buildClientProfileContactLookupData
 * at every email write site so the encrypted copy tracks the hash exactly.
 */
export function buildEmailEncryptionWriteData(input: {
  email?: unknown
}): { emailEncrypted?: EmailEncryptedInput } {
  if (input.email === undefined) return {}
  return { emailEncrypted: encryptedEmailInput(input.email) }
}

/**
 * Dual-read boundary for the burn-in period. Prefers the envelope, falls back
 * to plaintext for not-yet-backfilled rows. Throws only on a forged/malformed
 * envelope (via readEmailEnvelope) — never returns ciphertext.
 */
export function readEncryptedEmailOrFallback(
  encrypted: unknown,
  plaintextFallback: string | null,
): string | null {
  if (isEncryptedEmailEnvelopeV1(encrypted)) {
    return readEmailEnvelope(encrypted)
  }
  return plaintextFallback
}
