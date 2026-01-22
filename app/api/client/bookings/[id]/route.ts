// app/api/client/bookings/[id]/route.ts
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH() {
  return NextResponse.json(
    {
      ok: false,
      error: 'This endpoint has been deprecated.',
      hint: {
        cancel: 'POST /api/bookings/[id]/cancel',
        reschedule: 'POST /api/bookings/[id]/reschedule',
      },
    },
    { status: 410 },
  )
}
