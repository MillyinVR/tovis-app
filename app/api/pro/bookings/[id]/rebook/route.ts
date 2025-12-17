import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params

    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { scheduledFor } = body as { scheduledFor?: string }

    if (!scheduledFor) {
      return NextResponse.json(
        { error: 'scheduledFor is required' },
        { status: 400 }
      )
    }

    const scheduledDate = new Date(scheduledFor)
    if (Number.isNaN(scheduledDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid scheduledFor date' },
        { status: 400 }
      )
    }

    // Load the original booking
    const booking = await prisma.booking.findUnique({
      where: { id },
    })

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    // Make sure this booking belongs to the logged-in pro
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json(
        { error: 'Cannot rebook a booking that is not yours' },
        { status: 403 }
      )
    }

    // Create the new booking, copying the important bits
    const newBooking = await prisma.booking.create({
      data: {
        clientId: booking.clientId,
        professionalId: booking.professionalId,
        serviceId: booking.serviceId,
        offeringId: booking.offeringId,
        scheduledFor: scheduledDate,
        status: 'ACCEPTED', // for your internal use, it’s confirmed
        priceSnapshot: booking.priceSnapshot,
        durationMinutesSnapshot: booking.durationMinutesSnapshot,
      },
    })

    // Update / create AftercareSummary so it knows when you rebooked for
    await prisma.aftercareSummary.upsert({
      where: { bookingId: booking.id },
      update: { rebookedFor: scheduledDate },
      create: {
        bookingId: booking.id,
        rebookedFor: scheduledDate,
      },
    })

    return NextResponse.json(
      {
        ok: true,
        newBookingId: newBooking.id,
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('Rebook error', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
