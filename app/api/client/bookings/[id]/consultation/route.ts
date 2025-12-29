// app/api/client/bookings/[id]/consultation/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import {
  handleConsultationDecision,
  type ConsultationDecisionAction,
  type ConsultationDecisionCtx,
} from './_decision'

export const dynamic = 'force-dynamic'

// ✅ Folder is [id], so params must be { id: string }
type Ctx = ConsultationDecisionCtx & {
  params: Promise<{ id: string }> | { id: string }
}

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { id: rawId } = await Promise.resolve(ctx.params as any)
    const id = pickString(rawId)
    if (!id) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const booking = await prisma.booking.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const approval = await prisma.consultationApproval.findUnique({
      where: { bookingId: booking.id },
      select: {
        id: true,
        status: true,
        proposedServicesJson: true,
        proposedTotal: true,
        notes: true,
        createdAt: true,
        approvedAt: true,
        rejectedAt: true,
      },
    })

    if (!approval) {
      return NextResponse.json({ error: 'No consultation proposal found.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, booking, approval }, { status: 200 })
  } catch (e) {
    console.error('GET /api/client/bookings/[id]/consultation error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    const actionRaw = typeof body.action === 'string' ? body.action.toUpperCase().trim() : ''

    if (actionRaw !== 'APPROVE' && actionRaw !== 'REJECT') {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
    }

    const action: ConsultationDecisionAction = actionRaw === 'APPROVE' ? 'APPROVE' : 'REJECT'

    // ✅ Let _decision.ts read ctx.params.id (not bookingId)
    return handleConsultationDecision(action, ctx as ConsultationDecisionCtx)
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/consultation error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
