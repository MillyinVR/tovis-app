import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { declinePriorityOffer } from '@/lib/lastMinute/priorityOffer/priorityOffer'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ recipientId: string }> }

export async function POST(_req: Request, ctx: RouteContext) {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  const { recipientId } = await ctx.params

  const recipient = await prisma.lastMinuteRecipient.findUnique({
    where: { id: recipientId },
    select: { clientId: true },
  })

  if (!recipient) return jsonFail(404, 'Offer not found.')
  if (recipient.clientId !== auth.clientId) {
    return jsonFail(403, 'Not your offer.')
  }

  const result = await declinePriorityOffer(recipientId)

  if (!result.ok) {
    return jsonFail(result.reason === 'not_priority' ? 409 : 404, 'Cannot decline this offer.')
  }

  return jsonOk({ declined: true }, 200)
}
