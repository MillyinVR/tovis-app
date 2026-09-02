// app/api/v1/pro/bookings/[id]/consult-decline-deposit/route.ts
//
// Book the Look, B6 — the pro's keep-or-refund answer about a client's deposit
// after that client declined the finalized number in the chair (Tori,
// 2026-08-31: the pro decides each time, and the choice is recorded).
//
// Thin by design. Every rule — does the question apply, has it been answered,
// does the money move — lives in lib/consult/inChairDeclineOutcome.ts, which
// the pro's page reads from too, so the button and the surface that offers it
// can never disagree about whether it should exist.

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  parseConsultDeclineDepositChoice,
  recordConsultDeclineDepositChoice,
} from '@/lib/consult/inChairDeclineOutcome'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const OPERATION = 'POST /api/v1/pro/bookings/[id]/consult-decline-deposit'

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const actorUserId = auth.user.id
    if (!actorUserId) {
      return jsonFail(403, 'You are not allowed to make this decision.')
    }

    const params = await resolveRouteParams(context)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    // The bucket every pro booking write that touches a client's money shares.
    // A refund is exactly that.
    const rateLimit = await enforceRateLimit({
      bucket: 'pro:bookings:write',
      key: proRateLimitKey({
        professionalId: auth.professionalId,
        userId: actorUserId,
        request,
      }),
    })

    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

    const body = await readJsonRecord(request)
    const choice = parseConsultDeclineDepositChoice(body?.choice)
    if (!choice) {
      return jsonFail(400, 'Choose whether to keep or refund the deposit.', {
        code: 'CONSULT_DECLINE_DEPOSIT_INVALID_CHOICE',
      })
    }

    const result = await recordConsultDeclineDepositChoice({
      bookingId,
      professionalId: auth.professionalId,
      actorUserId,
      choice,
    })

    if (result.ok) {
      // `settlement` is the money's own answer and the client renders from it.
      // `choice` alone cannot carry this: a REFUND that moved nothing (already
      // returned, or frozen under a dispute) is still a successful request.
      return jsonOk({
        choice: result.choice,
        settlement: result.settlement,
        refundedCents: result.refundedCents,
      })
    }

    switch (result.code) {
      case 'NOT_FOUND':
        return jsonFail(404, 'Booking not found.', {
          code: 'CONSULT_DECLINE_DEPOSIT_NOT_FOUND',
        })
      case 'NOT_APPLICABLE':
        return jsonFail(409, 'There is no deposit decision to make here.', {
          code: 'CONSULT_DECLINE_DEPOSIT_NOT_APPLICABLE',
        })
      case 'ALREADY_DECIDED':
        return jsonFail(409, 'This deposit has already been decided.', {
          code: 'CONSULT_DECLINE_DEPOSIT_ALREADY_DECIDED',
        })
      case 'REFUND_FAILED':
        // The DECISION is recorded; only the money did not move. Say exactly
        // that rather than a generic failure, so the pro knows the choice
        // stands and the refund is what needs attention.
        return jsonFail(
          502,
          `Your choice is recorded, but the refund did not go through: ${result.message}`,
          { code: 'CONSULT_DECLINE_DEPOSIT_REFUND_FAILED' },
        )
    }
  } catch (error: unknown) {
    console.error(`${OPERATION} error`, safeError(error))
    return jsonFail(500, 'Internal server error')
  }
}
