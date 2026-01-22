// app/(main)/booking/AvailabilityDrawer/utils/authRedirect.ts
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/looks'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string) {
  const trimmed = String(from || '').trim()
  if (!trimmed) return '/looks'
  if (!trimmed.startsWith('/')) return '/looks'
  if (trimmed.startsWith('//')) return '/looks'
  return trimmed
}

export function redirectToLogin(router: AppRouterInstance, reason: string) {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from, reason: String(reason || 'auth') })
  router.push(`/login?${qs.toString()}`)
}
