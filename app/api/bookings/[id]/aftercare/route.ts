// pro/bookings/[id]/aftercare/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function POST(request: Request, context: any) {
  try {
    const user = await getCurrentUser()

    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const params = await context.params
    const id = params?.id as string | undefined

    if (!id) {
      return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })
    }

    const db: any = prisma
    const body = await request.json()
    const { notes, rebookAt } = body as {
      notes?: string
      rebookAt?: string | null
    }

    const booking = await db.booking.findUnique({
      where: { id },
    })

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Create or update aftercare summary
    const aftercare = await db.aftercareSummary.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        notes: notes ?? '',
        rebookedFor: rebookAt ? new Date(rebookAt) : null,
      },
      update: {
        notes: notes ?? '',
        rebookedFor: rebookAt ? new Date(rebookAt) : null,
      },
    })

    let newBooking: any = null

    if (rebookAt) {
      const rebookDate = new Date(rebookAt)

      newBooking = await db.booking.create({
        data: {
          clientId: booking.clientId,
          professionalId: booking.professionalId,
          serviceId: booking.serviceId,
          offeringId: booking.offeringId,
          scheduledFor: rebookDate,
          status: 'ACCEPTED',
          priceSnapshot: booking.priceSnapshot,
          durationMinutesSnapshot: booking.durationMinutesSnapshot,
        },
      })
    }

    // Make sure original booking is marked completed
    await db.booking.update({
      where: { id: booking.id },
      data: {
        status: 'COMPLETED',
      },
    })

    return NextResponse.json(
      {
        aftercareId: aftercare.id,
        rebookedBookingId: newBooking?.id ?? null,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('Aftercare save error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
