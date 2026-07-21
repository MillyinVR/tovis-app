// app/api/_utils/bookingResponses.ts
// Import jsonFail from the package barrel (not ./responses directly) so route
// tests that mock '@/app/api/_utils' also intercept the call made here.
import { jsonFail } from '@/app/api/_utils'
import {
  type BookingError,
  type BookingErrorCode,
  type BookingErrorOverrides,
  getBookingFailPayload,
} from '@/lib/booking/errors'

/**
 * Map a BookingErrorCode to a jsonFail response with the canonical
 * httpStatus / userMessage / { code, retryable, uiAction, message } envelope.
 * Shared by every booking-related route so the envelope can't drift.
 */
export function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: BookingErrorOverrides,
) {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
}

/**
 * Serialize a thrown BookingError, preserving EVERY field the throw site set.
 *
 * Route catch blocks used to hand-forward `{ message, userMessage }` off the
 * error and let `bookingJsonFail` re-derive the rest from the catalog. That
 * silently dropped a call-site `uiAction` override — the consultation approval
 * downgrades TIME_BLOCKED's remedy from PICK_NEW_SLOT to NONE (the client has
 * no slot to pick), and the wire kept saying PICK_NEW_SLOT anyway. Forwarding
 * the error itself means a new overridable field can never be missed at 37
 * call sites again.
 */
export function bookingErrorJsonFail(error: BookingError) {
  return bookingJsonFail(error.code, {
    message: error.message,
    userMessage: error.userMessage,
    uiAction: error.uiAction,
  })
}
