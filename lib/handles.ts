// lib/handles.ts

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'abuse',
  'account',
  'admin',
  'administrator',
  'api',
  'app',
  'auth',
  'billing',
  'book',
  'booking',
  'bookings',
  'c',
  'calendar',
  'client',
  'clients',
  'dashboard',
  'help',
  'login',
  'logout',
  'looks',
  'mail',
  'messages',
  'nfc',
  'null',
  'official',
  'p',
  'pricing',
  'pro',
  'professional',
  'professionals',
  'pros',
  'root',
  'search',
  'security',
  'settings',
  'signup',
  'staff',
  'support',
  'system',
  't',
  'team',
  'test',
  'tovis',
  'u',
  'undefined',
  'verify',
  'www',
])

/**
 * Callers must pass their route's existing normalized handle string.
 * This helper only answers whether that normalized value is reserved.
 */
export function isHandleReserved(normalized: string): boolean {
  return RESERVED_HANDLES.has(normalized)
}

export const HANDLE_MIN = 3
export const HANDLE_MAX = 24

/** The app's vanity root domain (e.g. `tovis.me`). Mirrors proxy.ts resolution. */
export function vanityRootDomain(): string {
  return process.env.APP_ROOT_DOMAIN?.trim() || 'tovis.me'
}

/**
 * The vanity host + absolute URL for a handle, e.g. `tori` ->
 * { host: 'tori.tovis.me', url: 'https://tori.tovis.me' }. Returns null for a
 * blank handle so callers can branch on "no handle yet".
 */
export function vanityLinkFor(
  handle: string | null | undefined,
): { host: string; url: string } | null {
  const normalized = normalizeHandle(handle ?? '')
  if (!normalized) return null
  const host = `${normalized}.${vanityRootDomain()}`
  return { host, url: `https://${host}` }
}

/**
 * Canonical handle form used for storage (handleNormalized), uniqueness checks,
 * and vanity-URL lookups: trim + lowercase only. Does NOT strip characters, so
 * pair it with isValidHandle() to reject anything outside the allowed charset.
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Whether a normalized handle is valid: HANDLE_MIN–HANDLE_MAX chars, only
 * lowercase letters/digits/hyphens, and starting + ending with a letter/digit.
 */
export function isValidHandle(handle: string): boolean {
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) return false
  if (!/^[a-z0-9-]+$/.test(handle)) return false
  if (!/^[a-z0-9]/.test(handle)) return false
  if (!/[a-z0-9]$/.test(handle)) return false
  return true
}

/**
 * Sanitize free-text input into a candidate handle for live previews and input
 * fields: lowercase, drop everything outside [a-z0-9-], trim leading/trailing
 * hyphens, and cap at HANDLE_MAX. The result should still be checked with
 * isValidHandle() before it is persisted.
 */
export function sanitizeHandleInput(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, HANDLE_MAX)
}

/**
 * Why a raw (already-normalized) candidate handle is not yet persistable, or null
 * when it passes every format/charset/reserved rule. Shared by the live
 * availability check and the PATCH route so client and server agree on copy.
 */
export type HandleFormatError = 'empty' | 'too_short' | 'too_long' | 'charset' | 'reserved'

export function handleFormatError(normalized: string): HandleFormatError | null {
  if (!normalized) return 'empty'
  if (normalized.length < HANDLE_MIN) return 'too_short'
  if (normalized.length > HANDLE_MAX) return 'too_long'
  if (!isValidHandle(normalized)) return 'charset'
  if (isHandleReserved(normalized)) return 'reserved'
  return null
}

/** Human-facing copy for each format error — single source for client + server. */
export function handleFormatMessage(error: HandleFormatError): string {
  switch (error) {
    case 'empty':
      return 'Pick a handle to preview your link.'
    case 'too_short':
      return `Handle must be at least ${HANDLE_MIN} characters.`
    case 'too_long':
      return `Handle must be ${HANDLE_MAX} characters or fewer.`
    case 'charset':
      return 'Use only letters, numbers, and hyphens. Must start and end with a letter or number.'
    case 'reserved':
      return 'That handle is reserved.'
  }
}

/**
 * Suggest alternative handles when a desired one is taken/reserved. Derives from
 * the sanitized base by appending numeric and suffix variants, capped to HANDLE_MAX
 * and filtered to valid, non-reserved candidates. Callers still check availability.
 */
export function suggestHandles(base: string, suffixes: readonly string[] = ['mua', 'beauty', 'studio']): string[] {
  const root = sanitizeHandleInput(base)
  if (!root) return []

  const candidates: string[] = []
  for (let n = 1; n <= 3; n += 1) candidates.push(`${root}${n}`)
  for (const suffix of suffixes) candidates.push(`${root}-${suffix}`)

  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of candidates) {
    const c = sanitizeHandleInput(raw)
    if (seen.has(c)) continue
    seen.add(c)
    if (handleFormatError(c) === null) out.push(c)
  }
  return out
}