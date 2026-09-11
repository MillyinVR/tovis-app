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
  management: {
    edit: 'Edit answers', done: 'Done editing', revoke: 'Privacy & stop this consult',
    revokeTitle: 'Stop this consult and withdraw your permission?',
    revokeBody: 'You won’t be able to add answers or photos, or create a plan, until you agree again. Temporary consult photos will be removed. Photos already saved in your appointment record will stay there.',
    revokeConfirm: 'Withdraw permission', keep: 'Keep consult',
  },
  chartPhotoUsed: 'Photo from your appointment record, dated {date}. You confirmed it still shows how you look now.',
  chartPhotoConfirm: 'Photo saved from {date}. Do you still look like this? Use this photo.',
  chartReviewUsed: 'You confirmed these details saved on {date}: {answer}',
  chartReviewQuestion: 'Anything done outside the app since your last visit on {date}?',
  chartReviewConfirm: 'No, these details are still right',
  chartReviewBoxDyeOnly: 'Only store-bought hair dye at home; the other details are still right',
  chartReviewChanged: 'Something has changed',
  chartReviewSummary: 'Please check these details saved from your last visit:',
  chartHistoryConfirmation: 'Your appointment record from {date} says “{answer}”. Still right? Tap that answer to confirm, or choose what fits now.',
  homeSessions: {
    title: 'Your look consultations', empty: 'Start with a look you love. Your unbooked consultations will be here.',
    resume: 'Continue consultation', delete: 'Delete consultation', confirmTitle: 'Delete this consultation?',
    confirmBody: 'Your answers and temporary consult photos will be deleted. You can start this look again. Photos already saved in your appointment record will stay there.',
    keep: 'Keep consultation', deleting: 'Deleting…', failed: 'We couldn’t finish deleting this consultation. Please try again.',
    loadFailed: 'We couldn’t load your consultations.', retry: 'Try again', more: 'Show more', proFallback: 'Your pro',
    stopped: 'This consultation can’t be continued. You can delete it here.',
  },
  openingWithService:
    'Love this one. Let’s work out what it would take on your {service} — a few taps, then you can book.',
  opening:
    'Love this one. Let’s work out what it would take on you — a few taps, then you can book.',

  consentIntro:
    'Quick bit first: two things to agree to before any photos. {pro} only ever sees what you send her.',
  consentResume:
    'You stopped this one earlier, so it’s been sitting right where you left it. Agree again and we pick up from there.',

  intakeIntro: 'A few quick things about you. Choose what fits. If you don’t know, use “Not sure” when it’s offered.',
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
  // Says what happens next rather than what is missing — she has not failed a
  // step here, she simply has not reached one. No jargon, no "locked".
  captureLockedBeforeBooking:
    'Photos come after you book — I’ll walk you through them then.',
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
  prepComplete:
    'You’ve answered the questions {pro} needs before your visit. She’ll go over them with you before starting.',
  prepDeadlineDue:
    'A few of these are the ones {pro} needs before she can safely start, so they’re due by {deadline}. They take about a minute.',

  estimateReady:
    'Your plan firmed up, so the price on your appointment has too. {pro} confirms the final number at your visit.',

  followUpIntro:
    'A couple of things I want to check with you, now that I’ve had a proper look. They’re quick, and they change what {pro} plans.',
  // 🔴 Honest, not apologetic. She is told the clever questions did not happen
  // AND that the ones below are the ones that actually matter — which is true,
  // because a fallback only ever asks the safety questions.
  followUpFallback:
    'I couldn’t think of the next question just now — so here are the essentials, the ones {pro} needs either way.',
  followUpDone:
    'That’s everything I need. {pro} has the rest — see you at your appointment.',

  // C2-4 — a question the PRO wrote. The card carries her name as its author;
  // these bubbles say why it is here. Supportive, never a summons: nothing is
  // cancelled if she does not answer, and the wording must not imply it.
  proFollowUpIntro:
    '{pro} has a quick question for you — she’s getting ready for your appointment and wants to learn a little more.',
  proFollowUpIntroNeeded:
    '{pro} has a quick question for you before your appointment — it helps her plan your visit properly. One tap is all it takes.',
  proFollowUpAttribution: 'From {pro}',
  proFollowUpDone: 'Perfect, {pro} has it. Your consultation is up to date.',

  chartCopyLabel:
    'Save these photos in my appointment record with {pro}, so we can come back to them — and so I can rework your plan if you change anything before your appointment. Untick this and they’re deleted as soon as your plan is built.',

  bookCtaLabel: 'Book the look',
  bookCtaSelfieRequired: 'Send one photo of yourself and this opens up.',
  bookCtaNotBookable:
    'This look isn’t bookable on its own — message your professional and she can set it up.',
  bookCtaPrepRequired: '{pro} asks clients to finish a few questions first.',
  bookCtaDepositFlat: '{amount} deposit',
  bookCtaDepositPercent: '{percent}% deposit',
  bookCtaPrepay: 'paid in full when you book',
  bookCtaNoteSeparator: ' · ',
  bookedDepositNote:
    'Your {amount} deposit is held and comes off the total. Cancel more than 24 hours ahead and it comes back.',

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
    'You withdrew your permission, so this consult stopped. You can start it again from the look any time.',

  proFallback: 'your professional',
}
