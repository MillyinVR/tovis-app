// lib/security/notesPrivacy.ts
//
// Prisma-facing dual-write / dual-read boundary for the AEAD-encrypted free-text
// note fields (allergy detail, pro client notes, consultation notes, closeout
// snapshots). Keeps Prisma typing out of the pure crypto module
// (lib/security/notesEncryption.ts) and centralizes the expand→contract burn-in
// behavior so every call site is identical.
//
// See docs/security/ticket-encrypt-tier3-health-notes.md.

import { Prisma } from '@prisma/client'
import * as Sentry from '@sentry/nextjs'

import {
  buildNotesEnvelope,
  isEncryptedNotesEnvelopeV1,
  readNotesEnvelope,
} from '@/lib/security/notesEncryption'
import { safeError } from '@/lib/security/logging'
import { toPrismaJson } from '@/lib/typed/prismaJson'

/**
 * Map a free-text value to a Prisma `Json?` input for a `*Encrypted` column.
 *
 * Returns the AEAD envelope object when there is content to protect, or
 * `Prisma.DbNull` (SQL NULL) for blank / absent input so an empty note never
 * yields a ciphertext envelope. Use this for the encrypted column in a
 * dual-write alongside the existing plaintext column.
 */
export function encryptedNoteInput(
  value: string | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  try {
    const envelope = buildNotesEnvelope(value)
    return envelope ? toPrismaJson(envelope) : Prisma.DbNull
  } catch (error) {
    // Fail-soft during the expand phase: these writes (allergy/note save,
    // consultation proposal) must not break if the keyring is misconfigured.
    // Plaintext is still written (the source of truth during burn-in) and the
    // backfill re-encrypts any row whose envelope is missing. Surfaced loudly so
    // misconfiguration is caught. Becomes fail-hard at the contract migration.
    console.error(
      'encryptedNoteInput failed; storing null envelope (plaintext retained)',
      safeError(error),
    )
    Sentry.captureException(error)
    return Prisma.DbNull
  }
}

/**
 * Dual-read boundary for the burn-in period.
 *
 * Prefers the encrypted envelope when present (post-backfill, all new writes),
 * and falls back to the plaintext column for rows not yet backfilled. After the
 * contract migration drops the plaintext columns, callers pass `null` for the
 * fallback and every row reads from the envelope.
 *
 * Throws only on a malformed/forged envelope (via readNotesEnvelope) — never
 * silently returns ciphertext.
 */
export function readEncryptedNoteOrFallback(
  encrypted: unknown,
  plaintextFallback: string | null,
): string | null {
  if (isEncryptedNotesEnvelopeV1(encrypted)) {
    return readNotesEnvelope(encrypted)
  }
  return plaintextFallback
}
