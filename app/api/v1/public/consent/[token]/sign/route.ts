// app/api/v1/public/consent/[token]/sign/route.ts
//
// K15: the client's signature, authenticated by the CONSENT_SIGNATURE
// ClientActionToken behind the link their pro sent. Anyone holding the message
// holds the token (the K12 premise), so the page puts the whole document in
// front of them and the act itself is explicit — a typed name plus an "I agree"
// tap, never a one-tap fire from the link.
//
// 🔴 The version signed is the one PINNED ON THE TOKEN at mint. This route never
// looks up the form's current version; if the pro published new text while the
// message sat unread, the record still attests to what the client actually saw.
//
// One signature per link is enforced by the UNIQUE
// ClientConsentRecord.signatureTokenId. The pre-check inside
// recordConsentSignature is the courteous message; the database is the promise.

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { isBookingError } from '@/lib/booking/errors'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import {
  CONSENT_SIGNATURE_NAME_MAX,
  parseConsentSignatureName,
} from '@/lib/consentForms/signatureName'
import {
  recordConsentSignature,
  resolveConsentSignatureTokenForRead,
} from '@/lib/consentForms/signatureTokens'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { tokenActorRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, ctx: RouteContext<{ token: string }>) {
  try {
    const params = await resolveRouteParams(ctx)
    const rawToken = pickString(params?.token)

    if (!rawToken) {
      return bookingJsonFail('CONSENT_TOKEN_MISSING')
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'client:consent:token',
      key: tokenActorRateLimitKey({ actorKey: rawToken, request: req }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const body = await readJsonRecord(req)
    const signatureName = parseConsentSignatureName(body.signatureName)

    if (!signatureName) {
      return jsonFail(
        400,
        `Type your full name to sign (up to ${CONSENT_SIGNATURE_NAME_MAX} characters).`,
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      const resolved = await resolveConsentSignatureTokenForRead({
        rawToken,
        tx,
      })

      // The kill switch reaches the WRITE and the CONTROL alike: the page
      // renders the same unavailable card, so a pro whose access is turned off
      // mid-flight never leaves a client staring at a button the server 400s.
      // Resolved from the TOKEN's pro, because there is no session here.
      if (!isClientTechnicalRecordEnabled(resolved.professionalId)) {
        return { kind: 'DISABLED' as const }
      }

      const written = await recordConsentSignature({
        tx,
        resolved,
        signatureName,
      })

      return { kind: 'DONE' as const, written, resolved }
    })

    if (result.kind === 'DISABLED') {
      return bookingJsonFail('CONSENT_TOKEN_INVALID', {
        message: 'Consent signing is not enabled for this professional.',
        userMessage: 'That consent link is invalid or expired.',
      })
    }

    if (!result.written.ok) {
      return jsonFail(409, result.written.error)
    }

    return jsonOk({
      recordId: result.written.recordId,
      signedAt: new Date().toISOString(),
      version: {
        id: result.resolved.version.id,
        version: result.resolved.version.version,
        title: result.resolved.version.title,
      },
    })
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(
      'POST /api/v1/public/consent/[token]/sign error',
      safeError(error),
    )

    return jsonFail(500, 'Failed to record your signature.')
  }
}
