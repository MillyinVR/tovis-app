import { jsonFail, jsonOk } from '@/app/api/_utils'
import { NotificationProvider } from '@prisma/client'
import Twilio from 'twilio'

import { applyDeliveryWebhookUpdate } from '@/lib/notifications/webhooks/applyDeliveryWebhookUpdate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type TwilioWebhookFields = Record<string, string>

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

function requireEnv(name: string): string {
  const value = readEnv(name)
  if (!value) {
    throw new Error(`Missing ${name} configuration.`)
  }

  return value
}

function readOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function formDataToFields(formData: FormData): TwilioWebhookFields {
  const fields: TwilioWebhookFields = {}

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      fields[key] = value
    }
  }

  return fields
}

function buildExternalRequestUrl(req: Request): string {
  const url = new URL(req.url)

  const forwardedProto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '')
  const forwardedHost =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host')?.split(',')[0]?.trim() ||
    url.host

  return `${forwardedProto}://${forwardedHost}${url.pathname}${url.search}`
}

function isValidTwilioSignature(args: {
  req: Request
  fields: TwilioWebhookFields
}): boolean {
  const authToken = requireEnv('TWILIO_AUTH_TOKEN')
  const signature = readOptionalString(
    args.req.headers.get('x-twilio-signature'),
  )

  if (!signature) return false

  return Twilio.validateRequest(
    authToken,
    signature,
    buildExternalRequestUrl(args.req),
    args.fields,
  )
}

function readProviderMessageId(fields: TwilioWebhookFields): string | null {
  return (
    readOptionalString(fields.MessageSid) ??
    readOptionalString(fields.SmsSid)
  )
}

function readProviderStatus(fields: TwilioWebhookFields): string | null {
  return (
    readOptionalString(fields.MessageStatus) ??
    readOptionalString(fields.SmsStatus)
  )
}

function mapTwilioStatusToKind(
  providerStatus: string,
): 'STATUS_UPDATE' | 'DELIVERED' | 'FAILED_FINAL' {
  const normalized = providerStatus.trim().toLowerCase()

  if (normalized === 'delivered') {
    return 'DELIVERED'
  }

  if (
    normalized === 'failed' ||
    normalized === 'undelivered' ||
    normalized === 'canceled'
  ) {
    return 'FAILED_FINAL'
  }

  return 'STATUS_UPDATE'
}

async function runWebhook(req: Request) {
  requireEnv('TWILIO_AUTH_TOKEN')

  const formData = await req.formData()
  const fields = formDataToFields(formData)

  if (!isValidTwilioSignature({ req, fields })) {
    return jsonFail(401, 'Unauthorized')
  }

  const providerMessageId = readProviderMessageId(fields)
  if (!providerMessageId) {
    return jsonFail(400, 'Missing MessageSid or SmsSid.')
  }

  const providerStatus = readProviderStatus(fields)
  if (!providerStatus) {
    return jsonFail(400, 'Missing MessageStatus or SmsStatus.')
  }

  const kind = mapTwilioStatusToKind(providerStatus)
  const errorCode = readOptionalString(fields.ErrorCode)
  const errorMessage = readOptionalString(fields.ErrorMessage)
  const occurredAt = new Date()

  const result = await applyDeliveryWebhookUpdate({
    provider: NotificationProvider.TWILIO,
    providerMessageId,
    providerStatus,
    kind,
    occurredAt,
    errorCode,
    errorMessage,
    payload: fields,
  })

  return jsonOk({
    matched: result.matched,
    provider: NotificationProvider.TWILIO,
    providerMessageId,
    providerStatus,
    kind,
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

export async function POST(req: Request) {
  try {
    return await runWebhook(req)
  } catch (err: unknown) {
    console.error(
      'POST /api/internal/webhooks/twilio/notifications/status error',
      err,
    )
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}