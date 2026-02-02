// lib/authClient.ts 
'use client'

export function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname + window.location.search + window.location.hash
}

export function loginUrl(from?: string) {
  const f = from ?? currentPathWithQuery()
  return `/login?from=${encodeURIComponent(f)}`
}

/**
 * If response is 401, redirect to login and return true.
 * If 403, return false (caller should show “forbidden” message).
 */
export function handleAuthRedirect(res: Response, from?: string): boolean {
  if (res.status !== 401) return false
  window.location.href = loginUrl(from)
  return true
}
