// lib/shortLink/rateLimit.ts
//
// Route-handler-side guard for the public short-link resolver. Mirrors
// lib/nfc/tapRateLimit.ts's isNfcTapWithinRateLimit, but takes the Request
// directly (a route.ts has one already) instead of reading next/headers.

import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { rateLimitKey } from '@/lib/rateLimit/identity'
import { getTrustedClientIpFromRequest } from '@/lib/trustedClientIp'

export async function isShortLinkResolveWithinRateLimit(
  request: Request,
): Promise<boolean> {
  const ip = getTrustedClientIpFromRequest(request) ?? 'unknown-ip'
  const decision = await enforceRateLimit({
    bucket: 'short-link:resolve',
    key: rateLimitKey([`ip:${ip}`]),
  })
  return decision.allowed
}
