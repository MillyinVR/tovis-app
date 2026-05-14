// lib/proSession/closeoutChecklist.ts

export type ProSessionCloseoutChecklistInput = {
  afterCount: number
  hasAfterPhoto: boolean
  hasAftercareDraft: boolean
  hasFinalizedAftercare: boolean
  hasPaymentCollected: boolean
  hasCheckoutClosed: boolean
  hasConsultationApproved: boolean
}

export type ProSessionCloseoutChecklistItemKey =
  | 'afterPhotos'
  | 'aftercare'
  | 'payment'
  | 'checkout'
  | 'consultation'

export type ProSessionCloseoutChecklistItem = {
  key: ProSessionCloseoutChecklistItemKey
  title: string
  subtitle: string
  done: boolean
}

export type ProSessionCloseoutChecklist = {
  canComplete: boolean
  helpText: string
  items: ProSessionCloseoutChecklistItem[]
}

export const CLOSEOUT_READY_HELP_TEXT =
  'All closeout requirements are ready. Finish closeout from aftercare.'

export const CLOSEOUT_BLOCKED_HELP_TEXT =
  'Requires approved consultation, after photos, finalized aftercare, collected payment, and paid or waived checkout.'

export function buildProSessionCloseoutChecklist(
  input: ProSessionCloseoutChecklistInput,
): ProSessionCloseoutChecklist {
  const aftercareStatus = input.hasFinalizedAftercare
    ? 'finalized + sent'
    : input.hasAftercareDraft
      ? 'draft saved'
      : 'missing'

  const paymentStatus = input.hasPaymentCollected
    ? 'collected'
    : 'not collected'

  const checkoutStatus = input.hasCheckoutClosed
    ? 'paid or waived'
    : 'not closed'

  const consultationStatus = input.hasConsultationApproved
    ? 'approved'
    : 'not approved'

  const canComplete =
    input.hasAfterPhoto &&
    input.hasFinalizedAftercare &&
    input.hasPaymentCollected &&
    input.hasCheckoutClosed &&
    input.hasConsultationApproved

  return {
    canComplete,
    helpText: canComplete
      ? CLOSEOUT_READY_HELP_TEXT
      : CLOSEOUT_BLOCKED_HELP_TEXT,
    items: [
      {
        key: 'afterPhotos',
        title: 'After photos',
        subtitle: input.hasAfterPhoto
          ? `${input.afterCount} photos captured`
          : 'Missing',
        done: input.hasAfterPhoto,
      },
      {
        key: 'aftercare',
        title: 'Aftercare sent to client',
        subtitle: aftercareStatus,
        done: input.hasFinalizedAftercare,
      },
      {
        key: 'payment',
        title: 'Payment collected',
        subtitle: paymentStatus,
        done: input.hasPaymentCollected,
      },
      {
        key: 'checkout',
        title: 'Checkout paid or waived',
        subtitle: checkoutStatus,
        done: input.hasCheckoutClosed,
      },
      {
        key: 'consultation',
        title: 'Consultation approved',
        subtitle: consultationStatus,
        done: input.hasConsultationApproved,
      },
    ],
  }
}