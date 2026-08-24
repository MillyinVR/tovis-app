// app/api/v1/pro/bookings/[id]/invite/route.ts
import { ContactMethod } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { requireProBooking } from '@/app/api/_utils/auth/requireProBooking'
import {
  enforceRateLimit,
  tokenRateLimitIdentity,
} from '@/app/api/_utils/rateLimit'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { createClientClaimInviteDelivery } from '@/lib/clientActions/createClientClaimInviteDelivery'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { issueClaimLinkForBooking } from '@/lib/clients/clientClaimLinks'
import { asTrimmedString, isRecord } from '@/lib/guards'
import { safeError, safeLogMeta } from '@/lib/security/logging'
import type { TenantContext } from '@/lib/tenant/context'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type InviteRequestBody = {
  name?: unknown
  email?: unknown
  phone?: unknown
  preferredContactMethod?: unknown
}

type NormalizedInviteInput = {
  name: string | null
  email: string | null
  phone: string | null
  preferredContactMethod: ContactMethod | null | 'invalid'
}

type InviteDeliverySummary = {
  attempted: boolean
  queued: boolean
  href: string | null
}

type BookingInviteContext = {
  id: string
  clientId: string
  client: {
    userId: string | null
  } | null
}

type ClaimInviteForDelivery = {
  id: string
  rawToken: string
  acceptedAt: Date | null
  invitedName: string
  invitedEmail: string | null
  invitedPhone: string | null
  preferredContactMethod: ContactMethod | null
  /** False when the claim token was ROTATED on an existing invite row. */
  created: boolean
}

function parsePreferredContactMethod(
  value: unknown,
): ContactMethod | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return 'invalid'

  const normalized = value.trim().toUpperCase()

  if (normalized === ContactMethod.EMAIL) return ContactMethod.EMAIL
  if (normalized === ContactMethod.SMS) return ContactMethod.SMS

  return 'invalid'
}

function normalizeInviteInput(rawBody: unknown): NormalizedInviteInput {
  const body: InviteRequestBody = isRecord(rawBody) ? rawBody : {}

  return {
    name: asTrimmedString(body.name),
    email: asTrimmedString(body.email),
    phone: asTrimmedString(body.phone),
    preferredContactMethod: parsePreferredContactMethod(
      body.preferredContactMethod,
    ),
  }
}

function validateInviteInput(input: NormalizedInviteInput): Response | null {
  if (!input.name) {
    return jsonFail(400, 'Name is required.', {
      code: 'VALIDATION_ERROR',
    })
  }

  if (!input.email && !input.phone) {
    return jsonFail(400, 'Email or phone is required.', {
      code: 'VALIDATION_ERROR',
    })
  }

  if (input.preferredContactMethod === 'invalid') {
    return jsonFail(400, 'Invalid preferredContactMethod.', {
      code: 'VALIDATION_ERROR',
    })
  }

  if (input.preferredContactMethod === ContactMethod.SMS && !input.phone) {
    return jsonFail(
      400,
      'Phone is required when preferredContactMethod is SMS.',
      { code: 'VALIDATION_ERROR' },
    )
  }

  if (input.preferredContactMethod === ContactMethod.EMAIL && !input.email) {
    return jsonFail(
      400,
      'Email is required when preferredContactMethod is EMAIL.',
      { code: 'VALIDATION_ERROR' },
    )
  }

  return null
}

async function maybeQueueInviteDelivery(args: {
  professionalId: string
  actorUserId: string | null
  tenantContext: TenantContext
  booking: BookingInviteContext
  invite: ClaimInviteForDelivery
}): Promise<InviteDeliverySummary> {
  // issueClaimLinkForBooking has already refused a revoked link and an
  // already-claimed client, and the row it hands back was just written PENDING
  // with a fresh token — so acceptedAt is the only invite state left to check.
  // It should be unreachable (accepting an invite claims the client profile in
  // the same transaction), but if it ever is reached, say so honestly rather
  // than texting a claim link for an invite that has already been used. The
  // rotated token still rides the response, so the pro is not left empty-handed.
  if (args.invite.acceptedAt != null) {
    return {
      attempted: false,
      queued: false,
      href: null,
    }
  }

  try {
    const delivery = await createClientClaimInviteDelivery({
      tenantContext: args.tenantContext,
      professionalId: args.professionalId,
      clientId: args.booking.clientId,
      bookingId: args.booking.id,
      inviteId: args.invite.id,
      rawToken: args.invite.rawToken,
      invitedName: args.invite.invitedName,
      invitedEmail: args.invite.invitedEmail,
      invitedPhone: args.invite.invitedPhone,
      preferredContactMethod: args.invite.preferredContactMethod,
      issuedByUserId: args.actorUserId,
      recipientUserId: args.booking.client?.userId ?? null,
      // A rotated invite needs a fresh send cycle; INITIAL_SEND would collapse
      // into the first invite's idempotency key and deliver nothing.
      resendMode: args.invite.created ? 'INITIAL_SEND' : 'RESEND',
    })

    return {
      attempted: true,
      queued: delivery.dispatch.created,
      href: delivery.link.href,
    }
  } catch (error: unknown) {
    console.error('POST /api/v1/pro/bookings/[id]/invite delivery enqueue failed', {
      error: safeError(error),
      meta: safeLogMeta({
        route: 'POST /api/v1/pro/bookings/[id]/invite',
        professionalId: args.professionalId,
        bookingId: args.booking.id,
        clientId: args.booking.clientId,
        inviteId: args.invite.id,
      }),
    })

    return {
      attempted: true,
      queued: false,
      href: null,
    }
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const params = await resolveRouteParams(ctx)
    const bookingId = asTrimmedString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.', {
        code: 'VALIDATION_ERROR',
      })
    }

    const rawBody: unknown = await request.json().catch(() => ({}))
    const input = normalizeInviteInput(rawBody)

    const validationError = validateInviteInput(input)
    if (validationError) {
      return validationError
    }

    if (!input.name || input.preferredContactMethod === 'invalid') {
      return jsonFail(400, 'Invalid invite input.', {
        code: 'VALIDATION_ERROR',
      })
    }

    const owned = await requireProBooking(bookingId, auth.professionalId, {
      id: true,
      clientId: true,
      client: {
        select: {
          userId: true,
        },
      },
    })
    if (!owned.ok) return owned.res
    const booking = owned.booking

    // Same ceiling, same key, same bucket as the booking-less sibling
    // (POST /api/v1/pro/clients/[id]/invite): both doors mint a claim link and
    // deliver it as an SMS/email to a contact taken from the REQUEST BODY, so
    // sharing one per-(pro,client) budget is the only way the ceiling means
    // anything — two doors with two keys would just be 2x the spam.
    //
    // `tokenRateLimitIdentity` rather than `proRateLimitKey` is deliberate: the
    // sibling derives `token:<proId>:<clientId>`, and a different derivation
    // here would land in a DIFFERENT slot of the same bucket, silently doubling
    // the ceiling instead of sharing it.
    //
    // Placed after ownership resolution because the key needs `booking.clientId`.
    // What that leaves ahead of the limiter is a body parse, input validation and
    // one indexed lookup — no writes and nothing billable. Everything BELOW it
    // mints a claim token and enqueues the send.
    const limited = await enforceRateLimit({
      bucket: 'pro:client-claim-invite',
      identity: tokenRateLimitIdentity(
        `${auth.professionalId}:${booking.clientId}`,
      ),
    })
    if (limited) return limited

    // ROTATE, never upsert. `upsertClientClaimLink` returns an unchanged
    // existing row on a repeat invite, and its rawToken then comes from the
    // deprecated plaintext `ProClientInvite.token` column — null on every modern
    // row. That made a second invite for the same booking a DOUBLE silent
    // failure: nothing was sent (no token to deliver) and the pro was handed no
    // link to pass on by hand either, behind a 200. Rotating gives this door the
    // same contract as its booking-less sibling — a fresh working token every
    // time, plus `created: false` so the delivery below opens a new send cycle
    // instead of collapsing into the first invite's idempotency key.
    //
    // Rotation invalidates the previously delivered link, which is why it may
    // only happen below the per-(pro, client) ceiling enforced above: every call
    // that kills a live link must also queue its replacement.
    const issued = await issueClaimLinkForBooking({
      bookingId: booking.id,
      // Contact comes from the request body, not the client profile: a pro can
      // invite at an address the profile does not carry yet.
      contact: {
        invitedName: input.name,
        invitedEmail: input.email,
        invitedPhone: input.phone,
        preferredContactMethod: input.preferredContactMethod,
      },
    })

    if (issued.kind === 'not_found') {
      return jsonFail(404, 'Booking not found.', { code: 'NOT_FOUND' })
    }

    if (issued.kind === 'already_claimed') {
      return jsonFail(409, 'This client has already been claimed.', {
        code: 'ALREADY_CLAIMED',
      })
    }

    if (issued.kind === 'revoked') {
      return jsonFail(409, 'This client’s claim link was revoked.', {
        code: 'REVOKED',
      })
    }

    const invite = issued.invite

    const inviteDelivery = await maybeQueueInviteDelivery({
      professionalId: auth.professionalId,
      actorUserId: asTrimmedString(auth.user?.id) ?? null,
      tenantContext: await resolveTenantContextForRequest(request),
      booking,
      invite: {
        id: invite.id,
        rawToken: issued.rawToken,
        acceptedAt: invite.acceptedAt,
        invitedName: invite.invitedName,
        invitedEmail: invite.invitedEmail,
        invitedPhone: invite.invitedPhone,
        preferredContactMethod: invite.preferredContactMethod,
        created: issued.created,
      },
    })

    // Claim invite enqueued — deliver the email/SMS link now. Unconditional on
    // purpose: `queued: false` can also mean a dispatch row already existed and
    // has not drained yet, and the kick is what gets THAT one moving.
    kickNotificationDrain()

    return jsonOk(
      {
        invite: {
          id: invite.id,

          // Token is returned so the caller can display/share the claim link
          // immediately. Always the non-persisted raw token from this issuance;
          // ProClientInvite stores tokenHash instead.
          token: issued.rawToken,

          status: invite.status,
          invitedName: invite.invitedName,
          invitedEmail: invite.invitedEmail,
          invitedPhone: invite.invitedPhone,
          preferredContactMethod: invite.preferredContactMethod,
        },
        inviteDelivery,
      },
      200,
    )
  } catch (error: unknown) {
    console.error('POST /api/v1/pro/bookings/[id]/invite error', {
      error: safeError(error),
      meta: safeLogMeta({
        route: 'POST /api/v1/pro/bookings/[id]/invite',
      }),
    })

    return jsonFail(500, 'Internal server error')
  }
}