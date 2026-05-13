// lib/booking/closeoutBlockers.ts
export type CloseoutBlockerCode =
  | 'AFTER_PHOTOS_REQUIRED'
  | 'AFTERCARE_REQUIRED'
  | 'AFTERCARE_NOT_SENT'
  | 'PAYMENT_NOT_COLLECTED'
  | 'CHECKOUT_NOT_COMPLETE'
  | 'CHECKOUT_NOT_PAID_OR_WAIVED'
  | 'CONSULTATION_NOT_APPROVED'

export type CloseoutBlockerDisplay = {
  code: CloseoutBlockerCode
  label: string
  description: string
  actionLabel: string
}

const CLOSEOUT_BLOCKER_DISPLAYS: Record<
  CloseoutBlockerCode,
  Omit<CloseoutBlockerDisplay, 'code'>
> = {
  AFTER_PHOTOS_REQUIRED: {
    label: 'After photos required',
    description:
      'Add at least one after photo before this booking can be completed.',
    actionLabel: 'Add after photos',
  },
  AFTERCARE_REQUIRED: {
    label: 'Aftercare required',
    description:
      'Create aftercare instructions before this booking can be completed.',
    actionLabel: 'Create aftercare',
  },
  AFTERCARE_NOT_SENT: {
    label: 'Aftercare not sent',
    description:
      'Send the aftercare summary to the client before this booking can be completed.',
    actionLabel: 'Send aftercare',
  },
  PAYMENT_NOT_COLLECTED: {
    label: 'Payment not collected',
    description:
      'Collect or confirm payment before this booking can be completed.',
    actionLabel: 'Go to checkout',
  },
  CHECKOUT_NOT_COMPLETE: {
    label: 'Checkout not complete',
    description:
      'Checkout must be paid or waived before this booking can be completed.',
    actionLabel: 'Finish checkout',
  },
  CHECKOUT_NOT_PAID_OR_WAIVED: {
    label: 'Checkout not paid or waived',
    description:
      'Mark checkout as paid or waived before this booking can be completed.',
    actionLabel: 'Finish checkout',
  },
  CONSULTATION_NOT_APPROVED: {
    label: 'Consultation not approved',
    description:
      'Record client consultation approval before this booking can be completed.',
    actionLabel: 'Review consultation',
  },
}

export const CLOSEOUT_BLOCKER_CODES: readonly CloseoutBlockerCode[] = [
  'AFTER_PHOTOS_REQUIRED',
  'AFTERCARE_REQUIRED',
  'AFTERCARE_NOT_SENT',
  'PAYMENT_NOT_COLLECTED',
  'CHECKOUT_NOT_COMPLETE',
  'CHECKOUT_NOT_PAID_OR_WAIVED',
  'CONSULTATION_NOT_APPROVED',
]

export function isCloseoutBlockerCode(
  value: unknown,
): value is CloseoutBlockerCode {
  return (
    typeof value === 'string' &&
    CLOSEOUT_BLOCKER_CODES.includes(value as CloseoutBlockerCode)
  )
}

export function getCloseoutBlockerDisplay(
  code: CloseoutBlockerCode,
): CloseoutBlockerDisplay {
  const display = CLOSEOUT_BLOCKER_DISPLAYS[code]

  return {
    code,
    ...display,
  }
}

export function getCloseoutBlockerLabel(
  code: CloseoutBlockerCode,
): string {
  return getCloseoutBlockerDisplay(code).label
}

export function getCloseoutBlockerDescription(
  code: CloseoutBlockerCode,
): string {
  return getCloseoutBlockerDisplay(code).description
}

export function normalizeCloseoutBlockerCodes(
  values: readonly unknown[] | null | undefined,
): CloseoutBlockerCode[] {
  if (!Array.isArray(values)) return []

  const seen = new Set<CloseoutBlockerCode>()
  const normalized: CloseoutBlockerCode[] = []

  for (const value of values) {
    if (!isCloseoutBlockerCode(value)) continue
    if (seen.has(value)) continue

    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

export function getCloseoutBlockerDisplays(
  values: readonly unknown[] | null | undefined,
): CloseoutBlockerDisplay[] {
  return normalizeCloseoutBlockerCodes(values).map(getCloseoutBlockerDisplay)
}

export function hasCloseoutBlockers(
  values: readonly unknown[] | null | undefined,
): boolean {
  return normalizeCloseoutBlockerCodes(values).length > 0
}