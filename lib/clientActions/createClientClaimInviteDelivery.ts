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
  // Nullable: a claim invite can be pro-less (cold self-serve) and/or
  // booking-less (directory-created / migration-imported client).
  professionalId: string | null
  clientId: string
  bookingId: string | null
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
// name is unavailable. Booking-less invites (no appointment) get profile-claim
// copy instead of "you're booked".
function buildInviteTitle(args: {
  proName: string | null
  brandName: string
  hasBooking: boolean
}): string {
  if (args.hasBooking) {
    return args.proName
      ? `You're booked with ${args.proName}`
      : `You've been booked with ${args.brandName}`
  }
  return args.proName
    ? `${args.proName} added you on ${args.brandName}`
    : `Claim your ${args.brandName} account`
}

function buildInviteBody(args: {
  invitedName: string | null
  proName: string | null
  serviceName: string | null
  whenClause: string
  brandName: string
  hasBooking: boolean
}): string {
  const invitedName = asTrimmedString(args.invitedName)

  if (args.hasBooking) {
    const lead = invitedName ? `${invitedName}, your` : 'Your'
    const withWhom = args.proName ?? args.brandName
    const service = args.serviceName?.trim() || 'appointment'
    return `${lead} ${service} with ${withWhom}${args.whenClause} is booked. Tap to view details and set up your profile.`
  }

  // Booking-less, pro attributed: a pro added/imported this client.
  if (args.proName) {
    const lead = invitedName ? `${invitedName}, ` : ''
    return `${lead}${args.proName} added you as a client on ${args.brandName}. Tap to set up your profile and keep your history together.`
  }

  // Booking-less, pro-less (cold self-serve): brand-level.
  const opener = invitedName ? `${invitedName}, we` : 'We'
  return `${opener} found existing history for your contact on ${args.brandName}. Tap to claim your account and keep your history together.`
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

/**
 * Resolve just the pro's public display name for a booking-less invite (there's
 * no booking to read it from). Null when the invite is pro-less.
 */
async function loadInviteProfessionalName(
  db: Prisma.TransactionClient | typeof prisma,
  professionalId: string | null,
): Promise<string | null> {
  if (!professionalId) {
    return null
  }

  const professional = await db.professionalProfile
    .findUnique({
      where: { id: professionalId },
      select: professionalPublicDisplayNameSelect,
    })
    .catch(() => null)

  return professional ? pickProfessionalPublicDisplayName(professional) : null
}

function buildInvitePayload(
  args: Pick<
    CreateClientClaimInviteDeliveryArgs,
    'professionalId' | 'clientId' | 'bookingId' | 'inviteId'
  >,
): Prisma.InputJsonValue {
  // Omit null pro/booking (JSON metadata carries only known refs).
  return {
    source: 'proClientInvite',
    actionType: 'CLIENT_CLAIM_INVITE',
    clientId: args.clientId,
    inviteId: args.inviteId,
    ...(args.professionalId ? { professionalId: args.professionalId } : {}),
    ...(args.bookingId ? { bookingId: args.bookingId } : {}),
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
  const db = args.tx ?? prisma
  const hasBooking = args.bookingId != null

  // Booking-bearing invites read the pro/service/when from the booking;
  // booking-less invites resolve just the pro name (null when pro-less).
  const bookingContext = args.bookingId
    ? await loadInviteBookingContext(db, args.bookingId)
    : {
        proName: await loadInviteProfessionalName(db, args.professionalId),
        serviceName: null,
        scheduledFor: null,
        timeZone: DEFAULT_TIME_ZONE,
      }
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
      hasBooking,
    }),
    body: buildInviteBody({
      invitedName: asTrimmedString(args.invitedName),
      proName: bookingContext.proName,
      serviceName: bookingContext.serviceName,
      whenClause,
      brandName: brand.displayName,
      hasBooking,
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