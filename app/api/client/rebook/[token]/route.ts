// app/api/client/rebook/[token]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireClient, pickString, upper, jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

function isValidDate(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId } = auth

    const { token: rawToken } = await Promise.resolve(ctx.params as any)
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
      ok: true,
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
    if (auth.res) return auth.res
    const { clientId } = auth

    const { token: rawToken } = await Promise.resolve(ctx.params as any)
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
    const mode = upper(aftercare.rebookMode)
    if (mode === 'RECOMMENDED_WINDOW') {
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
      const b = aftercare.booking!

      const newBooking = await tx.booking.create({
        data: {
          clientId,
          professionalId: b.professionalId,
          serviceId: b.serviceId,
          offeringId: b.offeringId ?? null,

          scheduledFor,
          status: 'PENDING',
          source: 'AFTERCARE',

          locationType: b.locationType,
          locationId: b.locationId,

          locationTimeZone: b.locationTimeZone ?? null,
          locationAddressSnapshot: (b.locationAddressSnapshot ?? null) as any,
          locationLatSnapshot: b.locationLatSnapshot ?? null,
          locationLngSnapshot: b.locationLngSnapshot ?? null,

          clientTimeZoneAtBooking: b.clientTimeZoneAtBooking ?? null,

          subtotalSnapshot: b.subtotalSnapshot,
          totalAmount: b.totalAmount ?? null,
          depositAmount: b.depositAmount ?? null,
          tipAmount: b.tipAmount ?? null,
          taxAmount: b.taxAmount ?? null,
          discountAmount: b.discountAmount ?? null,

          totalDurationMinutes: b.totalDurationMinutes,
          bufferMinutes: b.bufferMinutes ?? 0,

          sessionStep: 'NONE',
        },
        select: { id: true, status: true, scheduledFor: true },
      })

      await tx.aftercareSummary.update({
        where: { id: aftercare.id },
        data: {
          rebookMode: 'BOOKED_NEXT_APPOINTMENT',
          rebookedFor: scheduledFor,
        },
      })

      return newBooking
    })

    return NextResponse.json(
      { ok: true, booking: { id: created.id, status: created.status, scheduledFor: created.scheduledFor.toISOString() } },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/client/rebook/[token] error:', e)
    return jsonFail(500, 'Internal server error')
  }
}
