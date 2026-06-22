// lib/nfc/tapRateLimit.ts
//
// Page-side rate-limit guard for the public NFC tap routes. These are React
// Server Components (they redirect rather than return a Response), so they can't
// use the API-route `rateLimitExceededResponse` helper — they call this and, on
// a block, redirect to the friendly error surface.

import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import type { RateLimitBucket } from '@/lib/rateLimit/policies'
import { rateLimitKey } from '@/lib/rateLimit/identity'
import { getTrustedClientIpFromNextHeaders } from '@/lib/trustedClientIp'

/**
 * Returns true when the current request is within the rate limit for `bucket`,
 * false when it should be blocked. Keyed by the trusted client IP. Fails open
 * (allowed) when the limiter backend is unavailable, matching the redis-only
 * policy mode for these buckets.
 */
export async function isNfcTapWithinRateLimit(
  bucket: RateLimitBucket,
): Promise<boolean> {
  const ip = (await getTrustedClientIpFromNextHeaders()) ?? 'unknown-ip'
  const decision = await enforceRateLimit({
    bucket,
    key: rateLimitKey([`ip:${ip}`]),
  })
  return decision.allowed
}
