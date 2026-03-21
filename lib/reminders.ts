import twilio from 'twilio'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { markBookingRemindersSent } from '@/lib/booking/writeBoundary'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const fromNumber = process.env.TWILIO_FROM_NUMBER

const twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null

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
  timeZone: string
}) {
  const tz = sanitizeTimeZone(args.timeZone, 'UTC')

  const clientFirstName = (args.clientFirstName || '').trim() || 'there'
  const serviceName = (args.serviceName || '').trim() || 'appointment'
  const businessName = (args.businessName || '').trim() || 'your pro'

  const when = formatAppointmentWhen(args.scheduledFor, tz)

  return `Hi ${clientFirstName}! Reminder: ${serviceName} on ${when} with ${businessName}. Reply to confirm or message to reschedule.`
}

export async function markRemindersSent(bookingIds: string[]) {
  if (!bookingIds.length) return

  await markBookingRemindersSent({ bookingIds })
}