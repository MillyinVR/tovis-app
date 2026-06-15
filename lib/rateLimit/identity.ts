import { createHash } from 'node:crypto'

import { getTrustedClientIpFromRequest } from '@/lib/trustedClientIp'

/**
 * Resolve the client IP for a rate-limit key from a trusted-proxy header.
 *
 * Delegates to {@link getTrustedClientIpFromRequest}, which only honors the
 * configured `AUTH_TRUSTED_IP_HEADER` in production (falling back to the usual
 * proxy headers in development). This prevents attackers from rotating a
 * spoofed `x-forwarded-for` to land in a fresh rate-limit bucket per request.
 *
 * Falls back to the shared `'unknown-ip'` bucket when no trusted IP can be
 * resolved, matching the previous fallback semantics.
 */
export function getClientIpFromRequest(request: Request): string {
  return getTrustedClientIpFromRequest(request) ?? 'unknown-ip'
}

export function rateLimitKey(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('|')
}


function hashRateLimitValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

export function clientRateLimitKey(args: {
  clientId?: string | null
  userId?: string | null
  request: Request
}): string {
  return rateLimitKey([
    args.userId ? `user:${args.userId}` : null,
    args.clientId ? `client:${args.clientId}` : null,
    `ip:${getClientIpFromRequest(args.request)}`,
  ])
}

export function proRateLimitKey(args: {
  professionalId?: string | null
  userId?: string | null
  request: Request
}): string {
  return rateLimitKey([
    args.userId ? `user:${args.userId}` : null,
    args.professionalId ? `pro:${args.professionalId}` : null,
    `ip:${getClientIpFromRequest(args.request)}`,
  ])
}

export function tokenActorRateLimitKey(args: {
  actorKey: string
  request: Request
}): string {
  return rateLimitKey([
    `token:${hashRateLimitValue(args.actorKey)}`,
    `ip:${getClientIpFromRequest(args.request)}`,
  ])
}