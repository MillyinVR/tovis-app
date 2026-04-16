// lib/trustedClientIp.ts
import { headers } from 'next/headers'

type HeaderBag = {
  get(name: string): string | null
}

const DEV_FALLBACK_HEADERS = ['x-forwarded-for', 'x-real-ip'] as const

function normalizeHeaderName(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized || null
}

function pickFirstHeaderValue(raw: string | null): string | null {
  if (!raw) return null
  const first = raw.split(',')[0]?.trim()
  return first || null
}

function readTrustedClientIpFromBag(bag: HeaderBag): string | null {
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