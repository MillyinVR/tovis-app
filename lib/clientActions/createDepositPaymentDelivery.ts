// lib/clientActions/createDepositPaymentDelivery.ts
//
// K10-B: mint + deliver the secure deposit pay link for a pro-created booking.
//
// A pro-created client is often UNCLAIMED (ClientProfile.userId null) and can
// never pass requireClient() on the authed deposit checkout route, so the pay
// surface is an unauthenticated token page (/client/deposit/<token>) reached
// via EMAIL/SMS — the same rail the aftercare rebook link rides. The token is
// NOT single-use (the client may open Checkout, bail, and come back); payment
// completion is enforced by the booking's depositStatus, and the token expires
// at max(depositDueAt, scheduledFor) so a link never meaningfully outlives the
// deposit it collects.
//
// Call inside the pro-create write-boundary transaction, AFTER the deposit is
// stamped on the booking row — the enqueue writes dispatch rows on the same tx,
// so a refused create can never have sent a pay link.

import { ClientActionTokenKind, ContactMethod, Prisma } from '@prisma/client'

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
} from './types'
import { toNullableJsonCreateInput } from '@/lib/typed/prismaJson'

export type CreateDepositPaymentDeliveryArgs = {
  tx: Prisma.TransactionClient

  professionalId: string
  clientId: string
  bookingId: string

  /** Preformatted money string, e.g. "$50.00" (lib/money). */
  depositAmountLabel: string | null
  /** Preformatted release deadline in the appointment's timezone. */
  payByLabel: string
  /** Token lifetime: pass max(depositDueAt, scheduledFor). */
  expiresAt: Date

  recipientEmail?: string | null
  recipientPhone?: string | null
  preferredContactMethod?: ContactMethod | null

  issuedByUserId?: string | null
  recipientUserId?: string | null
  recipientTimeZone?: string | null

  professionalName: string | null
}

export type CreateDepositPaymentDeliveryResult = {
  plan: ClientActionOrchestrationPlan
  token: ClientActionIssuedToken
  link: ClientActionBuildLinkResult
  dispatch: Awaited<ReturnType<typeof enqueueClientActionDispatch>>
}

function buildDepositPaymentTitle(amountLabel: string | null): string {
  return amountLabel ? `Pay your ${amountLabel} deposit` : 'Pay your deposit'
}

function buildDepositPaymentBody(args: {
  professionalName: string | null
  payByLabel: string
}): string {
  const withWhom = args.professionalName ? ` with ${args.professionalName}` : ''

  return (
    `Your appointment${withWhom} is booked. ` +
    `Use this secure link to pay the deposit by ${args.payByLabel} — ` +
    `the booking is released automatically if it stays unpaid.`
  )
}

function buildDepositPaymentMetadata(
  args: Pick<
    CreateDepositPaymentDeliveryArgs,
    'professionalId' | 'clientId' | 'bookingId'
  >,
  plan: ClientActionOrchestrationPlan,
): Prisma.InputJsonObject {
  return {
    source: 'proCreatedDeposit',
    actionType: 'DEPOSIT_PAYMENT',
    professionalId: args.professionalId,
    clientId: args.clientId,
    bookingId: args.bookingId,
    resendMode: plan.resendMode,
    sendKey: plan.idempotency.sendKey,
    baseKey: plan.idempotency.baseKey,
  }
}

function buildOrchestrationPlan(
  args: CreateDepositPaymentDeliveryArgs,
): ClientActionOrchestrationPlan {
  const orchestration = orchestrateClientActionDelivery({
    actionType: 'DEPOSIT_PAYMENT',
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
      recipientEmail: asTrimmedString(args.recipientEmail),
      recipientPhone: asTrimmedString(args.recipientPhone),
      preferredContactMethod: args.preferredContactMethod ?? null,
      timeZone: asTrimmedString(args.recipientTimeZone),
    },
    resendMode: 'INITIAL_SEND',
    sendVersion: null,
    issuedByUserId: asTrimmedString(args.issuedByUserId),
    expiresAtOverride: args.expiresAt,
    metadata: null,
    tx: args.tx,
  })

  if (!orchestration.ok) {
    throw new Error(
      `createDepositPaymentDelivery: ${orchestration.code} ${orchestration.error}`,
    )
  }

  return orchestration.plan
}

async function issueDepositPaymentToken(args: {
  tx: Prisma.TransactionClient
  plan: ClientActionOrchestrationPlan
  bookingId: string
  metadata: Prisma.InputJsonValue
}): Promise<ClientActionIssuedToken> {
  const expiresAtResult = resolveClientActionExpiresAt({
    actionType: 'DEPOSIT_PAYMENT',
    now: new Date(),
    expiresAtOverride: args.plan.expiresAtOverride,
  })

  if (!expiresAtResult.ok || !expiresAtResult.value) {
    const detail = expiresAtResult.ok
      ? 'DEPOSIT_PAYMENT resolved to a null expiresAt unexpectedly.'
      : `${expiresAtResult.code} ${expiresAtResult.error}`

    throw new Error(`createDepositPaymentDelivery: ${detail}`)
  }

  const rawToken = generateClientActionToken()
  const tokenHash = hashClientActionToken(rawToken)

  const created = await args.tx.clientActionToken.create({
    data: {
      kind: ClientActionTokenKind.DEPOSIT_PAYMENT,
      tokenHash,
      singleUse: false,
      bookingId: args.bookingId,
      aftercareSummaryId: null,
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

export async function createDepositPaymentDelivery(
  args: CreateDepositPaymentDeliveryArgs,
): Promise<CreateDepositPaymentDeliveryResult> {
  const plan = buildOrchestrationPlan(args)
  const metadata = buildDepositPaymentMetadata(args, plan)

  const token = await issueDepositPaymentToken({
    tx: args.tx,
    plan,
    bookingId: args.bookingId,
    metadata,
  })

  const link = buildClientActionLinkForType({
    actionType: 'DEPOSIT_PAYMENT',
    rawToken: token.rawToken,
  })

  const planWithMetadata: ClientActionOrchestrationPlan = {
    ...plan,
    metadata,
  }

  const dispatch = await enqueueClientActionDispatch({
    plan: planWithMetadata,
    href: link.href,
    title: buildDepositPaymentTitle(args.depositAmountLabel),
    body: buildDepositPaymentBody({
      professionalName: args.professionalName,
      payByLabel: args.payByLabel,
    }),
    payload: {
      ...metadata,
      clientActionTokenId: token.id,
      expiresAt: token.expiresAt.toISOString(),
    },
    tx: args.tx,
  })

  return {
    plan: planWithMetadata,
    token,
    link,
    dispatch,
  }
}
