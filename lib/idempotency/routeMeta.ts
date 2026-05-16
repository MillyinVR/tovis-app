// lib/idempotency/routeMeta.ts

export const IDEMPOTENCY_ROUTES = {
  BOOKING_FINALIZE: 'POST /api/bookings/finalize',

  PRO_BOOKING_CREATE: 'POST /api/pro/bookings',
  PRO_BOOKING_UPDATE: 'PATCH /api/pro/bookings/[id]',
  PRO_BOOKING_CANCEL: 'PATCH /api/pro/bookings/[id]/cancel',
  PRO_BOOKING_REBOOK: 'POST /api/pro/bookings/[id]/rebook',
  PRO_BOOKING_FINAL_REVIEW: 'POST /api/pro/bookings/[id]/final-review',

  PRO_BOOKING_CHECKOUT_MARK_PAID:
  'POST /api/pro/bookings/[id]/checkout/mark-paid',

  PRO_BOOKING_CHECKOUT_WAIVE:
    'POST /api/pro/bookings/[id]/checkout/waive',
    
  BOOKING_CANCEL: 'POST /api/bookings/[id]/cancel',
  BOOKING_RESCHEDULE: 'POST /api/bookings/[id]/reschedule',

  BOOKING_START_SESSION: 'POST /api/pro/bookings/[id]/session/start',
  BOOKING_FINISH_SESSION: 'POST /api/pro/bookings/[id]/session/finish',
  BOOKING_SESSION_STEP: 'POST /api/pro/bookings/[id]/session/step',

  CONSULTATION_PROPOSAL_SEND:
    'POST /api/pro/bookings/[id]/consultation-proposal',
  CONSULTATION_PUBLIC_DECISION:
    'POST /api/public/consultation/[token]/decision',
  CONSULTATION_IN_PERSON_DECISION:
    'POST /api/pro/bookings/[id]/consultation/in-person-decision',
  CLIENT_CONSULTATION_DECISION: 'POST /api/client/bookings/[id]/consultation',

  BOOKING_MEDIA_CREATE: 'POST /api/pro/bookings/[id]/media',

  BOOKING_AFTERCARE_SEND: 'POST /api/pro/bookings/[id]/aftercare',
  CLIENT_AFTERCARE_REBOOK: 'POST /api/client/rebook/[token]',

  CLIENT_CHECKOUT_CONFIRM: 'POST /api/client/bookings/[id]/checkout',
  CLIENT_CHECKOUT_STRIPE_SESSION:
    'POST /api/client/bookings/[id]/checkout/stripe-session',
  CLIENT_CHECKOUT_PRODUCTS: 'POST /api/client/bookings/[id]/checkout/products',

  CLIENT_REVIEW_CREATE: 'POST /api/client/bookings/[id]/review',
} as const

export type IdempotencyRoute =
  (typeof IDEMPOTENCY_ROUTES)[keyof typeof IDEMPOTENCY_ROUTES]