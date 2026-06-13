// lib/booking/overridePrompts.ts
//
// Client-safe mapping from override-gated booking error codes to the
// PATCH /api/pro/bookings/[id] flags that authorize a retry, plus the
// copy the confirm dialog shows. The backend writes a BookingOverrideAuditLog
// entry for every applied override; the overrideReason is optional and, when
// provided, is also surfaced on the client's appointment detail.

import { isRecord } from '@/lib/guards'

export type BookingOverrideFlag =
  | 'allowShortNotice'
  | 'allowFarFuture'
  | 'allowOutsideWorkingHours'

export type BookingOverrideGatedCode =
  | 'ADVANCE_NOTICE_REQUIRED'
  | 'MAX_DAYS_AHEAD_EXCEEDED'
  | 'OUTSIDE_WORKING_HOURS'

/**
 * Which action tripped the override-gated rule. 'accept' is approving a
 * pending request; 'edit' is rescheduling/resizing an existing booking.
 * Only the dialog copy differs.
 */
export type BookingOverridePromptIntent = 'accept' | 'edit'

export type BookingOverridePrompt = {
  code: BookingOverrideGatedCode
  flag: BookingOverrideFlag
  question: string
  reasonPlaceholder: string
}

const BOOKING_OVERRIDE_PROMPTS: Record<
  BookingOverridePromptIntent,
  Record<BookingOverrideGatedCode, BookingOverridePrompt>
> = {
  accept: {
    ADVANCE_NOTICE_REQUIRED: {
      code: 'ADVANCE_NOTICE_REQUIRED',
      flag: 'allowShortNotice',
      question:
        'This booking is inside your advance-notice window. Accept anyway?',
      reasonPlaceholder:
        'Explain why this booking can be accepted on short notice.',
    },
    MAX_DAYS_AHEAD_EXCEEDED: {
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
      flag: 'allowFarFuture',
      question:
        'This booking is further out than your booking window allows. Accept anyway?',
      reasonPlaceholder:
        'Explain why this booking can be accepted this far in advance.',
    },
    OUTSIDE_WORKING_HOURS: {
      code: 'OUTSIDE_WORKING_HOURS',
      flag: 'allowOutsideWorkingHours',
      question: 'This booking is outside your working hours. Accept anyway?',
      reasonPlaceholder:
        'Explain why this booking can happen outside working hours.',
    },
  },
  edit: {
    ADVANCE_NOTICE_REQUIRED: {
      code: 'ADVANCE_NOTICE_REQUIRED',
      flag: 'allowShortNotice',
      question:
        'This new time is inside your advance-notice window. Save it anyway?',
      reasonPlaceholder:
        'Explain why this change can happen on short notice.',
    },
    MAX_DAYS_AHEAD_EXCEEDED: {
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
      flag: 'allowFarFuture',
      question:
        'This new time is further out than your booking window allows. Save it anyway?',
      reasonPlaceholder:
        'Explain why this booking can be scheduled this far in advance.',
    },
    OUTSIDE_WORKING_HOURS: {
      code: 'OUTSIDE_WORKING_HOURS',
      flag: 'allowOutsideWorkingHours',
      question:
        'This new time is outside your working hours. Save it anyway?',
      reasonPlaceholder:
        'Explain why this booking can happen outside working hours.',
    },
  },
}

function isBookingOverrideGatedCode(
  value: string,
): value is BookingOverrideGatedCode {
  return Object.prototype.hasOwnProperty.call(
    BOOKING_OVERRIDE_PROMPTS.accept,
    value,
  )
}

export function bookingOverridePromptFor(
  code: BookingOverrideGatedCode,
  intent: BookingOverridePromptIntent,
): BookingOverridePrompt {
  return BOOKING_OVERRIDE_PROMPTS[intent][code]
}

/**
 * Reads the structured `code` from a failed booking API response body
 * (`jsonFail` puts it at the top level) and returns the override prompt
 * when the failure is one the pro can explicitly override.
 */
export function readBookingOverridePrompt(
  data: unknown,
  intent: BookingOverridePromptIntent = 'accept',
): BookingOverridePrompt | null {
  if (!isRecord(data)) return null

  const code = data.code
  if (typeof code !== 'string' || !isBookingOverrideGatedCode(code)) {
    return null
  }

  return BOOKING_OVERRIDE_PROMPTS[intent][code]
}

/**
 * Thrown by booking PATCH helpers when the failure is override-gated,
 * so callers can offer an explicit override instead of dead-ending.
 */
export class BookingOverrideRequiredError extends Error {
  readonly prompt: BookingOverridePrompt

  constructor(message: string, prompt: BookingOverridePrompt) {
    super(message)
    this.name = 'BookingOverrideRequiredError'
    this.prompt = prompt
  }
}

export function mergeBookingOverrideFlags(
  flags: readonly BookingOverrideFlag[],
  nextFlag: BookingOverrideFlag,
): BookingOverrideFlag[] {
  return flags.includes(nextFlag) ? [...flags] : [...flags, nextFlag]
}
