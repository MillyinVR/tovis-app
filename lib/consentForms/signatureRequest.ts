// lib/consentForms/signatureRequest.ts
//
// K15 — mint + deliver the secure consent-signature link, and the one place that
// decides WHICH VERSION a client is being asked to sign.
//
// 🔴 The version is pinned HERE, at mint, onto
// `ClientActionToken.consentFormVersionId`. The signing route copies that id
// onto the record and never re-resolves it. An implementation that looked up
// `max(version)` when the client tapped "I agree" would be wrong in a way no
// unit test notices and every dispute would: a pro who publishes v2 while the
// SMS is sitting unread would have the record attest to words the client never
// saw. That is the single failure this module exists to prevent.
//
// The delivery rail is K10-B's: an unauthenticated token page reached by
// EMAIL/SMS, because the client this is aimed at is usually UNCLAIMED
// (ClientProfile.userId null) and can never pass requireClient() on any
// authenticated surface. Call inside a transaction — the enqueue writes dispatch
// rows on the same tx, so a refused request can never have sent a link.

import {
  ClientActionTokenKind,
  ContactMethod,
  Prisma,
  type ClientConsentKind,
} from '@prisma/client'

import { buildClientActionLinkForType } from '@/lib/clientActions/linkBuilders'
import { enqueueClientActionDispatch } from '@/lib/clientActions/enqueueClientActionDispatch'
import { orchestrateClientActionDelivery } from '@/lib/clientActions/orchestrateClientActionDelivery'
import {
  requireRecipientProfessionalId,
  resolveClientActionExpiresAt,
} from '@/lib/clientActions/policies'
import type {
  ClientActionBuildLinkResult,
  ClientActionIssuedToken,
  ClientActionOrchestrationPlan,
} from '@/lib/clientActions/types'
import {
  generateClientActionToken,
  hashClientActionToken,
} from '@/lib/consultation/clientActionTokens'
import { asTrimmedString } from '@/lib/guards'
import { toNullableJsonCreateInput } from '@/lib/typed/prismaJson'

/**
 * How long a signature link outlives the appointment it was sent for.
 *
 * A pro often sends this with the client already in the chair, and may chase it
 * the same evening — so the link must survive the appointment start, unlike the
 * K12 confirmation link, which is meaningless once the visit begins. A day is
 * enough for both and short enough that a link found in an old message thread
 * months later signs nothing.
 */
export const CONSENT_SIGNATURE_LINK_TAIL_MS = 1000 * 60 * 60 * 24 // 24h

/**
 * The link's expiry: a day after the appointment, or a day from now for a
 * booking that has already started (so a pro chasing a signature at the chair
 * is not handed a link that is born dead).
 */
export function resolveConsentSignatureExpiresAt(args: {
  scheduledFor: Date
  now: Date
}): Date {
  const anchor = Math.max(args.scheduledFor.getTime(), args.now.getTime())
  return new Date(anchor + CONSENT_SIGNATURE_LINK_TAIL_MS)
}

export type ConsentSignatureRequestRefusalCode =
  | 'FORM_NOT_FOUND'
  | 'FORM_RETIRED'
  | 'FORM_HAS_NO_TEXT'
  | 'NO_DELIVERABLE_CONTACT'

export type CreateConsentSignatureRequestArgs = {
  tx: Prisma.TransactionClient

  professionalId: string
  clientId: string
  bookingId: string
  /** The FORM to be signed; its current version is resolved and pinned here. */
  formId: string

  /** `Booking.scheduledFor` — anchors the link's expiry. */
  scheduledFor: Date

  recipientEmail?: string | null
  recipientPhone?: string | null
  preferredContactMethod?: ContactMethod | null

  issuedByUserId?: string | null
  recipientUserId?: string | null
  recipientTimeZone?: string | null

  professionalName: string | null

  now?: Date
}

export type CreateConsentSignatureRequestResult =
  | {
      ok: true
      plan: ClientActionOrchestrationPlan
      token: ClientActionIssuedToken
      link: ClientActionBuildLinkResult
      dispatch: Awaited<ReturnType<typeof enqueueClientActionDispatch>>
      /** The version the client will be shown — pinned on the token row. */
      version: { id: string; version: number; title: string }
      kind: ClientConsentKind
    }
  | { ok: false; code: ConsentSignatureRequestRefusalCode; error: string }

export function buildConsentSignatureTitle(formTitle: string): string {
  const trimmed = formTitle.trim()
  return trimmed ? `Please sign: ${trimmed}` : 'Please sign your consent form'
}

export function buildConsentSignatureBody(args: {
  professionalName: string | null
  formTitle: string
}): string {
  const withWhom = args.professionalName ? ` with ${args.professionalName}` : ''
  const named = args.formTitle.trim()

  // Names the document rather than saying "a form": a client who cannot tell
  // what they are being asked to sign from the message is a client who does not
  // tap the link.
  return (
    `Your appointment${withWhom} needs ${named ? `“${named}”` : 'a consent form'} signed. ` +
    `Use this secure link to read it and sign — it only takes a moment.`
  )
}

function buildMetadata(
  args: Pick<
    CreateConsentSignatureRequestArgs,
    'professionalId' | 'clientId' | 'bookingId' | 'formId'
  >,
  versionId: string,
  plan: ClientActionOrchestrationPlan,
): Prisma.InputJsonObject {
  return {
    source: 'consentSignatureRequest',
    actionType: 'CONSENT_SIGNATURE',
    professionalId: args.professionalId,
    clientId: args.clientId,
    bookingId: args.bookingId,
    formId: args.formId,
    formVersionId: versionId,
    resendMode: plan.resendMode,
    sendKey: plan.idempotency.sendKey,
    baseKey: plan.idempotency.baseKey,
  }
}

export async function createConsentSignatureRequest(
  args: CreateConsentSignatureRequestArgs,
): Promise<CreateConsentSignatureRequestResult> {
  const now = args.now ?? new Date()

  // 🔴 Own forms only, and the version is read INSIDE the caller's transaction.
  // A platform template is readable by every pro, but sending one the pro never
  // adopted would put the platform's words out under their name.
  const form = await args.tx.consentForm.findFirst({
    where: { id: args.formId, professionalId: args.professionalId },
    select: {
      id: true,
      kind: true,
      isActive: true,
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true, title: true },
      },
    },
  })

  if (!form) {
    return {
      ok: false,
      code: 'FORM_NOT_FOUND',
      error: 'That consent form was not found.',
    }
  }

  // A retired form is one the pro stopped using. Recording a signature a client
  // really gave against one is truthful (K14 allows it); ASKING for a new one is
  // not — it puts words the pro has withdrawn in front of a client.
  if (!form.isActive) {
    return {
      ok: false,
      code: 'FORM_RETIRED',
      error: 'That consent form is retired. Reactivate it before sending it.',
    }
  }

  const version = form.versions[0]
  if (!version) {
    return {
      ok: false,
      code: 'FORM_HAS_NO_TEXT',
      error: 'That consent form has no published text to sign.',
    }
  }

  const recipientEmail = asTrimmedString(args.recipientEmail)
  const recipientPhone = asTrimmedString(args.recipientPhone)

  // Refuse rather than silently drop: a pro told "sent" with nowhere to send it
  // believes a signature is on its way ([[offered-option-must-be-an-accepted-write]]).
  if (!recipientEmail && !recipientPhone) {
    return {
      ok: false,
      code: 'NO_DELIVERABLE_CONTACT',
      error:
        'This client has no email or phone on file, so there is nowhere to send the link.',
    }
  }

  const orchestration = orchestrateClientActionDelivery({
    actionType: 'CONSENT_SIGNATURE',
    refs: {
      bookingId: args.bookingId,
      clientId: args.clientId,
      professionalId: args.professionalId,
      aftercareId: null,
      consultationApprovalId: null,
      inviteId: null,
    },
    recipient: {
      clientId: args.clientId,
      professionalId: args.professionalId,
      userId: asTrimmedString(args.recipientUserId),
      invitedName: null,
      recipientEmail,
      recipientPhone,
      preferredContactMethod: args.preferredContactMethod ?? null,
      timeZone: asTrimmedString(args.recipientTimeZone),
    },
    resendMode: 'INITIAL_SEND',
    sendVersion: null,
    issuedByUserId: asTrimmedString(args.issuedByUserId),
    expiresAtOverride: resolveConsentSignatureExpiresAt({
      scheduledFor: args.scheduledFor,
      now,
    }),
    metadata: null,
    tx: args.tx,
  })

  if (!orchestration.ok) {
    throw new Error(
      `createConsentSignatureRequest: ${orchestration.code} ${orchestration.error}`,
    )
  }

  const plan = orchestration.plan
  const metadata = buildMetadata(args, version.id, plan)

  const expiresAtResult = resolveClientActionExpiresAt({
    actionType: 'CONSENT_SIGNATURE',
    now,
    expiresAtOverride: plan.expiresAtOverride,
  })

  if (!expiresAtResult.ok || !expiresAtResult.value) {
    const detail = expiresAtResult.ok
      ? 'CONSENT_SIGNATURE resolved to a null expiresAt unexpectedly.'
      : `${expiresAtResult.code} ${expiresAtResult.error}`

    throw new Error(`createConsentSignatureRequest: ${detail}`)
  }

  // Resend revokes the outstanding links for THIS form on THIS booking, and
  // only those: a client with two different waivers to sign has two live links,
  // and killing one when the pro chases the other would strand it. Scoped by
  // the pinned version's form rather than by the token kind alone.
  await args.tx.clientActionToken.updateMany({
    where: {
      kind: ClientActionTokenKind.CONSENT_SIGNATURE,
      bookingId: args.bookingId,
      clientId: args.clientId,
      revokedAt: null,
      consentFormVersion: { formId: form.id },
    },
    data: {
      revokedAt: now,
      revokeReason: 'Superseded by a newer consent signature link.',
    },
  })

  const rawToken = generateClientActionToken()
  const created = await args.tx.clientActionToken.create({
    data: {
      kind: ClientActionTokenKind.CONSENT_SIGNATURE,
      tokenHash: hashClientActionToken(rawToken),
      singleUse: false,
      bookingId: args.bookingId,
      aftercareSummaryId: null,
      consultationApprovalId: null,
      // 🔴 The pin. Everything downstream reads the version from here.
      consentFormVersionId: version.id,
      clientId: plan.recipient.clientId,
      professionalId: requireRecipientProfessionalId(plan.recipient),
      deliveryMethod: plan.resolvedDelivery.method,
      recipientEmailSnapshot: recipientEmail,
      recipientPhoneSnapshot: recipientPhone,
      issuedByUserId: plan.issuedByUserId,
      expiresAt: expiresAtResult.value,
      metadata: toNullableJsonCreateInput(metadata),
    },
    select: { id: true, expiresAt: true },
  })

  const token: ClientActionIssuedToken = {
    id: created.id,
    rawToken,
    expiresAt: created.expiresAt,
  }

  const link = buildClientActionLinkForType({
    actionType: 'CONSENT_SIGNATURE',
    rawToken,
  })

  const planWithMetadata: ClientActionOrchestrationPlan = { ...plan, metadata }

  const dispatch = await enqueueClientActionDispatch({
    plan: planWithMetadata,
    href: link.href,
    title: buildConsentSignatureTitle(version.title),
    body: buildConsentSignatureBody({
      professionalName: args.professionalName,
      formTitle: version.title,
    }),
    payload: {
      ...metadata,
      clientActionTokenId: token.id,
      expiresAt: token.expiresAt.toISOString(),
    },
    tx: args.tx,
  })

  return {
    ok: true,
    plan: planWithMetadata,
    token,
    link,
    dispatch,
    version,
    kind: form.kind,
  }
}
