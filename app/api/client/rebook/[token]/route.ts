// app/api/client/rebook/[token]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function isValidDate(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return jsonError('Unauthorized', 401)
    }

    const { token: rawToken } = await Promise.resolve(ctx.params as any)
    const token = pickString(rawToken)
    if (!token) return jsonError('Missing token.')

    const aftercare = await prisma.aftercareSummary.findUnique({
      where: { publicToken: token },
      select: {
        id: true,
        bookingId: true,
        notes: true,
        rebookMode: true,
        rebookedFor: true,
        rebookWindowStart: true,
        rebookWindowEnd: true,
        publicToken: true,
        booking: {
          select: {
            id: true,
            clientId: true,
            professionalId: true,
            serviceId: true,
            scheduledFor: true,
            durationMinutesSnapshot: true,
            priceSnapshot: true,
            status: true,
            service: { select: { id: true, name: true } },
            professional: {
              select: {
                id: true,
                businessName: true,
                timeZone: true,
                location: true,
                city: true,
                state: true,
              },
            },
          },
        },
      },
    })

    if (!aftercare) return jsonError('Invalid rebook link.', 404)
    if (!aftercare.booking) return jsonError('Rebook link is missing booking context.', 409)

    // Security: token must map to *this* client
    if (aftercare.booking.clientId !== user.clientProfile.id) {
      return jsonError('Forbidden', 403)
    }

    return NextResponse.json(
      {
        ok: true,
        aftercare: {
          id: aftercare.id,
          bookingId: aftercare.bookingId,
          notes: aftercare.notes,
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
          durationMinutesSnapshot: aftercare.booking.durationMinutesSnapshot,
          priceSnapshot: aftercare.booking.priceSnapshot,
          service: aftercare.booking.service,
          professional: aftercare.booking.professional,
        },
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/client/rebook/[token] error:', e)
    return jsonError('Internal server error', 500)
  }
}

type PostBody = {
  scheduledFor: string
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return jsonError('Unauthorized', 401)
    }

    const { token: rawToken } = await Promise.resolve(ctx.params as any)
    const token = pickString(rawToken)
    if (!token) return jsonError('Missing token.')

    const body = (await req.json().catch(() => ({}))) as Partial<PostBody> & Record<string, unknown>
    const scheduledForRaw = pickString(body.scheduledFor)
    if (!scheduledForRaw) return jsonError('Missing scheduledFor.')

    const scheduledFor = new Date(scheduledForRaw)
    if (!isValidDate(scheduledFor)) return jsonError('Invalid scheduledFor.')
    if (scheduledFor.getTime() < Date.now()) return jsonError('Pick a future time.', 400)

    const clientId = user.clientProfile.id

    const aftercare = await prisma.aftercareSummary.findUnique({
      where: { publicToken: token },
      select: {
        id: true,
        bookingId: true,
        rebookMode: true,
        rebookWindowStart: true,
        rebookWindowEnd: true,
        booking: {
          select: {
            id: true,
            clientId: true,
            professionalId: true,
            serviceId: true,
            durationMinutesSnapshot: true,
            priceSnapshot: true,
            status: true,
          },
        },
      },
    })

    if (!aftercare) return jsonError('Invalid rebook link.', 404)
    if (!aftercare.booking) return jsonError('Rebook link is missing booking context.', 409)
    if (aftercare.booking.clientId !== clientId) return jsonError('Forbidden', 403)

    // Optional guardrail: enforce recommended window if that mode is set
    const mode = upper(aftercare.rebookMode)
    if (mode === 'RECOMMENDED_WINDOW') {
      const s = aftercare.rebookWindowStart
      const e = aftercare.rebookWindowEnd
      if (s && e) {
        const t = scheduledFor.getTime()
        if (t < s.getTime() || t > e.getTime()) {
          return jsonError('Selected time is outside the recommended rebook window.', 409)
        }
      }
    }

    // Create the new booking sourced from AFTERCARE
    // Status should be PENDING so the pro can accept (keeps your workflow consistent).
    const created = await prisma.$transaction(async (tx) => {
      const b = aftercare.booking!

      const newBooking = await tx.booking.create({
        data: {
          clientId,
          professionalId: b.professionalId,
          serviceId: b.serviceId,
          scheduledFor,
          status: 'PENDING' as any,
          source: 'AFTERCARE' as any,

          // carry forward snapshots when available (safe MVP behavior)
          durationMinutesSnapshot: b.durationMinutesSnapshot ?? 60,
          priceSnapshot: b.priceSnapshot ?? null,

          // sessionStep should start at the beginning of the lifecycle
          sessionStep: null as any,
        } as any,
        select: { id: true, status: true, scheduledFor: true },
      })

      // Update aftercare to reflect that a rebook happened (helps UI + analytics)
      await tx.aftercareSummary.update({
        where: { id: aftercare.id },
        data: {
          rebookMode: 'BOOKED_NEXT_APPOINTMENT' as any,
          rebookedFor: scheduledFor,
        } as any,
      })

      return newBooking
    })

    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: created.id,
          status: created.status,
          scheduledFor: created.scheduledFor.toISOString(),
        },
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/client/rebook/[token] error:', e)
    return jsonError('Internal server error', 500)
  }
}
