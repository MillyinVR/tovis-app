import { describe, expect, it } from 'vitest'

import {
  getBookingUiMessage,
  parseBookingApiError,
  shouldRefreshAvailabilityAfterBookingError,
} from './bookingError'

describe('AvailabilityDrawer booking error helpers', () => {
  it('parses safe booking API error fields and ignores unknown ui actions', () => {
    expect(
      parseBookingApiError({
        code: 'TIME_HELD',
        error: 'That time was just taken.',
        uiAction: 'PICK_NEW_SLOT',
        retryable: true,
        message: 'developer-only detail',
      }),
    ).toEqual({
      code: 'TIME_HELD',
      message: 'That time was just taken.',
      uiAction: 'PICK_NEW_SLOT',
    })

    expect(
      parseBookingApiError({
        code: 'TIME_HELD',
        error: 'That time was just taken.',
        uiAction: 'DO_WEIRD_THING',
      }),
    ).toEqual({
      code: 'TIME_HELD',
      message: 'That time was just taken.',
      uiAction: null,
    })
  })

  it('returns null for non-object API error payloads', () => {
    expect(parseBookingApiError(null)).toBeNull()
    expect(parseBookingApiError('oops')).toBeNull()
    expect(parseBookingApiError([])).toBeNull()
  })

  it('uses mobile-address-specific copy for mobile address errors', () => {
    expect(
      getBookingUiMessage(
        {
          code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
          message: null,
          uiAction: null,
        },
        'Fallback message.',
      ),
    ).toBe('Choose a mobile service address before continuing.')

    expect(
      getBookingUiMessage(
        {
          code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
          message: 'Pick an address first.',
          uiAction: null,
        },
        'Fallback message.',
      ),
    ).toBe('Pick an address first.')
  })

  it('refreshes availability for conflict-style booking errors', () => {
    expect(
      shouldRefreshAvailabilityAfterBookingError(
        {
          code: 'TIME_HELD',
          message: 'That time is held.',
          uiAction: null,
        },
        400,
      ),
    ).toBe(true)

    expect(
      shouldRefreshAvailabilityAfterBookingError(
        {
          code: 'SOMETHING_UNKNOWN',
          message: 'Conflict.',
          uiAction: null,
        },
        409,
      ),
    ).toBe(true)

    expect(
      shouldRefreshAvailabilityAfterBookingError(
        {
          code: 'SOMETHING_UNKNOWN',
          message: 'Bad request.',
          uiAction: null,
        },
        400,
      ),
    ).toBe(false)
  })

  it('refreshes availability when the server explicitly requests a refresh or new slot', () => {
    expect(
      shouldRefreshAvailabilityAfterBookingError(
        {
          code: 'CUSTOM_ERROR',
          message: 'Refresh please.',
          uiAction: 'REFRESH_AVAILABILITY',
        },
        400,
      ),
    ).toBe(true)

    expect(
      shouldRefreshAvailabilityAfterBookingError(
        {
          code: 'CUSTOM_ERROR',
          message: 'Pick again.',
          uiAction: 'PICK_NEW_SLOT',
        },
        400,
      ),
    ).toBe(true)
  })
})