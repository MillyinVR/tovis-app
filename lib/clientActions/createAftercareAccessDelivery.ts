// lib/clientActions/createAftercareAccessDelivery.ts

import {
  ClientActionTokenKind,
  ContactMethod,
  Prisma,
} from '@prisma/client'

import {
  generateClientActionToken,
  hashClientActionToken,
} from '@/lib/consultation/clientActionTokens'
import { asTrimmedString } from '@/lib/guards'

import { buildClientActionLinkForType } from './linkBuilders'
import { enqueueClientActionDispatch } from './enqueueClientActionDispatch'
import { orchestrateClientActionDelivery } from './orchestrateClientActionDelivery'
import {
  requireRecipientProfessionalId,
  resolveClientActionExpiresAt,
} from './policies'
import type {
  ClientActionBuildLinkResult,
  ClientActionIssuedToken,
  ClientActionOrchestrationPlan,
  ClientActionResendMode,
} from './types'
import { toNullableJsonCreateInput } from '@/lib/typed/prismaJson'

export type CreateAftercareAccessDeliveryArgs = {
  tx: Prisma.TransactionClient

  professionalId: string
  clientId: string
  bookingId: string
  aftercareId: string
  aftercareVersion: number

  recipientEmail?: string | null
  recipientPhone?: string | null
  preferredContactMethod?: ContactMethod | null

  issuedByUserId?: string | null
  recipientUserId?: string | null
  recipientTimeZone?: string | null

  resendMode?: ClientActionResendMode
  expiresAtOverride?: Date | null
}

export type CreateAftercareAccessDeliveryResult = {
  plan: ClientActionOrchestrationPlan
  token: ClientActionIssuedToken
  link: ClientActionBuildLinkResult
  dispatch: Awaited<ReturnType<typeof enqueueClientActionDispatch>>
}

function normalizeResendMode(
  value: ClientActionResendMode | null | undefined,
): ClientActionResendMode {
  return value ?? 'INITIAL_SEND'
}

function buildAftercareTitle(): string {
  return 'Your aftercare is ready'
}

function buildAftercareBody(): string {
  // §12 NC1 #17: lead with the "ready" cue, keep the secure-link phrasing.
  return "Your aftercare is ready — use this secure link to view your summary and rebook when you're ready."
}

function buildAftercareMetadata(
  args: Pick<
    CreateAftercareAccessDeliveryArgs,
    | 'professionalId'
    | 'clientId'
    | 'bookingId'
    | 'aftercareId'
    | 'aftercareVersion'
  >,
  plan: ClientActionOrchestrationPlan,
): Prisma.InputJsonObject {
  return {
    source: 'aftercareSummary',
    actionType: 'AFTERCARE_ACCESS',
    professionalId: args.professionalId,
    clientId: args.clientId,
    bookingId: args.bookingId,
    aftercareId: args.aftercareId,
    aftercareVersion: args.aftercareVersion,
    resendMode: plan.resendMode,
    sendKey: plan.idempotency.sendKey,
    baseKey: plan.idempotency.baseKey,
  }
}

function buildDispatchPayload(args: {
  metadata: Prisma.InputJsonObject
  token: ClientActionIssuedToken
}): Prisma.InputJsonObject {
  return {
    ...args.metadata,
    clientActionTokenId: args.token.id,
    expiresAt: args.token.expiresAt.toISOString(),
  }
}

function buildOrchestrationPlan(
  args: CreateAftercareAccessDeliveryArgs,
): ClientActionOrchestrationPlan {
  const orchestration = orchestrateClientActionDelivery({
    actionType: 'AFTERCARE_ACCESS',
    refs: {
      bookingId: args.bookingId,
      clientId: args.clientId,
      professionalId: args.professionalId,
      aftercareId: args.aftercareId,
      consultationApprovalId: null,
      inviteId: null,
    },
    recipient: {
      clientId: args.clientId,
      professionalId: args.professionalId,
      userId: asTrimmedString(args.recipientUserId),
      invitedName: null,
      recipientEmail: asTrimmedString(args.recipientEmail),
      recipientPhone: asTrimmedString(args.recipientPhone),
      preferredContactMethod: args.preferredContactMethod ?? null,
      timeZone: asTrimmedString(args.recipientTimeZone),
    },
    resendMode: normalizeResendMode(args.resendMode),
    // Each aftercare send bumps the version; using it as the send-cycle
    // discriminator makes every resend a fresh delivery instead of deduping
    // against the prior send.
    sendVersion:
      typeof args.aftercareVersion === 'number'
        ? String(args.aftercareVersion)
        : null,
    issuedByUserId: asTrimmedString(args.issuedByUserId),
    expiresAtOverride: args.expiresAtOverride ?? null,
    metadata: null,
    tx: args.tx,
  })

  if (!orchestration.ok) {
    throw new Error(
      `createAftercareAccessDelivery: ${orchestration.code} ${orchestration.error}`,
    )
  }

  return orchestration.plan
}

async function revokeOutstandingAftercareTokens(args: {
  tx: Prisma.TransactionClient
  plan: ClientActionOrchestrationPlan
  bookingId: string
  aftercareId: string
}): Promise<void> {
  if (args.plan.resendMode !== 'RESEND') {
    return
  }

  await args.tx.clientActionToken.updateMany({
    where: {
      kind: ClientActionTokenKind.AFTERCARE_ACCESS,
      bookingId: args.bookingId,
      aftercareSummaryId: args.aftercareId,
      clientId: args.plan.recipient.clientId,
      professionalId: requireRecipientProfessionalId(args.plan.recipient),
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokeReason: 'Aftercare access link resent; previous token revoked.',
    },
  })
}

async function issueAftercareAccessToken(args: {
  tx: Prisma.TransactionClient
  plan: ClientActionOrchestrationPlan
  bookingId: string
  aftercareId: string
  metadata: Prisma.InputJsonValue
}): Promise<ClientActionIssuedToken> {
  const expiresAtResult = resolveClientActionExpiresAt({
    actionType: 'AFTERCARE_ACCESS',
    now: new Date(),
    expiresAtOverride: args.plan.expiresAtOverride,
  })

  if (!expiresAtResult.ok || !expiresAtResult.value) {
    const detail = expiresAtResult.ok
      ? 'AFTERCARE_ACCESS resolved to a null expiresAt unexpectedly.'
      : `${expiresAtResult.code} ${expiresAtResult.error}`

    throw new Error(`createAftercareAccessDelivery: ${detail}`)
  }

  const rawToken = generateClientActionToken()
  const tokenHash = hashClientActionToken(rawToken)

  const created = await args.tx.clientActionToken.create({
    data: {
      kind: ClientActionTokenKind.AFTERCARE_ACCESS,
      tokenHash,
      singleUse: false,
      bookingId: args.bookingId,
      aftercareSummaryId: args.aftercareId,
      consultationApprovalId: null,
      clientId: args.plan.recipient.clientId,
      professionalId: requireRecipientProfessionalId(args.plan.recipient),
      deliveryMethod: args.plan.resolvedDelivery.method,
      recipientEmailSnapshot: asTrimmedString(
        args.plan.recipient.recipientEmail,
      ),
      recipientPhoneSnapshot: asTrimmedString(
        args.plan.recipient.recipientPhone,
      ),
      issuedByUserId: args.plan.issuedByUserId,
      expiresAt: expiresAtResult.value,
      metadata: toNullableJsonCreateInput(args.metadata),
    },
    select: {
      id: true,
      expiresAt: true,
    },
  })

  return {
    id: created.id,
    rawToken,
    expiresAt: created.expiresAt,
  }
}

export async function createAftercareAccessDelivery(
  args: CreateAftercareAccessDeliveryArgs,
): Promise<CreateAftercareAccessDeliveryResult> {
  const plan = buildOrchestrationPlan(args)
  const metadata = buildAftercareMetadata(args, plan)

  await revokeOutstandingAftercareTokens({
    tx: args.tx,
    plan,
    bookingId: args.bookingId,
    aftercareId: args.aftercareId,
  })

  const token = await issueAftercareAccessToken({
    tx: args.tx,
    plan,
    bookingId: args.bookingId,
    aftercareId: args.aftercareId,
    metadata,
  })

  const link = buildClientActionLinkForType({
    actionType: 'AFTERCARE_ACCESS',
    rawToken: token.rawToken,
  })

  const planWithMetadata: ClientActionOrchestrationPlan = {
    ...plan,
    metadata,
  }

  const dispatch = await enqueueClientActionDispatch({
    plan: planWithMetadata,
    href: link.href,
    title: buildAftercareTitle(),
    body: buildAftercareBody(),
    payload: buildDispatchPayload({
      metadata,
      token,
    }),
    tx: args.tx,
  })

  return {
    plan: planWithMetadata,
    token,
    link,
    dispatch,
  }
}