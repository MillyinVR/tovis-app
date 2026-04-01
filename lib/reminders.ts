import twilio, { type Twilio } from 'twilio'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { markBookingRemindersSent } from '@/lib/booking/writeBoundary'

type TwilioConfig = {
  accountSid: string
  authToken: string
  fromNumber: string
}

function getTwilioConfig(): TwilioConfig | null {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID ?? '').trim()
  const authToken = (process.env.TWILIO_AUTH_TOKEN ?? '').trim()
  const fromNumber = (
    process.env.TWILIO_FROM_NUMBER ??
    process.env.TWILIO_PHONE_NUMBER ??
    ''
  ).trim()

  if (!accountSid || !authToken || !fromNumber) {
    return null
  }

  // Twilio constructor validates SID format. In CI/test we do not want
  // fake placeholder values to crash app build at import/startup time.
  if (!accountSid.startsWith('AC')) {
    console.warn(
      '[reminders] Twilio disabled: TWILIO_ACCOUNT_SID is present but invalid for runtime use.',
    )
    return null
  }

  return {
    accountSid,
    authToken,
    fromNumber,
  }
}

function getTwilioClient(): { client: Twilio; fromNumber: string } | null {
  const config = getTwilioConfig()
  if (!config) return null

  return {
    client: twilio(config.accountSid, config.authToken),
    fromNumber: config.fromNumber,
  }
}

export async function sendSmsReminder(to: string, body: string) {
  const runtime = getTwilioClient()

  if (!runtime) {
    console.warn(
      '[reminders] Twilio not configured, would have sent SMS to',
      to,
      '->',
      body,
    )
    return
  }

  await runtime.client.messages.create({
    to,
    from: runtime.fromNumber,
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