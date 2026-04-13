// lib/clientActions/createClientClaimInviteDelivery.ts

import {
  ContactMethod,
  NotificationEventKey,
  Prisma,
} from '@prisma/client'

import { buildClientActionLinkForType } from './linkBuilders'
import { enqueueClientActionDispatch } from './enqueueClientActionDispatch'
import { orchestrateClientActionDelivery } from './orchestrateClientActionDelivery'
import type {
  ClientActionBuildLinkResult,
  ClientActionOrchestrationPlan,
} from './types'

export type CreateClientClaimInviteDeliveryArgs = {
  professionalId: string
  clientId: string
  bookingId: string
  inviteId: string
  rawToken: string

  invitedName?: string | null
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null

  issuedByUserId?: string | null
  recipientUserId?: string | null
  recipientTimeZone?: string | null

  tx?: Prisma.TransactionClient
}

export type CreateClientClaimInviteDeliveryResult = {
  plan: ClientActionOrchestrationPlan
  link: ClientActionBuildLinkResult
  dispatch: Awaited<ReturnType<typeof enqueueClientActionDispatch>>
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildInviteTitle(): string {
  return 'Claim your TOVIS profile'
}

function buildInviteBody(args: { invitedName: string | null }): string {
  const invitedName = normalizeOptionalString(args.invitedName)

  if (invitedName) {
    return `${invitedName}, you’ve been invited to claim your TOVIS client profile and access your booking details.`
  }

  return 'You’ve been invited to claim your TOVIS client profile and access your booking details.'
}

function buildInvitePayload(
  args: Pick<
    CreateClientClaimInviteDeliveryArgs,
    'professionalId' | 'clientId' | 'bookingId' | 'inviteId'
  >,
): Prisma.InputJsonValue {
  return {
    source: 'proClientInvite',
    actionType: 'CLIENT_CLAIM_INVITE',
    professionalId: args.professionalId,
    clientId: args.clientId,
    bookingId: args.bookingId,
    inviteId: args.inviteId,
  } satisfies Prisma.InputJsonObject
}

function buildOrchestrationPlan(
  args: CreateClientClaimInviteDeliveryArgs,
): ClientActionOrchestrationPlan {
  const orchestration = orchestrateClientActionDelivery({
    actionType: 'CLIENT_CLAIM_INVITE',
    refs: {
      bookingId: args.bookingId,
      clientId: args.clientId,
      professionalId: args.professionalId,
      inviteId: args.inviteId,
      aftercareId: null,
      consultationApprovalId: null,
    },
    recipient: {
      clientId: args.clientId,
      professionalId: args.professionalId,
      userId: normalizeOptionalString(args.recipientUserId),
      invitedName: normalizeOptionalString(args.invitedName),
      recipientEmail: normalizeOptionalString(args.invitedEmail),
      recipientPhone: normalizeOptionalString(args.invitedPhone),
      preferredContactMethod: args.preferredContactMethod ?? null,
      timeZone: normalizeOptionalString(args.recipientTimeZone),
    },
    resendMode: 'INITIAL_SEND',
    issuedByUserId: normalizeOptionalString(args.issuedByUserId),
    expiresAtOverride: null,
    metadata: buildInvitePayload(args),
    tx: args.tx,
  })

  if (!orchestration.ok) {
    throw new Error(
      `createClientClaimInviteDelivery: ${orchestration.code} ${orchestration.error}`,
    )
  }

  return orchestration.plan
}

export async function createClientClaimInviteDelivery(
  args: CreateClientClaimInviteDeliveryArgs,
): Promise<CreateClientClaimInviteDeliveryResult> {
  const plan = buildOrchestrationPlan(args)

  const link = buildClientActionLinkForType({
    actionType: 'CLIENT_CLAIM_INVITE',
    rawToken: args.rawToken,
  })

  const dispatch = await enqueueClientActionDispatch({
    plan,
    href: link.href,
    title: buildInviteTitle(),
    body: buildInviteBody({
      invitedName: normalizeOptionalString(args.invitedName),
    }),
    payload: buildInvitePayload(args),
    eventKeyOverride: NotificationEventKey.CLIENT_CLAIM_INVITE,
    tx: args.tx,
  })

  return {
    plan,
    link,
    dispatch,
  }
}