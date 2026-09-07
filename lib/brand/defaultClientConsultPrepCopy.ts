import type { BrandClientConsultPrepCopy } from './types'

// P7a-4 — what the escalating prep reminders actually say.
//
// Four stages, one voice. The escalation is in the WORDS, not in the volume:
// each one is shorter and more concrete than the last, and none of them
// threatens the client with her own appointment. Nothing is cancelled if she
// does not answer — the pro is told instead, and reaches out. That is the
// "looked-after moment, not a gate" the Sept 5 flow asks for, and copy that
// implied otherwise would be the app lying to protect itself.
//
// `{pro}` is the professional; `{deadline}` is the deadline already formatted
// in the client's own zone by the caller. Neither is ever left as a bare slot
// — every sentence here reads correctly with both filled, and the emitter
// picks a slot-free variant when a value is missing.
//
// 🔴 No sentence names a specific question. The notification is a doorbell:
// the answers are health-adjacent, they live behind a login, and "we still
// need to know about your box dye" is a sentence that should not arrive on a
// lock screen someone else can read.
export const defaultClientConsultPrepCopy: BrandClientConsultPrepCopy = {
  booked: {
    title: 'You’re booked — one small thing left',
    body: 'There are a few quick questions {pro} needs answered before your appointment. They’re due by {deadline}, and they take about a minute.',
  },
  ahead: {
    title: 'A minute for {pro}?',
    body: 'Those last few questions are due by {deadline}. Answering them is what lets {pro} plan properly before you arrive.',
  },
  soon: {
    title: 'Due tomorrow',
    body: '{pro} still needs a couple of answers from you by {deadline}. It really is about a minute.',
  },
  due: {
    title: 'Last call on those questions',
    body: 'Today’s the day they were due. Your appointment is still on — answer when you can, and {pro} will pick up anything that’s missing with you.',
  },
}
