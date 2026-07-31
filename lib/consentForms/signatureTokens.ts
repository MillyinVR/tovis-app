// lib/consentForms/signatureTokens.ts
//
// K15: resolve the consent-signature link (ClientActionTokenKind.CONSENT_SIGNATURE,
// /client/consent/<token>) and record the signature it authorises.
//
// Mirrors lib/booking/appointmentConfirmationTokens.ts: the resolver VALIDATES
// without consuming, and it deliberately does NOT require the booking to still
// be actionable — the page must render honest "already signed" / "cancelled"
// states rather than 404 on a URL the client was texted.
//
// 🔴 The version is read from the TOKEN (`consentFormVersionId`), never
// re-resolved from the form. That is the entire point of pinning it at mint: a
// version published between the send and the signature must not change which
// words the record attests to.

import {
  ClientActionTokenKind,
  ConsentProofMethod,
  Prisma,
  type ClientConsentKind,
} from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'
import { hashClientActionToken } from '@/lib/consultation/clientActionTokens'
import { prisma } from '@/lib/prisma'
import { professionalPublicDisplayNameSelect } from '@/lib/privacy/professionalDisplayName'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function invalidConsentToken(
  message: string,
  userMessage = 'That consent link is invalid or expired.',
) {
  return bookingError('CONSENT_TOKEN_INVALID', { message, userMessage })
}

const CONSENT_SIGNATURE_TOKEN_SELECT = {
  id: true,
  kind: true,
  singleUse: true,
  bookingId: true,
  clientId: true,
  professionalId: true,
  consentFormVersionId: true,
  expiresAt: true,
  revokedAt: true,
  consentFormVersion: {
    select: {
      id: true,
      version: true,
      title: true,
      body: true,
      form: { select: { id: true, kind: true } },
    },
  },
  // The signature this link already produced, if any. Its presence — not the
  // token's used-ness — is what "already signed" means (the unique
  // ClientConsentRecord.signatureTokenId).
  consentRecord: {
    select: { id: true, signedAt: true, createdAt: true },
  },
  booking: {
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      locationTimeZone: true,
      clientId: true,
      professionalId: true,
      service: { select: { id: true, name: true } },
      professional: {
        select: {
          id: true,
          timeZone: true,
          ...professionalPublicDisplayNameSelect,
        },
      },
    },
  },
} satisfies Prisma.ClientActionTokenSelect

type ConsentSignatureTokenRecord = Prisma.ClientActionTokenGetPayload<{
  select: typeof CONSENT_SIGNATURE_TOKEN_SELECT
}>

export type ResolvedConsentSignatureToken = {
  accessSource: 'clientActionToken'
  token: {
    id: string
    expiresAt: Date
  }
  /** The pinned version — the ONLY text this link may produce a record for. */
  version: {
    id: string
    version: number
    title: string
    body: string
    formId: string
    /**
     * The FORM's kind, carried here so the record is written with the same kind
     * the document is. A GENERAL_CONSENT record pointing at a patch-test form's
     * words reads as proof of something it isn't — the mismatch K14's pro-facing
     * write route already refuses, held to here by construction instead.
     */
    formKind: ClientConsentKind
  }
  /** Non-null once this link has been signed. */
  signedRecord: { id: string; signedAt: Date | null; createdAt: Date } | null
  booking: NonNullable<ConsentSignatureTokenRecord['booking']>
  clientId: string
  professionalId: string
}

function assertConsentTokenUsable(
  token: ConsentSignatureTokenRecord | null,
  now: Date,
): asserts token is ConsentSignatureTokenRecord {
  if (!token) {
    throw invalidConsentToken('Consent signature token was not found.')
  }

  if (token.kind !== ClientActionTokenKind.CONSENT_SIGNATURE) {
    throw invalidConsentToken(
      `Unexpected client action token kind for consent signature. tokenId=${token.id} kind=${String(
        token.kind,
      )}`,
    )
  }

  if (token.revokedAt) {
    throw invalidConsentToken(
      `Consent signature token was revoked. tokenId=${token.id}`,
      'This link has been replaced by a newer one. Please use the most recent message.',
    )
  }

  if (token.expiresAt.getTime() <= now.getTime()) {
    throw invalidConsentToken(
      `Consent signature token expired. tokenId=${token.id}`,
      'This link has expired. Ask your professional to send a new one.',
    )
  }
}

function assertConsentTokenIntegrity(token: ConsentSignatureTokenRecord): void {
  if (!token.consentFormVersion) {
    // A token with no pinned version could only sign "whatever is current",
    // which is the exact thing this design refuses to do.
    throw invalidConsentToken(
      `Consent signature token is missing its pinned form version. tokenId=${token.id}`,
    )
  }

  if (!token.booking) {
    throw invalidConsentToken(
      `Consent signature token is missing its booking. tokenId=${token.id}`,
    )
  }

  if (token.booking.clientId !== token.clientId) {
    throw invalidConsentToken(
      `Consent token client mismatch. tokenId=${token.id} tokenClientId=${token.clientId} actualClientId=${token.booking.clientId}`,
    )
  }

  if (token.booking.professionalId !== token.professionalId) {
    throw invalidConsentToken(
      `Consent token professional mismatch. tokenId=${token.id} tokenProfessionalId=${token.professionalId} actualProfessionalId=${token.booking.professionalId}`,
    )
  }
}

/**
 * Validate a raw consent-signature token and return everything the page needs,
 * without mutating anything.
 */
export async function resolveConsentSignatureTokenForRead(args: {
  rawToken: string
  tx?: Prisma.TransactionClient
  now?: Date
}): Promise<ResolvedConsentSignatureToken> {
  const db = getDb(args.tx)
  const now = args.now ?? new Date()

  const normalized =
    typeof args.rawToken === 'string' ? args.rawToken.trim() : ''

  if (!normalized) {
    throw bookingError('CONSENT_TOKEN_MISSING', {
      message: 'Consent signature token is missing.',
      userMessage: 'That consent link is invalid or expired.',
    })
  }

  const token = await db.clientActionToken.findUnique({
    where: { tokenHash: hashClientActionToken(normalized) },
    select: CONSENT_SIGNATURE_TOKEN_SELECT,
  })

  assertConsentTokenUsable(token, now)
  assertConsentTokenIntegrity(token)

  const version = token.consentFormVersion
  const booking = token.booking

  if (!version || !booking) {
    // Unreachable — assertConsentTokenIntegrity threw. Narrowing for the
    // compiler without an escape hatch (house rule: no `as`).
    throw invalidConsentToken(
      `Consent signature token failed narrowing. tokenId=${token.id}`,
    )
  }

  return {
    accessSource: 'clientActionToken',
    token: { id: token.id, expiresAt: token.expiresAt },
    version: {
      id: version.id,
      version: version.version,
      title: version.title,
      body: version.body,
      formId: version.form.id,
      formKind: version.form.kind,
    },
    signedRecord: token.consentRecord ?? null,
    booking,
    clientId: token.clientId,
    professionalId: token.professionalId,
  }
}

export type RecordConsentSignatureResult =
  | { ok: true; recordId: string; alreadySigned: boolean }
  | { ok: false; code: 'ALREADY_SIGNED'; error: string }

/**
 * Write the signature.
 *
 * 🔴 `formVersionId` comes from the TOKEN's pin, and `proofMethod` is
 * CLIENT_TOKEN — a pairing only this function produces. From K15 on, that is
 * what makes "signed via a link" a fact rather than a claim: the pro's own
 * record form no longer offers CLIENT_TOKEN at all (K14-B).
 *
 * One signature per link, guaranteed by the UNIQUE
 * `ClientConsentRecord.signatureTokenId`. The pre-check below is a courteous
 * message, not the guarantee — a double-submitted form races past it and is
 * refused by the database.
 */
export async function recordConsentSignature(args: {
  tx: Prisma.TransactionClient
  resolved: ResolvedConsentSignatureToken
  /** The client's typed name — the click-wrap signature itself. */
  signatureName: string
  now?: Date
}): Promise<RecordConsentSignatureResult> {
  const now = args.now ?? new Date()

  const existing = await args.tx.clientConsentRecord.findUnique({
    where: { signatureTokenId: args.resolved.token.id },
    select: { id: true },
  })

  if (existing) {
    return {
      ok: false,
      code: 'ALREADY_SIGNED',
      error: 'This form has already been signed.',
    }
  }

  const created = await args.tx.clientConsentRecord.create({
    data: {
      clientId: args.resolved.clientId,
      professionalId: args.resolved.professionalId,
      bookingId: args.resolved.booking.id,
      // From the pinned version's FORM, never from the caller: the record's
      // kind and its text must describe the same document.
      kind: args.resolved.version.formKind,
      formVersionId: args.resolved.version.id,
      signedAt: now,
      proofMethod: ConsentProofMethod.CLIENT_TOKEN,
      // The typed name IS the proof reference — author-scoped, never surfaced
      // to another pro (the schema's own rule for this column).
      proofRef: args.signatureName,
      signatureTokenId: args.resolved.token.id,
    },
    select: { id: true },
  })

  return { ok: true, recordId: created.id, alreadySigned: false }
}
