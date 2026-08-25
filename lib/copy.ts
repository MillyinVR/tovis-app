// lib/copy.ts

/**
 * Centralized UI copy (strings) to avoid hardcoded text scattered across files.
 * Keep this file "dumb": plain strings + small helpers.
 *
 * GLOSSARY — user-facing copy says "booking" (never "appointment" or "visit")
 * for the scheduled-service concept. Internal model/field/type names (e.g.
 * Booking, BOOKED_NEXT_APPOINTMENT, appointmentTimeZone) keep their existing
 * names; only what a user reads must use "booking". Keep native apps consistent.
 */

export const COPY = {
  common: {
    unknownTime: 'Unknown time',
    notProvided: 'Not provided',
    professionalFallback: 'Professional',
    emDash: '—',
    /** Dismisses a sheet. The labelled affordance iOS uses, never a bare ×. */
    done: 'Done',
  },

  /**
   * `/booking/[id]` — where "Complete booking" lands. The moment is deliberately
   * honest: a new booking is PENDING until the pro accepts, so this never says
   * "Confirmed". The pro's pronouns are unknown, so every sentence uses "they".
   *
   * ⚠️ Prices on this screen are STARTING prices (`salonPriceStartingAt` /
   * `service.minPrice` feed the snapshot, and a consultation can revise the
   * total), so they are always prefixed "From" — never quoted as settled.
   */
  bookingConfirmation: {
    eyebrow: 'Booking requested',
    title: 'Request sent',
    titleSettled: 'You’re booked',
    pendingPill: 'Pending confirmation',
    /** Composed as `${proName} ${hasYourRequest}`. */
    hasYourRequest: 'has your request — nothing’s charged until they confirm.',
    settledBody: 'This one’s on the books. Everything you need is below.',
    /**
     * Terminal / past states (COMPLETED, CANCELLED, NO_SHOW) get the neutral
     * header instead of the celebratory one — a green check over "You're booked"
     * on a booking that was cancelled is a lie the old receipt never told.
     */
    titleClosed: 'Booking details',
    closedBody: 'Everything about this booking is below.',
    whatHappensNext: 'What happens next',
    /** Composed as `${proName} ${stepReviews}`. */
    stepReviews: 'reviews within a few hours.',
    stepNotify: 'We’ll notify you the moment they confirm.',
    stepNoCharge: 'No charge until they confirm.',
    whenLabel: 'When',
    whereLabel: 'Where',
    addOnsLabel: 'Add-ons',
    /** Composed as `${priceFrom} ${amount}` — see the ⚠️ above. */
    priceFrom: 'From',
    viewBooking: 'View booking',
    message: 'Message',
    backToLooks: 'Back to Looks',
    breakdownHeading: 'Service breakdown',
  },

  bookings: {
    titleFallback: 'Booking',
    backToBookings: '← Back to bookings',
    withLabel: 'With',
    addToCalendar: 'Add to calendar',

    tabs: {
      overview: 'Overview',
      consultation: 'Consultation',
      aftercare: 'Aftercare',
    },

    badges: {
      actionRequired: 'Action required',
      new: 'NEW',
    },

    consultation: {
      header: 'Consultation',
      notesLabel: 'Notes',
      noNotes: 'No consultation notes provided.',
      proposedTotalLabel: 'Proposed total:',
      timesShownIn: 'Times shown in',
      approvalNeeded: 'Approval needed',
      noApprovalNeeded: 'No consultation approval needed right now.',
      actionNeededTitle: 'Action needed: approve consultation',
      actionNeededBody: 'Your pro updated services and pricing. Review it so they can proceed.',
      actionNeededCta: 'Review & approve',
    },

    aftercare: {
      header: 'Aftercare summary',
      noAftercareNotesCompleted: 'No aftercare notes provided.',
      noAftercareNotesPending: 'Aftercare will appear here once the service is completed.',
      rebookHeader: 'Rebook',
      noRebookRecommendation: 'No rebook recommendation yet.',
      rebookCtaViewDetails: 'View rebook details',
      rebookCtaNow: 'Rebook now',
      rebookLinkNotAvailable: 'Rebook link not available yet.',
      viewAllAftercare: 'View all aftercare',
      nextAppointmentHeader: 'Next booking',
      nextAppointmentProposedSubtitle: 'Your pro suggested this time for your next booking.',
      nextAppointmentConfirm: 'Confirm this time',
      nextAppointmentConfirming: 'Confirming…',
      nextAppointmentCancel: 'Cancel',
      nextAppointmentCancelling: 'Cancelling…',
      nextAppointmentScheduleDifferent: 'Schedule a different time',
      nextAppointmentConfirmedLabel: 'Next booking confirmed',
      nextAppointmentConfirmedCta: 'View booking',
      nextAppointmentDeclinedLabel: 'You declined this time',
      nextAppointmentUnavailable:
        'That time is no longer available. Try scheduling a different time.',
      nextAppointmentError: 'Something went wrong. Please try again.',

      // Media-use consent (B3b) — the client lets their pro feature this session's
      // before/after photos publicly. Toggling it only UNLOCKS the pro's publish
      // action; nothing is shared automatically.
      mediaConsentTitle: 'Photos & sharing',
      mediaConsentLabel: 'Let my pro feature my photos & video',
      mediaConsentDescription:
        'Lets your pro share this session’s before & after on their portfolio. You can turn this off anytime.',
      mediaConsentError: 'Couldn’t update that. Please try again.',

      // A coupled next booking (booked through aftercare) that can't be approved
      // until the pro confirms they received payment for this appointment.
      nextAppointmentPendingPayment: 'Pending confirmation',
      nextAppointmentPendingPaymentBody:
        'Your pro will confirm this booking once they’ve confirmed your payment.',
    },

    // Client checkout — the AWAITING_CONFIRMATION state after the client marks an
    // off-platform payment (cash / Venmo / Zelle / Apple Cash / PayPal) as sent.
    // Payment is authorized on the client's word; the booking closes out only once
    // the pro confirms they received it.
    checkout: {
      awaitingConfirmationTitle: 'Payment sent — waiting on your pro',
      awaitingConfirmationBody:
        'Once your pro confirms they received payment, your booking will close out. There’s nothing else you need to do.',
      // Shown instead of the line above when the pro also sent a rebook option
      // (a recommended window, or a coupled next appointment) — the banner must
      // never claim there's “nothing else to do” while a rebook is waiting (PF6).
      awaitingConfirmationBodyWithRebook:
        'Once your pro confirms they received payment, your booking will close out. In the meantime, your pro suggested a time to rebook — you can book your next appointment now.',

      // The platform-credit toggle. Composed as
      // `Use my $30.00 credit on this booking`.
      creditToggleLabel: 'Use my',
      creditToggleSuffix: 'credit on this booking',
      /**
       * 🔴 States the two things a client would otherwise have to discover the
       * hard way: the credit is theirs to spend whenever they like (it does not
       * expire into this booking), and it is the platform's money, not a
       * discount taken out of their pro's payment.
       */
      creditToggleHelp:
        'Your credit is applied to this appointment only, and your pro is still paid in full. Leave it off to save it for another time.',
      /** The summary line, when credit is coming off this bill. */
      creditAppliedLabel: 'Credit applied',
      /**
       * Shown when the client HAS credit but is not on the card method, so the
       * toggle is hidden. Composed as
       * `You have $30.00 credit — choose card to use it on this booking.`
       * Never shown for a pro who takes no card at all: that would be advice the
       * client cannot act on.
       */
      creditNeedsCardPrefix: 'You have',
      creditNeedsCardSuffix:
        'credit — choose card as your payment method to use it on this booking.',
    },

    status: {
      pillUnknown: 'UNKNOWN',

      messages: {
        pending: {
          title: 'Request sent',
          body: 'Your professional hasn’t approved this yet. You’ll see it move to Confirmed once accepted.',
        },
        accepted: {
          title: 'Confirmed',
          body: 'You’re booked.',
        },
        inProgress: {
          title: 'In progress',
          body: 'Your appointment is under way. Your pro will wrap up and send your aftercare here.',
        },
        completed: {
          title: 'Completed',
          body: 'All done. Leave a review if you haven’t already.',
        },
        cancelled: {
          title: 'Cancelled',
          body: 'This booking is cancelled. If you still want the service, book a new time.',
        },
        // TERMINAL — never word this as "we're still tracking it" (B10): the
        // appointment is over and nothing further will move on this booking.
        noShow: {
          title: 'Marked as a no-show',
          body: 'Your pro marked this appointment as missed. If that’s wrong, message them — otherwise book a new time when you’re ready.',
        },
        fallback: {
          title: 'Booking status',
          body: 'We’re tracking this booking. Status updates will show here.',
        },
      },
    },
  },

  consultationDecisionCard: {
    title: 'Approve this consultation?',
    proposedServices: 'Proposed services',
    noLineItems: 'No line items provided.',
    proposedTotal: 'Proposed total',
    notes: 'Notes',
    noNotes: 'No consultation notes provided.',
    approve: 'Approve',
    approving: 'Approving…',
    reject: 'Reject',
    rejecting: 'Rejecting…',
    approvedDone: 'Approved. Your pro can proceed.',
    rejectedDone: 'Rejected. Your pro will revise and resend.',
    rejectHelp: 'If you reject, the pro gets kicked back to consultation to revise.',
    serviceFallback: 'Service',
  },

  aftercareInbox: {
    // `title` is ALSO the section heading inside the client appointments list
    // (AppointmentsList.tsx), so it stays the short noun. The page header uses
    // pageEyebrow/pageTitle.
    title: 'Aftercare',
    pageEyebrow: 'Aftercare',
    pageTitle: 'Every summary in one place',
    subtitle: 'What your pro sent you after each visit.',
    emptyTitle: 'Nothing yet',
    emptyBody: 'After your bookings, your pro will post aftercare here.',
    emptyCta: 'Browse pros',
    serviceFallback: 'Aftercare',
    proFallback: 'Your pro',
    newPill: 'NEW',
    hintRecommendedWindow: 'Recommended booking window',
    hintRecommendedDate: 'Recommended rebook date',
    hintNotes: 'Aftercare notes',
    openCta: 'Open',
  },

  // Pro-side "all aftercare" list at /pro/aftercare. The list a pro lands on to
  // see every summary they've sent, saved, or closed out — recognized by its
  // before & after, with the rebook nudge surfaced. GLOSSARY: user-facing copy
  // says "booking", so the design's "Visit"/"Next visit" become "Booking"/
  // "Next booking" here.
  proAftercareList: {
    eyebrow: 'Studio · Aftercare',
    title: 'Aftercare',
    subtitle:
      'Summaries you’ve sent and saved for your bookings. Recognize each one by its before & after.',
    countSuffix: 'shown',

    summaryToSend: 'to send',
    summaryAwaiting: 'awaiting rebook',
    summaryOverdue: 'overdue',

    searchPlaceholder: 'Search client or service',
    searchLabel: 'Search aftercare',
    sortLabel: 'Sort',
    sortNeedsAction: 'Needs action',
    sortRecent: 'Recent',

    filterAll: 'All',
    filterDrafts: 'Drafts',
    filterSent: 'Sent',
    filterFinished: 'Finished',

    statusDraft: 'Draft',
    statusSent: 'Sent',
    statusFinished: 'Finished',

    bookingChipLabel: 'Booking',
    rebookRecommended: 'Rebook',
    rebookOverdue: 'Overdue',
    rebookNext: 'Next booking',

    actionSend: 'Send',
    actionNudge: 'Nudge',
    actionOpen: 'Open',

    agoSaved: 'Saved',
    agoSent: 'Sent',
    agoBooked: 'Booked',
    agoSuffix: 'ago',

    clientFallback: 'Client',
    serviceFallback: 'Service',

    emptyTitle: 'No aftercare summaries yet',
    emptyBody:
      'Drafts and sent summaries will appear here once you start using aftercare on bookings.',
    emptyFiltered: 'No aftercare matches your search or filter.',

    sendError: 'Couldn’t send that aftercare. Please try again.',
    nudgeError: 'Couldn’t send that nudge. Please try again.',
  },

  // Pro-side "Confirm payment received" action — closes out a booking whose
  // checkout is AWAITING_CONFIRMATION (client paid off-platform). Confirming
  /**
   * `/u/[handle]` — a client's public creator profile, as seen by a stranger.
   *
   * ⚠️ Prices on the look cards are STARTING prices, composed by the loader as
   * `${bookingConfirmation.priceFrom} ${amount}` — never a bare figure.
   *
   * ⚠️ `spotlightBadge` is deliberately NOT "Viral", which is what the design
   * frame calls it. The flag behind it is `LookPost.featuredAt` — a SUPER_ADMIN
   * promoting a look editorially. Labelling an editor's pick "Viral" would claim
   * an engagement event that never happened.
   */
  publicProfile: {
    tabLooks: 'LOOKS',
    tabBoards: 'BOARDS',
    followersLabel: 'Followers',
    followingLabel: 'Following',
    looksLabel: 'Looks',
    follow: 'Follow',
    following: 'Following',
    /** Composed as `${topPercentPrefix} N${topPercentSuffix}` → "top 5% saver". */
    topPercentPrefix: 'top',
    topPercentSuffix: '% saver',
    tierTastemaker: 'Tastemaker',
    tierRising: 'Rising',
    spotlightBadge: 'Spotlight',
    /**
     * The pro's own chosen highlight post on their public profile
     * (`ProfessionalProfile.signatureMediaAssetId`).
     *
     * 🔴 It must never be called "Spotlight" — that is `spotlightBadge` above,
     * an editorial pick by a SUPER_ADMIN, and the whole point of that word here
     * is that the PLATFORM chose you. Nor "Featured": four other things in this
     * schema already answer to it. The design frame's mock labels this block
     * "Spotlight service"; the shipped label is Signature.
     */
    signatureLabel: 'Signature',
    signatureBookCta: 'Book this look',
    /** Composed as `${count} ${recreatedSuffix}` → "12 recreated this". */
    recreatedSuffix: 'recreated this',
    /**
     * Composed as `${count} ${boardLooks(count)}` → "12 LOOKS" / "1 LOOK" on a
     * board card. Two forms because a board can genuinely hold one look, and
     * "1 LOOKS" is the kind of detail that makes a whole screen look unfinished.
     */
    boardLooksOne: 'look',
    boardLooksMany: 'looks',
    savesLabel: 'saves',
    recreateCta: 'Recreate this look',
    emptyLooks: 'No public looks yet.',
    emptyBoards: 'No shared boards yet.',

    /**
     * The pro profile's book bar — the slim row between the end of the scroll
     * and the footer. It does not float and does not follow the scroll.
     *
     * ⚠️ There is deliberately NO "free to hold · cancel up to 24h before"
     * footnote here, which is what the design mock shows. Cancellation windows
     * are per-pro in this product, so a flat 24h claim on every profile would be
     * wrong on some of them.
     */
    bookBarHeadlineFallback: 'Book with this pro',
    bookBarHeadlinePending: 'Not bookable yet',
    bookBarSublinePending: 'Your verification needs attention before clients can book',
    bookBarSublineNoPrice: 'See services and availability',
    bookBarCta: 'Book',
    bookBarCtaPending: 'Unavailable',
    /** Composed as `${bookBarCta} · From $85`. */
    bookBarCtaPriceJoin: ' · From ',
    /**
     * Only the OWNER of a REFUSED profile sees the pending book bar now — an
     * unreviewed pro is bookable like anyone else (lib/proTrustState.ts) — so
     * this no longer promises a review that is already finished.
     */
    bookBarFootnotePending: 'Open Verification to see what we need',
    bookBarFootnoteSignedOut: 'You can pick a time before signing in',
    /** Composed as `Balayage from $250 · 5 services`. */
    bookBarSublineFrom: 'from',
    bookBarServicesOne: 'service',
    bookBarServicesMany: 'services',
  },

  /** The client's OWN boards screen. */
  clientActivity: {
    eyebrow: 'Activity',
    /**
     * 🔴 NOT "Who engaged with you". The feed's allowlist includes
     * `LOOK_NEW_FROM_FOLLOWED_PRO` — "A pro you follow posted a new look" —
     * which is a discovery nudge with no actor on the other end of it, so the
     * old heading made a claim one of its own rows contradicts. This wording is
     * true of every row the allowlist can produce.
     */
    title: 'What’s happening',
    emptyTitle: 'No activity yet',
    emptyBody:
      'When someone follows you or engages with your looks, it’ll show up here.',
    emptyCta: 'Browse looks',

    // ── the trending banner ──
    /** Composed as `Your {look name} is trending`. */
    trendHeadlinePrefix: 'Your',
    trendHeadlineSuffix: 'is trending',
    /** Composed as `+84 saves this week · top 3% in Brooklyn`. */
    trendSaves: 'saves',
    trendSaveOne: 'save',
    trendThisWeek: 'this week',
    trendInCity: 'in',
    /** A look whose caption carries no name still has to be addressable. */
    trendFallbackLookName: 'look',
    trendCta: 'View',

    // ── the credit banner ──
    /** Composed as `You earned $7.50 credit`. */
    creditHeadlinePrefix: 'You earned',
    creditHeadlineSuffix: 'credit',
    /** Composed as `@jade booked your Lived-in blonde`. */
    creditBookedYour: 'booked your',
    /** Used when the look behind the credit has since been removed. */
    creditBookedOneOfYourLooks: 'booked one of your looks',
    /** A booker who is not publicly addressable is never named. */
    creditSomeone: 'Someone',
    /** Composed as `$30.00 banked total`. */
    creditBankedSuffix: 'banked total',
    creditCta: 'Use',
  },

  /** The client's OWN dashboard, `/client/me`. */
  clientMe: {
    /** Section heading over the creator metrics + level. */
    influenceEyebrow: 'Your influence',
    savesStatLabel: 'Saves on your looks',
    bookedStatLabel: 'Booked from you',
    /** Composed as `Lvl 3`. */
    levelPrefix: 'Lvl',
    /**
     * Composed as `125 saves to Lvl 4` / `5 bookings to Lvl 3`.
     *
     * The unit names WHICH ladder is being climbed, because level is the higher
     * of two (`lib/clients/creatorLevel.ts`) and "125 to Lvl 4" alone would not
     * say 125 of what.
     */
    levelProgressJoin: 'to',
    levelUnitSaves: 'saves',
    levelUnitSavesOne: 'save',
    levelUnitBookings: 'bookings',
    levelUnitBookingsOne: 'booking',
    /** Shown instead of the progress line once the top rung is reached. */
    levelMaxed: 'Top level reached',
    // NOTE: the header's Share control reuses `app/professionals/[id]/ShareButton`
    // (native share → clipboard → prompt, brand-aware title) rather than
    // carrying its own copy — house rule: no duplicate logic.
  },

  /**
   * The client's own authored looks, as they appear folded onto the history
   * cards on `/client/me` (screen 7 dropped the separate "Your looks" grid).
   */
  clientLooks: {
    /** Accessible name for the per-look visibility switch. */
    visibilityToggleLabel: 'Look visibility',
    visibilityPublic: 'Public',
    visibilityPrivate: 'Private',
    makePublicHint: 'Anyone can find this look on your profile.',
    makePrivateHint: 'Only you can see this look.',
    visibilityError: 'Could not change that look’s visibility. Try again.',
    /** Shown on a completed visit that has no look posted from it yet. */
    shareCta: 'Share your look',
  },

  boards: {
    /**
     * Marks a board anyone with the link can open. Owner surfaces only — on the
     * public profile every listed board is shared by definition, so the badge
     * would be true of every row.
     */
    sharedBadge: 'SHARED',
    visibilityShared: 'Shared',
    visibilityPrivate: 'Private',
    /** Accessible name for the per-board visibility switch. */
    visibilityToggleLabel: 'Board visibility',
    makeSharedHint: 'Anyone with the link can open this board.',
    makePrivateHint: 'Only you can see this board.',
    visibilityError: 'Could not change that board’s visibility. Try again.',
  },

  // also auto-approves any aftercare next booking coupled to this payment.
  proBookingCheckout: {
    awaitingConfirmationTitle: 'Confirm payment received',
    awaitingConfirmationBody:
      'The client marked this payment as sent. Confirm once you’ve received it to close out the booking.',
    confirmCta: 'Confirm payment received',
    confirmCtaPending: 'Confirming…',
    confirmError:
      'Could not confirm payment. Check your connection and try again.',
    approvesNextNote:
      'This also approves the next booking the client requested.',

    // Card shown on a coupled next booking's detail page (the destination of the
    // PAYMENT_CONFIRMATION_REQUIRED notification): it stays pending until the pro
    // confirms payment for the previous appointment.
    coupledPendingTitle: 'Waiting on payment confirmation',
    coupledPendingBody:
      'This booking stays pending until you confirm you received payment for the previous appointment. Confirming that payment approves this booking automatically.',
  },
} as const
