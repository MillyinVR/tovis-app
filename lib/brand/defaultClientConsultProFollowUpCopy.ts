import type { BrandClientConsultProFollowUpCopy } from './types'

// C2-4 — the notifications around a question the professional asked herself.
//
// Doorbells, like the prep reminders (defaultClientConsultPrepCopy.ts): the
// question itself never travels in a notification. It is behind a login, it
// may be health-adjacent, and a lock screen is not a private surface. The
// wording is the September 9 product decision's own example, kept supportive
// — the pro is "getting ready", not "waiting"; nothing is at stake if the
// client is slow.
//
// `{pro}` is the professional's public display name, filled by the emitter.
export const defaultClientConsultProFollowUpCopy: BrandClientConsultProFollowUpCopy = {
  asked: {
    title: 'A quick question from {pro}',
    body: '{pro} is getting ready for your appointment and wants to learn a little more. One tap answers it.',
  },
  askedNeeded: {
    title: '{pro} has a quick question before your appointment',
    body: 'It helps {pro} plan your visit properly. One tap answers it, whenever you have a second.',
  },
  answered: {
    title: 'Your client answered',
    body: 'The answer to your question is on the consultation. Your Brief is up to date.',
  },
}
