// app/api/pro/bookings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { computeLastMinuteDiscount } from '@/lib/lastMinutePricing'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))

    const { clientId, offeringId, scheduledFor } = body as {
      clientId?: string
      offeringId?: string
      scheduledFor?: string
    }

    if (!clientId || !offeringId || !scheduledFor) {
      return NextResponse.json(
        { error: 'Client, offering, and scheduled time are required.' },
        { status: 400 },
      )
    }

    const scheduledDate = new Date(scheduledFor)
    if (Number.isNaN(scheduledDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date/time.' }, { status: 400 })
    }

    // Optional sanity check: don't create bookings in the past
    if (scheduledDate.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: 'Scheduled time must be in the future.' }, { status: 400 })
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      include: { service: true },
    })

    if (!offering) {
      return NextResponse.json({ error: 'Service offering not found.' }, { status: 404 })
    }

    if (offering.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'You can only book your own services.' }, { status: 403 })
    }

    const client = await prisma.clientProfile.findUnique({
      where: { id: clientId },
    })

    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    // Prisma Decimal -> number for discount math
    const basePriceNum = offering.price.toNumber()

    const discount = await computeLastMinuteDiscount({
      professionalId: offering.professionalId,
      serviceId: offering.serviceId,
      scheduledFor: scheduledDate,
      basePrice: basePriceNum,
    })

    const totalNum =
      discount.discountedPrice != null && Number.isFinite(discount.discountedPrice)
        ? discount.discountedPrice
        : basePriceNum

    const discountNum =
      discount.discountAmount != null && Number.isFinite(discount.discountAmount)
        ? discount.discountAmount
        : 0

    const booking = await prisma.booking.create({
      data: {
        clientId: client.id,
        professionalId: offering.professionalId,
        serviceId: offering.serviceId,
        offeringId: offering.id,
        scheduledFor: scheduledDate,

        // Snapshots
        priceSnapshot: offering.price,
        durationMinutesSnapshot: offering.durationMinutes,

        // Last-minute pricing results
        discountAmount: discountNum > 0 ? new Prisma.Decimal(discountNum) : null,
        totalAmount: new Prisma.Decimal(totalNum),
      },
      select: {
        id: true,
        status: true,
      },
    })

    return NextResponse.json({ id: booking.id, status: booking.status }, { status: 201 })
  } catch (error) {
    console.error('Create booking error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
