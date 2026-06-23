// lib/clientActions/createClientClaimInviteDelivery.ts

import { ContactMethod, Prisma } from '@prisma/client'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { asTrimmedString } from '@/lib/guards'
import type { TenantContext } from '@/lib/tenant/context'

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
  tenantContext: TenantContext

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

function buildInviteTitle(args: { brandName: string }): string {
  return `You’ve been booked with ${args.brandName}`
}

function buildInviteBody(args: {
  invitedName: string | null
  brandName: string
}): string {
  const invitedName = asTrimmedString(args.invitedName)

  if (invitedName) {
    return `${invitedName}, your appointment with ${args.brandName} is booked. Tap to view your booking details and finish setting up your profile.`
  }

  return `Your appointment with ${args.brandName} is booked. Tap to view your booking details and finish setting up your profile.`
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
      userId: asTrimmedString(args.recipientUserId),
      invitedName: asTrimmedString(args.invitedName),
      recipientEmail: asTrimmedString(args.invitedEmail),
      recipientPhone: asTrimmedString(args.invitedPhone),
      preferredContactMethod: args.preferredContactMethod ?? null,
      timeZone: asTrimmedString(args.recipientTimeZone),
    },
    resendMode: 'INITIAL_SEND',
    issuedByUserId: asTrimmedString(args.issuedByUserId),
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
  const brand = getBrandForTenantContext(args.tenantContext)

  const link = buildClientActionLinkForType({
    actionType: 'CLIENT_CLAIM_INVITE',
    rawToken: args.rawToken,
  })

  const dispatch = await enqueueClientActionDispatch({
    plan,
    href: link.href,
    title: buildInviteTitle({ brandName: brand.displayName }),
    body: buildInviteBody({
      invitedName: asTrimmedString(args.invitedName),
      brandName: brand.displayName,
    }),
    payload: buildInvitePayload(args),
    tx: args.tx,
  })

  return {
    plan,
    link,
    dispatch,
  }
}