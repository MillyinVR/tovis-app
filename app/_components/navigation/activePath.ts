// app/_components/navigation/activePath.ts

/**
 * Whether a footer nav target is "active" for the current pathname.
 * Shared by every role footer so the matching rule lives in one place.
 *
 * - default: active when the path equals the target or is nested under it
 *   (e.g. `/messages` and `/messages/123` both light up `/messages`).
 * - `exact`: active only on an exact match — used for index routes like the
 *   admin dashboard (`/admin`) that would otherwise match every `/admin/*` page.
 */
export function isActivePath(
  pathname: string,
  href: string,
  options?: { exact?: boolean },
): boolean {
  const base = href.split('?')[0] ?? href
  if (options?.exact) return pathname === base
  return pathname === base || pathname.startsWith(`${base}/`)
}
