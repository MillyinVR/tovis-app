// lib/booking/errors.ts

export type BookingErrorCode =
  | "BOOKING_ID_REQUIRED"
  | "HOLD_ID_REQUIRED"
  | "CLIENT_ID_REQUIRED"
  | "LOCATION_ID_REQUIRED"
  | "LOCATION_TYPE_REQUIRED"
  | "INVALID_LOCATION_TYPE"
  | "OFFERING_ID_REQUIRED"
  | "INVALID_SCHEDULED_FOR"
  | "INVALID_SERVICE_ITEMS"
  | "INVALID_BUFFER_MINUTES"
  | "INVALID_DURATION_MINUTES"
  | "INVALID_STATUS"
  | "INVALID_BOOLEAN"
  | "BOOKING_NOT_FOUND"
  | "HOLD_NOT_FOUND"
  | "OFFERING_NOT_FOUND"
  | "PRO_NOT_READY"
  | "LOCATION_NOT_FOUND"
  | "FORBIDDEN"
  | "HOLD_FORBIDDEN"
  | "HOLD_EXPIRED"
  | "HOLD_MISMATCH"
  | "CLIENT_SERVICE_ADDRESS_REQUIRED"
  | "CLIENT_SERVICE_ADDRESS_INVALID"
  | "HOLD_MISSING_CLIENT_ADDRESS"
  | "SALON_LOCATION_ADDRESS_REQUIRED"
  | "TIMEZONE_REQUIRED"
  | "WORKING_HOURS_REQUIRED"
  | "WORKING_HOURS_INVALID"
  | "MODE_NOT_SUPPORTED"
  | "DURATION_REQUIRED"
  | "PRICE_REQUIRED"
  | "COORDINATES_REQUIRED"
  | "NO_SCHEDULING_READY_LOCATION"
  | "TIME_IN_PAST"
  | "ADVANCE_NOTICE_REQUIRED"
  | "MAX_DAYS_AHEAD_EXCEEDED"
  | "STEP_MISMATCH"
  | "OUTSIDE_WORKING_HOURS"
  | "INVALID_DURATION"
  | "TIME_BLOCKED"
  | "TIME_BOOKED"
  | "TIME_HELD"
  | "TIME_NOT_AVAILABLE"
  | "ADDONS_INVALID"
  | "CLIENT_NOT_FOUND"
  | "MISSING_MEDIA_ID"
  | "OPENING_NOT_AVAILABLE"
  | "BOOKING_NOT_RESCHEDULABLE"
  | "BOOKING_ALREADY_STARTED"
  | "BOOKING_MISSING_OFFERING"
  | "HOLD_TIME_INVALID"
  | "BOOKING_CANNOT_EDIT_CANCELLED"
  | "BOOKING_CANNOT_EDIT_COMPLETED"
  | "BAD_LOCATION"
  | "BAD_LOCATION_MODE"
  | "DURATION_MISMATCH"
  | "AFTERCARE_TOKEN_MISSING"
  | "AFTERCARE_TOKEN_INVALID"
  | "AFTERCARE_NOT_COMPLETED"
  | "AFTERCARE_CLIENT_MISMATCH"
  | "AFTERCARE_OFFERING_MISMATCH"
  | "AFTERCARE_DELIVERY_FAILED"
  | "WAITLIST_ENTRY_NOT_FOUND"
  | "WAITLIST_OFFER_NOT_FOUND"
  | "WAITLIST_OFFER_NOT_PENDING"
  | "NO_SHOW_FEE_NOT_WAIVABLE"
  | "STALE_VERSION"
  | "INTERNAL_ERROR";

export type BookingErrorUiAction =
  | "REFRESH_AVAILABILITY"
  | "PICK_NEW_SLOT"
  | "ADD_SERVICE_ADDRESS"
  | "FIX_LOCATION_CONFIG"
  | "FIX_OFFERING_CONFIG"
  | "FIX_WORKING_HOURS"
  | "CONTACT_SUPPORT"
  | "NONE";

export type BookingErrorMeta = {
  httpStatus: number;
  retryable: boolean;
  uiAction: BookingErrorUiAction;
  /**
   * Stable developer-facing message. Safe to log and test against.
   * Keep this boring and canonical.
   */
  message: string;
  /**
   * Stable user-facing copy for UI defaults.
   * Routes may override only when the flow genuinely needs different copy.
   */
  userMessage: string;
};

export type BookingErrorDescriptor = BookingErrorMeta & {
  code: BookingErrorCode;
};

/**
 * Per-call-site overrides for a catalog entry.
 *
 * `uiAction` is overridable because one code can be reached from surfaces with
 * different remedies. TIME_BLOCKED is the live example: in the client booking
 * flow the answer really is PICK_NEW_SLOT, but on a consultation approval the
 * client has no slot to pick — the pro has to amend the proposal — so that
 * call site downgrades it to NONE. The CODE stays the same because its meaning
 * ("that time is blocked") is the same; only the suggested remedy differs.
 */
export type BookingErrorOverrides = Partial<
  Pick<BookingErrorMeta, "message" | "userMessage" | "uiAction">
>;

export type BookingErrorResponse = {
  ok: false;
  error: BookingErrorDescriptor;
};

const BOOKING_ERROR_CATALOG: Record<BookingErrorCode, BookingErrorMeta> = {
  BOOKING_ID_REQUIRED: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Booking id is required.",
    userMessage: "Missing booking id.",
  },
  HOLD_ID_REQUIRED: {
    httpStatus: 400,
    retryable: false,
    uiAction: "PICK_NEW_SLOT",
    message: "Hold id is required.",
    userMessage: "Missing hold. Please pick a slot again.",
  },
  CLIENT_ID_REQUIRED: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Client id is required.",
    userMessage: "Missing client id.",
  },
  LOCATION_ID_REQUIRED: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Location id is required.",
    userMessage: "Missing location id.",
  },
  LOCATION_TYPE_REQUIRED: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Location type is required.",
    userMessage: "Missing location type.",
  },
  INVALID_LOCATION_TYPE: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Location type is invalid.",
    userMessage: "Invalid location type.",
  },
  OFFERING_ID_REQUIRED: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Offering id is required.",
    userMessage: "Missing offering.",
  },
  INVALID_SCHEDULED_FOR: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Scheduled time is invalid.",
    userMessage: "Invalid scheduled time.",
  },
  INVALID_SERVICE_ITEMS: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Service items are invalid.",
    userMessage: "Invalid service items.",
  },
  INVALID_BUFFER_MINUTES: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Buffer minutes are invalid.",
    userMessage: "Invalid buffer minutes.",
  },
  INVALID_DURATION_MINUTES: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Duration minutes are invalid.",
    userMessage: "Invalid duration.",
  },
  INVALID_STATUS: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Status is invalid.",
    userMessage: "Invalid status.",
  },
  INVALID_BOOLEAN: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Boolean field is invalid.",
    userMessage: "Invalid request value.",
  },

  BOOKING_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    uiAction: "NONE",
    message: "Booking not found.",
    userMessage: "Booking not found.",
  },
  HOLD_NOT_FOUND: {
    httpStatus: 409,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Hold not found.",
    userMessage: "That hold is no longer available. Please pick a slot again.",
  },
  OFFERING_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    uiAction: "NONE",
    message: "Offering not found.",
    userMessage: "This service is no longer available.",
  },
  PRO_NOT_READY: {
    httpStatus: 409,
    retryable: false,
    uiAction: "REFRESH_AVAILABILITY",
    message: "Professional is not ready to accept bookings.",
    userMessage:
      "This professional is not currently accepting bookings. Please choose another provider or try again later.",
  },
  LOCATION_NOT_FOUND: {
    httpStatus: 409,
    retryable: false,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested location was not found or is not bookable.",
    userMessage: "This location is no longer available.",
  },
  FORBIDDEN: {
    httpStatus: 403,
    retryable: false,
    uiAction: "NONE",
    message: "Forbidden.",
    userMessage: "You do not have access to do that.",
  },
  HOLD_FORBIDDEN: {
    httpStatus: 403,
    retryable: false,
    uiAction: "NONE",
    message: "Hold does not belong to the current user.",
    userMessage: "That hold does not belong to you.",
  },
  HOLD_EXPIRED: {
    httpStatus: 409,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Hold expired.",
    userMessage: "That hold expired. Please pick a new slot.",
  },
  HOLD_MISMATCH: {
    httpStatus: 409,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Hold does not match the requested booking details.",
    userMessage: "That hold no longer matches your booking. Please pick a new slot.",
  },

  CLIENT_SERVICE_ADDRESS_REQUIRED: {
    httpStatus: 400,
    retryable: false,
    uiAction: "ADD_SERVICE_ADDRESS",
    message: "Client service address is required.",
    userMessage:
      "Add or select a mobile service address before booking this in-home appointment.",
  },
  CLIENT_SERVICE_ADDRESS_INVALID: {
    httpStatus: 400,
    retryable: false,
    uiAction: "ADD_SERVICE_ADDRESS",
    message: "Client service address is invalid.",
    userMessage:
      "That service address is incomplete. Please update it before booking.",
  },
  HOLD_MISSING_CLIENT_ADDRESS: {
    httpStatus: 409,
    retryable: true,
    uiAction: "ADD_SERVICE_ADDRESS",
    message: "Hold is missing the client service address.",
    userMessage:
      "That hold is missing the service address. Please pick a new slot after updating your address.",
  },
  SALON_LOCATION_ADDRESS_REQUIRED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "FIX_LOCATION_CONFIG",
    message: "Salon location address is required.",
    userMessage:
      "This salon location is missing an address and cannot take bookings.",
  },
  TIMEZONE_REQUIRED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "FIX_LOCATION_CONFIG",
    message: "A valid timezone is required.",
    userMessage:
      "This location must have a valid timezone before it can take bookings.",
  },
  WORKING_HOURS_REQUIRED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "FIX_WORKING_HOURS",
    message: "Working hours are required.",
    userMessage: "Working hours are not set for this location.",
  },
  WORKING_HOURS_INVALID: {
    httpStatus: 409,
    retryable: false,
    uiAction: "FIX_WORKING_HOURS",
    message: "Working hours are invalid.",
    userMessage: "Working hours are misconfigured for this location.",
  },
  MODE_NOT_SUPPORTED: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Offering does not support the requested booking mode.",
    userMessage:
      "This service is not available for the selected booking type.",
  },
  DURATION_REQUIRED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "FIX_OFFERING_CONFIG",
    message: "Offering duration is required.",
    userMessage:
      "This service is missing duration settings for the selected booking type.",
  },
  PRICE_REQUIRED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "FIX_OFFERING_CONFIG",
    message: "Offering price is required.",
    userMessage:
      "This service is missing pricing for the selected booking type.",
  },
  COORDINATES_REQUIRED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "FIX_LOCATION_CONFIG",
    message: "Coordinates are required for this booking flow.",
    userMessage:
      "This location is missing coordinates required for this booking flow.",
  },
  NO_SCHEDULING_READY_LOCATION: {
    httpStatus: 409,
    retryable: false,
    uiAction: "PICK_NEW_SLOT",
    message: "No scheduling-ready location found.",
    userMessage: "No booking-ready location is available for this service.",
  },

  TIME_IN_PAST: {
    httpStatus: 400,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested time is in the past.",
    userMessage: "Please select a future time.",
  },
  ADVANCE_NOTICE_REQUIRED: {
    httpStatus: 400,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested time violates advance notice rules.",
    userMessage: "That slot is too soon. Please choose a later time.",
  },
  MAX_DAYS_AHEAD_EXCEEDED: {
    httpStatus: 400,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested time is too far in the future.",
    userMessage: "That date is too far in the future.",
  },
  STEP_MISMATCH: {
    httpStatus: 400,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested time is not on the required scheduling boundary.",
    userMessage: "That start time is not on a valid booking boundary.",
  },
  OUTSIDE_WORKING_HOURS: {
    httpStatus: 400,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested time is outside working hours.",
    userMessage: "That time is outside working hours.",
  },
  INVALID_DURATION: {
    httpStatus: 409,
    retryable: false,
    uiAction: "CONTACT_SUPPORT",
    message: "Booking duration is invalid.",
    userMessage:
      "This booking has an invalid duration and cannot be processed.",
  },

  TIME_BLOCKED: {
    httpStatus: 409,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested time is blocked.",
    userMessage: "That time is blocked. Please choose another slot.",
  },
  TIME_BOOKED: {
    httpStatus: 409,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested time already has a booking.",
    userMessage: "That time was just taken. Please choose another slot.",
  },
  TIME_HELD: {
    httpStatus: 409,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested time is currently held.",
    userMessage: "Someone is already holding that time. Please try another slot.",
  },
  TIME_NOT_AVAILABLE: {
    httpStatus: 409,
    retryable: true,
    uiAction: "REFRESH_AVAILABILITY",
    message: "Requested time is no longer available.",
    userMessage:
      "That time is no longer available. Please refresh and select a different slot.",
  },

  ADDONS_INVALID: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "One or more add-ons are invalid.",
    userMessage: "One or more add-ons are invalid for this booking.",
  },

  CLIENT_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    uiAction: "NONE",
    message: "Client not found.",
    userMessage: "Client not found.",
  },
  MISSING_MEDIA_ID: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Discovery bookings require a media id.",
    userMessage: "This booking is missing required media.",
  },
  OPENING_NOT_AVAILABLE: {
    httpStatus: 409,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Requested opening is no longer available.",
    userMessage: "That opening was just taken. Please pick another slot.",
  },
  BOOKING_NOT_RESCHEDULABLE: {
    httpStatus: 409,
    retryable: false,
    uiAction: "NONE",
    message: "Booking cannot be rescheduled.",
    userMessage: "This booking cannot be rescheduled.",
  },
  BOOKING_ALREADY_STARTED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "NONE",
    message: "Booking has already started.",
    userMessage: "This booking has started and cannot be rescheduled.",
  },
  BOOKING_MISSING_OFFERING: {
    httpStatus: 409,
    retryable: false,
    uiAction: "CONTACT_SUPPORT",
    message: "Booking is missing offering information.",
    userMessage:
      "This booking is missing service information and cannot be processed.",
  },
  HOLD_TIME_INVALID: {
    httpStatus: 400,
    retryable: true,
    uiAction: "PICK_NEW_SLOT",
    message: "Hold time is invalid.",
    userMessage: "Hold time is invalid. Please pick a new slot.",
  },
  BOOKING_CANNOT_EDIT_CANCELLED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "NONE",
    message: "Cancelled bookings cannot be edited.",
    userMessage: "Cancelled bookings cannot be edited.",
  },
  BOOKING_CANNOT_EDIT_COMPLETED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "NONE",
    message: "Completed bookings cannot be edited.",
    userMessage: "Completed bookings cannot be edited.",
  },
  BAD_LOCATION: {
    httpStatus: 409,
    retryable: false,
    uiAction: "FIX_LOCATION_CONFIG",
    message: "Booking location is invalid or not bookable.",
    userMessage: "This booking location is invalid or no longer bookable.",
  },
  BAD_LOCATION_MODE: {
    httpStatus: 409,
    retryable: false,
    uiAction: "FIX_LOCATION_CONFIG",
    message: "Booking location does not support the requested mode.",
    userMessage:
      "This booking location no longer supports the selected booking type.",
  },
  DURATION_MISMATCH: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Booking duration does not match the selected services.",
    userMessage: "Duration does not match the selected services.",
  },
  AFTERCARE_TOKEN_MISSING: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Aftercare token is missing.",
    userMessage: "Missing aftercare token.",
  },
  AFTERCARE_TOKEN_INVALID: {
    httpStatus: 400,
    retryable: false,
    uiAction: "NONE",
    message: "Aftercare token is invalid.",
    userMessage: "Invalid aftercare token.",
  },
  AFTERCARE_NOT_COMPLETED: {
    httpStatus: 409,
    retryable: false,
    uiAction: "NONE",
    message: "Only completed bookings can be rebooked from aftercare.",
    userMessage: "Only completed bookings can be rebooked.",
  },
  AFTERCARE_CLIENT_MISMATCH: {
    httpStatus: 403,
    retryable: false,
    uiAction: "NONE",
    message: "Aftercare token does not match the current client.",
    userMessage: "That aftercare link does not belong to you.",
  },
  AFTERCARE_OFFERING_MISMATCH: {
    httpStatus: 403,
    retryable: false,
    uiAction: "NONE",
    message: "Aftercare token does not match the requested offering.",
    userMessage: "That aftercare link does not match this service.",
  },
  AFTERCARE_DELIVERY_FAILED: {
    // Downstream delivery dependency failed; 503 (not 409) so clients and
    // monitoring treat it as a retryable service condition, not a conflict.
    httpStatus: 503,
    retryable: true,
    uiAction: "NONE",
    message: "Aftercare access delivery could not be queued.",
    userMessage: "We could not send aftercare to the client. Please try again.",
  },
  STALE_VERSION: {
    httpStatus: 409,
    retryable: true,
    uiAction: "REFRESH_AVAILABILITY",
    message: "Aftercare version is stale.",
    userMessage: "This aftercare draft is out of date. Refresh and try again.",
  },

  WAITLIST_ENTRY_NOT_FOUND: {
    // Uniform 404 for missing / foreign / no-longer-active waitlist entries
    // (no-leak: never distinguish "not yours" from "gone").
    httpStatus: 404,
    retryable: false,
    uiAction: "NONE",
    message: "Waitlist entry not found or not active.",
    userMessage: "That waitlist request is no longer available.",
  },
  WAITLIST_OFFER_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    uiAction: "NONE",
    message: "Waitlist offer not found.",
    userMessage: "That offer is no longer available.",
  },
  WAITLIST_OFFER_NOT_PENDING: {
    // The offer was already accepted / declined / expired / superseded.
    httpStatus: 409,
    retryable: false,
    uiAction: "NONE",
    message: "Waitlist offer is not pending.",
    userMessage: "This offer has already been responded to or has expired.",
  },

  NO_SHOW_FEE_NOT_WAIVABLE: {
    // Only a fee that was assessed but never collected (FAILED) can be waived
    // in-app. A CHARGED fee must be refunded (separate PaymentIntent); a SKIPPED
    // or absent fee has nothing to forgive.
    httpStatus: 409,
    retryable: false,
    uiAction: "NONE",
    message: "No-show fee is not in a waivable state.",
    userMessage: "This fee can't be waived — it was never charged, or was already collected.",
  },

  INTERNAL_ERROR: {
    httpStatus: 500,
    retryable: false,
    uiAction: "CONTACT_SUPPORT",
    message: "Internal booking error.",
    userMessage: "Something went wrong while processing the booking.",
  },
};

export function getBookingErrorMeta(code: BookingErrorCode): BookingErrorMeta {
  return BOOKING_ERROR_CATALOG[code];
}

/**
 * Whether a caller-supplied code names a catalog entry. Lets helpers that
 * accept an error code as a parameter (e.g. lib/booking/serviceItems guards)
 * throw a proper BookingError for catalog codes instead of a plain Error the
 * routes' isBookingError check can't recognize.
 */
export function isBookingErrorCode(code: string): code is BookingErrorCode {
  return Object.prototype.hasOwnProperty.call(BOOKING_ERROR_CATALOG, code);
}

export function getBookingErrorDescriptor(
  code: BookingErrorCode,
  overrides?: BookingErrorOverrides,
): BookingErrorDescriptor {
  const meta = getBookingErrorMeta(code);

  return {
    code,
    httpStatus: meta.httpStatus,
    retryable: meta.retryable,
    uiAction: overrides?.uiAction ?? meta.uiAction,
    message: overrides?.message ?? meta.message,
    userMessage: overrides?.userMessage ?? meta.userMessage,
  };
}

export function toBookingErrorResponse(
  code: BookingErrorCode,
  overrides?: BookingErrorOverrides,
): BookingErrorResponse {
  return {
    ok: false,
    error: getBookingErrorDescriptor(code, overrides),
  };
}

export class BookingError extends Error {
  readonly code: BookingErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly uiAction: BookingErrorUiAction;
  readonly userMessage: string;

  constructor(
    code: BookingErrorCode,
    overrides?: BookingErrorOverrides,
  ) {
    const descriptor = getBookingErrorDescriptor(code, overrides);
    super(descriptor.message);

    this.name = "BookingError";
    this.code = descriptor.code;
    this.httpStatus = descriptor.httpStatus;
    this.retryable = descriptor.retryable;
    this.uiAction = descriptor.uiAction;
    this.userMessage = descriptor.userMessage;
  }
}

export function bookingError(
  code: BookingErrorCode,
  overrides?: BookingErrorOverrides,
): BookingError {
  return new BookingError(code, overrides);
}

/**
 * Codes that mean "this opening (or this exact time) is no longer yours to take"
 * on a last-minute claim.
 *
 * The claim path CANNOT branch on the 409 status alone. Twenty-seven distinct
 * codes answer 409, and several are reachable on a claim without anybody having
 * raced you — `PRO_NOT_READY` when the pro's readiness lapsed after the opening
 * was published, and the location-config family (`WORKING_HOURS_REQUIRED`,
 * `TIMEZONE_REQUIRED`, `SALON_LOCATION_ADDRESS_REQUIRED`,
 * `NO_SCHEDULING_READY_LOCATION`, …) when their setup drifted. Telling that
 * client "Someone just grabbed it" is simply false, and it sends them away from
 * a slot that is still sitting there with no way to find out otherwise.
 *
 * Policy refusals (off-step start, outside working hours, too soon) are 400s and
 * carry their own readable copy — never dress those up as a race either.
 *
 * `OPENING_NOT_AVAILABLE` is raised from five distinct places in the write
 * boundary — wrong pro, wrong service, time mismatch, already consumed, and the
 * update race — with no discriminator. On the claim path every one of them means
 * the same thing to the client, because the claim surface never lets them pick a
 * time: it always sends the opening's own instant, so a mismatch can only mean
 * the opening changed underneath them.
 *
 * Kept here rather than in a component so web and the iOS `OpeningClaimFailure`
 * classifier stay the same rule rather than two lists that drift.
 */
export const OPENING_GONE_CODES: ReadonlySet<BookingErrorCode> = new Set([
  "OPENING_NOT_AVAILABLE",
  "TIME_BOOKED",
  "TIME_HELD",
  "TIME_BLOCKED",
]);

/** Whether a `code` off an error body means the opening is gone. */
export function isOpeningGoneCode(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const code = value.trim().toUpperCase();
  return isBookingErrorCode(code) && OPENING_GONE_CODES.has(code);
}

export function isBookingError(value: unknown): value is BookingError {
  return value instanceof BookingError;
}

/**
 * Helper for existing routes that still use jsonFail(status, message, extra).
 * Example:
 *
 * const err = getBookingErrorDescriptor("TIME_BLOCKED");
 * return jsonFail(err.httpStatus, err.userMessage, {
 *   code: err.code,
 *   retryable: err.retryable,
 *   uiAction: err.uiAction,
 *   message: err.message,
 * });
 */
export function getBookingFailPayload(
  code: BookingErrorCode,
  overrides?: BookingErrorOverrides,
): {
  httpStatus: number;
  userMessage: string;
  extra: {
    code: BookingErrorCode;
    retryable: boolean;
    uiAction: BookingErrorUiAction;
    message: string;
  };
} {
  const descriptor = getBookingErrorDescriptor(code, overrides);

  return {
    httpStatus: descriptor.httpStatus,
    userMessage: descriptor.userMessage,
    extra: {
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    },
  };
}