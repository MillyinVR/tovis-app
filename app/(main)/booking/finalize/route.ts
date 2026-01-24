// app/(main)/booking/finalize/route.ts

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { BookingSource, ServiceLocationType } from '@prisma/client'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'

// Reuse helpers by importing them if you move them into a shared file.
// For today: copy helper functions from /api/bookings/route.ts (normalizeSourceLoose, normalizeLocationTypeStrict, etc.)

export const dynamic = 'force-dynamic'

type Body = {
  offeringId?: unknown
  holdId?: unknown
  source?: unknown
  locationType?: unknown
  mediaId?: unknown
  addOns?: unknown
}

export async function POST(request: Request) {
  // ✅ same logic as existing /api/bookings POST
  // - validate auth
  // - validate hold
  // - validate offering
  // - conflict check
  // - create booking
  // - delete hold
  // - (later) attach addOns to serviceItems or a bookingAddOn table

  return NextResponse.json({ ok: true, booking: { id: '...' } }, { status: 201 })
}
