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
        completed: {
          title: 'Completed',
          body: 'All done. Leave a review if you haven’t already.',
        },
        cancelled: {
          title: 'Cancelled',
          body: 'This booking is cancelled. If you still want the service, book a new time.',
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
    title: 'Aftercare',
    subtitle: 'Every aftercare summary you’ve received, all in one place.',
    emptyTitle: 'Nothing yet',
    emptyBody: 'After your bookings, your pro will post aftercare here.',
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
} as const
