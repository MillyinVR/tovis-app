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

import {
  ClientActionTokenKind,
  ContactMethod,
  NotificationDeliveryStatus,
  Prisma,
} from '@prisma/client'

import {
  generateClientActionToken,
  hashClientActionToken,
} from '@/lib/consultation/clientActionTokens'
import { asTrimmedString } from '@/lib/guards'
import { formatDatedAppointmentWhen } from '@/lib/time'

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
  /**
   * The stamped release deadline (Booking.depositDueAt). Rendered into the
   * copy by formatDepositPayByLabel in the location's timezone — formatted
   * HERE, not by the caller, so no call site can hand the templates an
   * unformatted or wrong-zone deadline.
   */
  depositDueAt: Date
  /** The appointment location's IANA zone the deadline renders in. */
  locationTimeZone: string | null
  /** Token lifetime: pass max(depositDueAt, scheduledFor). */
  expiresAt: Date
  /**
   * K10-B-1: when set, a SECOND dispatch of the same link is scheduled at this
   * instant (the DEPOSIT_REMINDER runAt — computeDepositReminderRunAt) as the
   * pre-release nudge for UNCLAIMED clients, who can't use the login-gated
   * DEPOSIT_REMINDER (no in-app inbox, email suppressed on the unverified
   * destination, no SMS channel). ⚠️ The dispatch drain does NOT revalidate
   * deposit state at send time, so every state change that makes the nudge a
   * lie must call cancelDepositPaymentNudgeDispatch (today: the deposit-paid
   * webhook applier, and performLockedCancel — which the release sweep rides).
   */
  nudgeRunAt?: Date | null

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
  /** The scheduled pre-release nudge, when nudgeRunAt was set. */
  nudgeDispatch: Awaited<ReturnType<typeof enqueueClientActionDispatch>> | null
}

/**
 * The release deadline as the client reads it — in the appointment location's
 * zone, e.g. "Fri, Aug 14, 2026, 7:30 PM". Exported so the render tests prove
 * the delivered copy through the exact formatter the boundary path uses.
 */
export function formatDepositPayByLabel(
  dueAt: Date,
  timeZone: string | null,
): string {
  // formatInTimeZone sanitizes: a missing/invalid zone falls back to UTC.
  return formatDatedAppointmentWhen(dueAt, timeZone ?? '', 'en-US')
}

export function buildDepositPaymentTitle(amountLabel: string | null): string {
  return amountLabel ? `Pay your ${amountLabel} deposit` : 'Pay your deposit'
}

export function buildDepositPaymentBody(args: {
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

export function buildDepositPaymentNudgeTitle(
  amountLabel: string | null,
): string {
  return amountLabel
    ? `Reminder: pay your ${amountLabel} deposit`
    : 'Reminder: pay your deposit'
}

export function buildDepositPaymentNudgeBody(args: {
  professionalName: string | null
  payByLabel: string
}): string {
  const withWhom = args.professionalName ? ` with ${args.professionalName}` : ''

  // Tighter than the initial-send body ON PURPOSE: this rides SMS where the
  // render caps the message and clips prose around the link — the deadline and
  // the consequence must survive a real-world professionalName.
  return (
    `Your appointment${withWhom} is still waiting on its deposit. ` +
    `Pay by ${args.payByLabel} — ` +
    `the booking is released automatically if it stays unpaid.`
  )
}

/**
 * The nudge dispatch's idempotency/source key. Deterministic from the booking
 * id alone ON PURPOSE: the cancellation paths (the deposit-paid webhook
 * applier, performLockedCancel) only hold a bookingId, and this is how they
 * find the row. One nudge per booking — the enqueue layer dedupes on it.
 */
export function buildDepositPaymentNudgeSourceKey(bookingId: string): string {
  return `deposit-payment-nudge:${bookingId}`
}

/**
 * Stamp the scheduled pre-release nudge (and its not-yet-attempted deliveries)
 * cancelled. The generic dispatch drain has NO drain-time revalidation — the
 * claim query only checks dispatch.cancelledAt — so the moment the nudge stops
 * being true (deposit paid, booking cancelled/released) the state-change path
 * must call this. Safe to call unconditionally: no matching row is a no-op.
 */
export async function cancelDepositPaymentNudgeDispatch(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  now?: Date
}): Promise<void> {
  const now = args.now ?? new Date()
  const sourceKey = buildDepositPaymentNudgeSourceKey(args.bookingId)

  await args.tx.notificationDelivery.updateMany({
    where: {
      dispatch: { sourceKey },
      status: NotificationDeliveryStatus.PENDING,
      cancelledAt: null,
      sentAt: null,
    },
    data: {
      status: NotificationDeliveryStatus.CANCELLED,
      cancelledAt: now,
    },
  })

  await args.tx.notificationDispatch.updateMany({
    where: { sourceKey, cancelledAt: null },
    data: { cancelledAt: now },
  })
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

  const payByLabel = formatDepositPayByLabel(
    args.depositDueAt,
    args.locationTimeZone,
  )

  const payload: Prisma.InputJsonObject = {
    ...metadata,
    clientActionTokenId: token.id,
    expiresAt: token.expiresAt.toISOString(),
  }

  const dispatch = await enqueueClientActionDispatch({
    plan: planWithMetadata,
    href: link.href,
    title: buildDepositPaymentTitle(args.depositAmountLabel),
    body: buildDepositPaymentBody({
      professionalName: args.professionalName,
      payByLabel,
    }),
    payload,
    tx: args.tx,
  })

  const nudgeDispatch = args.nudgeRunAt
    ? await enqueueClientActionDispatch({
        plan: planWithMetadata,
        href: link.href,
        title: buildDepositPaymentNudgeTitle(args.depositAmountLabel),
        body: buildDepositPaymentNudgeBody({
          professionalName: args.professionalName,
          payByLabel,
        }),
        payload: { ...payload, nudge: true },
        scheduledFor: args.nudgeRunAt,
        sourceKeyOverride: buildDepositPaymentNudgeSourceKey(args.bookingId),
        tx: args.tx,
      })
    : null

  return {
    plan: planWithMetadata,
    token,
    link,
    dispatch,
    nudgeDispatch,
  }
}
