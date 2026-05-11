// app/api/internal/webhooks/twilio/notifications/status/route.ts

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { NotificationProvider } from '@prisma/client'

import { applyDeliveryWebhookUpdate } from '@/lib/notifications/webhooks/applyDeliveryWebhookUpdate'
import { readTwilioDeliveryWebhookFromRequest } from '@/lib/notifications/webhooks/twilio'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function runWebhook(request: Request) {
  const webhook = await readTwilioDeliveryWebhookFromRequest(request)

  if (!webhook.signature.ok) {
    return jsonFail(webhook.signature.status, webhook.signature.message, {
      code: webhook.signature.code,
    })
  }

  if (!webhook.parsed) {
    return jsonFail(400, 'Invalid Twilio webhook payload.', {
      code: 'TWILIO_WEBHOOK_INVALID',
    })
  }

  if (!webhook.parsed.ok) {
    return jsonFail(webhook.parsed.status, webhook.parsed.message, {
      code: webhook.parsed.code,
    })
  }

  const result = await applyDeliveryWebhookUpdate(webhook.parsed.webhook)

  return jsonOk({
    matched: result.matched,
    provider: NotificationProvider.TWILIO,
    providerMessageId: webhook.parsed.webhook.providerMessageId,
    providerStatus: webhook.parsed.webhook.providerStatus,
    kind: webhook.parsed.webhook.kind,
    ...(result.matched
      ? {
          deliveryId: result.delivery.id,
          previousStatus: result.previousStatus,
          nextStatus: result.nextStatus,
          statusChanged: result.statusChanged,
        }
      : {}),
  })
}

export async function POST(request: Request) {
  try {
    return await runWebhook(request)
  } catch (error: unknown) {
    console.error(
      'POST /api/internal/webhooks/twilio/notifications/status error',
      error,
    )

    return jsonFail(500, 'Internal server error', {
      code: 'INTERNAL',
    })
  }
}