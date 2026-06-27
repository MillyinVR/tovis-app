// lib/idempotency/routeMeta.ts

export const IDEMPOTENCY_ROUTES = {
  BOOKING_FINALIZE: 'POST /api/v1/bookings/finalize',

  PRO_BOOKING_CREATE: 'POST /api/v1/pro/bookings',
  PRO_BOOKING_UPDATE: 'PATCH /api/v1/pro/bookings/[id]',
  PRO_BOOKING_CANCEL: 'PATCH /api/v1/pro/bookings/[id]/cancel',
  PRO_BOOKING_REBOOK: 'POST /api/v1/pro/bookings/[id]/rebook',
  PRO_BOOKING_FINAL_REVIEW: 'POST /api/v1/pro/bookings/[id]/final-review',
  PRO_BOOKING_CHECKOUT_MARK_PAID:
    'POST /api/v1/pro/bookings/[id]/checkout/mark-paid',
  PRO_BOOKING_CHECKOUT_WAIVE:
    'POST /api/v1/pro/bookings/[id]/checkout/waive',

  BOOKING_CANCEL: 'POST /api/v1/bookings/[id]/cancel',
  BOOKING_REFUND: 'POST /api/v1/bookings/[id]/refund',
  BOOKING_RESCHEDULE: 'POST /api/v1/bookings/[id]/reschedule',

  BOOKING_START_SESSION: 'POST /api/v1/pro/bookings/[id]/session/start',
  BOOKING_FINISH_SESSION: 'POST /api/v1/pro/bookings/[id]/session/finish',
  BOOKING_SESSION_STEP: 'POST /api/v1/pro/bookings/[id]/session/step',

  CONSULTATION_PROPOSAL_SEND:
    'POST /api/v1/pro/bookings/[id]/consultation-proposal',
  CONSULTATION_PUBLIC_DECISION:
    'POST /api/v1/public/consultation/[token]/decision',
  CONSULTATION_IN_PERSON_DECISION:
    'POST /api/v1/pro/bookings/[id]/consultation/in-person-decision',
  CLIENT_CONSULTATION_DECISION: 'POST /api/v1/client/bookings/[id]/consultation',

  BOOKING_MEDIA_CREATE: 'POST /api/v1/pro/bookings/[id]/media',

  BOOKING_AFTERCARE_SEND: 'POST /api/v1/pro/bookings/[id]/aftercare',
  CLIENT_AFTERCARE_REBOOK: 'POST /api/v1/client/rebook/[token]',

  CLIENT_CHECKOUT_CONFIRM: 'POST /api/v1/client/bookings/[id]/checkout',
  CLIENT_CHECKOUT_STRIPE_SESSION:
    'POST /api/v1/client/bookings/[id]/checkout/stripe-session',
  CLIENT_DEPOSIT_STRIPE_SESSION:
    'POST /api/v1/client/bookings/[id]/deposit/stripe-session',
  PUBLIC_AFTERCARE_CHECKOUT_STRIPE_SESSION:
    'POST /api/v1/client/rebook/[token]/checkout',
  CLIENT_CHECKOUT_PRODUCTS: 'POST /api/v1/client/bookings/[id]/checkout/products',

  CLIENT_REVIEW_CREATE: 'POST /api/v1/client/bookings/[id]/review',

  CLIENT_SHARE_LOOK: 'POST /api/v1/client/bookings/[id]/share-look',
} as const

export type IdempotencyRoute =
  (typeof IDEMPOTENCY_ROUTES)[keyof typeof IDEMPOTENCY_ROUTES]