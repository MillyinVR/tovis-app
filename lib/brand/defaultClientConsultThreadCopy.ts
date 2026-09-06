import type { BrandClientConsultThreadCopy } from './types'

// P5a — every system bubble the consult thread says, in one file.
//
// The voice is the APP's: warm, short, on the client's side. It never
// impersonates the professional — she is the person this is being prepared FOR,
// and a bubble that spoke as her would be a lie the moment she disagreed with
// it. `{pro}` and `{service}` are filled by lib/consult/threadCopy.ts.
//
// Tone rules (handoff Part 2): no jargon before its picture, never "as you can
// see", never a question that sounds like a test, and never a step that reads
// as the app protecting itself from the client.
export const defaultClientConsultThreadCopy: BrandClientConsultThreadCopy = {
  openingWithService:
    'Love this one. Let’s work out what it would take on your {service} — a few taps, then you can book.',
  opening:
    'Love this one. Let’s work out what it would take on you — a few taps, then you can book.',

  consentIntro:
    'Quick bit first: two things to agree to before any photos. {pro} only ever sees what you send her.',
  consentResume:
    'You stopped this one earlier, so it’s been sitting right where you left it. Agree again and we pick up from there.',

  intakeIntro: 'A few quick things about you. Tap what fits.',
  intakeDone: 'That’s everything I needed from you in words.',

  inspirationSourceIntro:
    'Want to show me a picture of the look you’re after? You can skip this and still carry on.',
  inspirationReading: 'Let me have a proper look at this…',
  inspirationReadRetryLabel: 'Have another go',
  inspirationIntro:
    'Now tell me what you like about it — tap what catches your eye.',
  inspirationDone: 'Got it. {pro} will see exactly what you picked out.',

  captureIntro:
    'Now a few of you, in daylight if you can. Each one gets checked straight away, and I’ll tell you why if one won’t work.',
  captureDone: 'All of them came through. That’s the hard part done.',
  capturePartial:
    'You can carry on with the ones that came through. Anything the missing shots would have shown just comes back as unknown — no guessing.',

  planAwaitingStart:
    'I’ve got everything I need. Want me to work out the plan? It takes a minute or two.',
  planRunning:
    'Working it out now. You can close this — I’ll keep going without you.',
  planReady:
    'Here’s where you’re starting from and what it would take. These are things to talk through with {pro}, not promises.',

  booked: 'You’re on {pro}’s calendar. Nice.',
  prepIntro:
    'Now let’s help {pro} get ready. Everything you add from here sharpens what she sees before you walk in — do it now, or come back to it later.',
  estimateReady:
    'Your plan firmed up, so the price on your appointment has too. {pro} confirms the final number at your visit.',

  chartCopyLabel:
    'Keep these photos on my chart with {pro}, so we can come back to them — and so I can rework your plan if you change anything before your appointment. Untick this and they’re deleted as soon as your plan is built.',

  bookCtaLabel: 'Book the look',
  bookCtaSelfieRequired: 'Send one photo of yourself and this opens up.',
  bookCtaNotBookable:
    'This look isn’t bookable on its own — message your professional and she can set it up.',

  // P7a-3 — the consult stays open until the appointment, so these are the
  // sentences of a document that is still alive.
  planUpdating:
    'You changed something, so I’m having another look. One minute.',
  planUpdated: 'Your plan moved. Here’s what changed:',
  planUnchanged:
    'I looked again with what you added — the plan still holds. Nothing to change.',
  planNeedsPhoto:
    'I’d love to look again, but your photos have expired. Send me one more and I’ll take another look.',
  planUpdateLimitReached:
    'That’s as far as I can take this one. Anything else you want changed, tell {pro} at your visit — she’ll have all of this in front of her.',
  appointmentStarted:
    'You’re in {pro}’s chair now, so this is closed. Everything you added is with her.',

  stopped: 'This consult was stopped. Nothing more can be added to it.',
  stoppedRevoked:
    'You revoked consent, so this stopped where it was. You can start it again from the look any time.',

  proFallback: 'your professional',
}
