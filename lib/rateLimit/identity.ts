import { createHash } from 'node:crypto'

export function getClientIpFromRequest(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const vercelForwardedFor = request.headers.get('x-vercel-forwarded-for')
  const realIp = request.headers.get('x-real-ip')

  const firstForwarded = forwardedFor?.split(',')[0]?.trim()

  return (
    firstForwarded ||
    vercelForwardedFor?.trim() ||
    realIp?.trim() ||
    'unknown-ip'
  )
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