// app/api/_utils/bookingResponses.ts
// Import jsonFail from the package barrel (not ./responses directly) so route
// tests that mock '@/app/api/_utils' also intercept the call made here.
import { jsonFail } from '@/app/api/_utils'
import {
  type BookingErrorCode,
  getBookingFailPayload,
} from '@/lib/booking/errors'

/**
 * Map a BookingErrorCode to a jsonFail response with the canonical
 * httpStatus / userMessage / { code, retryable, uiAction, message } envelope.
 * Shared by every booking-related route so the envelope can't drift.
 */
export function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
) {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
}
