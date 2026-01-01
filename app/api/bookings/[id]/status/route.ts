// app/api/bookings/[id]/status/route.ts
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH() {
  return NextResponse.json(
    { error: 'This endpoint has moved. Use PATCH /api/pro/bookings/[id]/status' },
    { status: 410 },
  )
}
