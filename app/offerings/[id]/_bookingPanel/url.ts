// app/offerings/[id]/_bookingPanel/url.ts

import type { ServiceLocationType } from './types'
import type { useRouter, useSearchParams } from 'next/navigation'

export function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname + window.location.search + window.location.hash
}

export function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/'
  if (!trimmed.startsWith('/')) return '/'
  if (trimmed.startsWith('//')) return '/'
  return trimmed
}

export function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from })
  if (reason) qs.set('reason', reason)
  router.push(`/login?${qs.toString()}`)
}

export function replaceQuery(
  router: ReturnType<typeof useRouter>,
  searchParams: ReturnType<typeof useSearchParams>,
  mut: (qs: URLSearchParams) => void,
) {
  if (typeof window === 'undefined') return
  const qs = new URLSearchParams(searchParams?.toString() || '')
  mut(qs)
  const base = window.location.pathname
  const next = qs.toString()
  router.replace(next ? `${base}?${next}` : base, { scroll: false })
}

export function clearHoldParamsOnly(router: ReturnType<typeof useRouter>, searchParams: ReturnType<typeof useSearchParams>) {
  replaceQuery(router, searchParams, (qs) => {
    qs.delete('holdId')
    qs.delete('holdUntil')
    qs.delete('scheduledFor')
    qs.delete('locationType')
  })
}

export function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}
