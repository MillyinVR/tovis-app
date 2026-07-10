// lib/appUrl.ts
import { readOptionalEnv } from '@/lib/env'

/**
 * Resolve the public app origin from env alone (no request in scope) — used by
 * background senders (notification delivery, calendar links) that build absolute
 * URLs without an incoming Request. Prefers APP_URL, then NEXT_PUBLIC_APP_URL.
 * Returns the validated origin (protocol + host, no trailing path) or null when
 * unset/invalid, so callers can degrade gracefully rather than throw.
 */
export function readAppOriginFromEnv(): string | null {
  const raw = readOptionalEnv('APP_URL') ?? readOptionalEnv('NEXT_PUBLIC_APP_URL')
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null

  return url.origin
}

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
