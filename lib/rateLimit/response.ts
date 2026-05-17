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
    rateLimitHeaders(decision),
  )
}