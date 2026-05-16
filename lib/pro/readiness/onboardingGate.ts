// lib/pro/readiness/onboardingGate.ts
//
// Pure routing helper for the Pro onboarding hard gate.
//
// Unready Pros should be able to access setup/fix-it surfaces, but should not
// be able to access risky booking, marketplace, or workflow actions until their
// readiness blockers are resolved.

import type {
  ProReadiness,
  ProReadinessBlocker,
} from '@/lib/pro/readiness/proReadiness'

const PRO_ONBOARDING_HOME = '/pro/onboarding'

const UNREADY_PRO_ALLOWED_PATH_PREFIXES = [
  '/pro/onboarding',
  '/pro/profile',
  '/pro/services',
  '/pro/locations',
  '/pro/payments',
  '/pro/verification',
  '/pro/settings',
] as const

const BLOCKER_ONBOARDING_HREFS: Partial<Record<ProReadinessBlocker, string>> = {
  NO_ACTIVE_OFFERING: '/pro/services',
  OFFERING_MISSING_SALON_PRICE_OR_DURATION: '/pro/services',
  OFFERING_MISSING_MOBILE_PRICE_OR_DURATION: '/pro/services',

  NO_BOOKABLE_LOCATION: '/pro/locations',
  SALON_MISSING_ADDRESS: '/pro/locations',
  MOBILE_MISSING_BASE_CONFIG: '/pro/locations',
  LOCATION_MISSING_TIMEZONE: '/pro/locations',
  LOCATION_MISSING_GEO: '/pro/locations',

  // Calendar is intentionally blocked while unready for now. Route this
  // through onboarding so the page can explain what to fix without looping.
  LOCATION_MISSING_WORKING_HOURS: PRO_ONBOARDING_HOME,

  STRIPE_NOT_READY: '/pro/payments',

  VERIFICATION_NOT_APPROVED: '/pro/verification',
  VERIFICATION_NOT_BROADLY_DISCOVERABLE: '/pro/verification',
}

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
    const href = BLOCKER_ONBOARDING_HREFS[blocker]

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