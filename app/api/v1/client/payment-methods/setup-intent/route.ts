// app/api/v1/client/payment-methods/setup-intent/route.ts
//
// Starts a SetupIntent so the client can save a card on file (Phase 2 revenue
// protection). Dark unless ENABLE_NO_SHOW_PROTECTION is on.
import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import type { ClientSetupIntentResponseDTO } from '@/lib/dto/clientPaymentMethods'
import { createClientSetupIntent } from '@/lib/clientPayments/cardOnFile'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'

export const dynamic = 'force-dynamic'

export async function POST() {
  if (!noShowProtectionEnabled()) return jsonFail(404, 'Not found.')

  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const setup = await createClientSetupIntent({
      clientId: auth.clientId,
      email: auth.user.email,
    })

    const response: ClientSetupIntentResponseDTO = {
      clientSecret: setup.clientSecret,
      setupIntentId: setup.setupIntentId,
      customerId: setup.customerId,
      // Web inlines this from the NEXT_PUBLIC_ bundle; native clients can't, so
      // we vend it here to guarantee the SDK key matches the backend Stripe mode.
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
    }

    return jsonOk(response)
  } catch (error: unknown) {
    console.error('POST /api/v1/client/payment-methods/setup-intent error', error)
    return jsonFail(500, 'Failed to start saving your card.')
  }
}
