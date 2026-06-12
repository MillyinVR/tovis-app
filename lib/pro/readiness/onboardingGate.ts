// lib/pro/readiness/onboardingGate.ts
//
// Pure routing helper for the Pro onboarding hard gate.
//
// Unready Pros should be able to access setup/fix-it surfaces, but should not
// be able to access risky booking, marketplace, or workflow actions until their
// readiness blockers are resolved.

import { blockerCopy } from '@/lib/pro/readiness/blockerCopy'
import type {
  ProReadiness,
  ProReadinessBlocker,
} from '@/lib/pro/readiness/proReadiness'

const PRO_ONBOARDING_HOME = '/pro/onboarding'

// Every blocker fix-it href (see blockerCopy.ts) must fall under one of
// these prefixes, otherwise the gate would redirect to a page it then
// blocks, looping the pro back to onboarding forever.
const UNREADY_PRO_ALLOWED_PATH_PREFIXES = [
  '/pro/onboarding',
  '/pro/profile',
  '/pro/services',
  '/pro/locations',
  // Working hours are edited in the calendar, so unready pros need it.
  // Clients still cannot book an unready pro — readiness is enforced
  // server-side in availability and booking creation.
  '/pro/calendar',
  '/pro/payments',
  '/pro/verification',
  '/pro/settings',
] as const

function normalizeProPath(pathname: string): string {
  const trimmed = pathname.trim()

  if (!trimmed) return '/pro'

  let pathOnly = trimmed

  const hashIndex = pathOnly.indexOf('#')
  if (hashIndex >= 0) {
    pathOnly = pathOnly.slice(0, hashIndex)
  }

  const queryIndex = pathOnly.indexOf('?')
  if (queryIndex >= 0) {
    pathOnly = pathOnly.slice(0, queryIndex)
  }

  if (!pathOnly.startsWith('/')) {
    pathOnly = `/${pathOnly}`
  }

  if (pathOnly.length > 1 && pathOnly.endsWith('/')) {
    pathOnly = pathOnly.replace(/\/+$/, '')
  }

  return pathOnly || '/pro'
}

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function canAccessProPathWhileUnready(pathname: string): boolean {
  const normalized = normalizeProPath(pathname)

  return UNREADY_PRO_ALLOWED_PATH_PREFIXES.some((prefix) =>
    pathMatchesPrefix(normalized, prefix),
  )
}

export function getNextOnboardingHref(
  blockers: readonly ProReadinessBlocker[],
): string {
  for (const blocker of blockers) {
    const href = blockerCopy(blocker)?.href

    if (href) return href
  }

  return PRO_ONBOARDING_HOME
}

export function shouldGateProPath(args: {
  pathname: string
  readiness: ProReadiness
}): boolean {
  if (args.readiness.ok) return false

  return !canAccessProPathWhileUnready(args.pathname)
}

export function getProOnboardingRedirectHref(args: {
  pathname: string
  readiness: ProReadiness
}): string | null {
  const { readiness } = args

  if (readiness.ok) return null
  if (canAccessProPathWhileUnready(args.pathname)) return null

  return getNextOnboardingHref(readiness.blockers)
}