// app/api/client/bookings/[id]/consultation/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient, upper } from '@/app/api/_utils'
import { handleConsultationDecision, type ConsultationDecisionAction, type ConsultationDecisionCtx } from './_decision'

export const dynamic = 'force-dynamic'

type Ctx = ConsultationDecisionCtx & {
  params: Promise<{ id: string }> | { id: string }
}

type OwnershipOk = { ok: true }
type OwnershipFail = { ok: false; res: ReturnType<typeof jsonFail> }
type OwnershipResult = OwnershipOk | OwnershipFail

async function requireOwnership(bookingId: string, clientId: string): Promise<OwnershipResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, clientId: true },
  })

  if (!booking) return { ok: false, res: jsonFail(404, 'Booking not found.') }
  if (booking.clientId !== clientId) return { ok: false, res: jsonFail(403, 'Forbidden.') }
  return { ok: true }
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const { id: rawId } = await Promise.resolve(ctx.params)
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const own = await requireOwnership(bookingId, clientId)
    if (!own.ok) return own.res

    const approval = await prisma.consultationApproval.findUnique({
      where: { bookingId },
      select: {
        id: true,
        status: true,
        proposedServicesJson: true,
        proposedTotal: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        approvedAt: true,
        rejectedAt: true,
        clientId: true,
        proId: true,
      },
    })

    if (!approval) return jsonFail(404, 'No consultation proposal found.')

    return jsonOk({ bookingId, approval })
  } catch (e) {
    console.error('GET /api/client/bookings/[id]/consultation error', e)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    const a = upper(body?.action)

    if (a !== 'APPROVE' && a !== 'REJECT') return jsonFail(400, 'Invalid action.')

    const action: ConsultationDecisionAction = a === 'APPROVE' ? 'APPROVE' : 'REJECT'

    // ✅ no boundary cast needed
    return handleConsultationDecision(action, ctx)
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/consultation error', e)
    return jsonFail(500, 'Internal server error')
  }
}