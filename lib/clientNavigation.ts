// lib/clientNavigation.ts
//
// Navigation helpers: "where is the viewer standing?" and "send them to log in
// and bring them back" — both re-authored in about a dozen components before
// this.
//
// Mostly browser-facing, but `sanitizeInternalPath` is deliberately runtime-
// agnostic and the auth API routes import it: the open-redirect rule has to be
// the same one on both sides, and there is no `window` in the module scope to
// stop a server route importing it.

/**
 * Full-page navigation, bypassing the Next.js client router. Used after logout
 * so server components re-evaluate with the cleared auth cookie.
 */
export function hardNavigate(url: string): void {
  if (typeof window === 'undefined') return
  window.location.assign(url)
}

/**
 * The viewer's current location as an app-relative path — pathname + query +
 * hash — for round-tripping them back after a login.
 *
 * `fallback` is returned when there is no `window` (SSR/prerender). Call sites
 * differ on what that should be: a pro surface wants `/pro`, a public one
 * `/looks`. It is only reachable during SSR, since every caller runs this from
 * an event handler or an effect, but it is kept a parameter rather than a
 * constant so no site silently changes where it lands.
 */
export function currentPathWithQuery(fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return window.location.pathname + window.location.search + window.location.hash
}

/**
 * Reduce an arbitrary string to a path we are willing to navigate to, or `null`.
 * Rejects anything that is not same-origin-relative:
 *
 *   - blank / whitespace
 *   - not starting with `/` (absolute URLs, `javascript:`, bare words)
 *   - starting with `//` — a protocol-relative URL, which is an OPEN REDIRECT
 *     off-site despite looking like a path
 *
 * Security relevant, which is exactly why it should not be re-typed per module.
 * Callers that need a default supply their own: `sanitizeInternalPath(x) ?? '/'`.
 */
export function sanitizeInternalPath(
  value: string | null | undefined,
): string | null {
  const trimmed = (value ?? '').trim()

  if (!trimmed) return null
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('//')) return null

  return trimmed
}

/**
 * The `/login` URL that returns the viewer to where they are STANDING — it
 * reads `window.location`, so it only means anything in the browser.
 *
 * Named for that: the server-rendered guards elsewhere build the same URL from
 * a path they already hold, and a shared name for the two would be a trap —
 * `loginHref(x)` would mean "send them back to x" in one file and "send them
 * back to here, or x if we can't tell" in another.
 *
 * `fallback` is both the SSR path and the value used when the current location
 * fails sanitization. `reason` is the optional `?reason=` tag the login screen
 * uses to explain why the viewer was bounced.
 */
export function loginHrefFromHere(fallback: string, reason?: string): string {
  const from =
    sanitizeInternalPath(currentPathWithQuery(fallback)) ?? fallback
  const params = new URLSearchParams({ from })

  if (reason) params.set('reason', reason)

  return `/login?${params.toString()}`
}
