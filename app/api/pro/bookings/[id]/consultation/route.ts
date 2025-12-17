import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params
    const user = await getCurrentUser()

    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const db: any = prisma
    const body = await request.json().catch(() => ({} as any))

    const notesRaw = typeof body.notes === 'string' ? body.notes.trim() : ''
    const priceRaw = body.price as string | number | null

    let priceCents: number | null = null
    if (priceRaw !== null && priceRaw !== undefined && priceRaw !== '') {
      const dollars =
        typeof priceRaw === 'number'
          ? priceRaw
          : parseFloat(String(priceRaw).replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(dollars) || dollars < 0) {
        return NextResponse.json(
          { error: 'Invalid consultation price.' },
          { status: 400 },
        )
      }
      priceCents = Math.round(dollars * 100)
    }

    const booking = await db.booking.findUnique({
      where: { id },
      include: { professional: true },
    })

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    }

    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json(
        { error: 'You can only edit your own bookings.' },
        { status: 403 },
      )
    }

    const updated = await db.booking.update({
      where: { id: booking.id },
      data: {
        consultationNotes: notesRaw || null,
        consultationPriceCents: priceCents,
        consultationConfirmedAt: new Date(),
      },
    })

    return NextResponse.json(
      {
        id: updated.id,
        consultationNotes: updated.consultationNotes,
        consultationPriceCents: updated.consultationPriceCents,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('Consultation save error', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
