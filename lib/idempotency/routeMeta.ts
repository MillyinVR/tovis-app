export const IDEMPOTENCY_ROUTES = {
  BOOKING_FINALIZE: 'POST /api/bookings/finalize',
  PRO_BOOKING_CREATE: 'POST /api/pro/bookings',
  PRO_BOOKING_UPDATE: 'PATCH /api/pro/bookings/[id]',
  BOOKING_START_SESSION: 'POST /api/pro/bookings/[id]/session/start',
  BOOKING_FINISH_SESSION: 'POST /api/pro/bookings/[id]/session/finish',
  BOOKING_SESSION_STEP: 'POST /api/pro/bookings/[id]/session/step',
  CONSULTATION_PROPOSAL_SEND:
    'POST /api/pro/bookings/[id]/consultation-proposal',
  CONSULTATION_PUBLIC_DECISION:
    'POST /api/public/consultation/[token]/decision',
  CONSULTATION_IN_PERSON_DECISION:
    'POST /api/pro/bookings/[id]/consultation/in-person-decision',
  BOOKING_MEDIA_CREATE: 'POST /api/pro/bookings/[id]/media',
  CLIENT_CHECKOUT_CONFIRM: 'POST /api/client/bookings/[id]/checkout',
  BOOKING_AFTERCARE_SEND: 'POST /api/pro/bookings/[id]/aftercare',
  CLIENT_AFTERCARE_REBOOK: 'POST /api/client/rebook/[token]',
  CLIENT_REVIEW_CREATE: 'POST /api/client/bookings/[id]/review',
  CLIENT_CONSULTATION_DECISION: 'POST /api/client/bookings/[id]/consultation',
  PRO_BOOKING_FINAL_REVIEW: 'POST /api/pro/bookings/[id]/final-review',
CLIENT_CHECKOUT_PRODUCTS: 'POST /api/client/bookings/[id]/checkout/products',
} as const

export type IdempotencyRoute =
  (typeof IDEMPOTENCY_ROUTES)[keyof typeof IDEMPOTENCY_ROUTES]