// app/api/bookings/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk, jsonFail } from '@/app/api/_utils/responses'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickString } from '@/app/api/_utils/pick'
import { buildClientBookingDTO } from '@/lib/dto/clientBooking'
import { Role, type Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

const bookingSelect = {
  id: true, status: true, source: true, sessionStep: true,
  scheduledFor: true, finishedAt: true,
  subtotalSnapshot: true, serviceSubtotalSnapshot: true, productSubtotalSnapshot: true,
  tipAmount: true, taxAmount: true, discountAmount: true, totalAmount: true,
  checkoutStatus: true, selectedPaymentMethod: true,
  paymentAuthorizedAt: true, paymentCollectedAt: true,
  totalDurationMinutes: true, bufferMinutes: true,
  locationType: true, locationId: true, locationTimeZone: true, locationAddressSnapshot: true,
  clientId: true, professionalId: true,
  service: { select: { id: true, name: true } },
  professional: { select: { id: true, businessName: true, location: true, timeZone: true } },
  location: { select: { id: true, name: true, formattedAddress: true, city: true, state: true, timeZone: true } },
  consultationNotes: true, consultationPrice: true, consultationConfirmedAt: true,
  consultationApproval: { select: { status: true, proposedServicesJson: true, proposedTotal: true, notes: true, approvedAt: true, rejectedAt: true } },
  serviceItems: {
    select: { id: true, itemType: true, parentItemId: true, sortOrder: true, durationMinutesSnapshot: true, priceSnapshot: true, serviceId: true, service: { select: { name: true } } },
    orderBy: [{ sortOrder: 'asc' as const }],
  },
  productSales: {
    select: { id: true, productId: true, quantity: true, unitPrice: true, product: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' as const }],
  },
} satisfies Prisma.BookingSelect

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.CLIENT, Role.PRO, Role.ADMIN] })
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Booking ID is required.')

    const user = auth.user
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: bookingSelect })
    if (!booking) return jsonFail(404, 'Booking not found.')

    // Access check: client or pro on the booking, or admin
    const clientId = user.clientProfile?.id ?? null
    const professionalId = user.professionalProfile?.id ?? null
    const isAdmin = user.role === Role.ADMIN
    const isClient = clientId != null && booking.clientId === clientId
    const isPro = professionalId != null && booking.professionalId === professionalId

    if (!isAdmin && !isClient && !isPro) {
      return jsonFail(403, 'Forbidden.')
    }

    // Check for unread aftercare (AftercareSummary sent but not viewed by client)
    const hasUnreadAftercare = isClient
      ? await prisma.aftercareSummary.count({
          where: { bookingId, sentToClientAt: { not: null } },
        }).then(Boolean)
      : false

    const hasPendingConsultationApproval =
      booking.consultationApproval?.status === 'PENDING'

    const dto = await buildClientBookingDTO({
      booking: booking as Parameters<typeof buildClientBookingDTO>[0]['booking'],
      unreadAftercare: hasUnreadAftercare,
      hasPendingConsultationApproval,
    })

    return jsonOk({ booking: dto })
  } catch (err) {
    console.error('GET /api/bookings/[id] error', err)
    return jsonFail(500, 'Failed to fetch booking.')
  }
}
