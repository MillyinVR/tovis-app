// lib/notifications/webhooks/twilio.ts

import Twilio from 'twilio'
import { NotificationProvider } from '@prisma/client'

export type TwilioWebhookFields = Record<string, string>

export type TwilioDeliveryWebhookKind =
  | 'STATUS_UPDATE'
  | 'DELIVERED'
  | 'FAILED_FINAL'

export type TwilioDeliveryWebhookPayload = {
  provider: typeof NotificationProvider.TWILIO
  providerMessageId: string
  providerStatus: string
  kind: TwilioDeliveryWebhookKind
  errorCode: string | null
  errorMessage: string | null
  occurredAt: Date
  payload: TwilioWebhookFields
}

export type TwilioDeliveryWebhookParseResult =
  | {
      ok: true
      webhook: TwilioDeliveryWebhookPayload
    }
  | {
      ok: false
      status: 400
      message: string
      code:
        | 'TWILIO_MESSAGE_ID_MISSING'
        | 'TWILIO_MESSAGE_STATUS_MISSING'
    }

export type TwilioSignatureValidationResult =
  | {
      ok: true
    }
  | {
      ok: false
      status: 401 | 500
      message: string
      code:
        | 'TWILIO_AUTH_TOKEN_MISSING'
        | 'TWILIO_SIGNATURE_MISSING'
        | 'TWILIO_SIGNATURE_INVALID'
    }

function readOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function readTwilioWebhookAuthToken(): string | null {
  return readOptionalString(process.env.TWILIO_AUTH_TOKEN)
}

export function formDataToTwilioWebhookFields(
  formData: FormData,
): TwilioWebhookFields {
  const fields: TwilioWebhookFields = {}

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      fields[key] = value
    }
  }

  return fields
}

export function buildTwilioWebhookExternalUrl(request: Request): string {
  const requestUrl = new URL(request.url)

  const forwardedProto =
    readOptionalString(
      request.headers.get('x-forwarded-proto')?.split(',')[0],
    ) ?? requestUrl.protocol.replace(':', '')

  const forwardedHost =
    readOptionalString(
      request.headers.get('x-forwarded-host')?.split(',')[0],
    ) ??
    readOptionalString(request.headers.get('host')?.split(',')[0]) ??
    requestUrl.host

  return `${forwardedProto}://${forwardedHost}${requestUrl.pathname}${requestUrl.search}`
}

export function validateTwilioWebhookSignature(args: {
  request: Request
  fields: TwilioWebhookFields
  authToken?: string | null
}): TwilioSignatureValidationResult {
  const authToken =
    readOptionalString(args.authToken) ?? readTwilioWebhookAuthToken()

  if (!authToken) {
    return {
      ok: false,
      status: 500,
      message: 'Twilio webhook authentication is not configured.',
      code: 'TWILIO_AUTH_TOKEN_MISSING',
    }
  }

  const signature = readOptionalString(
    args.request.headers.get('x-twilio-signature'),
  )

  if (!signature) {
    return {
      ok: false,
      status: 401,
      message: 'Unauthorized.',
      code: 'TWILIO_SIGNATURE_MISSING',
    }
  }

  const isValid = Twilio.validateRequest(
    authToken,
    signature,
    buildTwilioWebhookExternalUrl(args.request),
    args.fields,
  )

  if (!isValid) {
    return {
      ok: false,
      status: 401,
      message: 'Unauthorized.',
      code: 'TWILIO_SIGNATURE_INVALID',
    }
  }

  return {
    ok: true,
  }
}

export function readTwilioProviderMessageId(
  fields: TwilioWebhookFields,
): string | null {
  return (
    readOptionalString(fields.MessageSid) ??
    readOptionalString(fields.SmsSid) ??
    readOptionalString(fields.SmsMessageSid)
  )
}

export function readTwilioProviderStatus(
  fields: TwilioWebhookFields,
): string | null {
  return (
    readOptionalString(fields.MessageStatus) ??
    readOptionalString(fields.SmsStatus)
  )
}

export function mapTwilioStatusToDeliveryKind(
  providerStatus: string,
): TwilioDeliveryWebhookKind {
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

export function parseTwilioDeliveryWebhookFields(
  fields: TwilioWebhookFields,
): TwilioDeliveryWebhookParseResult {
  const providerMessageId = readTwilioProviderMessageId(fields)

  if (!providerMessageId) {
    return {
      ok: false,
      status: 400,
      message: 'Missing MessageSid or SmsSid.',
      code: 'TWILIO_MESSAGE_ID_MISSING',
    }
  }

  const providerStatus = readTwilioProviderStatus(fields)

  if (!providerStatus) {
    return {
      ok: false,
      status: 400,
      message: 'Missing MessageStatus or SmsStatus.',
      code: 'TWILIO_MESSAGE_STATUS_MISSING',
    }
  }

  return {
    ok: true,
    webhook: {
      provider: NotificationProvider.TWILIO,
      providerMessageId,
      providerStatus,
      kind: mapTwilioStatusToDeliveryKind(providerStatus),
      errorCode: readOptionalString(fields.ErrorCode),
      errorMessage: readOptionalString(fields.ErrorMessage),
      occurredAt: new Date(),
      payload: fields,
    },
  }
}

export async function readTwilioDeliveryWebhookFromRequest(
  request: Request,
): Promise<{
  fields: TwilioWebhookFields
  signature: TwilioSignatureValidationResult
  parsed: TwilioDeliveryWebhookParseResult | null
}> {
  const formData = await request.formData()
  const fields = formDataToTwilioWebhookFields(formData)

  const signature = validateTwilioWebhookSignature({
    request,
    fields,
  })

  if (!signature.ok) {
    return {
      fields,
      signature,
      parsed: null,
    }
  }

  return {
    fields,
    signature,
    parsed: parseTwilioDeliveryWebhookFields(fields),
  }
}