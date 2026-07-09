// app/api/v1/client/bookings/route.ts
import { NextRequest } from 'next/server'
import { safeError } from '@/lib/security/logging'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'

import { loadClientBookingBuckets } from '@/lib/booking/clientBookingBuckets'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) {
      return auth.res
    }

    const { buckets, meta } = await loadClientBookingBuckets(auth.clientId)

    return jsonOk({ buckets, meta }, 200)
  } catch (error: unknown) {
    console.error('GET /api/v1/client/bookings error', {
      error: safeError(error),
    })

    return jsonFail(500, 'Failed to load client bookings.')
  }
}

export async function POST(_req: NextRequest) {
  return jsonFail(410, 'This endpoint has been deprecated.', {
    code: 'DEPRECATED_ENDPOINT',
    hint: {
      deprecatedEndpoint: 'POST /api/v1/client/bookings',
      correctFlow: {
        createHold: 'POST /api/v1/holds',
        finalizeBooking: 'POST /api/v1/bookings/finalize',
      },
      message: 'Create a booking hold first, then finalize the hold.',
    },
  })
}
