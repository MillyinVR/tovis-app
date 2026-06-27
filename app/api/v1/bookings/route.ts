// app/api/v1/bookings/route.ts

import { jsonFail } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

const BOOKING_CREATE_FLOW_HINT = {
  createHold: 'POST /api/v1/holds',
  finalizeBooking: 'POST /api/v1/bookings/finalize',
} as const

export async function GET() {
  return jsonFail(405, 'Method not allowed.', {
    code: 'METHOD_NOT_ALLOWED',
    allowedMethods: ['POST'],
    hint: {
      readClientBookings: 'GET /api/v1/client/bookings',
      readProBookings: 'GET /api/v1/pro/bookings',
    },
  })
}

export async function POST() {
  return jsonFail(410, 'Direct booking creation has been deprecated.', {
    code: 'DEPRECATED_ENDPOINT',
    allowedMethods: ['POST'],
    hint: {
      correctFlow: BOOKING_CREATE_FLOW_HINT,
      message: 'Create a booking hold first, then finalize the hold.',
    },
  })
}