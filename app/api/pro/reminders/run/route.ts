// app/api/pro/reminders/run/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { sendSmsReminder, formatReminderMessage, markRemindersSent } from '@/lib/reminders'

export async function POST() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db: any = prisma

  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const dayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)

  // bookings for *this pro* happening tomorrow, not already reminded
  const bookings = await db.booking.findMany({
    where: {
      professionalId: user.professionalProfile.id,
      status: { in: ['PENDING', 'ACCEPTED'] },
      scheduledFor: {
        gte: tomorrow,
        lt: dayAfter,
      },
      reminderSentAt: null,
    },
    include: {
      client: {
        include: {
          user: true,
        },
      },
      service: true,
    },
  })

  const sentIds: string[] = []
  const skipped: { id: string; reason: string }[] = []

  for (const b of bookings) {
    const phone = b.client.phone?.trim()

    if (!phone) {
      skipped.push({ id: b.id, reason: 'no phone' })
      continue
    }

    const message = formatReminderMessage({
      clientFirstName: b.client.firstName,
      serviceName: b.service.name,
      scheduledFor: new Date(b.scheduledFor),
      businessName: user.professionalProfile.businessName,
    })

    try {
      await sendSmsReminder(phone, message)
      sentIds.push(b.id)
    } catch (err) {
      console.error('[reminders] Failed for booking', b.id, err)
      skipped.push({ id: b.id, reason: 'twilio_error' })
    }
  }

  if (sentIds.length) {
    await markRemindersSent(sentIds)
  }

  return NextResponse.json({
    processed: bookings.length,
    sent: sentIds.length,
    skipped,
  })
}
