// lib/pro/readiness/blockerCopy.ts
//
// Single source of truth for how each Pro readiness blocker is presented:
// the human label and the page where the pro can fix it. Used by the
// readiness banner, the onboarding checklist page, and the onboarding gate
// so a blocker can never point at a page that does not exist.

import type { ProReadinessBlocker } from '@/lib/pro/readiness/proReadiness'
import { PRO_PUBLIC_PROFILE_PATH } from '@/lib/routes'

export type ProBlockerCopy = {
  label: string
  href: string
}

export const PRO_BLOCKER_COPY: Record<ProReadinessBlocker, ProBlockerCopy> = {
  NO_ACTIVE_OFFERING: {
    label: 'Add at least one active service offering.',
    href: '/pro/services',
  },
  NO_BOOKABLE_LOCATION: {
    label: 'Add or publish at least one bookable location.',
    href: '/pro/locations',
  },
  SALON_MISSING_ADDRESS: {
    label: 'Add a valid address to your salon or suite location.',
    href: '/pro/locations',
  },
  MOBILE_MISSING_BASE_CONFIG: {
    label: 'Add your mobile base postal code and service radius.',
    href: '/pro/locations',
  },
  LOCATION_MISSING_TIMEZONE: {
    label: 'Add a valid timezone to every bookable location.',
    href: '/pro/locations',
  },
  LOCATION_MISSING_WORKING_HOURS: {
    label: 'Add working hours for every bookable location.',
    href: '/pro/calendar',
  },
  LOCATION_MISSING_GEO: {
    label: 'Add a map location to every bookable location.',
    href: '/pro/locations',
  },
  OFFERING_MISSING_SALON_PRICE_OR_DURATION: {
    label: 'Add salon pricing and duration to salon services.',
    href: '/pro/services',
  },
  OFFERING_MISSING_MOBILE_PRICE_OR_DURATION: {
    label: 'Add mobile pricing and duration to mobile services.',
    href: '/pro/services',
  },
  STRIPE_NOT_READY: {
    label: 'Finish Stripe payout setup in your payment settings.',
    href: PRO_PUBLIC_PROFILE_PATH,
  },
  VERIFICATION_NOT_APPROVED: {
    label: 'Finish professional verification.',
    href: '/pro/verification',
  },
  VERIFICATION_NOT_BROADLY_DISCOVERABLE: {
    label: 'Finish verification so clients can discover you.',
    href: '/pro/verification',
  },
}

export function blockerCopy(blocker: ProReadinessBlocker): ProBlockerCopy {
  return PRO_BLOCKER_COPY[blocker]
}
