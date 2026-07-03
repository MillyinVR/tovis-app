// app/api/v1/client/payment-methods/[id]/route.ts
//
// DELETE — remove a saved card (detaches from Stripe, promotes a new default).
// Dark unless ENABLE_NO_SHOW_PROTECTION is on (Phase 2 revenue protection).
import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import type { ClientPaymentMethodDeleteResponseDTO } from '@/lib/dto/clientPaymentMethods'
import { removeClientPaymentMethod } from '@/lib/clientPayments/cardOnFile'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, props: RouteContext) {
  if (!noShowProtectionEnabled()) return jsonFail(404, 'Not found.')

  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id } = await resolveRouteParams(props)
    const paymentMethodId =
      typeof id === 'string' && id.trim() ? id.trim() : null
    if (!paymentMethodId) {
      return jsonFail(400, 'A payment method id is required.')
    }

    const removed = await removeClientPaymentMethod({
      clientId: auth.clientId,
      paymentMethodId,
    })

    if (!removed) return jsonFail(404, 'Saved card not found.')

    const response: ClientPaymentMethodDeleteResponseDTO = {
      removedId: removed.removedId,
    }
    return jsonOk(response)
  } catch (error: unknown) {
    console.error('DELETE /api/v1/client/payment-methods/[id] error', error)
    return jsonFail(500, 'Failed to remove your saved card.')
  }
}
