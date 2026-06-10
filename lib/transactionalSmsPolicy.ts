export const TRANSACTIONAL_SMS_POLICY_VERSION = '2026-04-17'

export const TRANSACTIONAL_SMS_USE_CASES = [
  'Account verification codes',
  'Appointment confirmations',
  'Appointment reminders',
  'Reschedules',
  'Cancellations',
] as const

// Brand name is interpolated so white-label tenants render their own brand
// (WS-6); for the root tenant the output is byte-identical to the copy the
// current TRANSACTIONAL_SMS_POLICY_VERSION was approved against.

export function buildTransactionalSmsCheckboxLabel(brandName: string): string {
  return `I agree to receive transactional SMS/text messages from ${brandName} for account verification and appointment updates, including appointment confirmations, reminders, reschedules, and cancellations. ${brandName} does not send marketing or promotional SMS. Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help.`
}

export function buildTransactionalSmsSummary(brandName: string): string {
  return `${brandName} sends transactional SMS only for account verification and appointment updates. Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help. No marketing or promotional SMS.`
}

export function buildTransactionalSmsPageCopy(brandName: string): string {
  return `${brandName} uses SMS only for transactional messages related to your account and appointments. Messages may include account verification codes, appointment confirmations, appointment reminders, reschedules, and cancellations. Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help. ${brandName} does not send marketing or promotional SMS.`
}
