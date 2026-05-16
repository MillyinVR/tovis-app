// lib/pro/readiness/onboardingGate.test.ts

import { describe, expect, it } from 'vitest'

import type { ProReadiness } from '@/lib/pro/readiness/proReadiness'
import {
  canAccessProPathWhileUnready,
  getNextOnboardingHref,
  getProOnboardingRedirectHref,
  shouldGateProPath,
} from './onboardingGate'

const ready: ProReadiness = {
  ok: true,
  liveModes: ['SALON'],
  readyLocationIds: ['loc_1'],
}

const unreadyWithServiceBlocker: ProReadiness = {
  ok: false,
  blockers: ['NO_ACTIVE_OFFERING'],
}

const unreadyWithLocationBlocker: ProReadiness = {
  ok: false,
  blockers: ['NO_BOOKABLE_LOCATION'],
}

const unreadyWithVerificationBlocker: ProReadiness = {
  ok: false,
  blockers: ['VERIFICATION_NOT_APPROVED'],
}

const unreadyWithStripeBlocker: ProReadiness = {
  ok: false,
  blockers: ['STRIPE_NOT_READY'],
}

describe('onboardingGate', () => {
  describe('canAccessProPathWhileUnready', () => {
    it('allows onboarding and setup/fix-it paths while unready', () => {
      expect(canAccessProPathWhileUnready('/pro/onboarding')).toBe(true)
      expect(canAccessProPathWhileUnready('/pro/onboarding/locations')).toBe(
        true,
      )
      expect(canAccessProPathWhileUnready('/pro/profile')).toBe(true)
      expect(canAccessProPathWhileUnready('/pro/profile/public-profile')).toBe(
        true,
      )
      expect(canAccessProPathWhileUnready('/pro/services')).toBe(true)
      expect(canAccessProPathWhileUnready('/pro/locations')).toBe(true)
      expect(canAccessProPathWhileUnready('/pro/payments')).toBe(true)
      expect(canAccessProPathWhileUnready('/pro/verification')).toBe(true)
      expect(canAccessProPathWhileUnready('/pro/settings')).toBe(true)
    })

    it('blocks booking, marketplace, client, media, and dashboard paths while unready', () => {
      expect(canAccessProPathWhileUnready('/pro')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/calendar')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/bookings')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/bookings/new')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/bookings/booking_1')).toBe(
        false,
      )
      expect(canAccessProPathWhileUnready('/pro/clients')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/media')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/media/new')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/last-minute')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/dashboard')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/reviews')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/store')).toBe(false)
      expect(canAccessProPathWhileUnready('/pro/trending-services')).toBe(false)
    })

    it('normalizes query strings, hashes, trailing slashes, whitespace, and missing leading slashes', () => {
      expect(canAccessProPathWhileUnready('/pro/services?tab=prices')).toBe(
        true,
      )
      expect(canAccessProPathWhileUnready('/pro/locations#primary')).toBe(true)
      expect(canAccessProPathWhileUnready('/pro/verification/')).toBe(true)
      expect(canAccessProPathWhileUnready(' pro/profile ')).toBe(true)

      expect(canAccessProPathWhileUnready('/pro/bookings/new?foo=bar')).toBe(
        false,
      )
      expect(canAccessProPathWhileUnready('/pro/calendar#week')).toBe(false)
    })

    it('does not accidentally allow similarly named paths', () => {
      expect(canAccessProPathWhileUnready('/pro/services-danger-zone')).toBe(
        false,
      )
      expect(canAccessProPathWhileUnready('/pro/location-settings-danger')).toBe(
        false,
      )
      expect(canAccessProPathWhileUnready('/pro/verificationish')).toBe(false)
    })
  })

  describe('getNextOnboardingHref', () => {
    it('routes offering blockers to services', () => {
      expect(getNextOnboardingHref(['NO_ACTIVE_OFFERING'])).toBe(
        '/pro/services',
      )
      expect(
        getNextOnboardingHref(['OFFERING_MISSING_SALON_PRICE_OR_DURATION']),
      ).toBe('/pro/services')
      expect(
        getNextOnboardingHref(['OFFERING_MISSING_MOBILE_PRICE_OR_DURATION']),
      ).toBe('/pro/services')
    })

    it('routes location blockers to locations', () => {
      expect(getNextOnboardingHref(['NO_BOOKABLE_LOCATION'])).toBe(
        '/pro/locations',
      )
      expect(getNextOnboardingHref(['SALON_MISSING_ADDRESS'])).toBe(
        '/pro/locations',
      )
      expect(getNextOnboardingHref(['MOBILE_MISSING_BASE_CONFIG'])).toBe(
        '/pro/locations',
      )
      expect(getNextOnboardingHref(['LOCATION_MISSING_TIMEZONE'])).toBe(
        '/pro/locations',
      )
      expect(getNextOnboardingHref(['LOCATION_MISSING_GEO'])).toBe(
        '/pro/locations',
      )
    })

    it('routes working-hours blockers to onboarding because calendar is gated while unready', () => {
    expect(getNextOnboardingHref(['LOCATION_MISSING_WORKING_HOURS'])).toBe(
        '/pro/onboarding',
    )
    })

    it('routes payment blockers to payments', () => {
      expect(getNextOnboardingHref(['STRIPE_NOT_READY'])).toBe('/pro/payments')
    })

    it('routes verification blockers to verification', () => {
      expect(getNextOnboardingHref(['VERIFICATION_NOT_APPROVED'])).toBe(
        '/pro/verification',
      )
      expect(
        getNextOnboardingHref(['VERIFICATION_NOT_BROADLY_DISCOVERABLE']),
      ).toBe('/pro/verification')
    })

    it('uses the first actionable blocker and falls back to onboarding home', () => {
      expect(
        getNextOnboardingHref([
          'STRIPE_NOT_READY',
          'NO_ACTIVE_OFFERING',
          'NO_BOOKABLE_LOCATION',
        ]),
      ).toBe('/pro/payments')

      expect(getNextOnboardingHref([])).toBe('/pro/onboarding')
    })
  })

  describe('shouldGateProPath', () => {
    it('never gates ready pros', () => {
      expect(
        shouldGateProPath({
          pathname: '/pro/bookings/new',
          readiness: ready,
        }),
      ).toBe(false)

      expect(
        shouldGateProPath({
          pathname: '/pro/calendar',
          readiness: ready,
        }),
      ).toBe(false)
    })

    it('does not gate unready pros on allowed setup paths', () => {
      expect(
        shouldGateProPath({
          pathname: '/pro/services',
          readiness: unreadyWithServiceBlocker,
        }),
      ).toBe(false)

      expect(
        shouldGateProPath({
          pathname: '/pro/locations',
          readiness: unreadyWithLocationBlocker,
        }),
      ).toBe(false)

      expect(
        shouldGateProPath({
          pathname: '/pro/verification',
          readiness: unreadyWithVerificationBlocker,
        }),
      ).toBe(false)
    })

    it('gates unready pros on risky paths', () => {
      expect(
        shouldGateProPath({
          pathname: '/pro/bookings/new',
          readiness: unreadyWithServiceBlocker,
        }),
      ).toBe(true)

      expect(
        shouldGateProPath({
          pathname: '/pro/calendar',
          readiness: unreadyWithLocationBlocker,
        }),
      ).toBe(true)

      expect(
        shouldGateProPath({
          pathname: '/pro/media/new',
          readiness: unreadyWithVerificationBlocker,
        }),
      ).toBe(true)
    })
  })

  describe('getProOnboardingRedirectHref', () => {
    it('returns null when the pro is ready', () => {
      expect(
        getProOnboardingRedirectHref({
          pathname: '/pro/bookings/new',
          readiness: ready,
        }),
      ).toBeNull()
    })

    it('returns null when an unready pro is already on an allowed setup path', () => {
      expect(
        getProOnboardingRedirectHref({
          pathname: '/pro/services',
          readiness: unreadyWithServiceBlocker,
        }),
      ).toBeNull()
    })

    it('returns the next fix-it href when an unready pro hits a blocked path', () => {
      expect(
        getProOnboardingRedirectHref({
          pathname: '/pro/bookings/new',
          readiness: unreadyWithServiceBlocker,
        }),
      ).toBe('/pro/services')

      expect(
        getProOnboardingRedirectHref({
          pathname: '/pro/calendar',
          readiness: unreadyWithStripeBlocker,
        }),
      ).toBe('/pro/payments')

      expect(
        getProOnboardingRedirectHref({
          pathname: '/pro/media/new',
          readiness: unreadyWithVerificationBlocker,
        }),
      ).toBe('/pro/verification')
    })
  })
})