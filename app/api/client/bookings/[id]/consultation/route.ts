// app/api/client/bookings/[id]/consultation/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickString,
  upper,
  requireClient,
} from '@/app/api/_utils'
import {
  handleConsultationDecision,
  type ConsultationDecisionAction,
  type ConsultationDecisionCtx,
} from './_decision'

export const dynamic = 'force-dynamic'

type Ctx = ConsultationDecisionCtx & {
  params: Promise<{ id: string }> | { id: string }
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId } = auth

    const { id: rawId } = await Promise.resolve(ctx.params as any)
    const id = pickString(rawId)
    if (!id) return jsonFail(400, 'Missing booking id.')

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

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

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

    if (!approval) return jsonFail(404, 'No consultation proposal found.')

    return jsonOk({ booking, approval })
  } catch (e) {
    console.error('GET /api/client/bookings/[id]/consultation error', e)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    const actionRaw = upper(body?.action)

    if (actionRaw !== 'APPROVE' && actionRaw !== 'REJECT') {
      return jsonFail(400, 'Invalid action.')
    }

    const action: ConsultationDecisionAction = actionRaw === 'APPROVE' ? 'APPROVE' : 'REJECT'
    return handleConsultationDecision(action, ctx as ConsultationDecisionCtx)
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/consultation error', e)
    return jsonFail(500, 'Internal server error')
  }
}
