// lib/rateLimit/response.ts

import { jsonFail } from '@/app/api/_utils/responses'

import {
  getRateLimitHeaders,
  type BlockedRateLimitDecision,
  type RateLimitDecision,
} from './enforce'

export function rateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  return getRateLimitHeaders(decision)
}

export function rateLimitExceededResponse(
  decision: BlockedRateLimitDecision,
): Response {
  return jsonFail(
    429,
    'Too many requests. Please try again later.',
    {
      code: 'RATE_LIMITED',
      retryable: true,
      uiAction: 'RETRY_LATER',
      message: `Rate limit exceeded for ${decision.bucket}.`,
    },
    // `jsonFail`'s 4th parameter is a ResponseInit, so the header map has to be
    // nested under `headers`. Passing the bare record here type-checked (every
    // property is optional on ResponseInit) and silently dropped ALL of them:
    // `mergeHeaders` reads `init?.headers`, which was undefined. Found by
    // curling a real 429 off the running server — the unit tests only asserted
    // that this helper was CALLED, which stayed green throughout.
    // `_utils/rateLimit.ts`'s `buildRateLimitResponse` always had it right.
    { headers: rateLimitHeaders(decision) },
  )
}
