// app/_components/boundaries/errorHome.ts
//
// The *shapes and destinations* for "where is this viewer's home", with no
// runtime dependencies at all.
//
// Split out of errorHomeHref.ts on purpose: that module reaches for
// `next/headers` and (lazily) `@/lib/auth`, so importing it from a client
// component would drag server-only code — and everything it transitively pulls
// in — into the browser bundle. Client boundaries (error.tsx is always a client
// component) import THIS file; the server resolver imports it too, so both
// halves answer "where does this user's home page live" from one list.

export const GUEST_HOME_HREF = '/'
export const CLIENT_HOME_HREF = '/client'
export const PRO_HOME_HREF = '/pro'
export const ADMIN_HOME_HREF = '/admin'

export type ErrorHome = { href: string; label: string }

export const GUEST_HOME: ErrorHome = {
  href: GUEST_HOME_HREF,
  label: 'Back to home',
}

export const CLIENT_HOME: ErrorHome = {
  href: CLIENT_HOME_HREF,
  label: 'Back to home',
}

export const PRO_HOME: ErrorHome = {
  href: PRO_HOME_HREF,
  label: 'Back to your calendar',
}

export const ADMIN_HOME: ErrorHome = {
  href: ADMIN_HOME_HREF,
  label: 'Back to admin',
}
