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