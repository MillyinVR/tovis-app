import type { Locator, Page } from '@playwright/test'

type Scope = Page | Locator

export const testIds = {
  availability: {
    drawer: 'availability-drawer',
    openTrigger: 'availability-open-trigger',
    closeButton: 'availability-close-button',
    loading: 'availability-loading',
    error: 'availability-error',
    retryButton: 'availability-retry-button',
    dayScroller: 'availability-day-scroller',
    slotList: 'availability-slot-list',
    slotChip: (slotIso: string) => `availability-slot-${slotIso}`,
    holdBanner: 'availability-hold-banner',
    holdCountdown: 'availability-hold-countdown',
    continueButton: 'availability-continue-button',
  },

  location: {
    switcher: 'booking-location-switcher',
    salonOption: 'booking-location-salon',
    mobileOption: 'booking-location-mobile',
  },

  mobileAddress: {
    section: 'mobile-address-section',
    emptyState: 'mobile-address-empty-state',
    savedList: 'mobile-address-saved-list',
    savedOption: (addressId: string) => `mobile-address-option-${addressId}`,
    addButton: 'mobile-address-add-button',
    modal: 'mobile-address-create-modal',
    submitButton: 'mobile-address-submit-button',
    cancelButton: 'mobile-address-cancel-button',
  },

  addOns: {
    page: 'booking-add-ons-page',
    loading: 'booking-add-ons-loading',
    error: 'booking-add-ons-error',
    list: 'booking-add-ons-list',
    continueButton: 'booking-add-ons-continue-button',
    skipButton: 'booking-add-ons-skip-button',
  },
} as const

export const text = {
  availability: {
    heading: /availability/i,
    retry: /retry/i,
    continue: /^continue$/i,
    expired: /expired|time ran out|hold expired/i,
    failed: /could not load|something went wrong|failed/i,
  },

  location: {
    salon: /salon/i,
    mobile: /mobile/i,
  },

  mobileAddress: {
    addAddress: /add address/i,
    noSavedAddress: /no saved address|add an address/i,
  },

  addOns: {
    heading: /add-ons|add ons/i,
    continue: /^continue$/i,
    skip: /skip/i,
  },
} as const

export function byTestId(scope: Scope, value: string): Locator {
  return scope.getByTestId(value)
}

export function availabilityDrawer(scope: Scope): Locator {
  return byTestId(scope, testIds.availability.drawer)
}

export function availabilitySlot(scope: Scope, slotIso: string): Locator {
  return byTestId(scope, testIds.availability.slotChip(slotIso))
}

export function mobileAddressOption(scope: Scope, addressId: string): Locator {
  return byTestId(scope, testIds.mobileAddress.savedOption(addressId))
}