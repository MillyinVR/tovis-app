// app/api/v1/client/rebook/[token]/checkout/manual/route.ts
//
// Public (no-login) OFF-PLATFORM checkout for unclaimed clients, authenticated by
// the AFTERCARE_ACCESS ClientActionToken. The token-authenticated twin of
// /api/v1/client/bookings/[id]/checkout: same tip save, same method selection,
// same "client attests they paid, pro confirms receipt" AWAITING_CONFIRMATION
// landing — it just resolves the booking + client from the aftercare token
// instead of requireClient(), exactly as the sibling Stripe route does.
//
// Card rails stay out of reach here for the same reason they do on the authed
// route: STRIPE_CARD must go through hosted checkout (the sibling route), and the
// pro-run rails are not client-selectable at all.

import { BookingCheckoutStatus, PaymentMethod, Role } from '@prisma/client'

import { jsonFail, pickString } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { resolveAftercareAccessTokenForMutation } from '@/lib/aftercare/aftercareAccessTokens'
import { isBookingError } from '@/lib/booking/errors'
import { updateClientBookingCheckout } from '@/lib/booking/writeBoundary'
import { isRecord } from '@/lib/guards'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { parseTipAmount } from '@/lib/money'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import {
  acceptedPaymentMethodsSelect,
  buildClientSelfServePaymentMethods,
  isUnverifiablePaymentMethod,
  normalizePaymentMethodInput,
} from '@/lib/payments/acceptedMethods'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { tokenActorRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'
import type { JsonObjectPayload } from '@/app/api/_utils/jsonPayload'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION = 'POST /api/v1/client/rebook/[token]/checkout/manual'

export async function POST(req: Request, ctx: RouteContext<{ token: string }>) {
  try {
    const params = await resolveRouteParams(ctx)
    const rawToken = pickString(params?.token)

    if (!rawToken) {
      return bookingJsonFail('AFTERCARE_TOKEN_MISSING', {
        message: 'Aftercare access token is missing from route params.',
        userMessage: 'That payment link is invalid or expired.',
      })
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const parsedTip = parseTipAmount(body.tipAmount)
    if (!parsedTip.ok) {
      return jsonFail(400, parsedTip.error)
    }

    let selectedPaymentMethod: PaymentMethod | undefined
    if (body.selectedPaymentMethod !== undefined) {
      selectedPaymentMethod = normalizePaymentMethodInput(
        body.selectedPaymentMethod,
      )

      if (!selectedPaymentMethod) {
        return jsonFail(
          400,
          'selectedPaymentMethod must be one of: cash, Venmo, Zelle, Apple Cash, PayPal, Stripe card.',
        )
      }
    }

    const confirmPayment = body.confirmPayment === true

    const rateLimit = await enforceRateLimit({
      bucket: 'client:checkout:token',
      key: tokenActorRateLimitKey({ actorKey: rawToken, request: req }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const resolved = await resolveAftercareAccessTokenForMutation({ rawToken })

    const bookingId = resolved.booking.id
    const clientId = resolved.booking.clientId

    // Everything below is validated BEFORE the idempotency wrapper opens: that
    // wrapper records whatever `run` returns as the key's committed result, so a
    // refusal raised inside would be replayed as if it were the real answer and
    // burn the client's key on a retryable mistake.
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { professionalId: true, selectedPaymentMethod: true },
    })

    if (!booking) {
      return bookingJsonFail('BOOKING_NOT_FOUND')
    }

    const paymentSettings = await prisma.professionalPaymentSettings.findUnique({
      where: { professionalId: booking.professionalId },
      select: { ...acceptedPaymentMethodsSelect, tipsEnabled: true },
    })

    const acceptedMethods = buildClientSelfServePaymentMethods(paymentSettings)

    if (selectedPaymentMethod && !acceptedMethods.has(selectedPaymentMethod)) {
      return jsonFail(400, 'That payment method is not enabled by this provider.')
    }

    const effectivePaymentMethod =
      selectedPaymentMethod ?? booking.selectedPaymentMethod ?? null

    if (confirmPayment) {
      if (!effectivePaymentMethod) {
        return jsonFail(400, 'Choose a payment method before confirming payment.')
      }

      // Card is only "paid" once Stripe says so — the sibling route mints that
      // session.
      if (effectivePaymentMethod === PaymentMethod.STRIPE_CARD) {
        return jsonFail(
          400,
          'Card payments must be confirmed through Stripe checkout.',
          { code: 'STRIPE_CHECKOUT_REQUIRED' },
        )
      }

      if (!acceptedMethods.has(effectivePaymentMethod)) {
        return jsonFail(
          400,
          'That payment method is not enabled by this provider.',
        )
      }
    }

    if (
      paymentSettings?.tipsEnabled === false &&
      parsedTip.tipAmount !== undefined &&
      parsedTip.tipAmount !== null &&
      Number(parsedTip.tipAmount) > 0
    ) {
      return jsonFail(400, 'Tips are not enabled for this provider.')
    }

    // Everything a client can self-serve here is off-platform and therefore
    // unverifiable: we stamp authorization, hold collection, and wait for the pro
    // to confirm receipt. There is no immediate-PAID path on this route.
    const confirmAsUnverifiable =
      confirmPayment && isUnverifiablePaymentMethod(effectivePaymentMethod)

    return await withRouteIdempotency<JsonObjectPayload>(
      {
        request: req,
        actor: {
          actorKey: resolved.idempotencyActorKey,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.PUBLIC_AFTERCARE_CHECKOUT_MANUAL,
        requestLabel: 'public aftercare off-platform checkout',
        requestBody: {
          aftercareTokenId: resolved.token.id,
          bookingId,
          clientId,
          tipAmountProvided: parsedTip.tipAmount !== undefined,
          tipAmount: parsedTip.tipAmount ?? null,
          selectedPaymentMethod: selectedPaymentMethod ?? null,
          confirmPayment,
        },
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress: 'A matching checkout request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
        operation: ROUTE_OPERATION,
      },
      async () => {
        const result = await updateClientBookingCheckout({
          bookingId,
          clientId,
          tipAmount: parsedTip.tipAmount,
          selectedPaymentMethod,
          checkoutStatus: confirmPayment
            ? confirmAsUnverifiable
              ? BookingCheckoutStatus.AWAITING_CONFIRMATION
              : BookingCheckoutStatus.PAID
            : undefined,
          markPaymentAuthorized: confirmPayment,
          markPaymentCollected: confirmPayment && !confirmAsUnverifiable,
        })

        kickNotificationDrain()

        return {
          status: 200,
          body: {
            booking: {
              id: result.booking.id,
              checkoutStatus: result.booking.checkoutStatus,
              selectedPaymentMethod: result.booking.selectedPaymentMethod,
              tipAmount: result.booking.tipAmount?.toString() ?? null,
              totalAmount: result.booking.totalAmount?.toString() ?? null,
              paymentAuthorizedAt:
                result.booking.paymentAuthorizedAt?.toISOString() ?? null,
              paymentCollectedAt:
                result.booking.paymentCollectedAt?.toISOString() ?? null,
            },
          },
        }
      },
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(`${ROUTE_OPERATION} error`, { error: safeError(error) })

    captureBookingException({ error, route: ROUTE_OPERATION })

    return jsonFail(500, 'Failed to update checkout.')
  }
}
