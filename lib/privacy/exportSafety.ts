// lib/privacy/exportSafety.ts

/**
 * Privacy export safety guard.
 *
 * This is a last-line-of-defense check for payloads that are about to leave the
 * server as user privacy exports. It is not a replacement for explicit Prisma
 * select projections; it exists to catch accidental regressions when schema
 * fields or export shapes change.
 */

const UNSAFE_EXACT_KEYS = new Set([
  // Auth/security
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'csrfToken',
  'privateKey',
  'secret',
  'secretKey',
  'apiKey',
  'authorization',

  // Legacy and HMAC lookup identifiers
  'emailHash',
  'phoneHash',
  'emailHashV2',
  'phoneHashV2',
  'emailHashKeyVersion',
  'phoneHashKeyVersion',

  // Address encryption / raw privacy envelope internals
  'encryptedAddressJson',
  'encryptedLocationAddressSnapshotJson',
  'encryptedClientAddressSnapshotJson',
  'addressKeyVersion',
  'locationAddressSnapshotKeyVersion',
  'clientAddressSnapshotKeyVersion',
  'addressSnapshotsEncryptedAt',

  // Provider / delivery internals
  'recipientEmail',
  'recipientPhone',
  'recipientInAppTargetId',
  'providerMessageId',
  'providerStatus',
  'leaseToken',
  'leaseExpiresAt',
  'payload',
  'payloadJson',
  'metaJson',
  'contextJson',

  // Storage internals
  'storageBucket',
  'storagePath',
  'thumbBucket',
  'thumbPath',
  'bucket',
  'path',
  'objectKey',

  // Payment/provider IDs that should not be part of broad user exports
  'stripeCheckoutSessionId',
  'stripePaymentIntentId',
  'stripeConnectedAccountId',
  'stripeLastEventId',
  'stripeAccountId',
  'stripeCustomerId',
])

const SAFE_EXACT_KEYS = new Set([
  'clientActionTokens',
  'notificationDeliveries',
  'notificationDispatches',
])

const UNSAFE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /private[-_]?key/i,
  /api[-_]?key/i,
  /authorization/i,
  /email[-_]?hash/i,
  /phone[-_]?hash/i,
  /encrypted.*address/i,
  /address.*key.*version/i,
  /provider.*message/i,
  /lease.*token/i,
  /storage.*(bucket|path|key)/i,
  /thumb.*(bucket|path|key)/i,
  /payload.*json/i,
  /meta.*json/i,
  /context.*json/i,
  /stripe.*(secret|session|intent|account|customer|event)/i,
]

const UNSAFE_STRING_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/u,
  /\bsk_(?:live|test)_[A-Za-z0-9_]+/u,
  /\brk_(?:live|test)_[A-Za-z0-9_]+/u,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /(?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|signature=|signed|token=)/iu,
  /(?:media-private|private-media|verification-documents)/iu,
]

const MAX_PATHS = 50

export type ExportSafetyViolation = {
  path: string
  reason: 'unsafe_key' | 'unsafe_string' | 'circular_reference'
}

export class UnsafePrivacyExportError extends Error {
  readonly violations: ExportSafetyViolation[]

  constructor(violations: ExportSafetyViolation[]) {
    super(
      `Unsafe privacy export payload: ${violations
        .slice(0, 10)
        .map((violation) => `${violation.path} (${violation.reason})`)
        .join(', ')}`,
    )

    this.name = 'UnsafePrivacyExportError'
    this.violations = violations
  }
}

export function findUnsafePrivacyExportPaths(
  value: unknown,
): ExportSafetyViolation[] {
  const violations: ExportSafetyViolation[] = []
  visitValue({
    value,
    path: '$',
    seen: new WeakSet<object>(),
    violations,
  })

  return violations
}

export function assertSafePrivacyExportPayload(value: unknown): void {
  const violations = findUnsafePrivacyExportPaths(value)

  if (violations.length > 0) {
    throw new UnsafePrivacyExportError(violations)
  }
}

function visitValue(args: {
  value: unknown
  path: string
  seen: WeakSet<object>
  violations: ExportSafetyViolation[]
}): void {
  if (args.violations.length >= MAX_PATHS) return

  const { value, path, seen, violations } = args

  if (typeof value === 'string') {
    if (isUnsafeString(value)) {
      violations.push({
        path,
        reason: 'unsafe_string',
      })
    }

    return
  }

  if (value === null) return

  if (typeof value !== 'object') return

  if (seen.has(value)) {
    violations.push({
      path,
      reason: 'circular_reference',
    })
    return
  }

  seen.add(value)

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visitValue({
        value: item,
        path: `${path}[${index}]`,
        seen,
        violations,
      })
    })

    return
  }

  for (const [key, childValue] of Object.entries(value)) {
    const childPath = `${path}.${key}`

    if (isUnsafeKey(key)) {
      violations.push({
        path: childPath,
        reason: 'unsafe_key',
      })

      if (violations.length >= MAX_PATHS) return
      continue
    }

    visitValue({
      value: childValue,
      path: childPath,
      seen,
      violations,
    })

    if (violations.length >= MAX_PATHS) return
  }
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isUnsafeKey(key: string): boolean {
  const normalized = key.trim()
  const compact = normalizeKey(key)

  if (SAFE_EXACT_KEYS.has(normalized)) return false
  if (SAFE_EXACT_KEYS.has(compact)) return false

  if (UNSAFE_EXACT_KEYS.has(normalized)) return true
  if (UNSAFE_EXACT_KEYS.has(compact)) return true

  return UNSAFE_KEY_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isUnsafeString(value: string): boolean {
  return UNSAFE_STRING_PATTERNS.some((pattern) => pattern.test(value))
}