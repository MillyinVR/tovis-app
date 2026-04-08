import { jsonFail, jsonOk } from '@/app/api/_utils'
import { NotificationProvider, Prisma } from '@prisma/client'

import { applyDeliveryWebhookUpdate } from '@/lib/notifications/webhooks/applyDeliveryWebhookUpdate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type PostmarkWebhookPayload = Prisma.InputJsonObject

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

function requireWebhookSecret(): string {
  const secret =
    readEnv('POSTMARK_WEBHOOK_SECRET') ??
    readEnv('POSTMARK_WEBHOOK_TOKEN')

  if (!secret) {
    throw new Error(
      'Missing POSTMARK_WEBHOOK_SECRET or POSTMARK_WEBHOOK_TOKEN configuration.',
    )
  }

  return secret
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function decodeBasicAuth(header: string): {
  username: string
  password: string
} | null {
  if (!header.startsWith('Basic ')) return null

  const encoded = header.slice('Basic '.length).trim()
  if (!encoded) return null

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
    const separator = decoded.indexOf(':')
    if (separator < 0) return null

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    }
  } catch {
    return null
  }
}

function isAuthorizedWebhookRequest(req: Request): boolean {
  const secret = requireWebhookSecret()

  const internalHeader = readString(
    req.headers.get('x-postmark-webhook-secret'),
  )
  if (internalHeader === secret) return true

  const authHeader = readString(req.headers.get('authorization'))
  if (!authHeader) return false

  if (authHeader === `Bearer ${secret}`) {
    return true
  }

  const basic = decodeBasicAuth(authHeader)
  if (basic && basic.password === secret) {
    return true
  }

  return false
}

function readProviderMessageId(
  payload: PostmarkWebhookPayload,
): string | null {
  return readString(payload.MessageID) ?? readString(payload.MessageId)
}

function readRecordType(payload: PostmarkWebhookPayload): string | null {
  return readString(payload.RecordType)
}

function buildProviderStatus(payload: PostmarkWebhookPayload): string {
  const recordType = readRecordType(payload)?.toLowerCase() ?? 'unknown'

  if (recordType === 'delivery') {
    return 'delivered'
  }

  if (recordType === 'bounce') {
    const bounceType = readString(payload.Type)
    return bounceType ? `bounce:${bounceType}` : 'bounce'
  }

  if (recordType === 'spamcomplaint') {
    return 'spam_complaint'
  }

  if (recordType === 'open') {
    return 'open'
  }

  if (recordType === 'click') {
    return 'click'
  }

  return recordType
}

function mapRecordTypeToKind(
  payload: PostmarkWebhookPayload,
): 'STATUS_UPDATE' | 'DELIVERED' | 'FAILED_FINAL' {
  const recordType = readRecordType(payload)?.toLowerCase() ?? 'unknown'

  if (recordType === 'delivery') {
    return 'DELIVERED'
  }

  if (recordType === 'bounce' || recordType === 'spamcomplaint') {
    return 'FAILED_FINAL'
  }

  return 'STATUS_UPDATE'
}

function readOccurredAt(payload: PostmarkWebhookPayload): Date {
  return (
    readDate(payload.DeliveredAt) ??
    readDate(payload.BouncedAt) ??
    readDate(payload.ReceivedAt) ??
    readDate(payload.InactiveAt) ??
    readDate(payload.ClickedAt) ??
    readDate(payload.FirstOpen) ??
    new Date()
  )
}

function readErrorCode(payload: PostmarkWebhookPayload): string | null {
  const typeCode =
    typeof payload.TypeCode === 'number' ? String(payload.TypeCode) : null

  return typeCode ?? readString(payload.ErrorCode)
}

function readErrorMessage(payload: PostmarkWebhookPayload): string | null {
  return (
    readString(payload.Description) ??
    readString(payload.Details) ??
    readString(payload.Message) ??
    null
  )
}

function isInputJsonValue(value: unknown): value is Prisma.InputJsonValue {
  if (value === null) return true

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every((item) => isInputJsonValue(item))
  }

  if (typeof value === 'object') {
    return Object.values(value).every((item) => isInputJsonValue(item))
  }

  return false
}

function isInputJsonObject(value: unknown): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => isInputJsonValue(item))
  )
}

async function parseJsonBody(
  req: Request,
): Promise<PostmarkWebhookPayload | null> {
  const body = await req.json().catch(() => null)
  return isInputJsonObject(body) ? body : null
}

async function runWebhook(req: Request) {
  requireWebhookSecret()

  if (!isAuthorizedWebhookRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  const payload = await parseJsonBody(req)
  if (!payload) {
    return jsonFail(400, 'Invalid JSON body.')
  }

  const providerMessageId = readProviderMessageId(payload)
  if (!providerMessageId) {
    return jsonFail(400, 'Missing MessageID.')
  }

  const providerStatus = buildProviderStatus(payload)
  const kind = mapRecordTypeToKind(payload)

  const result = await applyDeliveryWebhookUpdate({
    provider: NotificationProvider.POSTMARK,
    providerMessageId,
    providerStatus,
    kind,
    occurredAt: readOccurredAt(payload),
    errorCode: readErrorCode(payload),
    errorMessage: readErrorMessage(payload),
    payload,
  })

  return jsonOk({
    matched: result.matched,
    provider: NotificationProvider.POSTMARK,
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
      'POST /api/internal/webhooks/postmark/notifications error',
      err,
    )
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}