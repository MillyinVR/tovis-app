// app/api/bookings/[id]/checkout/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk, jsonFail } from '@/app/api/_utils/responses'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickString } from '@/app/api/_utils/pick'
import { rateLimitRedis } from '@/lib/rateLimitRedis'
import { updateBookingCheckout } from '@/lib/booking/writeBoundary'
import { Role, PaymentMethod, BookingCheckoutStatus, BookingCloseoutAuditAction } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

const checkoutSelect = {
  id: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  subtotalSnapshot: true,
  serviceSubtotalSnapshot: true,
  totalAmount: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  clientId: true,
  professionalId: true,
} as const

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.PRO, Role.CLIENT, Role.ADMIN] })
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Booking ID is required.')

    const user = auth.user
    const clientId = user.clientProfile?.id ?? null
    const professionalId = user.professionalProfile?.id ?? null
    const isAdmin = user.role === Role.ADMIN

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: checkoutSelect,
    })

    if (!booking) return jsonFail(404, 'Booking not found.')

    const isClient = clientId != null && booking.clientId === clientId
    const isPro = professionalId != null && booking.professionalId === professionalId

    if (!isAdmin && !isClient && !isPro) {
      return jsonFail(403, 'Forbidden.')
    }

    return jsonOk({
      checkoutStatus: booking.checkoutStatus,
      selectedPaymentMethod: booking.selectedPaymentMethod,
      subtotalSnapshot: booking.subtotalSnapshot?.toString() ?? null,
      serviceSubtotalSnapshot: booking.serviceSubtotalSnapshot?.toString() ?? null,
      totalAmount: booking.totalAmount?.toString() ?? null,
      paymentAuthorizedAt: booking.paymentAuthorizedAt?.toISOString() ?? null,
      paymentCollectedAt: booking.paymentCollectedAt?.toISOString() ?? null,
    })
  } catch (err) {
    console.error('GET /api/bookings/[id]/checkout error', err)
    return jsonFail(500, 'Failed to fetch checkout state.')
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.PRO] })
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Booking ID is required.')

    // Rate limit: 10 requests per 60 seconds per booking
    const rl = await rateLimitRedis({
      key: `checkout:${bookingId}`,
      limit: 10,
      windowSeconds: 60,
    })
    if (!rl.success) return jsonFail(429, 'Too many requests.')

    const professionalId = auth.user.professionalProfile?.id
    if (!professionalId) return jsonFail(403, 'Only professionals can update payment method.')

    const body: unknown = await req.json().catch(() => ({}))
    const rawMethod = (body && typeof body === 'object' && 'paymentMethod' in body)
      ? (body as Record<string, unknown>).paymentMethod
      : null

    if (!rawMethod || typeof rawMethod !== 'string') {
      return jsonFail(400, 'paymentMethod is required.')
    }

    if (!Object.values(PaymentMethod).includes(rawMethod as PaymentMethod)) {
      return jsonFail(400, `Invalid paymentMethod: ${rawMethod}.`)
    }

    const paymentMethod = rawMethod as PaymentMethod

    // Verify the pro is on this booking
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { professionalId: true },
    })
    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== professionalId) return jsonFail(403, 'Forbidden.')

    const result = await updateBookingCheckout({
      bookingId,
      professionalId,
      selectedPaymentMethod: paymentMethod,
    })

    // Log PAYMENT_METHOD_UPDATED
    await prisma.bookingCloseoutAuditLog.create({
      data: {
        bookingId,
        professionalId,
        action: BookingCloseoutAuditAction.PAYMENT_METHOD_UPDATED,
        route: 'app/api/bookings/[id]/checkout/route.ts:PATCH',
        newValue: { selectedPaymentMethod: paymentMethod },
      },
    }).catch(() => {
      // Audit log failure should not block the response
    })

    return jsonOk({
      checkoutStatus: result.booking.checkoutStatus,
      selectedPaymentMethod: result.booking.selectedPaymentMethod,
      subtotalSnapshot: result.booking.subtotalSnapshot?.toString() ?? null,
      serviceSubtotalSnapshot: result.booking.serviceSubtotalSnapshot?.toString() ?? null,
      totalAmount: result.booking.totalAmount?.toString() ?? null,
      paymentAuthorizedAt: result.booking.paymentAuthorizedAt?.toISOString() ?? null,
      paymentCollectedAt: result.booking.paymentCollectedAt?.toISOString() ?? null,
    })
  } catch (err) {
    console.error('PATCH /api/bookings/[id]/checkout error', err)
    return jsonFail(500, 'Failed to update payment method.')
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.PRO] })
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Booking ID is required.')

    // Rate limit: 10 requests per 60 seconds per booking
    const rl = await rateLimitRedis({
      key: `checkout:${bookingId}`,
      limit: 10,
      windowSeconds: 60,
    })
    if (!rl.success) return jsonFail(429, 'Too many requests.')

    const professionalId = auth.user.professionalProfile?.id
    if (!professionalId) return jsonFail(403, 'Only professionals can record payment.')

    const body: unknown = await req.json().catch(() => ({}))
    const rawMethod = (body && typeof body === 'object' && 'method' in body)
      ? (body as Record<string, unknown>).method
      : null

    if (!rawMethod || typeof rawMethod !== 'string') {
      return jsonFail(400, 'method is required.')
    }

    if (!Object.values(PaymentMethod).includes(rawMethod as PaymentMethod)) {
      return jsonFail(400, `Invalid method: ${rawMethod}.`)
    }

    const paymentMethod = rawMethod as PaymentMethod

    // Verify the pro is on this booking and payment hasn't been collected yet
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { professionalId: true, paymentCollectedAt: true },
    })
    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== professionalId) return jsonFail(403, 'Forbidden.')
    if (booking.paymentCollectedAt) return jsonFail(409, 'Payment already collected.')

    const result = await updateBookingCheckout({
      bookingId,
      professionalId,
      selectedPaymentMethod: paymentMethod,
      checkoutStatus: BookingCheckoutStatus.PAID,
      markPaymentCollected: true,
    })

    // Log PAYMENT_COLLECTED
    await prisma.bookingCloseoutAuditLog.create({
      data: {
        bookingId,
        professionalId,
        action: BookingCloseoutAuditAction.PAYMENT_COLLECTED,
        route: 'app/api/bookings/[id]/checkout/route.ts:POST',
        newValue: {
          selectedPaymentMethod: paymentMethod,
          checkoutStatus: BookingCheckoutStatus.PAID,
        },
      },
    }).catch(() => {
      // Audit log failure should not block the response
    })

    return jsonOk({ collected: true })
  } catch (err) {
    console.error('POST /api/bookings/[id]/checkout error', err)
    return jsonFail(500, 'Failed to record payment.')
  }
}
