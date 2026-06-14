// lib/appUrl.ts
import { readOptionalEnv } from '@/lib/env'

/**
 * Resolve the public app base URL for building links in emails / tokens.
 * Prefers NEXT_PUBLIC_APP_URL, otherwise derives it from the request's
 * forwarded host + protocol. Returns null when neither is available.
 * Never has a trailing slash. Single source of truth for both the
 * email-verification and password-reset flows.
 */
export function getAppUrlFromRequest(request: Request): string | null {
  const envUrl = readOptionalEnv('NEXT_PUBLIC_APP_URL')
  if (envUrl) {
    return envUrl.replace(/\/+$/, '')
  }

  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'

  if (!host) return null

  return `${proto}://${host}`.replace(/\/+$/, '')
}
