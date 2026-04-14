import type { Locator, Page } from '@playwright/test'

type Scope = Page | Locator

export const testIds = {
  availability: {
    drawer: 'availability-drawer',
    openTrigger: 'open-availability-button',
    closeButton: 'availability-close-button',
    error: 'availability-error',
    retryButton: 'availability-retry-button',
    slotList: 'availability-slot-list',
    slotChip: (slotIso: string) => `availability-slot-${slotIso}`,
    holdBanner: 'availability-hold-banner',
    continueButton: 'availability-hold-continue-button',
    refreshButton: 'availability-refresh-button',
    backgroundStatus: 'availability-background-status',
  },

  location: {
    salonOption: 'booking-location-salon',
    mobileOption: 'booking-location-mobile',
  },

  mobileAddress: {
    section: 'mobile-address-section',
    emptyState: 'mobile-address-empty-state',
    savedOption: (addressId: string) => `mobile-address-option-${addressId}`,
    addButton: 'mobile-address-add-button',
    modal: 'mobile-address-create-modal',
    submitButton: 'mobile-address-submit-button',
    cancelButton: 'mobile-address-cancel-button',
  },

  addOns: {
    list: 'booking-add-ons-list',
    continueButton: 'booking-add-ons-continue-button',
    skipButton: 'booking-add-ons-skip-button',
  },
} as const

export const text = {
  availability: {
    heading: /^availability$/i,
    retry: /retry/i,
    continue: /continue(?:\s+to\s+add-ons)?/i,
    expired: /expired|time ran out|hold expired/i,
    failed: /could not load|something went wrong|failed/i,
  },

  location: {
    salon: /salon|in-salon/i,
    mobile: /mobile/i,
  },

mobileAddress: {
  addAddress: /^add address$/i,
  addFirstAddress: /^add first address$/i,
  noSavedAddress: /no saved addresses? yet/i,
  noSavedAddressHelp: /add one now so the pro knows where to come\./i,
},

  addOns: {
    heading: /add-ons|add ons/i,
    continue: /^continue$/i,
    skip: /skip/i,
  },
} as const

export const patterns = {
  availability: {
    dayButton: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s*\d{1,2}$/i,
    slotButton:
      /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat).*?\d{1,2}(?::\d{2})?\s?(?:AM|PM)/i,
    continueButton: /continue(?:\s+to\s+add-ons)?/i,
  },
} as const

export function byTestId(scope: Scope, value: string): Locator {
  return scope.getByTestId(value)
}

export function availabilityDrawer(scope: Scope): Locator {
  return byTestId(scope, testIds.availability.drawer)
}

export function availabilityDayButtons(scope: Scope): Locator {
  return availabilityDrawer(scope).getByRole('button', {
    name: patterns.availability.dayButton,
  })
}

export function availabilitySlotButtons(scope: Scope): Locator {
  return availabilityDrawer(scope).getByRole('button', {
    name: patterns.availability.slotButton,
  })
}

export function availabilityContinueButton(scope: Scope): Locator {
  return availabilityDrawer(scope)
    .getByRole('button', {
      name: patterns.availability.continueButton,
    })
    .first()
}

export function availabilitySlot(scope: Scope, slotIso: string): Locator {
  return byTestId(scope, testIds.availability.slotChip(slotIso))
}

export function mobileAddressOption(scope: Scope, addressId: string): Locator {
  return byTestId(scope, testIds.mobileAddress.savedOption(addressId))
}