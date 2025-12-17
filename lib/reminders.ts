// lib/reminders.ts
import twilio from 'twilio'
import { prisma } from './prisma'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const fromNumber = process.env.TWILIO_FROM_NUMBER

const twilioClient = accountSid && authToken
  ? twilio(accountSid, authToken)
  : null

export async function sendSmsReminder(to: string, body: string) {
  if (!twilioClient || !fromNumber) {
    console.warn('[reminders] Twilio not configured, would have sent SMS to', to, '->', body)
    return
  }

  await twilioClient.messages.create({
    to,
    from: fromNumber,
    body,
  })
}

export function formatReminderMessage(args: {
  clientFirstName: string
  serviceName: string
  scheduledFor: Date
  businessName?: string | null
}) {
  const { clientFirstName, serviceName, scheduledFor, businessName } = args

  const when = scheduledFor.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const biz = businessName || 'your appointment'

  return `Hi ${clientFirstName}, this is a reminder for your ${serviceName} at ${when} with ${biz}. Reply to confirm or contact us to reschedule.`
}

// tiny helper: mark bookings as reminded
export async function markRemindersSent(bookingIds: string[]) {
  if (!bookingIds.length) return

  await prisma.booking.updateMany({
    where: { id: { in: bookingIds } },
    data: { reminderSentAt: new Date() },
  })
}
