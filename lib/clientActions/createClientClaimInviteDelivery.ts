// lib/clientActions/createClientClaimInviteDelivery.ts

import { ContactMethod, Prisma } from '@prisma/client'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { asTrimmedString } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import {
  pickProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { formatBookingWhenClause } from '@/lib/booking/notificationCopy'
import { DEFAULT_TIME_ZONE } from '@/lib/time'
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

// §12 NC1 #39: this is the client's highest-stakes first touch, so lead with the
// PRO (their actual relationship), falling back to the brand only when the pro
// name is unavailable.
function buildInviteTitle(args: {
  proName: string | null
  brandName: string
}): string {
  return args.proName
    ? `You're booked with ${args.proName}`
    : `You've been booked with ${args.brandName}`
}

function buildInviteBody(args: {
  invitedName: string | null
  proName: string | null
  serviceName: string | null
  whenClause: string
  brandName: string
}): string {
  const invitedName = asTrimmedString(args.invitedName)
  const lead = invitedName ? `${invitedName}, your` : 'Your'
  const withWhom = args.proName ?? args.brandName
  const service = args.serviceName?.trim() || 'appointment'

  return `${lead} ${service} with ${withWhom}${args.whenClause} is booked. Tap to view details and set up your profile.`
}

async function loadInviteBookingContext(
  db: Prisma.TransactionClient | typeof prisma,
  bookingId: string,
): Promise<{
  proName: string | null
  serviceName: string | null
  scheduledFor: Date | null
  timeZone: string
}> {
  const booking = await db.booking
    .findUnique({
      where: { id: bookingId },
      select: {
        scheduledFor: true,
        locationTimeZone: true,
        service: { select: { name: true } },
        professional: {
          select: { timeZone: true, ...professionalPublicDisplayNameSelect },
        },
      },
    })
    .catch(() => null)

  if (!booking) {
    return {
      proName: null,
      serviceName: null,
      scheduledFor: null,
      timeZone: DEFAULT_TIME_ZONE,
    }
  }

  return {
    proName: pickProfessionalPublicDisplayName(booking.professional),
    serviceName: booking.service?.name ?? null,
    scheduledFor: booking.scheduledFor ?? null,
    timeZone:
      booking.locationTimeZone ||
      booking.professional?.timeZone ||
      DEFAULT_TIME_ZONE,
  }
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
  const bookingContext = await loadInviteBookingContext(
    args.tx ?? prisma,
    args.bookingId,
  )
  const whenClause = formatBookingWhenClause(
    bookingContext.scheduledFor,
    bookingContext.timeZone,
  )

  const link = buildClientActionLinkForType({
    actionType: 'CLIENT_CLAIM_INVITE',
    rawToken: args.rawToken,
  })

  const dispatch = await enqueueClientActionDispatch({
    plan,
    href: link.href,
    title: buildInviteTitle({
      proName: bookingContext.proName,
      brandName: brand.displayName,
    }),
    body: buildInviteBody({
      invitedName: asTrimmedString(args.invitedName),
      proName: bookingContext.proName,
      serviceName: bookingContext.serviceName,
      whenClause,
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