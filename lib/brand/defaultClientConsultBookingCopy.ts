import type { BrandClientConsultBookingCopy } from './types'

/**
 * Book the Look, B4b — the client's booking door on a look-anchored consult
 * (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 3, 4 and 5).
 *
 * ⚠️ The load-bearing sentences are NOT here. The price label, the estimate
 * framing, the "your pro makes the final call" line and the what-happens-when-
 * you-tap sentence are all composed by the SERVER and arrive on
 * `ConsultBookingProposalDTO` — the last of them routed through the same
 * `getClientSubmittedBookingStatus` fork the commit runs, so the page cannot
 * promise something the booking then does not do. Everything below is chrome
 * around them.
 *
 * A LOOK never names the service that produced it (B1), so nothing here labels
 * a service either. The proposal's own line names come from the pro's menu and
 * are her half of the answer — they are rendered as the shape of the
 * appointment, never as a taxonomy the client is choosing from.
 */
export const defaultClientConsultBookingCopy: BrandClientConsultBookingCopy = {
  // Names the DESTINATION only — ClientPage renders the ← glyph itself.
  backToResults: 'Your consult',
  eyebrow: 'Book this look',
  title: 'Your appointment, from your consultation',
  intro:
    'Choose how you want to be seen, then pick a time. The length below is what your professional will actually need for this look.',

  modeTitle: 'How do you want to be seen?',
  modeBody: 'Prices and length differ between the two, so pick before you choose a time.',
  modeSalonLabel: 'At the salon',
  modeMobileLabel: 'They come to you',
  // 🔴 Reason-AGNOSTIC on purpose. The typed refusal that comes back can be any
  // of nine things — a mode the pro doesn't offer, an unset price, an unfinished
  // scheduling setup — and a hint that names one of them is wrong the other
  // eight times. (Seen live: the fixture pro offers no mobile, yet the refusal
  // was PRO_SCHEDULING_NOT_READY, because the location context is resolved
  // first.) The hint says there is an answer; selecting the mode gives it.
  modeUnavailableLabel: 'Tap to see why',

  proposalTitle: 'What you’d be booking',
  proposalBody:
    'Put together from your photos and this professional’s own service list.',
  durationLabel: 'Time set aside',
  chooseTimeCta: 'Choose a time',
  chooseModeFirst: 'Pick salon or mobile to see times.',

  // Every refusal is a rendered, explained state — never a dead end and never a
  // silent disabled button. Each one says what happened and what happens next.
  refusalTitle: 'This look isn’t bookable here yet',
  refusalMessages: {
    ESTIMATE_MISSING:
      'We couldn’t put an appointment together from this consultation. Message your professional and she can book it for you.',
    ESTIMATE_REFUSED:
      'This professional’s service list can’t express this look yet. Message her and she can put it together for you.',
    SAFETY_REVIEW_REQUIRED:
      'Your analysis calls for a patch or strand test before this service. That has to happen with your professional first, so this one isn’t bookable on your own — she already has your consultation and can take it from here.',
    OFFERING_OFF_MENU:
      'Part of this look is no longer on your professional’s service list. Message her and she can book it for you.',
    MODE_NOT_OFFERED:
      'Your professional doesn’t offer this look in that way. Try the other option.',
    MODE_PRICE_UNSET:
      'Your professional hasn’t set a price for this look in that way yet. Try the other option, or message her.',
    MODE_DURATION_UNSET:
      'Your professional hasn’t set a length for this look in that way yet. Try the other option, or message her.',
    PRO_SCHEDULING_NOT_READY:
      'Your professional’s booking setup isn’t finished, so times can’t be offered yet. Message her and she can book it for you.',
    SLOT_TOO_LONG:
      'This look needs more time in one sitting than a single booking can hold. Your professional will split it across visits — message her to set it up.',
  },
  refusalMessageUnknown:
    'This look isn’t bookable on your own right now. Message your professional and she can book it for you.',
  messageProCta: 'Message your professional',

  // The confirm step and the confirmation both re-state what a commit did.
  // Book the Look's second half of decision 4: request mode ALREADY owns the
  // slot, so it is described as held rather than as a queue.
  reviewEyebrow: 'From your consultation',
  reviewTitle: 'Your look',

  // The booking sheet's title for an unnamed look on THIS path. Never the
  // service name: a LOOK never names the service that produced it (B1), and
  // this is the one screen whose entire point is that she is booking an
  // outcome rather than picking off a menu.
  sheetUnnamedLookTitle: 'Book this look',
}
