// lib/idempotency/responses.ts
//
// The three refusals every idempotent route owes its caller, in one place.
//
// Extracted 2026-08-21 when a fourth route (POST /api/v1/holds) needed them.
// Before that there were three private copies, and they were NOT all the same:
// `missingKey` and `conflict` were byte-identical in all three, but
// `inProgress` had three different wordings because each route names its own
// operation. That difference is deliberate copy, not drift, so it survives as a
// parameter rather than being flattened into one generic sentence — the same
// call the `errorFromResponse` consolidation (#960) made: share the logic, keep
// the per-surface copy.
import { jsonFail } from '@/app/api/_utils'

export function idempotencyMissingKeyFail(): Response {
  return jsonFail(400, 'Missing idempotency key.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
  })
}

export function idempotencyConflictFail(): Response {
  return jsonFail(
    409,
    'This idempotency key was already used with a different request body.',
    {
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    },
  )
}

/**
 * @param operation names what is already running, in the caller's own words —
 * e.g. `'pro booking'` renders "A matching pro booking request is already in
 * progress." Pass the phrase the route used before this was shared; changing it
 * changes user-visible copy.
 */
export function idempotencyInProgressFail(operation: string): Response {
  return jsonFail(
    409,
    `A matching ${operation} request is already in progress.`,
    {
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    },
  )
}
