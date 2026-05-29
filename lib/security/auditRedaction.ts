// lib/security/auditRedaction.ts

/**
 * Central audit-log redaction helpers.
 *
 * Audit logs need enough detail to explain what changed, but they must not
 * persist raw PII, tokens, signed URLs, private media paths, payment secrets,
 * or address payloads.
 *
 * Use `redactAuditPayload(...)` before writing JSON snapshots to audit tables,
 * idempotency response bodies, admin action logs, or other long-lived
 * diagnostic records.
 */

import type { Prisma } from '@prisma/client'

type JsonValue = Prisma.JsonValue
type JsonObject = Prisma.JsonObject
type JsonArray = Prisma.JsonArray

const REDACTED = '[REDACTED]'
const TRUNCATED = '[TRUNCATED]'

const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 50
const MAX_OBJECT_KEYS = 100
const MAX_DEPTH = 8

const SENSITIVE_EXACT_KEYS = new Set([
  // Auth/session/token fields
  'accessToken',
  'actionToken',
  'apiKey',
  'authorization',
  'authToken',
  'bearer',
  'clientSecret',
  'csrf',
  'csrfToken',
  'idToken',
  'jwt',
  'password',
  'passwordHash',
  'passwordResetToken',
  'privateKey',
  'publicToken',
  'refreshToken',
  'secret',
  'secretKey',
  'session',
  'sessionToken',
  'signature',
  'signedUrl',
  'token',
  'tokenHash',

  // Contact / identity
  'address',
  'addressLine1',
  'addressLine2',
  'city',
  'clientAddress',
  'dateOfBirth',
  'dob',
  'email',
  'emailAddress',
  'firstName',
  'fullName',
  'lastName',
  'legalName',
  'name',
  'phone',
  'phoneNumber',
  'postalCode',
  'street',
  'street1',
  'street2',
  'zip',
  'zipCode',

  // Notes / free text likely to contain sensitive content
  'aftercareBody',
  'aftercareNotes',
  'body',
  'clientNotes',
  'consultationNotes',
  'description',
  'message',
  'note',
  'notes',
  'privateNote',
  'privateNotes',
  'summary',

  // Media / storage
  'bucket',
  'mediaPath',
  'objectKey',
  'path',
  'privateMediaPath',
  'storageKey',
  'url',

  // Payments / providers
  'accountNumber',
  'bankAccount',
  'card',
  'cardNumber',
  'paymentMethod',
  'paymentSecret',
  'routingNumber',
  'stripeAccountId',
  'stripeCustomerId',
  'stripePaymentIntentId',
  'stripeSecret',
])

const SENSITIVE_KEY_PATTERNS = [
  /address/i,
  /aftercare.*(body|note|summary|text|content)/i,
  /api[-_]?key/i,
  /auth(orization)?/i,
  /bearer/i,
  /card/i,
  /client[-_]?secret/i,
  /consultation.*(body|note|summary|text|content)/i,
  /csrf/i,
  /date.*birth/i,
  /dob/i,
  /email/i,
  /first.*name/i,
  /full.*name/i,
  /last.*name/i,
  /media.*(path|url|key)/i,
  /message.*(body|text|content)/i,
  /note/i,
  /password/i,
  /phone/i,
  /postal/i,
  /private.*(path|url|note|media)/i,
  /refresh[-_]?token/i,
  /secret/i,
  /session[-_]?token/i,
  /signed[-_]?url/i,
  /ssn/i,
  /street/i,
  /token/i,
  /url/i,
  /zip/i,
]

const SENSITIVE_STRING_PATTERNS = [
  // Bearer/API tokens
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/u,
  /\bsk_(?:live|test)_[A-Za-z0-9_]+/u,
  /\brk_(?:live|test)_[A-Za-z0-9_]+/u,

  // JWT-like strings
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,

  // Email
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,

  // Phone-ish values
  /\+?\d[\d\s().-]{7,}\d/u,

  // Signed URL / provider query signatures
  /(?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|token=|signature=|signed|expires=)/iu,

  // Supabase storage paths and likely private media references
  /(?:media-private|private-media|verification-documents|aftercare|consultation)/iu,
]

const ADDRESS_ENVELOPE_KEYS = new Set([
  'v',
  'algorithm',
  'keyVersion',
  'street',
  'street2',
  'city',
  'region',
  'state',
  'postalCode',
  'country',
  'lat',
  'lng',
  'label',
])

/**
 * Redacts a value before storing it in long-lived audit/log JSON.
 *
 * Accepts `unknown` intentionally because this function is the safety boundary.
 * Callers should not need to pre-shape route bodies, Prisma snapshots, or
 * service metadata before sending them through audit redaction.
 */
export function redactAuditPayload(value: unknown): JsonValue {
  if (!isJsonValue(value)) return REDACTED
  return redactValue(value, 0)
}

/**
 * Redacts old/new audit pair payloads with the same policy.
 */
export function redactAuditChangeSet(args: {
  oldValue: unknown
  newValue: unknown
}): {
  oldValue: JsonValue
  newValue: JsonValue
} {
  return {
    oldValue: redactAuditPayload(args.oldValue),
    newValue: redactAuditPayload(args.newValue),
  }
}

/**
 * Returns true when an object looks like the current address privacy envelope.
 *
 * The current expand-phase envelope can still contain plaintext address fields,
 * so the whole object should be redacted in audit storage.
 */
export function isAddressPrivacyEnvelopeLike(
  value: unknown,
): value is JsonObject {
  if (!isJsonObject(value)) return false

  const algorithm = value.algorithm
  const keyVersion = value.keyVersion

  if (typeof algorithm !== 'string') return false

  if (
    typeof keyVersion !== 'string' &&
    typeof keyVersion !== 'number'
  ) {
    return false
  }

  const keys = Object.keys(value)
  if (keys.length < 3) return false

  return keys.some((key) => ADDRESS_ENVELOPE_KEYS.has(key))
}

function redactValue(value: JsonValue, depth: number): JsonValue {
  if (value === null) return null

  if (typeof value === 'string') {
    return redactString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return redactArray(value, depth)
  }

  if (isJsonObject(value)) {
    return redactObject(value, depth)
  }

  return REDACTED
}

function redactArray(value: JsonArray, depth: number): JsonValue {
  if (depth >= MAX_DEPTH) return TRUNCATED

  const sliced = value
    .slice(0, MAX_ARRAY_LENGTH)
    .map((item) => redactValue(item, depth + 1))

  if (value.length > MAX_ARRAY_LENGTH) {
    return [...sliced, TRUNCATED]
  }

  return sliced
}

function redactObject(value: JsonObject, depth: number): JsonValue {
  if (depth >= MAX_DEPTH) return TRUNCATED

  if (isAddressPrivacyEnvelopeLike(value)) {
    return {
      redacted: true,
      reason: 'address_privacy_envelope',
      algorithm:
        typeof value.algorithm === 'string' ? value.algorithm : REDACTED,
      keyVersion:
        typeof value.keyVersion === 'string' ||
        typeof value.keyVersion === 'number'
          ? value.keyVersion
          : REDACTED,
    }
  }

  const result: JsonObject = {}
  const keys = Object.keys(value)

  for (const [index, key] of keys.entries()) {
    if (index >= MAX_OBJECT_KEYS) {
      result.__truncatedKeys = keys.length - MAX_OBJECT_KEYS
      break
    }

    if (isSensitiveKey(key)) {
      result[key] = REDACTED
      continue
    }

    const childValue = value[key]

    if (!isJsonValue(childValue)) {
      result[key] = REDACTED
      continue
    }

    result[key] = redactValue(childValue, depth + 1)
  }

  return result
}

function redactString(value: string): JsonValue {
  if (value.length === 0) return value

  if (isSensitiveString(value)) return REDACTED

  if (value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`
  }

  return value
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim()

  if (SENSITIVE_EXACT_KEYS.has(normalized)) return true

  const lower = normalized.toLowerCase()
  if (SENSITIVE_EXACT_KEYS.has(lower)) return true

  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isSensitiveString(value: string): boolean {
  return SENSITIVE_STRING_PATTERNS.some((pattern) => pattern.test(value))
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  if (typeof value === 'object') {
    for (const childValue of Object.values(value)) {
      if (!isJsonValue(childValue)) return false
    }

    return true
  }

  return false
}