// lib/requestPath.ts
//
// "Where did this request actually ask for?", read from the request headers a
// server component can see. A layout/RSC has no access to the URL — only the
// headers `proxy.ts` forwards — so the answer has to be reassembled here.
//
// `proxy.ts` sets `x-pathname` (normalized) and `x-search` (the query string,
// minus Next's internal RSC marker) on every request it handles. The remaining
// names in the chain are legacy/edge fallbacks kept from the pro layout's
// original helper: they are NOT overwritten by the proxy, so a client could
// forge them — which is exactly why the assembled path is run through
// `sanitizeInternalPath` before anyone builds a redirect out of it.

import { sanitizeInternalPath } from '@/lib/clientNavigation'

function firstHeader(h: Headers, names: readonly string[]): string | null {
  for (const name of names) {
    const value = h.get(name)
    if (value) return value
  }
  return null
}

const PATHNAME_HEADERS = [
  'x-pathname',
  'x-current-path',
  'next-url',
  'x-invoke-path',
] as const

/**
 * The requested pathname, WITHOUT the query string. `fallback` is returned when
 * no header carries one (e.g. a unit test, or a render outside the proxy).
 */
export function pathnameFromHeaders(h: Headers, fallback: string): string {
  return firstHeader(h, PATHNAME_HEADERS) ?? fallback
}

/**
 * The requested pathname WITH its query string — what you need to send a viewer
 * back to exactly where they were standing, query and all.
 *
 * `?step=aftercare` is the load-bearing case: `/client/bookings/{id}` without it
 * lands on the booking overview rather than the aftercare step, so dropping the
 * query turns "log in to leave your aftercare note" into a dead end.
 *
 * Returns `fallback` when there is no usable pathname, or when the assembled
 * path fails `sanitizeInternalPath` (a forged `x-current-path` of `//evil.com`
 * must never become a redirect target).
 */
export function pathWithQueryFromHeaders(h: Headers, fallback: string): string {
  const pathname = firstHeader(h, PATHNAME_HEADERS)
  if (!pathname) return fallback

  const search = h.get('x-search') ?? ''
  const withQuery = search.startsWith('?') ? `${pathname}${search}` : pathname

  return sanitizeInternalPath(withQuery) ?? fallback
}
