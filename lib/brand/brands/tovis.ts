// lib/brand/brands/tovis.ts
import type { BrandConfig } from '../types'

// Inter Tight loaded via next/font into --font-body
const fontSans =
  'var(--font-body), "Inter Tight", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

// Fraunces loaded via next/font into --font-display-face
const fontDisplay =
  'var(--font-display-face), "Fraunces", Georgia, "Times New Roman", serif'

// JetBrains Mono loaded via next/font into --font-mono-face
const fontMono =
  'var(--font-mono-face), "JetBrains Mono", ui-monospace, "Cascadia Code", "Fira Code", monospace'

const proCalendar: BrandConfig['proCalendar'] = {
  titles: {
    day: 'Your day.',
    week: 'This week.',
    month: 'This month.',
  },

  statusLabels: {
    accepted: 'Accepted',
    pending: 'Pending',
    completed: 'Completed',
    waitlist: 'Waitlist',
    blocked: 'Blocked',
    cancelled: 'Cancelled',
  },

  pageHero: {
    title: 'tovis',
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
    editSchedule: 'Edit schedule',
    editHours: 'Edit hours',
    hideHours: 'Hide hours',
    autoAccept: 'Auto-accept',
    approveRequest: 'Approve request',
    denyRequest: 'Deny request',
    viewAllRequests: 'View all requests',
    messageClient: 'Message',
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
    appointment: 'Appointment',
    lastVisit: 'Last visit',
    lifetime: 'Lifetime',
    noShows: 'No-shows',
    timeZone: 'TZ',
  },

  locationPanel: {
    eyebrow: '◆ Calendar location',
    titleFallback: 'Select location.',
    description:
      'Booking creation and blocked-time actions use this selected location.',
    selectLabel: 'Location',
    selectAriaLabel: 'Select calendar location',
    selectFallback: 'Select location',
    timeZoneLabel: 'TZ',
    emptyState:
      'No bookable locations yet. Add a location to use the calendar.',
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
    appointmentFallback: 'Appointment',
    moreSuffix: 'more',
    openAllLabel: 'Open all pending requests',
    openRequestsLabel: 'Open pending booking requests',
    approveLabel: 'Approve pending booking',
    denyLabel: 'Deny pending booking',
  },

  legend: {
    accepted: 'Accepted',
    pending: 'Pending request',
    completed: 'Completed',
    waitlist: 'Waitlist hold',
    blocked: 'Blocked / break',
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
      'These hours control when clients can request appointments before booking-specific rules, blocks, and overrides are applied.',
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
    title: 'Appointment',
    clientFallback: 'Client',
    serviceFallback: 'Service',
    appointmentTimeLabel: 'Appointment time',
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
      'Review this change before it updates the appointment.',
    outsideHoursTitle: 'Outside working hours',
    outsideHoursDescription:
      'This time is outside the current working-hours rules. Add a reason to override it.',
    overrideReasonLabel: 'Override reason',
    overrideReasonPlaceholder: 'Why is this appointment allowed here?',
    cancelLabel: 'Cancel',
    confirmLabel: 'Confirm change',
    applyingLabel: 'Applying…',
  },
}

export const tovisBrand: BrandConfig = {
  id: 'tovis',
  displayName: 'TOVIS',
  tagline: 'A New Age of Self Care',
  defaultMode: 'dark',

  assets: {
    mark: {
      src: '/brand/tovis/mark.png',
      alt: 'TOVIS mark',
    },
    wordmark: {
      text: 'TOVIS',
    },
  },

  contact: {
    businessName: 'Tovis Technology',
    supportEmail: 'Support@tovis.app',
    location: 'Encinitas, CA',
  },

  proCalendar,

  tokensByMode: {
    dark: {
      colors: {
        bgPrimary: '10 9 7',
        bgSecondary: '20 17 14',
        bgSurface: '30 26 21',

        textPrimary: '244 239 231',
        textSecondary: '205 198 187',
        textMuted: '122 117 105',

        surfaceGlass: '244 239 231',

        accentPrimary: '224 90 40',
        accentPrimaryHover: '255 106 54',
        microAccent: '232 221 212',

        colorAcid: '212 255 58',
        colorFern: '98 168 122',
        colorEmber: '255 61 78',
        colorAmber: '240 168 48',
      },

      effects: {
        glassBlurPx: 20,
        glassOpacity: 0.09,
        shadowColor: '10 9 7',

        radiusAppIconPx: 28,
        radiusCardPx: 14,
        radiusPanelPx: 18,
        radiusSheetPx: 24,
        radiusInnerPx: 8,
        radiusPillPx: 999,
      },

      typography: {
        fontSans,
        fontDisplay,
        fontMono,
        letterSpacingCaps: '0.08em',
        letterSpacingTight: '-0.03em',
      },

      layout: {
        pageMaxWidthPx: 960,
        mobileShellWidthPx: 430,
      },
    },

    light: {
      colors: {
        bgPrimary: '244 239 231',
        bgSecondary: '255 255 255',
        bgSurface: '250 247 244',

        textPrimary: '10 9 7',
        textSecondary: '122 117 105',
        textMuted: '154 148 140',

        surfaceGlass: '10 9 7',

        accentPrimary: '224 90 40',
        accentPrimaryHover: '255 106 54',
        microAccent: '154 123 92',

        colorAcid: '180 200 0',
        colorFern: '68 130 90',
        colorEmber: '210 40 55',
        colorAmber: '240 168 48',
      },

      effects: {
        glassBlurPx: 18,
        glassOpacity: 0.07,
        shadowColor: '30 22 18',

        radiusAppIconPx: 28,
        radiusCardPx: 14,
        radiusPanelPx: 18,
        radiusSheetPx: 24,
        radiusInnerPx: 8,
        radiusPillPx: 999,
      },

      typography: {
        fontSans,
        fontDisplay,
        fontMono,
        letterSpacingCaps: '0.08em',
        letterSpacingTight: '-0.03em',
      },

      layout: {
        pageMaxWidthPx: 960,
        mobileShellWidthPx: 430,
      },
    },
  },
}