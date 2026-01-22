// app/api/pro/bookings/[id]/consultation-proposal/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const NOTES_MAX = 2000

/**
 * Route-local money helpers (only used here).
 * If you later add "@/lib/money", replace these imports and delete.
 */
function moneyStringToCents(raw: string): number {
  // Accept "123", "123.4", "123.45", "$1,234.50"
  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return 0
  const m = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!m) return 0
  const whole = m[1] || '0'
  let frac = (m[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'
  const cents = Number(whole) * 100 + Number(frac || '0')
  return Number.isFinite(cents) ? Math.max(0, cents) : 0
}

function parseMoneyToCents(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null
    return Math.round(v * 100)
  }
  if (typeof v === 'string') {
    const cents = moneyStringToCents(v)
    return cents >= 0 ? cents : null
  }
  const s = (v as any)?.toString?.()
  if (typeof s === 'string') return moneyStringToCents(s)
  return null
}

function centsToMoneyString(cents: number): string {
  const c = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(c / 100)
  const rem = c % 100
  return `${dollars}.${String(rem).padStart(2, '0')}`
}

function parseProposedServicesJson(v: unknown): any | null {
  if (v == null) return null

  // If already an object/array, accept
  if (typeof v === 'object') return v

  // If stringified JSON, parse it
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    try {
      const parsed = JSON.parse(s)
      if (parsed && typeof parsed === 'object') return parsed
      return null
    } catch {
      return null
    }
  }

  return null
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as {
      proposedServicesJson?: unknown
      proposedTotal?: unknown
      notes?: unknown
    }

    const proposedServicesJson = parseProposedServicesJson(body?.proposedServicesJson)
    if (!proposedServicesJson) return jsonFail(400, 'Missing proposed services.')

    const proposedCents = parseMoneyToCents(body?.proposedTotal)
    if (proposedCents == null) return jsonFail(400, 'Enter a valid total.')

    const notesRaw = pickString(body?.notes)
    const notes = notesRaw ? notesRaw.slice(0, NOTES_MAX) : null

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        clientId: true,
        status: true,
        finishedAt: true,
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden')

    // finalized = cancelled OR completed OR has finishedAt
    const statusUpper = typeof booking.status === 'string' ? booking.status.toUpperCase() : ''
    if (statusUpper === 'CANCELLED' || statusUpper === 'COMPLETED' || booking.finishedAt) {
      return jsonFail(409, 'This booking is finalized.')
    }

    const proposedTotalMoney = centsToMoneyString(proposedCents)

    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.consultationApproval.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          clientId: booking.clientId,
          proId: booking.professionalId,
          status: 'PENDING',
          proposedServicesJson: proposedServicesJson as any,
          proposedTotal: proposedTotalMoney as any, // Decimal string
          notes,
          approvedAt: null,
          rejectedAt: null,
        } as any,
        update: {
          status: 'PENDING',
          proposedServicesJson: proposedServicesJson as any,
          proposedTotal: proposedTotalMoney as any,
          notes,
          approvedAt: null,
          rejectedAt: null,
        } as any,
        select: {
          id: true,
          status: true,
          proposedTotal: true,
          updatedAt: true,
        },
      })

      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          sessionStep: 'CONSULTATION_PENDING_CLIENT' as any,
        } as any,
        select: { id: true, sessionStep: true },
      })

      // Notify client (best effort)
      try {
        await tx.clientNotification.create({
          data: {
            clientId: booking.clientId,
            type: 'BOOKING' as any,
            title: 'Consultation proposal ready',
            body: 'Your professional sent an updated service total for approval.',
            bookingId: booking.id,
            dedupeKey: `CONSULTATION_PROPOSED:${booking.id}:${approval.updatedAt.toISOString()}`,
          } as any,
        })
      } catch (e) {
        console.error('Client notification failed (consultation proposal):', e)
      }

      return { approval, sessionStep: updatedBooking.sessionStep, proposedCents }
    })

    return jsonOk(
      {
        approval: result.approval,
        sessionStep: result.sessionStep,
        proposedCents: result.proposedCents,
      },
      200,
    )
  } catch (e: any) {
    console.error('POST /api/pro/bookings/[id]/consultation-proposal error', e)
    return jsonFail(
      500,
      'Internal server error',
      process.env.NODE_ENV !== 'production' ? { name: e?.name, code: e?.code } : undefined,
    )
  }
}
