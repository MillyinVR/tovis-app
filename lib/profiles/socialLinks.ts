// lib/profiles/socialLinks.ts
//
// Normalization + deep links for the pro profile's public social presence
// (instagramHandle / tiktokHandle / websiteUrl). Handles are stored WITHOUT
// the leading "@"; websiteUrl is stored as a full https:// URL.

const HANDLE_PATTERN = /^[a-zA-Z0-9._]{1,30}$/
const MAX_WEBSITE_URL_LENGTH = 200

/**
 * Normalizes a social handle ("@tori.hair" → "tori.hair").
 * Returns null for invalid input; empty input is the caller's "clear" case.
 */
export function normalizeSocialHandle(raw: string): string | null {
  const trimmed = raw.trim().replace(/^@+/, '')
  if (!trimmed) return null

  return HANDLE_PATTERN.test(trimmed) ? trimmed : null
}

/**
 * Normalizes a website URL — prepends https:// when the scheme is missing,
 * requires http(s) and a dotted hostname. Returns null for invalid input.
 */
export function normalizeWebsiteUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_WEBSITE_URL_LENGTH) return null

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname.includes('.')) return null

  return url.toString()
}

export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle}`
}

export function tiktokUrl(handle: string): string {
  return `https://www.tiktok.com/@${handle}`
}
