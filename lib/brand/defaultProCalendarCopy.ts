// lib/brand/defaultProCalendarCopy.ts
import type { BrandConfig } from './types'

// Shared pro-calendar product copy. This is generic UI text (labels,
// actions, day names), not brand identity — every brand reuses it. The
// factory injects the brand wordmark into the hero title.
export function defaultProCalendarCopy(
  wordmark: string,
): BrandConfig['proCalendar'] {
  return {
  titles: {
    day: 'Your day.',
    week: 'This week.',
    month: 'This month.',
  },

  // The six booking states read exactly as they do everywhere else in the
  // product (lib/booking/statusLabel) — a brand may reword them, but the
  // default must not be a seventh spelling.
  statusLabels: {
    accepted: 'Confirmed',
    pending: 'Pending',
    inProgress: 'In progress',
    noShow: 'No-show',
    completed: 'Completed',
    waitlist: 'Waitlist',
    blocked: 'Blocked',
    cancelled: 'Cancelled',
    held: 'Held',
  },

  pageHero: {
    title: wordmark,
    accentMark: '.',
    suffix: ' / pro',
    dashboardHref: '/pro',
    dashboardLabel: '← Pro dashboard',
  },

  header: {
    controlsAriaLabel: 'Calendar navigation',
    viewTabsLabel: 'Calendar view',
    viewLabels: {
      day: 'Day',
      week: 'Week',
      month: 'Month',
    },
    viewAriaLabels: {
      day: 'Switch to day view',
      week: 'Switch to week view',
      month: 'Switch to month view',
    },
    previousRangeLabel: 'Previous calendar range',
    nextRangeLabel: 'Next calendar range',
  },

  mobileHeader: {
    backHref: '/',
    backLabel: 'CLIENT',
    backAriaLabel: 'Go to client view',
  },

  mobileChrome: {
    expandLabel: 'Show calendar summary',
    collapseLabel: 'Hide calendar summary',
  },

  tablet: {
    eyebrowPrefix: '◆ Pro mode',
    layoutNote:
      'Horizontal stats strip · No sidebar · Full-width calendar · Pending bar',
    pendingBarLabel: '◆ Pending request',
    locationToolbarLabel: 'Location',
  },

  desktop: {
    calendarHref: '/pro/calendar',
    mobileHref: '/pro/calendar',
    mobileLabel: '← Mobile layout',
    dashboardHref: '/pro',
    dashboardLabel: 'Dashboard →',
    sidebarTodayPrefix: 'Today',
    sidebarStatusKeyTitle: 'Status key',
    sidebarLocationTitle: 'Location',
    sidebarEditScheduleLabel: 'Edit schedule',
    pendingFooterLabel: '◆ Pending request',
    pendingFooterViewAllLabel: 'View all requests',
  },

  stats: {
    booked: 'Booked',
    pending: 'Pending',
    waitlist: 'Waitlist',
    free: 'Free',

    bookedSub: 'today',
    pendingSub: 'review',
    waitlistSub: 'people',
    freeSub: 'gaps',
    blockedSuffix: 'blocked',
  },

  actions: {
    today: 'Today',
    blockTime: '+ Block time',
    createBlock: 'Create blocked time',
    addAppointment: 'Add appointment',
    addAppointmentHint: 'Book a client into an open slot',
    blockPersonalTime: 'Block personal time',
    blockPersonalTimeHint: 'Hold time so clients can’t book',
    createMenu: 'Add to calendar',
    createMenuButton: '+ Add',
    editSchedule: 'Edit schedule',
    editHours: 'Edit hours',
    hideHours: 'Hide hours',
    autoAccept: 'Auto-accept',
    approveRequest: 'Approve request',
    denyRequest: 'Deny request',
    viewAllRequests: 'View all requests',
    messageClient: 'Message',
    editBooking: 'Edit booking',
    reschedule: 'Reschedule',
    checkIn: 'Check in',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    delete: 'Delete',
    confirm: 'Confirm',
  },

  labels: {
    mode: '◆ Pro mode',
    locationShort: 'Loc',
    statusKey: 'Status key',
    loadingCalendar: 'Loading calendar…',
    loadingRefresh: 'Loading…',
    total: 'Total',
    service: 'Service',
    services: 'Services',
    time: 'Time',
    status: 'Status',
    client: 'Client',
    clientNote: 'Client note',
    appointment: 'Booking',
    lastVisit: 'Last booking',
    lifetime: 'Lifetime',
    noShows: 'No-shows',
    timeZone: 'TZ',
    overlapWarning: 'Overlaps another appointment',
  },

  locationPanel: {
    eyebrow: '◆ Calendar location',
    // The default is now every location, so "select one" is no longer what the
    // pro is being asked to do — filtering is optional (K3).
    titleFallback: 'All locations',
    description:
      'Showing every location. Filter to one to see just that location’s day.',
    selectLabel: 'Location',
    selectAriaLabel: 'Filter calendar by location',
    selectFallback: 'Location',
    timeZoneLabel: 'TZ',
    emptyState:
      'No bookable locations yet. Add a location to use the calendar.',
    allLocationsLabel: 'All locations',
  },

  mobileAutoAccept: {
    title: 'Auto-accept',
    onLabel: 'On',
    offLabel: 'Off',
    savingLabel: 'Saving',
    subtitle: 'new bookings go live',
    ariaLabelOn: 'Auto-accept is on',
    ariaLabelOff: 'Auto-accept is off',
  },

  mobilePendingRequest: {
    label: '◆ Pending request',
    clientFallback: 'Client',
    appointmentFallback: 'Booking',
    moreSuffix: 'more',
    openAllLabel: 'Open all pending requests',
    openRequestsLabel: 'Open pending booking requests',
    approveLabel: 'Approve pending booking',
    denyLabel: 'Deny pending booking',
    dismissLabel: 'Hide pending requests bar',
  },

  // The legend is the key to the chips beside it, so it uses the chips' words —
  // it read "Accepted" while the chip it explains now reads "Confirmed" (B10).
  legend: {
    accepted: 'Confirmed',
    pending: 'Pending request',
    completed: 'Completed',
    waitlist: 'Waitlist hold',
    blocked: 'Blocked / break',
    // Anonymous on purpose — a hold means someone is mid-checkout right now,
    // and the pro is told the time is spoken for, not who is hesitating (B5).
    // Reworded from "Booking in progress": once IN_PROGRESS got a chip of its
    // own, that phrase named a *live session* on one row and a *hold* on this
    // one. "Checkout" keeps B5's anonymity and says which of the two it is.
    held: 'Checkout in progress',
    // The channel key (K7). "Confirmed"/"Pending request"/… below are what the
    // card FILL says; this line is what the fill IS. Decision D2 keeps status
    // on the fill and gives service the stripe, so these two never swap without
    // this copy swapping with them.
    fillChannel: 'Card colour · booking status',
    stripeChannel: 'Side stripe · service colour',
    glyphChannel: 'Corner glyph · client confirmation',
  },

  emptyState: {
    dayTitle: 'No bookings yet.',
    weekTitle: 'No bookings this week.',
    monthTitle: 'No bookings this month.',
    description:
      'Your calendar is ready. Add blocked time or wait for new bookings to come in.',
    createBlockLabel: 'Block time',
  },

  management: {
    title: 'Calendar management',
    pendingRequestsTitle: 'Pending requests',
    waitlistTitle: 'Waitlist',
    blocksTitle: 'Blocked time',
    emptyPendingRequests: 'No pending requests right now.',
    emptyWaitlist: 'No waitlist holds right now.',
    emptyBlocks: 'No blocked time in this range.',
    createBlockNowLabel: 'Create block now',
    blockFullDayTodayLabel: 'Block full day today',
  },

    workingHours: {
    overlay: {
      eyebrow: '◆ Edit schedule',
      title: 'Working hours.',
      description:
        'Set your base availability per location type. Individual bookings and blocked time will still override these hours.',
      dragHandleLabel: 'Edit schedule sheet handle',
    },

    locationTabsAriaLabel: 'Working-hours location type',

    locations: {
      salon: {
        label: 'Salon hours',
        shortLabel: 'Salon',
        eyebrow: '◆ Salon hours',
        description:
          'Fixed location availability. Applies to your salon, suite, or studio.',
      },
      mobile: {
        label: 'Mobile hours',
        shortLabel: 'Mobile',
        eyebrow: '◆ Mobile hours',
        description:
          'When you travel to the client. Set your availability for on-location work.',
      },
    },

    days: {
      monday: {
        shortLabel: 'Mon',
        fullLabel: 'Monday',
      },
      tuesday: {
        shortLabel: 'Tue',
        fullLabel: 'Tuesday',
      },
      wednesday: {
        shortLabel: 'Wed',
        fullLabel: 'Wednesday',
      },
      thursday: {
        shortLabel: 'Thu',
        fullLabel: 'Thursday',
      },
      friday: {
        shortLabel: 'Fri',
        fullLabel: 'Friday',
      },
      saturday: {
        shortLabel: 'Sat',
        fullLabel: 'Saturday',
      },
      sunday: {
        shortLabel: 'Sun',
        fullLabel: 'Sunday',
      },
    },

    table: {
      day: 'Day',
      on: 'On',
      start: 'Start',
      end: 'End',
    },

    baseScheduleLabel: 'Base schedule',
    baseScheduleDescription:
      'These hours control when clients can request bookings before booking-specific rules, blocks, and overrides are applied.',
    setHoursPerDayLabel: 'Set hours per day',
    daysOnLabel: 'Days on',

    onLabel: 'On',
    offLabel: 'Off',

    actions: {
      cancel: 'Cancel',
      close: 'Close',
      saveSchedule: 'Save schedule',
      saving: 'Saving…',
      saved: 'Saved',
    },

    status: {
      loadingSchedule: 'Loading schedule…',
      failedLoadHours: 'Could not load working hours.',
      failedSave: 'Could not save working hours. Try again.',
      validationEndAfterStart: 'End time must be after start time.',
    },

    stranded: {
      title: '{count} bookings now fall outside these hours',
      titleOne: '1 booking now falls outside these hours',
      description:
        'They are unchanged and still on your calendar — nothing was cancelled or moved.',
      more: '+{count} more',
      viewCalendar: 'View calendar',
      reschedule: 'Reschedule',
      message: 'Message',
    },
  },
  
  blockTimeModal: {
    title: 'Block time',
    description:
      'Hold time on your calendar so clients cannot book over it.',
    startLabel: 'Start',
    endLabel: 'End',
    locationLabel: 'Location',
    reasonLabel: 'Reason',
    reasonPlaceholder: 'Lunch, errands, prep time…',
    saveLabel: 'Create block',
    savingLabel: 'Creating…',
    successLabel: 'Blocked time created.',
    errorFallback: 'Could not create blocked time. Try again.',
  },

  editBlockModal: {
    title: 'Edit blocked time',
    description:
      'Update or remove this blocked window from your calendar.',
    startLabel: 'Start',
    endLabel: 'End',
    reasonLabel: 'Reason',
    reasonPlaceholder: 'Lunch, errands, prep time…',
    saveLabel: 'Save changes',
    savingLabel: 'Saving…',
    deleteLabel: 'Delete block',
    deletingLabel: 'Deleting…',
    errorFallback: 'Could not update blocked time. Try again.',
  },

  bookingModal: {
    title: 'Booking',
    clientFallback: 'Client',
    serviceFallback: 'Service',
    appointmentTimeLabel: 'Booking time',
    servicesLabel: 'Services',
    rescheduleDateLabel: 'New date',
    rescheduleTimeLabel: 'New time',
    notifyClientLabel: 'Notify client',
    allowOutsideHoursLabel: 'Allow outside working hours',
    saveChangesLabel: 'Save changes',
    savingLabel: 'Saving…',
    approveLabel: 'Approve request',
    denyLabel: 'Deny request',
    errorFallback: 'Could not load this booking. Try again.',
  },

  confirmChangeModal: {
    title: 'Confirm calendar change',
    description:
      'Review this change before it updates the booking.',
    outsideHoursTitle: 'Outside working hours',
    outsideHoursDescription:
      'This time is outside the current working-hours rules. Add a reason to override it.',
    overrideReasonLabel: 'Override reason',
    overrideReasonPlaceholder: 'Why is this booking allowed here?',
    cancelLabel: 'Cancel',
    confirmLabel: 'Confirm change',
    applyingLabel: 'Applying…',
  },
  }
}
