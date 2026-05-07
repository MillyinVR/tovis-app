// lib/idempotency/client.ts

export function buildClientIdempotencyKey(args: {
  scope: string
  entityId: string
  action?: string
}): string {
  const cleanScope = args.scope.trim()
  const cleanEntityId = args.entityId.trim()
  const cleanAction = args.action?.trim()

  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : [
        cleanScope,
        cleanEntityId,
        cleanAction,
        Date.now(),
        Math.random().toString(36).slice(2),
      ]
        .filter(Boolean)
        .join('-')
}

export function idempotencyHeaders(key: string): Record<string, string> {
  return {
    'Idempotency-Key': key,
    'x-idempotency-key': key,
  }
}