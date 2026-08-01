// app/api/v1/pro/bookings/[id]/session/state/route.ts
//
// Compact read model for Pro session polling. Returns the current session
// state snapshot plus a stable hash; the Pro session UI polls this route
// and refreshes the server-rendered page only when the hash changes.
//
// K17-A also answers with the consent forms this appointment's client still owes
// (K15), because this route is the native session hub's spine — see the header
// of `lib/dto/proSessionState.ts` for why the footer payload could not reach it.

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { requireProBooking } from '@/app/api/_utils/auth/requireProBooking'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { loadUnsignedConsentFormsForBooking } from '@/lib/consentForms/requirement'
import type { ProSessionStateResponseDTO } from '@/lib/dto/proSessionState'
import { prisma } from '@/lib/prisma'
import {
  PRO_SESSION_STATE_SELECT,
  buildProSessionState,
  computeProSessionStateHash,
} from '@/lib/proSession/sessionState'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

/**
 * The forms this booking's client still owes, or an empty list.
 *
 * 🔴 The kill switch reaches the QUERY, not the payload: while the
 * technical-record gate is off this function issues no SQL at all, so a route
 * the pro session UI POLLS costs exactly what it cost before K17-A. That is also
 * why the consent columns are read here rather than added to
 * `PRO_SESSION_STATE_SELECT` — that select is shared with the session page's
 * layout, and widening it would put a `serviceItems` join on every load of a
 * surface that has no use for one, dark or not.
 *
 * Ownership is already established by `requireProBooking` before this runs; the
 * `professionalId` term below is the second lock, not the first.
 */
async function loadUnsignedConsentForms(bookingId: string, professionalId: string) {
  if (!isClientTechnicalRecordEnabled(professionalId)) return []

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, professionalId },
    select: {
      id: true,
      clientId: true,
      // Both halves of the service axis: a waiver can hang off the booking's own
      // service OR off any of its items (the `take: 1` #812 removed).
      serviceId: true,
      serviceItems: { select: { serviceId: true } },
    },
  })

  if (!booking) return []

  return loadUnsignedConsentFormsForBooking({
    db: prisma,
    professionalId,
    booking,
    now: new Date(),
  })
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const owned = await requireProBooking(
      bookingId,
      auth.professionalId,
      PRO_SESSION_STATE_SELECT,
    )
    if (!owned.ok) return owned.res

    const state = buildProSessionState(owned.booking)

    const unsignedConsentForms = await loadUnsignedConsentForms(
      bookingId,
      auth.professionalId,
    )

    const payload: ProSessionStateResponseDTO = {
      state,
      // The hash covers `state` and nothing else. Polling exists to notice a
      // step/checkout change on the booking row; a signature landing mid-visit
      // is not that, and folding it in would make every tick pay the two consent
      // queries below.
      stateHash: computeProSessionStateHash(state),
      // Omitted, never null or empty — "nothing outstanding" gets exactly one
      // representation on the wire (the shape `loadUnsignedConsentFormsForBooking`
      // already chose for its map).
      ...(unsignedConsentForms.length > 0 ? { unsignedConsentForms } : {}),
    }

    return jsonOk(payload, 200)
  } catch (error) {
    console.error(
      'GET /api/v1/pro/bookings/[id]/session/state error',
      safeError(error),
    )
    return jsonFail(500, 'Internal server error')
  }
}
