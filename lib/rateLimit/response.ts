// lib/rateLimit/response.ts
//
// THE 429 builder. Every rate-limited response in the API — the ~40 routes that
// call `rateLimitExceededResponse` directly and the auth/identity routes that go
// through `app/api/_utils/rateLimit.ts`'s `enforceRateLimit` — is built here, so
// there is exactly one body shape on the wire:
//
//   {
//     ok: false,
//     error,                      // user-facing copy
//     code: 'RATE_LIMITED',
//     retryable: true,
//     uiAction: 'RETRY_LATER',
//     message,                    // developer-facing, names the bucket
//     details: { bucket, limit, remaining, reset, retryAfterSeconds, source, reason },
//   }
//
// `details.retryAfterSeconds` is the field the clients ACT on: web
// (`app/(auth)/_components/otpCooldown.ts`) and iOS (`APIErrorBody.Details` in
// TovisKit's Common.swift) both read it there, NESTED, to run the OTP resend
// countdown. Until 2026-09-08 this file's builder omitted `details` entirely
// while `_utils/rateLimit.ts` carried its own copy that sent it — two bodies for
// one status, and the clients only happened to work because OTP resend used the
// second one. Do not fork this again: if a route needs a different 429, extend
// the shape here so every reader keeps seeing one contract.

import type { NextResponse } from 'next/server'

import { jsonFail } from '@/app/api/_utils/responses'

import {
  getRateLimitHeaders,
  type BlockedRateLimitDecision,
  type RateLimitDecision,
} from './enforce'

/** User-facing copy on every rate-limited response. */
const RATE_LIMITED_ERROR_MESSAGE =
  'Too many requests. Please try again later.'

export function rateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  return getRateLimitHeaders(decision)
}

export function rateLimitExceededResponse(
  decision: BlockedRateLimitDecision,
): NextResponse {
  return jsonFail(
    429,
    RATE_LIMITED_ERROR_MESSAGE,
    {
      code: 'RATE_LIMITED',
      retryable: true,
      uiAction: 'RETRY_LATER',
      message: `Rate limit exceeded for ${decision.bucket}.`,
      // The decision minus its `key`: the key carries a user id and an IP and
      // must never ride in a response body.
      details: {
        bucket: decision.bucket,
        limit: decision.limit,
        remaining: decision.remaining,
        reset: decision.resetAt.getTime(),
        retryAfterSeconds: decision.retryAfterSeconds,
        source: decision.source,
        reason: decision.reason,
      },
    },
    // `jsonFail`'s 4th parameter is a ResponseInit, so the header map has to be
    // nested under `headers`. Passing the bare record here type-checked (every
    // property is optional on ResponseInit) and silently dropped ALL of them:
    // `mergeHeaders` reads `init?.headers`, which was undefined. Found by
    // curling a real 429 off the running server — the unit tests only asserted
    // that this helper was CALLED, which stayed green throughout.
    {
      headers: {
        ...rateLimitHeaders(decision),
        // Legacy `X-` spellings, kept alongside the IETF `RateLimit-*` set for
        // any client that still reads them. `X-RateLimit-Reset` is epoch ms,
        // matching `details.reset`; `RateLimit-Reset` is epoch seconds.
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': String(decision.remaining),
        'X-RateLimit-Reset': String(decision.resetAt.getTime()),
      },
    },
  )
}
