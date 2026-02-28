// app/api/client/rebook/[token]/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireClient, pickString, jsonFail, jsonOk } from '@/app/api/_utils'
import { AftercareRebookMode, BookingSource, BookingStatus, Prisma, SessionStep } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

function isValidDate(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime())
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

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const { token: rawToken } = await Promise.resolve(ctx.params)
    const token = pickString(rawToken)
    if (!token) return jsonFail(400, 'Missing token.')

    const aftercare = await prisma.aftercareSummary.findUnique({
      where: { publicToken: token },
      include: {
        booking: {
          select: {
            id: true,
            clientId: true,
            professionalId: true,
            serviceId: true,
            offeringId: true,
            scheduledFor: true,
            status: true,

            locationType: true,
            locationId: true,

            subtotalSnapshot: true,
            totalDurationMinutes: true,

            service: { select: { id: true, name: true } },
            professional: {
              select: {
                id: true,
                businessName: true,
                timeZone: true,
                location: true,
              },
            },
          },
        },
      },
    })

    if (!aftercare) return jsonFail(404, 'Invalid rebook link.')
    if (!aftercare.booking) return jsonFail(409, 'Rebook link is missing booking context.')
    if (aftercare.booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    return jsonOk({
      aftercare: {
        id: aftercare.id,
        bookingId: aftercare.bookingId,
        notes: aftercare.notes,
        serviceNotes: aftercare.serviceNotes,
        rebookMode: aftercare.rebookMode,
        rebookedFor: aftercare.rebookedFor ? aftercare.rebookedFor.toISOString() : null,
        rebookWindowStart: aftercare.rebookWindowStart ? aftercare.rebookWindowStart.toISOString() : null,
        rebookWindowEnd: aftercare.rebookWindowEnd ? aftercare.rebookWindowEnd.toISOString() : null,
        publicToken: aftercare.publicToken,
      },
      booking: {
        id: aftercare.booking.id,
        status: aftercare.booking.status,
        scheduledFor: aftercare.booking.scheduledFor.toISOString(),
        totalDurationMinutes: aftercare.booking.totalDurationMinutes,
        subtotalSnapshot: aftercare.booking.subtotalSnapshot,
        service: aftercare.booking.service,
        professional: aftercare.booking.professional,
      },
    })
  } catch (e) {
    console.error('GET /api/client/rebook/[token] error:', e)
    return jsonFail(500, 'Internal server error')
  }
}

type PostBody = { scheduledFor: string }

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const { token: rawToken } = await Promise.resolve(ctx.params)
    const token = pickString(rawToken)
    if (!token) return jsonFail(400, 'Missing token.')

    const body = (await req.json().catch(() => ({}))) as Partial<PostBody> & Record<string, unknown>
    const scheduledForRaw = pickString(body.scheduledFor)
    if (!scheduledForRaw) return jsonFail(400, 'Missing scheduledFor.')

    const scheduledFor = new Date(scheduledForRaw)
    if (!isValidDate(scheduledFor)) return jsonFail(400, 'Invalid scheduledFor.')
    if (scheduledFor.getTime() < Date.now()) return jsonFail(400, 'Pick a future time.')

    const aftercare = await prisma.aftercareSummary.findUnique({
      where: { publicToken: token },
      include: {
        booking: {
          select: {
            id: true,
            clientId: true,
            professionalId: true,
            serviceId: true,
            offeringId: true,

            locationType: true,
            locationId: true,
            locationTimeZone: true,
            locationAddressSnapshot: true,
            locationLatSnapshot: true,
            locationLngSnapshot: true,
            clientTimeZoneAtBooking: true,

            subtotalSnapshot: true,
            totalAmount: true,
            depositAmount: true,
            tipAmount: true,
            taxAmount: true,
            discountAmount: true,

            totalDurationMinutes: true,
            bufferMinutes: true,
          },
        },
      },
    })

    if (!aftercare) return jsonFail(404, 'Invalid rebook link.')
    if (!aftercare.booking) return jsonFail(409, 'Rebook link is missing booking context.')
    if (aftercare.booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    // enforce recommended window if enabled
    if (aftercare.rebookMode === AftercareRebookMode.RECOMMENDED_WINDOW) {
      const s = aftercare.rebookWindowStart
      const e = aftercare.rebookWindowEnd
      if (s && e) {
        const t = scheduledFor.getTime()
        if (t < s.getTime() || t > e.getTime()) {
          return jsonFail(409, 'Selected time is outside the recommended rebook window.')
        }
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const b = aftercare.booking
      if (!b) {
        throw new Error('Rebook link is missing booking context.')
      }

      const locationAddressSnapshot =
        b.locationAddressSnapshot == null ? undefined : toInputJsonValue(b.locationAddressSnapshot)
      const locationLatSnapshot = b.locationLatSnapshot ?? undefined
      const locationLngSnapshot = b.locationLngSnapshot ?? undefined

      const newBooking = await tx.booking.create({
        data: {
          clientId,
          professionalId: b.professionalId,
          serviceId: b.serviceId,
          offeringId: b.offeringId ?? undefined,

          scheduledFor,
          status: BookingStatus.PENDING,
          source: BookingSource.AFTERCARE,

          locationType: b.locationType,
          locationId: b.locationId,

          locationTimeZone: b.locationTimeZone ?? undefined,
          locationAddressSnapshot,
          locationLatSnapshot,
          locationLngSnapshot,
          clientTimeZoneAtBooking: b.clientTimeZoneAtBooking ?? undefined,

          subtotalSnapshot: b.subtotalSnapshot,
          totalAmount: b.totalAmount ?? undefined,
          depositAmount: b.depositAmount ?? undefined,
          tipAmount: b.tipAmount ?? undefined,
          taxAmount: b.taxAmount ?? undefined,
          discountAmount: b.discountAmount ?? undefined,

          totalDurationMinutes: b.totalDurationMinutes,
          bufferMinutes: b.bufferMinutes ?? 0,

          sessionStep: SessionStep.NONE,
        },
        select: { id: true, status: true, scheduledFor: true },
      })

      await tx.aftercareSummary.update({
        where: { id: aftercare.id },
        data: {
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor: scheduledFor,
        },
      })

      return newBooking
    })

    return jsonOk(
      {
        booking: {
          id: created.id,
          status: created.status,
          scheduledFor: created.scheduledFor.toISOString(),
        },
      },
      201,
    )
  } catch (e) {
    console.error('POST /api/client/rebook/[token] error:', e)
    return jsonFail(500, 'Internal server error')
  }
}
