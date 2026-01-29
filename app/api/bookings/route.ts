import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { ok: false, error: 'Not implemented. Use /api/bookings/* routes.' },
    { status: 404 },
  )
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'Not implemented. Use /api/bookings/* routes.' },
    { status: 404 },
  )
}
