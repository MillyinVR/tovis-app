import { asTrimmedString, getRecordProp, isRecord } from '@/lib/guards'

export type BookingErrorUiAction =
  | 'REFRESH_AVAILABILITY'
  | 'PICK_NEW_SLOT'
  | 'ADD_SERVICE_ADDRESS'
  | 'FIX_LOCATION_CONFIG'
  | 'FIX_OFFERING_CONFIG'
  | 'FIX_WORKING_HOURS'
  | 'CONTACT_SUPPORT'
  | 'NONE'

export type ParsedBookingApiError = {
  code: string | null
  message: string | null
  uiAction: BookingErrorUiAction | null
}

export function parseBookingUiAction(
  value: unknown,
): BookingErrorUiAction | null {
  if (
    value === 'REFRESH_AVAILABILITY' ||
    value === 'PICK_NEW_SLOT' ||
    value === 'ADD_SERVICE_ADDRESS' ||
    value === 'FIX_LOCATION_CONFIG' ||
    value === 'FIX_OFFERING_CONFIG' ||
    value === 'FIX_WORKING_HOURS' ||
    value === 'CONTACT_SUPPORT' ||
    value === 'NONE'
  ) {
    return value
  }

  return null
}

export function parseBookingApiError(
  raw: unknown,
): ParsedBookingApiError | null {
  if (!isRecord(raw)) return null

  return {
    code: asTrimmedString(getRecordProp(raw, 'code')),
    message: asTrimmedString(getRecordProp(raw, 'error')),
    uiAction: parseBookingUiAction(getRecordProp(raw, 'uiAction')),
  }
}

/**
 * Error thrown by the drawer's fetch layers when the API rejects a request.
 * Carries the machine-readable booking error `code` from the envelope so
 * callers can branch on it instead of matching userMessage strings (which
 * differ per route for the same code).
 */
export class BookingApiRequestError extends Error {
  readonly code: string | null

  constructor(message: string, code: string | null = null) {
    super(message)
    this.name = 'BookingApiRequestError'
    this.code = code
  }
}

export function bookingErrorCodeFromUnknown(e: unknown): string | null {
  return e instanceof BookingApiRequestError ? e.code : null
}

export function getBookingUiMessage(
  parsed: ParsedBookingApiError | null,
  fallback: string,
): string {
  if (!parsed) return fallback

  switch (parsed.code) {
    case 'CLIENT_SERVICE_ADDRESS_REQUIRED':
    case 'CLIENT_SERVICE_ADDRESS_INVALID':
    case 'HOLD_MISSING_CLIENT_ADDRESS':
      return (
        parsed.message ?? 'Choose a mobile service address before continuing.'
      )

    case 'HOLD_EXPIRED':
      return parsed.message ?? 'That hold expired. Please pick a new slot.'

    case 'HOLD_NOT_FOUND':
    case 'HOLD_MISMATCH':
    case 'TIME_BLOCKED':
    case 'TIME_BOOKED':
    case 'TIME_HELD':
    case 'TIME_NOT_AVAILABLE':
    case 'STEP_MISMATCH':
    case 'OUTSIDE_WORKING_HOURS':
    case 'ADVANCE_NOTICE_REQUIRED':
    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return parsed.message ?? fallback

    default:
      return parsed.message ?? fallback
  }
}

export function shouldRefreshAvailabilityAfterBookingError(
  parsed: ParsedBookingApiError | null,
  status: number,
): boolean {
  if (
    parsed?.uiAction === 'REFRESH_AVAILABILITY' ||
    parsed?.uiAction === 'PICK_NEW_SLOT'
  ) {
    return true
  }

  switch (parsed?.code) {
    case 'HOLD_EXPIRED':
    case 'HOLD_NOT_FOUND':
    case 'HOLD_MISMATCH':
    case 'TIME_BLOCKED':
    case 'TIME_BOOKED':
    case 'TIME_HELD':
    case 'TIME_NOT_AVAILABLE':
    case 'STEP_MISMATCH':
    case 'OUTSIDE_WORKING_HOURS':
    case 'ADVANCE_NOTICE_REQUIRED':
    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return true

    default:
      return status === 409
  }
}