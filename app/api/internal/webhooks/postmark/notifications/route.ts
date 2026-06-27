// app/api/internal/webhooks/postmark/notifications/route.ts

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { NotificationProvider } from '@prisma/client'

import { applyDeliveryWebhookUpdate } from '@/lib/notifications/webhooks/applyDeliveryWebhookUpdate'
import { safeError } from '@/lib/security/logging'
import { readPostmarkDeliveryWebhookFromRequest } from '@/lib/notifications/webhooks/postmark'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function runWebhook(request: Request) {
  const webhook = await readPostmarkDeliveryWebhookFromRequest(request)

  if (!webhook.auth.ok) {
    return jsonFail(webhook.auth.status, webhook.auth.message, {
      code: webhook.auth.code,
    })
  }

  if (!webhook.parsed) {
    return jsonFail(400, 'Invalid Postmark webhook payload.', {
      code: 'POSTMARK_WEBHOOK_INVALID',
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
    provider: NotificationProvider.POSTMARK,
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
      'POST /api/internal/webhooks/postmark/notifications error',
      { error: safeError(error) },
    )

    return jsonFail(500, 'Internal server error', {
      code: 'INTERNAL',
    })
  }
}