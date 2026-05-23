import {
  redactAddress,
  redactEmail,
  redactNotes,
  redactPhone,
  redactSignedUrl,
  redactToken,
} from '@/lib/security/redaction'

const MAX_LOG_DEPTH = 4
const MAX_ARRAY_ITEMS = 25

export type SafeLogValue =
  | null
  | string
  | number
  | boolean
  | SafeLogValue[]
  | { [key: string]: SafeLogValue }

const REDACTED = '[redacted]'

const SAFE_ID_KEYS = new Set([
  'id',
  'bookingId',
  'clientId',
  'professionalId',
  'proId',
  'userId',
  'locationId',
  'holdId',
  'offeringId',
  'serviceId',
  'reviewId',
  'mediaId',
  'lookId',
  'commentId',
  'notificationId',
  'eventId',
  'stripeEventId',
  'stripeCheckoutSessionId',
  'stripePaymentIntentId',
  'providerMessageId',
  'requestId',
  'idempotencyRecordId',
])

const TOKEN_KEYS = new Set([
  'token',
  'rawToken',
  'accessToken',
  'refreshToken',
  'idToken',
  'sessionToken',
  'verificationToken',
  'passwordResetToken',
  'publicToken',
  'secret',
  'clientSecret',
  'apiKey',
  'authorization',
  'cookie',
  'setCookie',
])

const SIGNED_URL_KEYS = new Set([
  'url',
  'signedUrl',
  'downloadUrl',
  'uploadUrl',
  'mediaUrl',
])

const EMAIL_KEYS = new Set(['email'])
const PHONE_KEYS = new Set(['phone', 'phoneNumber'])

const ADDRESS_KEYS = new Set([
  'address',
  'formattedAddress',
  'locationAddressSnapshot',
  'clientAddressSnapshot',
])

const NOTES_KEYS = new Set([
  'notes',
  'body',
  'messageBody',
  'description',
  'providerPayload',
  'rawPayload',
  'payloadRaw',
])

function normalizeKey(key: string): string {
  return key.replace(/[-_]/g, '').toLowerCase()
}

function keyMatches(key: string, sensitiveKeys: Set<string>): boolean {
  const normalized = normalizeKey(key)

  for (const candidate of sensitiveKeys) {
    if (normalized === normalizeKey(candidate)) return true
  }

  return false
}

function sanitizeSafePrimitive(value: unknown): SafeLogValue {
  if (value == null) return null

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()

  return sanitizeLogValue(value, 0)
}

function redactByKey(key: string, value: unknown, depth: number): SafeLogValue {
  if (keyMatches(key, TOKEN_KEYS)) return REDACTED
  if (keyMatches(key, SIGNED_URL_KEYS)) return REDACTED
  if (keyMatches(key, EMAIL_KEYS)) return REDACTED
  if (keyMatches(key, PHONE_KEYS)) return REDACTED
  if (keyMatches(key, ADDRESS_KEYS)) return redactAddress(value)
  if (keyMatches(key, NOTES_KEYS)) return redactNotes(value)

  if (keyMatches(key, SAFE_ID_KEYS)) return sanitizeSafePrimitive(value)

  return sanitizeLogValue(value, depth + 1)
}

function sanitizeString(value: string): string {
  return redactNotes(
    redactAddress(
      redactSignedUrl(redactToken(redactPhone(redactEmail(value)))),
    ),
  )
}

function sanitizeLogValue(value: unknown, depth: number): SafeLogValue {
  if (value == null) return null

  if (typeof value === 'string') return sanitizeString(value)

  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (typeof value === 'bigint') return value.toString()

  if (value instanceof Date) return value.toISOString()

  if (value instanceof Error) return safeError(value)

  if (Array.isArray(value)) {
    if (depth >= MAX_LOG_DEPTH) return '[max-depth]'

    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeLogValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    if (depth >= MAX_LOG_DEPTH) return '[max-depth]'

    const output: Record<string, SafeLogValue> = {}

    for (const [key, item] of Object.entries(value)) {
      output[key] = redactByKey(key, item, depth)
    }

    return output
  }

  return String(value)
}

export function safeError(error: unknown): {
  name: string
  message: string
} {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: sanitizeString(error.message || 'Unknown error'),
    }
  }

  return {
    name: 'NonErrorThrown',
    message: sanitizeString(String(error)),
  }
}

export function safeLogMeta(meta: unknown): SafeLogValue {
  return sanitizeLogValue(meta, 0)
}