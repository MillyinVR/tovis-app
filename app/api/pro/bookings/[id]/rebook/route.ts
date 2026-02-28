// app/api/pro/bookings/[id]/rebook/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  AftercareRebookMode,
  BookingSource,
  BookingStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

type RebookMode = 'BOOK' | 'RECOMMEND_WINDOW' | 'CLEAR'

type Body = {
  mode?: unknown
  scheduledFor?: unknown
  windowStart?: unknown
  windowEnd?: unknown
}

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function parseISODate(v: unknown): Date | null {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function isMode(x: unknown): x is RebookMode {
  return x === 'BOOK' || x === 'RECOMMEND_WINDOW' || x === 'CLEAR'
}

function mustLocationType(v: ServiceLocationType): ServiceLocationType {
  // this is already typed, but keeping a guard-style function makes intent explicit
  if (v === ServiceLocationType.SALON) return v
  if (v === ServiceLocationType.MOBILE) return v
  // if schema ever expands, this will force you to handle it
  throw new Error(`Unsupported ServiceLocationType: ${String(v)}`)
}

function toInputJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.map((item) => (item === null ? null : toInputJsonValue(item)))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      out[key] = item === null ? null : toInputJsonValue(item)
    }
    return out
  }
  throw new Error('Unsupported JSON snapshot value.')
}

const bookingSelect = Prisma.validator<Prisma.BookingSelect>()({
  id: true,
  status: true,
  clientId: true,
  professionalId: true,

  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,

  bufferMinutes: true,

  serviceItems: {
    orderBy: { sortOrder: 'asc' },
    select: {
      serviceId: true,
      offeringId: true,
      priceSnapshot: true,
      durationMinutesSnapshot: true,
      sortOrder: true,
      itemType: true,
      parentItemId: true,
    },
  },
})

type BookingPayload = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const originalBookingId = pickString(params?.id)
    if (!originalBookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as Body
    const modeRaw = body.mode ?? 'BOOK'
    const mode: RebookMode = isMode(modeRaw) ? modeRaw : 'BOOK'

    const booking: BookingPayload | null = await prisma.booking.findUnique({
      where: { id: originalBookingId },
      select: bookingSelect,
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden.')
    if (booking.status !== BookingStatus.COMPLETED) {
      return jsonFail(409, 'Only COMPLETED bookings can be rebooked.')
    }

    const bookingId = booking.id

    // ---- CLEAR ----
    if (mode === 'CLEAR') {
      const aftercare = await prisma.aftercareSummary.upsert({
        where: { bookingId },
        create: {
          bookingId,
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        },
        update: {
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        },
        select: { id: true, rebookMode: true },
      })

      return jsonOk({ mode, aftercareId: aftercare.id, rebookMode: aftercare.rebookMode }, 200)
    }

    // ---- RECOMMEND_WINDOW ----
    if (mode === 'RECOMMEND_WINDOW') {
      const windowStart = parseISODate(body.windowStart)
      const windowEnd = parseISODate(body.windowEnd)

      if (!windowStart || !windowEnd) {
        return jsonFail(
          400,
          'windowStart and windowEnd are required ISO strings for RECOMMEND_WINDOW.',
        )
      }
      if (windowEnd <= windowStart) return jsonFail(400, 'windowEnd must be after windowStart.')

      const aftercare = await prisma.aftercareSummary.upsert({
        where: { bookingId },
        create: {
          bookingId,
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookWindowStart: windowStart,
          rebookWindowEnd: windowEnd,
          rebookedFor: null,
        },
        update: {
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookWindowStart: windowStart,
          rebookWindowEnd: windowEnd,
          rebookedFor: null,
        },
        select: {
          id: true,
          rebookMode: true,
          rebookWindowStart: true,
          rebookWindowEnd: true,
          rebookedFor: true,
        },
      })

      return jsonOk({ mode, aftercare }, 200)
    }

    // ---- BOOK ----
    const scheduledFor = parseISODate(body.scheduledFor)
    if (!scheduledFor) return jsonFail(400, 'scheduledFor is required (ISO string) for BOOK mode.')

    const now = new Date()
    if (scheduledFor.getTime() < now.getTime() + 60_000) {
      return jsonFail(400, 'scheduledFor must be at least 1 minute in the future.')
    }

    const items = booking.serviceItems ?? []
    const primary = items[0] ?? null
    if (!primary?.serviceId || !primary?.offeringId) {
      return jsonFail(409, 'This booking has no service items to rebook.')
    }

    const locationType = mustLocationType(booking.locationType)

    // JSON + snapshots: use undefined (Prisma-safe) instead of null
    const locationAddressSnapshot =
      booking.locationAddressSnapshot == null ? undefined : toInputJsonValue(booking.locationAddressSnapshot)

    const locationLatSnapshot = booking.locationLatSnapshot ?? undefined
    const locationLngSnapshot = booking.locationLngSnapshot ?? undefined
    const locationTimeZone = booking.locationTimeZone ?? undefined

    const zero = new Prisma.Decimal(0)
    const subtotal = items.reduce(
      (sum, i) => sum.plus(i.priceSnapshot ?? zero),
      new Prisma.Decimal(0),
    )
    const duration = items.reduce(
      (sum, i) => sum + Number(i.durationMinutesSnapshot ?? 0),
      0,
    )

    const created = await prisma.$transaction(async (tx) => {
      const nextBooking = await tx.booking.create({
        data: {
          clientId: booking.clientId,
          professionalId: booking.professionalId,

          // required base service
          serviceId: primary.serviceId,
          offeringId: primary.offeringId,

          scheduledFor,
          status: BookingStatus.ACCEPTED,

          locationType,
          locationId: booking.locationId,

          locationTimeZone,
          locationAddressSnapshot,
          locationLatSnapshot,
          locationLngSnapshot,

          subtotalSnapshot: subtotal,
          totalDurationMinutes: Math.max(15, Math.round(duration || 60)),
          bufferMinutes: Math.max(0, Number(booking.bufferMinutes ?? 0)),

          source: BookingSource.AFTERCARE,
          rebookOfBookingId: bookingId,

          // copy items
          serviceItems: {
            create: items.map((i) => ({
              serviceId: i.serviceId,
              offeringId: i.offeringId,
              itemType: i.itemType,
              parentItemId: i.parentItemId,
              priceSnapshot: i.priceSnapshot ?? zero,
              durationMinutesSnapshot: Math.max(
                15,
                Math.round(Number(i.durationMinutesSnapshot ?? 60)),
              ),
              sortOrder: Number.isFinite(Number(i.sortOrder)) ? Number(i.sortOrder) : 0,
            })),
          },
        },
        select: { id: true, scheduledFor: true, status: true },
      })

      const aftercare = await tx.aftercareSummary.upsert({
        where: { bookingId },
        create: {
          bookingId,
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor: scheduledFor,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        },
        update: {
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor: scheduledFor,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        },
        select: { id: true, rebookMode: true, rebookedFor: true },
      })

      return { nextBooking, aftercare }
    })

    return jsonOk({ mode, nextBookingId: created.nextBooking.id, aftercare: created.aftercare }, 201)
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/rebook error', e)
    return jsonFail(500, 'Internal server error')
  }
}
