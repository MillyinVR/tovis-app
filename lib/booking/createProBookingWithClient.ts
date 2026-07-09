import {
  ClientClaimStatus,
  ContactMethod,
  NotificationChannel,
  NotificationEventKey,
  NotificationRecipientKind,
  Prisma,
  ProClientInviteStatus,
  ServiceLocationType,
} from '@prisma/client'

import { createProBooking } from '@/lib/booking/writeBoundary'
import { buildBookingConfirmedClientCopy } from '@/lib/booking/notificationCopy'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { DEFAULT_TIME_ZONE } from '@/lib/time'
import { createClientClaimInviteDelivery } from '@/lib/clientActions/createClientClaimInviteDelivery'
import { upsertClientClaimLink } from '@/lib/clients/clientClaimLinks'
import { asTrimmedString, isRecord } from '@/lib/guards'
import { enqueueDispatch } from '@/lib/notifications/dispatch/enqueueDispatch'
import { prisma } from '@/lib/prisma'
import { checkProReadinessForEntryPoint } from '@/lib/pro/readiness/proReadiness'
import type { TenantContext } from '@/lib/tenant/context'

import {
  resolveProBookingClient,
  type ProBookingServiceAddressInput,
} from '@/lib/booking/resolveProBookingClient'

type NewClientInput = {
  firstName?: unknown
  lastName?: unknown
  email?: unknown
  phone?: unknown
}

const inviteClientSelect = {
  id: true,
  userId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  claimStatus: true,
} satisfies Prisma.ClientProfileSelect

type InviteClientSnapshot = Prisma.ClientProfileGetPayload<{
  select: typeof inviteClientSelect
}>

export type CreateProBookingWithClientArgs = {
  professionalId: string
  actorUserId: string
  tenantContext: TenantContext
  overrideReason: string | null
  requestId?: string | null
  idempotencyKey?: string | null

  clientId?: string | null
  client?: NewClientInput | null
  clientAddressId?: string | null
  serviceAddress?: ProBookingServiceAddressInput | null

  offeringId: string
  /** OfferingAddOn link ids to fold into the booking as ADD_ON line items. */
  addOnIds?: string[]
  locationId: string
  locationType: ServiceLocationType
  scheduledFor: Date
  internalNotes: string | null
  requestedBufferMinutes: number | null
  requestedTotalDurationMinutes: number | null
  allowOutsideWorkingHours: boolean
  allowShortNotice: boolean
  allowFarFuture: boolean
}

type CreateProBookingResult = Awaited<ReturnType<typeof createProBooking>>

type CreatedInviteResult = {
  id: string
  token: string | null
}

type CreatedInviteDeliveryCandidate = {
  id: string
  rawToken: string
  invitedName: string
  invitedEmail: string | null
  invitedPhone: string | null
  preferredContactMethod: ContactMethod | null
}

export type CreateProBookingWithClientResult =
  | {
      ok: true
      clientId: string
      clientUserId: string | null
      clientEmail: string | null
      clientClaimStatus: ClientClaimStatus
      clientAddressId: string | null
      bookingResult: CreateProBookingResult
      invite: CreatedInviteResult | null
    }
  | {
      ok: false
      status: number
      error: string
      code: string
    }

function normalizeClientInput(
  value: CreateProBookingWithClientArgs['client'],
): NewClientInput | null {
  if (!value) return null
  if (!isRecord(value)) return null

  return {
    firstName: value.firstName,
    lastName: value.lastName,
    email: value.email,
    phone: value.phone,
  }
}

function normalizeServiceAddressInput(
  value: CreateProBookingWithClientArgs['serviceAddress'],
): ProBookingServiceAddressInput | null {
  if (!value) return null
  if (!isRecord(value)) return null

  return value
}

function shouldAutoCreateInvite(args: {
  resolvedClientClaimStatus: ClientClaimStatus
}): boolean {
  return args.resolvedClientClaimStatus === ClientClaimStatus.UNCLAIMED
}

function buildInvitedName(client: InviteClientSnapshot | null): string | null {
  if (!client) return null

  const firstName = asTrimmedString(client.firstName)
  const lastName = asTrimmedString(client.lastName)
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

  return fullName || null
}

function inferPreferredContactMethod(args: {
  email: string | null
  phone: string | null
}): ContactMethod | null {
  if (args.email && !args.phone) return ContactMethod.EMAIL
  if (args.phone && !args.email) return ContactMethod.SMS

  return null
}

function toPublicInviteResult(
  invite: CreatedInviteDeliveryCandidate,
): CreatedInviteResult {
  return {
    id: invite.id,

    // Returned only so caller can show/share the claim link immediately.
    // New invite rows persist tokenHash, not this raw token.
    token: invite.rawToken,
  }
}

async function loadInviteClientSnapshot(
  clientId: string,
): Promise<InviteClientSnapshot | null> {
  return prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: inviteClientSelect,
  })
}

async function tryCreateInvite(args: {
  professionalId: string
  bookingId: string
  clientId: string
}): Promise<CreatedInviteDeliveryCandidate | null> {
  const clientSnapshot = await loadInviteClientSnapshot(args.clientId)

  if (!clientSnapshot) {
    console.error('createProBookingWithClient invite client lookup failed', {
      professionalId: args.professionalId,
      bookingId: args.bookingId,
      clientId: args.clientId,
    })

    return null
  }

  if (clientSnapshot.claimStatus !== ClientClaimStatus.UNCLAIMED) {
    return null
  }

  const invitedName = buildInvitedName(clientSnapshot)
  const invitedEmail = asTrimmedString(clientSnapshot.email)
  const invitedPhone = asTrimmedString(clientSnapshot.phone)
  const preferredContactMethod = inferPreferredContactMethod({
    email: invitedEmail,
    phone: invitedPhone,
  })

  if (!invitedName || (!invitedEmail && !invitedPhone)) {
    return null
  }

  try {
    const createdInvite = await upsertClientClaimLink({
      professionalId: args.professionalId,
      clientId: args.clientId,
      bookingId: args.bookingId,
      invitedName,
      invitedEmail,
      invitedPhone,
      preferredContactMethod,
    })

    if (
      createdInvite.status !== ProClientInviteStatus.PENDING ||
      createdInvite.acceptedAt != null ||
      createdInvite.revokedAt != null ||
      !createdInvite.rawToken
    ) {
      return null
    }

    return {
      id: createdInvite.id,
      rawToken: createdInvite.rawToken,
      invitedName,
      invitedEmail,
      invitedPhone,
      preferredContactMethod,
    }
  } catch (error: unknown) {
    console.error('createProBookingWithClient invite creation failed', {
      professionalId: args.professionalId,
      bookingId: args.bookingId,
      clientId: args.clientId,
      error,
    })

    return null
  }
}

async function tryEnqueueInviteDelivery(args: {
  professionalId: string
  actorUserId: string
  tenantContext: TenantContext
  bookingId: string
  clientId: string
  clientUserId: string | null
  invite: CreatedInviteDeliveryCandidate
}): Promise<void> {
  try {
    await createClientClaimInviteDelivery({
      tenantContext: args.tenantContext,
      professionalId: args.professionalId,
      clientId: args.clientId,
      bookingId: args.bookingId,
      inviteId: args.invite.id,
      rawToken: args.invite.rawToken,
      invitedName: args.invite.invitedName,
      invitedEmail: args.invite.invitedEmail,
      invitedPhone: args.invite.invitedPhone,
      preferredContactMethod: args.invite.preferredContactMethod,
      issuedByUserId: args.actorUserId,
      recipientUserId: args.clientUserId,
    })
  } catch (error: unknown) {
    console.error('createProBookingWithClient invite delivery enqueue failed', {
      professionalId: args.professionalId,
      bookingId: args.bookingId,
      clientId: args.clientId,
      inviteId: args.invite.id,
      error,
    })
  }
}

async function tryEnqueueBookingConfirmedDelivery(args: {
  professionalId: string
  bookingId: string
  clientId: string
}): Promise<void> {
  const clientSnapshot = await loadInviteClientSnapshot(args.clientId)

  if (!clientSnapshot) {
    console.error(
      'createProBookingWithClient booking confirmation client lookup failed',
      {
        professionalId: args.professionalId,
        bookingId: args.bookingId,
        clientId: args.clientId,
      },
    )

    return
  }

  /**
   * BOOKING_CONFIRMED is a Tier B event: in-app + email only, no SMS (see
   * docs/design/notification-channel-policy.md). UNCLAIMED clients have no app
   * target and, per policy, get no confirmation SMS — they are notified by the
   * claim invite (SMS/email snapshot carve-out) which links to the booking. So
   * the confirmation here only targets CLAIMED clients (in-app + email).
   */
  if (!clientSnapshot.userId) {
    return
  }

  const recipientEmail = asTrimmedString(clientSnapshot.email)
  const now = new Date()

  // §12 NC1 #3+4: shared "you're booked with {pro} for {service} on {date} at
  // {time}" copy, matching every other confirm path.
  const bookingMeta = await prisma.booking
    .findUnique({
      where: { id: args.bookingId },
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
  const confirmedCopy = buildBookingConfirmedClientCopy({
    proName: formatProfessionalPublicDisplayName(bookingMeta?.professional),
    serviceName: bookingMeta?.service?.name,
    scheduledFor: bookingMeta?.scheduledFor ?? null,
    timeZone:
      bookingMeta?.locationTimeZone ||
      bookingMeta?.professional?.timeZone ||
      DEFAULT_TIME_ZONE,
  })

  try {
    await enqueueDispatch({
      key: NotificationEventKey.BOOKING_CONFIRMED,
      sourceKey: `PRO_BOOKING_CONFIRMED:${args.bookingId}:CLIENT`,
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: args.clientId,
        userId: clientSnapshot.userId,
        inAppTargetId: args.clientId,
        email: recipientEmail,
        /**
         * Pro-created bookings target the contact snapshot entered/selected by
         * the Pro; treat it as eligible at enqueue (synthetic timestamp), not an
         * ownership claim.
         */
        emailVerifiedAt: recipientEmail ? now : null,
        timeZone: null,
      },
      title: confirmedCopy.title,
      body: confirmedCopy.body,
      href: `/client/bookings/${args.bookingId}`,
      payload: {
        source: 'proCreatedBooking',
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        clientId: args.clientId,
      },
      requestedChannels: [
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
      ],
    })
  } catch (error: unknown) {
    console.error(
      'createProBookingWithClient booking confirmation delivery enqueue failed',
      {
        professionalId: args.professionalId,
        bookingId: args.bookingId,
        clientId: args.clientId,
        error,
      },
    )
  }
}

export async function createProBookingWithClient(
  args: CreateProBookingWithClientArgs,
): Promise<CreateProBookingWithClientResult> {
  const readiness = await checkProReadinessForEntryPoint({
    professionalId: args.professionalId,
    entryPoint: 'PRO_CREATED',
  })

  if (!readiness.ok) {
    return {
      ok: false,
      status: 409,
      error: 'This professional is not currently accepting bookings.',
      code: 'PRO_NOT_READY',
    }
  }

  const normalizedClient = normalizeClientInput(args.client)
  const normalizedServiceAddress = normalizeServiceAddressInput(
    args.serviceAddress,
  )

  const resolvedClient = await resolveProBookingClient({
    professionalId: args.professionalId,
    locationType: args.locationType,
    clientId: args.clientId,
    client: normalizedClient,
    clientAddressId: args.clientAddressId,
    serviceAddress: normalizedServiceAddress,
  })

  if (!resolvedClient.ok) {
    return resolvedClient
  }

  const bookingResult = await createProBooking({
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    overrideReason: args.overrideReason,
    clientId: resolvedClient.clientId,
    offeringId: args.offeringId,
    addOnIds: args.addOnIds ?? [],
    locationId: args.locationId,
    locationType: args.locationType,
    scheduledFor: args.scheduledFor,
    clientAddressId: resolvedClient.clientAddressId,
    internalNotes: args.internalNotes,
    requestedBufferMinutes: args.requestedBufferMinutes,
    requestedTotalDurationMinutes: args.requestedTotalDurationMinutes,
    allowOutsideWorkingHours: args.allowOutsideWorkingHours,
    allowShortNotice: args.allowShortNotice,
    allowFarFuture: args.allowFarFuture,
    requestId: args.requestId ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
  })

  const bookingWasCreated = bookingResult.meta.mutated

  let inviteCandidate: CreatedInviteDeliveryCandidate | null = null

  if (
    bookingWasCreated &&
    shouldAutoCreateInvite({
      resolvedClientClaimStatus: resolvedClient.clientClaimStatus,
    })
  ) {
    inviteCandidate = await tryCreateInvite({
      professionalId: args.professionalId,
      bookingId: bookingResult.booking.id,
      clientId: resolvedClient.clientId,
    })
  }

  if (bookingWasCreated) {
    /**
     * Confirmation only fires for CLAIMED clients (in-app + email). UNCLAIMED
     * clients are notified by the claim invite below, which links to the public
     * claim/overview page, so no separate confirmation is sent to them here.
     */
    await tryEnqueueBookingConfirmedDelivery({
      professionalId: args.professionalId,
      bookingId: bookingResult.booking.id,
      clientId: resolvedClient.clientId,
    })
  }

  if (inviteCandidate) {
    await tryEnqueueInviteDelivery({
      professionalId: args.professionalId,
      actorUserId: args.actorUserId,
      tenantContext: args.tenantContext,
      bookingId: bookingResult.booking.id,
      clientId: resolvedClient.clientId,
      clientUserId: resolvedClient.clientUserId,
      invite: inviteCandidate,
    })
  }

  return {
    ok: true,
    clientId: resolvedClient.clientId,
    clientUserId: resolvedClient.clientUserId,
    clientEmail: resolvedClient.clientEmail,
    clientClaimStatus: resolvedClient.clientClaimStatus,
    clientAddressId: resolvedClient.clientAddressId,
    bookingResult,
    invite: inviteCandidate ? toPublicInviteResult(inviteCandidate) : null,
  }
}