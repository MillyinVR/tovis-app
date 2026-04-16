// lib/trustedClientIp.ts
import * as Sentry from '@sentry/nextjs'
import { headers } from 'next/headers'

type HeaderBag = {
  get(name: string): string | null
}

const DEV_FALLBACK_HEADERS = ['x-forwarded-for', 'x-real-ip'] as const

const TRUSTED_IP_HEADER_MISCONFIG_LOGGED_KEY =
  '__tovisTrustedIpHeaderMissingLogged' as const
const TRUSTED_IP_HEADER_MISCONFIG_SENTRY_KEY =
  '__tovisTrustedIpHeaderMissingSentryCaptured' as const

type TrustedIpGlobalState = typeof globalThis & {
  [TRUSTED_IP_HEADER_MISCONFIG_LOGGED_KEY]?: boolean
  [TRUSTED_IP_HEADER_MISCONFIG_SENTRY_KEY]?: boolean
}

function normalizeHeaderName(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized || null
}

function pickFirstHeaderValue(raw: string | null): string | null {
  if (!raw) return null
  const first = raw.split(',')[0]?.trim()
  return first || null
}

function reportTrustedIpHeaderMisconfigOnce(): void {
  const globalState = globalThis as TrustedIpGlobalState
  const message = 'AUTH_TRUSTED_IP_HEADER is not set in production'

  if (!globalState[TRUSTED_IP_HEADER_MISCONFIG_LOGGED_KEY]) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        app: 'tovis-app',
        namespace: 'auth',
        level: 'error',
        event: 'trusted_ip_header_missing',
        message,
      }),
    )
    globalState[TRUSTED_IP_HEADER_MISCONFIG_LOGGED_KEY] = true
  }

  if (!globalState[TRUSTED_IP_HEADER_MISCONFIG_SENTRY_KEY]) {
    try {
      Sentry.withScope((scope) => {
        scope.setLevel('fatal')
        scope.setTag('area', 'auth')
        scope.setTag('auth.event', 'trusted_ip_header_missing')
        scope.setTag('auth.route', 'trustedClientIp')
        Sentry.captureMessage(message)
      })

      globalState[TRUSTED_IP_HEADER_MISCONFIG_SENTRY_KEY] = true
    } catch {
      // Best effort only. Console logging already happened.
      // Leaving the flag unset allows a later retry if Sentry becomes ready.
    }
  }
}

function assertTrustedIpHeaderConfigured(): void {
  const isProduction = process.env.NODE_ENV === 'production'
  const configuredHeader = normalizeHeaderName(
    process.env.AUTH_TRUSTED_IP_HEADER,
  )

  if (isProduction && !configuredHeader) {
    reportTrustedIpHeaderMisconfigOnce()
  }
}

assertTrustedIpHeaderConfigured()

function readTrustedClientIpFromBag(bag: HeaderBag): string | null {
  assertTrustedIpHeaderConfigured()

  const configuredHeader = normalizeHeaderName(process.env.AUTH_TRUSTED_IP_HEADER)
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction) {
    if (!configuredHeader) return null
    return pickFirstHeaderValue(bag.get(configuredHeader))
  }

  if (configuredHeader) {
    const configuredValue = pickFirstHeaderValue(bag.get(configuredHeader))
    if (configuredValue) return configuredValue
  }

  for (const headerName of DEV_FALLBACK_HEADERS) {
    const value = pickFirstHeaderValue(bag.get(headerName))
    if (value) return value
  }

  return null
}

export async function getTrustedClientIpFromNextHeaders(): Promise<string | null> {
  const h = await headers()
  return readTrustedClientIpFromBag(h)
}

export function getTrustedClientIpFromRequest(request: Request): string | null {
  return readTrustedClientIpFromBag(request.headers)
}