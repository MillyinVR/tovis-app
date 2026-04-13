// lib/clientActions/createAftercareAccessDelivery.ts

import {
  ClientActionTokenKind,
  ContactMethod,
  Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  generateClientActionToken,
  hashClientActionToken,
} from '@/lib/consultation/clientActionTokens'

import { buildClientActionLinkForType } from './linkBuilders'
import { enqueueClientActionDispatch } from './enqueueClientActionDispatch'
import { orchestrateClientActionDelivery } from './orchestrateClientActionDelivery'
import { resolveClientActionExpiresAt } from './policies'
import type {
  ClientActionBuildLinkResult,
  ClientActionIssuedToken,
  ClientActionOrchestrationPlan,
  ClientActionResendMode,
} from './types'

type DbClient = Prisma.TransactionClient | typeof prisma

export type CreateAftercareAccessDeliveryArgs = {
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

  tx?: Prisma.TransactionClient
}

export type CreateAftercareAccessDeliveryResult = {
  plan: ClientActionOrchestrationPlan
  token: ClientActionIssuedToken
  link: ClientActionBuildLinkResult
  dispatch: Awaited<ReturnType<typeof enqueueClientActionDispatch>>
}

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
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

function toNullableJsonCreateInput(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value
}

function buildAftercareTitle(): string {
  return 'Your aftercare is ready'
}

function buildAftercareBody(): string {
  return 'Use this secure link to view your aftercare summary and rebook when you are ready.'
}

function buildAftercareMetadata(
  args: Pick<
    CreateAftercareAccessDeliveryArgs,
    'professionalId' | 'clientId' | 'bookingId' | 'aftercareId' | 'aftercareVersion'
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
      `createAftercareAccessDelivery: ${orchestration.code} ${orchestration.error}`,
    )
  }

  return orchestration.plan
}

async function revokeOutstandingAftercareTokens(args: {
  db: DbClient
  plan: ClientActionOrchestrationPlan
  bookingId: string
  aftercareId: string
}): Promise<void> {
  if (args.plan.resendMode !== 'RESEND') {
    return
  }

  await args.db.clientActionToken.updateMany({
    where: {
      kind: ClientActionTokenKind.AFTERCARE_ACCESS,
      bookingId: args.bookingId,
      aftercareSummaryId: args.aftercareId,
      clientId: args.plan.recipient.clientId,
      professionalId: args.plan.recipient.professionalId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokeReason: 'Aftercare access link resent; previous token revoked.',
    },
  })
}

async function issueAftercareAccessToken(args: {
  db: DbClient
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

  const created = await args.db.clientActionToken.create({
    data: {
      kind: ClientActionTokenKind.AFTERCARE_ACCESS,
      tokenHash,
      singleUse: false,
      bookingId: args.bookingId,
      aftercareSummaryId: args.aftercareId,
      consultationApprovalId: null,
      clientId: args.plan.recipient.clientId,
      professionalId: args.plan.recipient.professionalId,
      deliveryMethod: args.plan.resolvedDelivery.method,
      recipientEmailSnapshot: normalizeOptionalString(
        args.plan.recipient.recipientEmail,
      ),
      recipientPhoneSnapshot: normalizeOptionalString(
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
  const db = getDb(args.tx)
  const plan = buildOrchestrationPlan(args)
  const metadata = buildAftercareMetadata(args, plan)

  await revokeOutstandingAftercareTokens({
    db,
    plan,
    bookingId: args.bookingId,
    aftercareId: args.aftercareId,
  })

  const token = await issueAftercareAccessToken({
    db,
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