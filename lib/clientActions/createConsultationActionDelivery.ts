// lib/clientActions/createConsultationActionDelivery.ts

import { ContactMethod, Prisma } from '@prisma/client'

import {
  issueConsultationActionToken,
  revokeConsultationActionTokensForBooking,
} from '@/lib/consultation/clientActionTokens'

import { buildClientActionLinkForType } from './linkBuilders'
import { enqueueClientActionDispatch } from './enqueueClientActionDispatch'
import { orchestrateClientActionDelivery } from './orchestrateClientActionDelivery'
import type {
  ClientActionBuildLinkResult,
  ClientActionIssuedToken,
  ClientActionOrchestrationPlan,
  ClientActionResendMode,
} from './types'

export type CreateConsultationActionDeliveryArgs = {
  professionalId: string
  clientId: string
  bookingId: string
  consultationApprovalId: string

  recipientEmail?: string | null
  recipientPhone?: string | null
  preferredContactMethod?: ContactMethod | null

  issuedByUserId?: string | null
  recipientUserId?: string | null
  recipientTimeZone?: string | null

  resendMode?: ClientActionResendMode
  expiresAtOverride?: Date | null

  tx?: Prisma.TransactionClient
}

export type CreateConsultationActionDeliveryResult = {
  plan: ClientActionOrchestrationPlan
  token: ClientActionIssuedToken
  link: ClientActionBuildLinkResult
  dispatch: Awaited<ReturnType<typeof enqueueClientActionDispatch>>
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeResendMode(
  value: ClientActionResendMode | null | undefined,
): ClientActionResendMode {
  return value ?? 'INITIAL_SEND'
}

function buildConsultationTitle(): string {
  return 'Consultation proposal ready'
}

function buildConsultationBody(): string {
  return 'Review your updated service proposal and approve or decline it through this secure link.'
}

function buildConsultationMetadata(
  args: Pick<
    CreateConsultationActionDeliveryArgs,
    'professionalId' | 'clientId' | 'bookingId' | 'consultationApprovalId'
  >,
  plan: ClientActionOrchestrationPlan,
): Prisma.InputJsonObject {
  return {
    source: 'consultationApproval',
    actionType: 'CONSULTATION_ACTION',
    professionalId: args.professionalId,
    clientId: args.clientId,
    bookingId: args.bookingId,
    consultationApprovalId: args.consultationApprovalId,
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
  args: CreateConsultationActionDeliveryArgs,
): ClientActionOrchestrationPlan {
  const orchestration = orchestrateClientActionDelivery({
    actionType: 'CONSULTATION_ACTION',
    refs: {
      bookingId: args.bookingId,
      clientId: args.clientId,
      professionalId: args.professionalId,
      consultationApprovalId: args.consultationApprovalId,
      aftercareId: null,
      inviteId: null,
    },
    recipient: {
      clientId: args.clientId,
      professionalId: args.professionalId,
      userId: normalizeOptionalString(args.recipientUserId),
      invitedName: null,
      recipientEmail: normalizeOptionalString(args.recipientEmail),
      recipientPhone: normalizeOptionalString(args.recipientPhone),
      preferredContactMethod: args.preferredContactMethod ?? null,
      timeZone: normalizeOptionalString(args.recipientTimeZone),
    },
    resendMode: normalizeResendMode(args.resendMode),
    issuedByUserId: normalizeOptionalString(args.issuedByUserId),
    expiresAtOverride: args.expiresAtOverride ?? null,
    metadata: null,
    tx: args.tx,
  })

  if (!orchestration.ok) {
    throw new Error(
      `createConsultationActionDelivery: ${orchestration.code} ${orchestration.error}`,
    )
  }

  return orchestration.plan
}

async function maybeRevokeOutstandingConsultationTokens(args: {
  plan: ClientActionOrchestrationPlan
  bookingId: string
  tx?: Prisma.TransactionClient
}): Promise<void> {
  if (args.plan.resendMode !== 'RESEND') {
    return
  }

  await revokeConsultationActionTokensForBooking({
    bookingId: args.bookingId,
    revokeReason: 'Consultation proposal resent; previous token revoked.',
    tx: args.tx,
  })
}

async function issueConsultationToken(args: {
  plan: ClientActionOrchestrationPlan
  bookingId: string
  consultationApprovalId: string
  metadata: Prisma.InputJsonValue
  tx?: Prisma.TransactionClient
}): Promise<ClientActionIssuedToken> {
  const issued = await issueConsultationActionToken({
    bookingId: args.bookingId,
    consultationApprovalId: args.consultationApprovalId,
    clientId: args.plan.recipient.clientId,
    professionalId: args.plan.recipient.professionalId,
    issuedByUserId: args.plan.issuedByUserId,
    deliveryMethod: args.plan.resolvedDelivery.method,
    recipientEmailSnapshot: normalizeOptionalString(
      args.plan.recipient.recipientEmail,
    ),
    recipientPhoneSnapshot: normalizeOptionalString(
      args.plan.recipient.recipientPhone,
    ),
    expiresAt: args.plan.expiresAtOverride,
    metadata: args.metadata,
    tx: args.tx,
  })

  return {
    id: issued.id,
    rawToken: issued.rawToken,
    expiresAt: issued.expiresAt,
  }
}

export async function createConsultationActionDelivery(
  args: CreateConsultationActionDeliveryArgs,
): Promise<CreateConsultationActionDeliveryResult> {
  const plan = buildOrchestrationPlan(args)
  const metadata = buildConsultationMetadata(args, plan)

  await maybeRevokeOutstandingConsultationTokens({
    plan,
    bookingId: args.bookingId,
    tx: args.tx,
  })

  const token = await issueConsultationToken({
    plan,
    bookingId: args.bookingId,
    consultationApprovalId: args.consultationApprovalId,
    metadata,
    tx: args.tx,
  })

  const link = buildClientActionLinkForType({
    actionType: 'CONSULTATION_ACTION',
    rawToken: token.rawToken,
  })

  const planWithMetadata: ClientActionOrchestrationPlan = {
    ...plan,
    metadata,
  }

  const dispatch = await enqueueClientActionDispatch({
    plan: planWithMetadata,
    href: link.href,
    title: buildConsultationTitle(),
    body: buildConsultationBody(),
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