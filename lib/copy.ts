// lib/copy.ts

/**
 * Centralized UI copy (strings) to avoid hardcoded text scattered across files.
 * Keep this file "dumb": plain strings + small helpers.
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
    emptyBody: 'After your appointments, your pro will post aftercare here.',
    serviceFallback: 'Aftercare',
    proFallback: 'Your pro',
    newPill: 'NEW',
    hintRecommendedWindow: 'Recommended booking window',
    hintRecommendedDate: 'Recommended rebook date',
    hintNotes: 'Aftercare notes',
    openCta: 'Open',
  },
} as const
