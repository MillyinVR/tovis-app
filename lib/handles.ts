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