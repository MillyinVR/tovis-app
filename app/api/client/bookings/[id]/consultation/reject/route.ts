// app/api/client/[bookingsid]/consultation/reject/route.ts
import { handleConsultationDecision } from '../_decision'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  return handleConsultationDecision('REJECT', ctx)
}
