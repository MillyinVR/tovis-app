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

// CTIA guidance (and the "Reply STOP" promise already made at signup, above)
// expects opt-out instructions to appear IN a recurring program's messages,
// not only in a web disclosure — but repeating it on every send burns segment
// budget for no compliance benefit once a recipient has already seen it once.
// Appended only to the first SMS a destination phone ever receives from the
// notification engine (lib/notifications/delivery/processDueDeliveries.ts
// decides "first"); every later send omits it. Brand-name-free and short on
// purpose — the SMS body it's appended to already opens with "${brandName}:".
export function buildSmsOptOutDisclosureSuffix(): string {
  return 'Reply STOP to opt out, HELP for help.'
}

// Auto-replies sent from the inbound Twilio webhook
// (app/api/webhooks/twilio/route.ts) when a recipient texts a STOP/START/HELP
// keyword. Twilio's own default opt-out handling may intercept these keywords
// before they ever reach the webhook (Console > Messaging > opt-out settings)
// — when it does, Twilio sends its own default reply and this code path never
// runs; these exist for when it doesn't (or is turned off).
export function buildSmsStopConfirmationReply(brandName: string): string {
  return `${brandName}: You're unsubscribed and won't receive further SMS. Reply START to resubscribe.`
}

export function buildSmsStartConfirmationReply(brandName: string): string {
  return `${brandName}: You're resubscribed to SMS. Reply STOP to opt out anytime.`
}

export function buildSmsHelpReply(args: {
  brandName: string
  supportEmail: string
}): string {
  return `${args.brandName}: For help, email ${args.supportEmail}. Msg & data rates may apply. Reply STOP to opt out.`
}
