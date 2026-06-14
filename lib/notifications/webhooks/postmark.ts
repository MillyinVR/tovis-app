// lib/notifications/webhooks/postmark.ts

import { NotificationProvider, Prisma } from '@prisma/client'

import { readOptionalEnv as readEnv } from '@/lib/env'

export type PostmarkWebhookPayload = Prisma.InputJsonObject

export type PostmarkDeliveryWebhookKind =
  | 'STATUS_UPDATE'
  | 'DELIVERED'
  | 'FAILED_FINAL'

export type PostmarkDeliveryWebhookPayload = {
  provider: typeof NotificationProvider.POSTMARK
  providerMessageId: string
  providerStatus: string
  kind: PostmarkDeliveryWebhookKind
  occurredAt: Date
  errorCode: string | null
  errorMessage: string | null
  payload: PostmarkWebhookPayload
}

export type PostmarkWebhookAuthResult =
  | { ok: true }
  | {
      ok: false
      status: 401 | 500
      message: string
      code:
        | 'POSTMARK_WEBHOOK_SECRET_MISSING'
        | 'POSTMARK_WEBHOOK_UNAUTHORIZED'
    }

export type PostmarkWebhookParseResult =
  | {
      ok: true
      webhook: PostmarkDeliveryWebhookPayload
    }
  | {
      ok: false
      status: 400
      message: string
      code:
        | 'POSTMARK_INVALID_JSON'
        | 'POSTMARK_MESSAGE_ID_MISSING'
    }

function readOptionalString(value: unknown): string | null {
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

export function readPostmarkWebhookSecret(): string | null {
  return (
    readEnv('POSTMARK_WEBHOOK_SECRET') ??
    readEnv('POSTMARK_WEBHOOK_TOKEN')
  )
}

export function decodePostmarkBasicAuth(header: string): {
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

export function validatePostmarkWebhookAuth(request: Request): PostmarkWebhookAuthResult {
  const secret = readPostmarkWebhookSecret()

  if (!secret) {
    return {
      ok: false,
      status: 500,
      message: 'Postmark webhook authentication is not configured.',
      code: 'POSTMARK_WEBHOOK_SECRET_MISSING',
    }
  }

  const secretHeader = readOptionalString(
    request.headers.get('x-postmark-webhook-secret'),
  )

  if (secretHeader === secret) {
    return { ok: true }
  }

  const authorization = readOptionalString(request.headers.get('authorization'))

  if (authorization === `Bearer ${secret}`) {
    return { ok: true }
  }

  if (authorization) {
    const basic = decodePostmarkBasicAuth(authorization)

    if (basic && basic.password === secret) {
      return { ok: true }
    }
  }

  return {
    ok: false,
    status: 401,
    message: 'Unauthorized.',
    code: 'POSTMARK_WEBHOOK_UNAUTHORIZED',
  }
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

export function isPostmarkWebhookPayload(
  value: unknown,
): value is PostmarkWebhookPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => isInputJsonValue(item))
  )
}

export async function readPostmarkWebhookJsonPayload(
  request: Request,
): Promise<PostmarkWebhookPayload | null> {
  const body: unknown = await request.json().catch(() => null)
  return isPostmarkWebhookPayload(body) ? body : null
}

export function readPostmarkProviderMessageId(
  payload: PostmarkWebhookPayload,
): string | null {
  return readOptionalString(payload.MessageID) ?? readOptionalString(payload.MessageId)
}

export function readPostmarkRecordType(
  payload: PostmarkWebhookPayload,
): string | null {
  return readOptionalString(payload.RecordType)
}

export function buildPostmarkProviderStatus(
  payload: PostmarkWebhookPayload,
): string {
  const recordType = readPostmarkRecordType(payload)?.toLowerCase() ?? 'unknown'

  if (recordType === 'delivery') {
    return 'delivered'
  }

  if (recordType === 'bounce') {
    const bounceType = readOptionalString(payload.Type)
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

export function mapPostmarkRecordTypeToDeliveryKind(
  payload: PostmarkWebhookPayload,
): PostmarkDeliveryWebhookKind {
  const recordType = readPostmarkRecordType(payload)?.toLowerCase() ?? 'unknown'

  if (recordType === 'delivery') {
    return 'DELIVERED'
  }

  if (recordType === 'bounce' || recordType === 'spamcomplaint') {
    return 'FAILED_FINAL'
  }

  return 'STATUS_UPDATE'
}

export function readPostmarkOccurredAt(payload: PostmarkWebhookPayload): Date {
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

export function readPostmarkErrorCode(
  payload: PostmarkWebhookPayload,
): string | null {
  const typeCode =
    typeof payload.TypeCode === 'number' ? String(payload.TypeCode) : null

  return typeCode ?? readOptionalString(payload.ErrorCode)
}

export function readPostmarkErrorMessage(
  payload: PostmarkWebhookPayload,
): string | null {
  return (
    readOptionalString(payload.Description) ??
    readOptionalString(payload.Details) ??
    readOptionalString(payload.Message)
  )
}

export function parsePostmarkDeliveryWebhookPayload(
  payload: PostmarkWebhookPayload | null,
): PostmarkWebhookParseResult {
  if (!payload) {
    return {
      ok: false,
      status: 400,
      message: 'Invalid JSON body.',
      code: 'POSTMARK_INVALID_JSON',
    }
  }

  const providerMessageId = readPostmarkProviderMessageId(payload)

  if (!providerMessageId) {
    return {
      ok: false,
      status: 400,
      message: 'Missing MessageID.',
      code: 'POSTMARK_MESSAGE_ID_MISSING',
    }
  }

  return {
    ok: true,
    webhook: {
      provider: NotificationProvider.POSTMARK,
      providerMessageId,
      providerStatus: buildPostmarkProviderStatus(payload),
      kind: mapPostmarkRecordTypeToDeliveryKind(payload),
      occurredAt: readPostmarkOccurredAt(payload),
      errorCode: readPostmarkErrorCode(payload),
      errorMessage: readPostmarkErrorMessage(payload),
      payload,
    },
  }
}

export async function readPostmarkDeliveryWebhookFromRequest(
  request: Request,
): Promise<{
  auth: PostmarkWebhookAuthResult
  parsed: PostmarkWebhookParseResult | null
}> {
  const auth = validatePostmarkWebhookAuth(request)

  if (!auth.ok) {
    return {
      auth,
      parsed: null,
    }
  }

  const payload = await readPostmarkWebhookJsonPayload(request)

  return {
    auth,
    parsed: parsePostmarkDeliveryWebhookPayload(payload),
  }
}