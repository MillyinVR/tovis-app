// lib/idempotency/client.ts

const DEFAULT_BUCKET_MS = 60_000

function djb2Hash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Build a deterministic client idempotency key.
 *
 * Same (scope, entityId, action) within the same time bucket => same key.
 * Two clicks of the same button within the bucket window produce the same
 * key, so the server's idempotency ledger replays the first response
 * instead of running the side effect twice. After the bucket expires
 * (default 60s) a legitimate retry produces a fresh key.
 */
export function buildClientIdempotencyKey(args: {
  scope: string
  entityId: string
  action?: string
  bucketMs?: number
  nonce?: string
}): string {
  const scope = args.scope.trim()
  const entityId = args.entityId.trim()
  const action = args.action?.trim() ?? ''
  const nonce = args.nonce?.trim() ?? ''

  if (!scope || !entityId) {
    throw new Error(
      'buildClientIdempotencyKey requires a non-empty scope and entityId.',
    )
  }

  const bucketMs =
    typeof args.bucketMs === 'number' && args.bucketMs > 0
      ? args.bucketMs
      : DEFAULT_BUCKET_MS

  const bucket = Math.floor(Date.now() / bucketMs)

  const fingerprint = djb2Hash(
    [scope, entityId, action, String(bucket), nonce].join('␟'),
  )

  return [scope, entityId, action || 'default', String(bucket), fingerprint]
    .map((part) => encodeURIComponent(part))
    .join(':')
}

export function idempotencyHeaders(key: string): Record<string, string> {
  return {
    'Idempotency-Key': key,
    'x-idempotency-key': key,
  }
}
