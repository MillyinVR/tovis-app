// app/api/v1/pro/clients/[id]/consent-requests/route.ts
//
// K15: the pro's "send this form to be signed" control.
//
// 🔴 This route is what makes ConsentProofMethod.CLIENT_TOKEN honest. Before
// K15 the pro's record form OFFERED "Client link" with no link flow behind it
// (K14-B) — a control that had been lying since it shipped. From here on the
// only writer of that proof method is the signing route on the other end of the
// link this mints, and the manual option is gone.
//
// The link is anchored to a BOOKING, because that is when a per-service
// requirement becomes real (and because ClientActionToken.bookingId is
// required — widening it for this one kind would touch five other flows). With
// no bookingId supplied the client's next upcoming appointment with this pro is
// used, which is what a pro means by "send them the waiver".

import { BookingStatus, NotificationEventKey, Prisma } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { chartRefusal } from '@/lib/clients/chartAccessCopy'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { createConsentSignatureRequest } from '@/lib/consentForms/signatureRequest'
import {
  inferPreferredContactMethod,
  pickFirstNonEmptyContact,
} from '@/lib/notifications/contactMethod'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { prisma } from '@/lib/prisma'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BOOKING_SELECT = {
  id: true,
  scheduledFor: true,
  professional: { select: professionalPublicDisplayNameSelect },
  client: {
    select: {
      userId: true,
      // pii-plaintext-read-ok: resolving the client-action link's delivery
      // destination, exactly as the K10-B deposit pay link does — a magic link
      // has nowhere to go without it.
      email: true,
      phone: true, // pii-plaintext-read-ok: same, SMS destination for an unclaimed client
      preferredContactMethod: true,
      user: {
        select: {
          email: true, // pii-plaintext-read-ok: delivery destination fallback
          phone: true, // pii-plaintext-read-ok: delivery destination fallback
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

export async function POST(req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    if (!isClientTechnicalRecordEnabled(professionalId)) {
      return jsonFail(404, 'Not found.')
    }

    const params = await resolveRouteParams(context)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) {
      const refusal = chartRefusal(gate.visibility, 403)
      return jsonFail(refusal.status, refusal.message, { code: refusal.code })
    }

    const body = await readJsonRecord(req)
    const formId = pickString(body.formId)
    if (!formId) return jsonFail(400, 'A form id is required.')

    const requestedBookingId = pickString(body.bookingId)
    const now = new Date()

    const outcome = await prisma.$transaction(async (tx) => {
      // The appointment the signature is for. An explicit id must still belong
      // to this pro AND this client — the chart is a pro surface, but the id
      // came from a request body.
      const booking = requestedBookingId
        ? await tx.booking.findFirst({
            where: { id: requestedBookingId, clientId, professionalId },
            select: BOOKING_SELECT,
          })
        : await tx.booking.findFirst({
            where: {
              clientId,
              professionalId,
              status: { not: BookingStatus.CANCELLED },
              scheduledFor: { gte: now },
            },
            orderBy: { scheduledFor: 'asc' },
            select: BOOKING_SELECT,
          })

      if (!booking) {
        return {
          kind: 'NO_BOOKING' as const,
          error: requestedBookingId
            ? 'That appointment was not found for this client.'
            : 'This client has no upcoming appointment to attach the form to.',
        }
      }

      const recipientEmail = pickFirstNonEmptyContact(
        booking.client.email, // pii-plaintext-read-ok: link delivery destination
        booking.client.user?.email ?? null, // pii-plaintext-read-ok: link delivery destination
      )
      const recipientPhone = pickFirstNonEmptyContact(
        booking.client.phone, // pii-plaintext-read-ok: link delivery destination
        booking.client.user?.phone ?? null, // pii-plaintext-read-ok: link delivery destination
      )

      const result = await createConsentSignatureRequest({
        tx,
        professionalId,
        clientId,
        bookingId: booking.id,
        formId,
        scheduledFor: booking.scheduledFor,
        recipientEmail,
        recipientPhone,
        preferredContactMethod: inferPreferredContactMethod({
          email: recipientEmail,
          phone: recipientPhone,
          existingPreference: booking.client.preferredContactMethod,
        }),
        issuedByUserId: auth.userId,
        recipientUserId: booking.client.userId ?? null,
        recipientTimeZone: null,
        professionalName: formatProfessionalPublicDisplayName(
          booking.professional,
          '',
        ) || null,
        now,
      })

      // 🔴 Every refusal happens BEFORE any write inside this callback, so
      // returning one cannot commit half a send ([[prisma-transaction-return-commits]]).
      return { kind: 'DONE' as const, result, bookingId: booking.id }
    })

    if (outcome.kind === 'NO_BOOKING') {
      return jsonFail(400, outcome.error)
    }

    if (!outcome.result.ok) {
      return jsonFail(400, outcome.result.error)
    }

    // The dispatch rows committed with the transaction — deliver them now.
    kickNotificationDrain()

    return jsonOk(
      {
        bookingId: outcome.bookingId,
        eventKey: NotificationEventKey.CONSENT_SIGNATURE_REQUEST,
        version: outcome.result.version,
      },
      201,
    )
  } catch (error: unknown) {
    console.error(
      'POST /api/v1/pro/clients/[id]/consent-requests error',
      safeError(error),
    )
    return jsonFail(500, 'Failed to send the consent form.')
  }
}
