// app/api/v1/client/payment-methods/route.ts
//
// GET  — list the client's saved cards.
// POST — persist the card the client just confirmed via a SetupIntent.
// Dark unless ENABLE_NO_SHOW_PROTECTION is on (Phase 2 revenue protection).
import type { NextRequest } from 'next/server'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import type {
  ClientPaymentMethodConfirmResponseDTO,
  ClientPaymentMethodsListResponseDTO,
} from '@/lib/dto/clientPaymentMethods'
import {
  listClientPaymentMethods,
  persistConfirmedClientCard,
} from '@/lib/clientPayments/cardOnFile'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!noShowProtectionEnabled()) return jsonFail(404, 'Not found.')

  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const paymentMethods = await listClientPaymentMethods(auth.clientId)

    const response: ClientPaymentMethodsListResponseDTO = { paymentMethods }
    return jsonOk(response)
  } catch (error: unknown) {
    console.error('GET /api/v1/client/payment-methods error', error)
    return jsonFail(500, 'Failed to load your saved cards.')
  }
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function POST(req: NextRequest) {
  if (!noShowProtectionEnabled()) return jsonFail(404, 'Not found.')

  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body =
      typeof rawBody === 'object' && rawBody !== null
        ? (rawBody as Record<string, unknown>)
        : {}

    const setupIntentId = trimmedString(body.setupIntentId)
    if (!setupIntentId) {
      return jsonFail(400, 'A confirmed setupIntentId is required.')
    }

    const paymentMethod = await persistConfirmedClientCard({
      clientId: auth.clientId,
      setupIntentId,
    })

    const response: ClientPaymentMethodConfirmResponseDTO = { paymentMethod }
    return jsonOk(response)
  } catch (error: unknown) {
    console.error('POST /api/v1/client/payment-methods error', error)
    return jsonFail(500, 'Failed to save your card.')
  }
}
