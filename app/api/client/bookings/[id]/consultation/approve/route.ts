// app/api/client/bookings/[id]/consultation/approve/route.ts
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: 'This endpoint has been deprecated.',
      hint: {
        correctEndpoint: 'POST /api/client/bookings/[id]/consultation',
        body: { action: 'APPROVE' },
      },
    },
    { status: 410 },
  )
}
