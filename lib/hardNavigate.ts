// lib/hardNavigate.ts
//
// Full-page navigation, bypassing the Next.js client router. Used after
// logout so server components re-evaluate with the cleared auth cookie.
export function hardNavigate(href: string): void {
  window.location.assign(href)
}
