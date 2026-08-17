// lib/shortLink/allowlist.ts
//
// A ShortLink's destination is never a full URL and never attacker-influenced
// — it is always a site-root-relative path we generated ourselves, from a
// fixed prefix list. This closes the open-redirect surface at validation time
// rather than by trusting the caller, and is re-checked at BOTH creation and
// resolution (lib/auth/sessionHandoff.ts's re-check-at-redemption pattern) so
// a row written by any future code path still can't become one.
//
// Widening this list is a deliberate edit here, not something a caller can do
// by passing a longer path. Prefixes below are exactly what the client SMS
// templates embed today:
//  - the client-action magic-link prefixes (lib/clientActions/actionRegistry.ts)
//  - /client/bookings/ — the login-gated booking detail page
//  - /api/v1/calendar/ics/ — the signed "add to calendar" link (lib/calendar/bookingInvite.ts)

const MAX_PATH_LENGTH = 512

const ALLOWED_PATH_PREFIXES: readonly string[] = [
  '/client/bookings/',
  '/client/rebook/',
  '/client/deposit/',
  '/client/appointment/',
  '/client/consent/',
  '/client/consultation/',
  '/claim/',
  '/api/v1/calendar/ics/',
]

const PATH_PARSE_ORIGIN = 'https://short-link.invalid'

// The highest code point treated as a control character for this check: C0
// controls (0-31), the space itself (32), and DEL (127).
const MAX_LOW_CONTROL_CODE = 32
const DEL_CODE = 127

/**
 * True if `value` contains a C0 control character (including plain space) or
 * DEL. Checked by code point rather than a regex literal so CR/LF can never
 * reach a `Location` header.
 */
function hasControlOrSpaceChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= MAX_LOW_CONTROL_CODE || code === DEL_CODE) return true
  }
  return false
}

/**
 * Validate and normalize a candidate ShortLink destination. Returns the
 * normalized path (pathname + search + hash), or null when it is not one of
 * the allowlisted internal paths. Never throws.
 */
export function sanitizeShortLinkDestinationPath(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null

  const candidate = raw.trim()
  if (!candidate) return null
  if (candidate.length > MAX_PATH_LENGTH) return null

  // Must be site-root-relative. `//host` is scheme-relative (an absolute URL
  // to another origin) and is rejected before anything else looks at it.
  if (!candidate.startsWith('/')) return null
  if (candidate.startsWith('//')) return null

  // A backslash never appears in a legitimate path of ours, and browsers
  // disagree about whether it means `/`. Refuse rather than guess.
  if (candidate.includes('\\')) return null

  // Control characters (NUL/TAB/CR/LF/…) and DEL — CR/LF in particular must
  // never be able to reach a `Location` header.
  if (hasControlOrSpaceChar(candidate)) return null

  // Literal `..` anywhere. The encoded forms are caught by the post-parse
  // pathname check below, which sees the DECODED path.
  if (candidate.includes('..')) return null

  let parsed: URL
  try {
    parsed = new URL(candidate, PATH_PARSE_ORIGIN)
  } catch {
    return null
  }

  if (parsed.origin !== PATH_PARSE_ORIGIN) return null

  const pathname = parsed.pathname
  if (pathname.includes('..')) return null

  if (!ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null
  }

  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`
  if (normalized.length > MAX_PATH_LENGTH) return null

  return normalized
}
