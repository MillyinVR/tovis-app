// lib/brand/types.ts

export type BrandId = string // 'tovis' | 'salon-xyz' | 'school-abc' | ...

export type BrandMode = 'dark' | 'light'

export type RgbTriplet = `${number} ${number} ${number}`

export type BrandCalendarViewKey = 'day' | 'week' | 'month'

export type BrandCalendarStatusKey =
  | 'accepted'
  | 'pending'
  // A session the pro has already started, and a client who never turned up.
  // Both reach the calendar feed (it filters only CANCELLED), and without a key
  // of their own both fell through to `accepted` — so the pro's calendar called
  // a live session and a no-show "Accepted" (B10).
  | 'inProgress'
  | 'noShow'
  | 'completed'
  | 'waitlist'
  | 'blocked'
  | 'cancelled'
  // A client's live checkout reservation on the pro's calendar (B5).
  | 'held'

export type BrandCalendarViewLabels = Record<BrandCalendarViewKey, string>

export type BrandCalendarStatusLabels =
  Record<BrandCalendarStatusKey, string>

export type BrandProCalendarPageHeroCopy = {
  title: string
  accentMark: string
  suffix: string
  dashboardHref: string
  dashboardLabel: string
}

export type BrandProCalendarHeaderCopy = {
  controlsAriaLabel: string
  viewTabsLabel: string
  viewLabels: BrandCalendarViewLabels
  viewAriaLabels: BrandCalendarViewLabels
  previousRangeLabel: string
  nextRangeLabel: string
}

export type BrandProCalendarMobileHeaderCopy = {
  backHref: string
  backLabel: string
  backAriaLabel: string
}

export type BrandProCalendarMobileChromeCopy = {
  /** Accessible label for the chevron when the summary chrome is collapsed. */
  expandLabel: string
  /** Accessible label for the chevron when the summary chrome is expanded. */
  collapseLabel: string
}

export type BrandProCalendarTabletCopy = {
  eyebrowPrefix: string
  layoutNote: string
  pendingBarLabel: string
  locationToolbarLabel: string
}

export type BrandProCalendarDesktopCopy = {
  calendarHref: string
  mobileHref: string
  mobileLabel: string
  dashboardHref: string
  dashboardLabel: string
  sidebarTodayPrefix: string
  sidebarStatusKeyTitle: string
  sidebarLocationTitle: string
  sidebarEditScheduleLabel: string
  pendingFooterLabel: string
  pendingFooterViewAllLabel: string
}

export type BrandProCalendarStatsCopy = {
  booked: string
  pending: string
  waitlist: string
  free: string

  bookedSub: string
  pendingSub: string
  waitlistSub: string
  freeSub: string
  blockedSuffix: string
}

export type BrandProCalendarActionsCopy = {
  today: string
  blockTime: string
  createBlock: string
  addAppointment: string
  addAppointmentHint: string
  blockPersonalTime: string
  blockPersonalTimeHint: string
  createMenu: string
  createMenuButton: string
  editSchedule: string
  editHours: string
  hideHours: string
  autoAccept: string
  approveRequest: string
  denyRequest: string
  viewAllRequests: string
  messageClient: string
  /** Opens the full booking editor — time, services and notification. */
  editBooking: string
  /** Time-only affordances (the grid's drag/resize handles). */
  reschedule: string
  checkIn: string
  save: string
  cancel: string
  close: string
  delete: string
  confirm: string
}

export type BrandProCalendarLabelsCopy = {
  mode: string
  locationShort: string
  statusKey: string
  loadingCalendar: string
  loadingRefresh: string
  total: string
  service: string
  services: string
  time: string
  status: string
  client: string
  clientNote: string
  appointment: string
  lastVisit: string
  lifetime: string
  noShows: string
  timeZone: string
  /** Passive double-book signal: tile a11y hint + reschedule-confirm note. */
  overlapWarning: string
}

export type BrandProCalendarLocationPanelCopy = {
  eyebrow: string
  titleFallback: string
  description: string
  selectLabel: string
  selectAriaLabel: string
  selectFallback: string
  timeZoneLabel: string
  emptyState: string
  /**
   * The unfiltered option, and the calendar's default: every location's
   * occupancy on one grid, which is what the booking overlap constraint
   * actually enforces (K3).
   */
  allLocationsLabel: string
}

export type BrandProCalendarAutoAcceptCopy = {
  title: string
  onLabel: string
  offLabel: string
  savingLabel: string
  subtitle: string
  ariaLabelOn: string
  ariaLabelOff: string
}

export type BrandProCalendarPendingRequestCopy = {
  label: string
  clientFallback: string
  appointmentFallback: string
  moreSuffix: string
  openAllLabel: string
  openRequestsLabel: string
  approveLabel: string
  denyLabel: string
  dismissLabel: string
}

export type BrandProCalendarLegendCopy = {
  accepted: string
  pending: string
  completed: string
  waitlist: string
  blocked: string
  held: string

  /**
   * Names what the card's FILL currently means (K7). Three things want colour
   * on one card, so the key has to say which channel is which — a legend that
   * only lists tones leaves the pro guessing what the stripe is for.
   */
  fillChannel: string
  /**
   * Names what the 4px accent stripe means. Shown only while the grid actually
   * carries service colours: until a pro picks one (K8) the stripe still shows
   * the status tone, and a key claiming otherwise would be a lie.
   */
  stripeChannel: string
  /**
   * Names what the corner glyph means (K11 client confirmation). Same rule as
   * the stripe: shown only while an event on the grid actually carries a
   * confirmation state — until K12 ships the writers, none does.
   */
  glyphChannel: string
}

export type BrandProCalendarEmptyStateCopy = {
  dayTitle: string
  weekTitle: string
  monthTitle: string
  description: string
  createBlockLabel: string
}

export type BrandProCalendarManagementCopy = {
  title: string
  pendingRequestsTitle: string
  waitlistTitle: string
  blocksTitle: string
  emptyPendingRequests: string
  emptyWaitlist: string
  emptyBlocks: string
  createBlockNowLabel: string
  blockFullDayTodayLabel: string
}

export type BrandProCalendarBlockTimeModalCopy = {
  title: string
  description: string
  startLabel: string
  endLabel: string
  locationLabel: string
  reasonLabel: string
  reasonPlaceholder: string
  saveLabel: string
  savingLabel: string
  successLabel: string
  errorFallback: string
}

export type BrandProCalendarEditBlockModalCopy = {
  title: string
  description: string
  startLabel: string
  endLabel: string
  reasonLabel: string
  reasonPlaceholder: string
  saveLabel: string
  savingLabel: string
  deleteLabel: string
  deletingLabel: string
  errorFallback: string
}

export type BrandProCalendarBookingModalCopy = {
  title: string
  clientFallback: string
  serviceFallback: string
  appointmentTimeLabel: string
  servicesLabel: string
  rescheduleDateLabel: string
  rescheduleTimeLabel: string
  notifyClientLabel: string
  allowOutsideHoursLabel: string
  saveChangesLabel: string
  savingLabel: string
  approveLabel: string
  denyLabel: string
  errorFallback: string
}

export type BrandProCalendarConfirmChangeModalCopy = {
  title: string
  description: string
  outsideHoursTitle: string
  outsideHoursDescription: string
  overrideReasonLabel: string
  overrideReasonPlaceholder: string
  cancelLabel: string
  confirmLabel: string
  applyingLabel: string
}

export type BrandWorkingHoursLocationKey = 'salon' | 'mobile'

export type BrandWorkingHoursDayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export type BrandWorkingHoursLocationCopy = {
  label: string
  shortLabel: string
  eyebrow: string
  description: string
}

export type BrandWorkingHoursDayLabelCopy = {
  shortLabel: string
  fullLabel: string
}

export type BrandWorkingHoursOverlayCopy = {
  eyebrow: string
  title: string
  description: string
  dragHandleLabel: string
}

export type BrandWorkingHoursTableCopy = {
  day: string
  on: string
  start: string
  end: string
}

export type BrandWorkingHoursActionsCopy = {
  cancel: string
  close: string
  saveSchedule: string
  saving: string
  saved: string
}

export type BrandWorkingHoursStatusCopy = {
  loadingSchedule: string
  failedLoadHours: string
  failedSave: string
  validationEndAfterStart: string
}

/**
 * The heads-up shown after a save that narrows the week over bookings that
 * already exist there (B8). The save always succeeds — this only tells the pro
 * what is now outside their published hours, and nothing is cancelled or moved.
 */
export type BrandWorkingHoursStrandedCopy = {
  /** `{count}` is substituted; `titleOne` is the singular form. */
  title: string
  titleOne: string
  description: string
  /** Shown when more are stranded than the list renders; `{count}` substituted. */
  more: string
  viewCalendar: string
  /** Per-row actions: open that booking for rescheduling, or message the client. */
  reschedule: string
  message: string
}

export type BrandWorkingHoursCopy = {
  /**
   * Brand-owned working-hours / edit-schedule copy.
   *
   * Keep wording here so the same real scheduling logic can render as
   * desktop modal, tablet sheet, or mobile sheet without hardcoded UI text.
   */
  overlay: BrandWorkingHoursOverlayCopy

  locationTabsAriaLabel: string
  locations: Record<BrandWorkingHoursLocationKey, BrandWorkingHoursLocationCopy>

  days: Record<BrandWorkingHoursDayKey, BrandWorkingHoursDayLabelCopy>
  table: BrandWorkingHoursTableCopy

  baseScheduleLabel: string
  baseScheduleDescription: string
  setHoursPerDayLabel: string
  daysOnLabel: string

  onLabel: string
  offLabel: string

  actions: BrandWorkingHoursActionsCopy
  status: BrandWorkingHoursStatusCopy
  stranded: BrandWorkingHoursStrandedCopy
}

export type BrandProCalendarCopy = {
  /**
   * Brand-owned pro calendar UI copy.
   *
   * Keep product/brand language here instead of hard-coding it inside
   * calendar components or storing it on a professional profile.
   */
  titles: BrandCalendarViewLabels
  statusLabels: BrandCalendarStatusLabels

  pageHero: BrandProCalendarPageHeroCopy
  header: BrandProCalendarHeaderCopy
  mobileHeader: BrandProCalendarMobileHeaderCopy
  mobileChrome: BrandProCalendarMobileChromeCopy
  tablet: BrandProCalendarTabletCopy
  desktop: BrandProCalendarDesktopCopy

  stats: BrandProCalendarStatsCopy
  actions: BrandProCalendarActionsCopy
  labels: BrandProCalendarLabelsCopy
  locationPanel: BrandProCalendarLocationPanelCopy
  mobileAutoAccept: BrandProCalendarAutoAcceptCopy
  mobilePendingRequest: BrandProCalendarPendingRequestCopy
  legend: BrandProCalendarLegendCopy
  emptyState: BrandProCalendarEmptyStateCopy

  management: BrandProCalendarManagementCopy
  workingHours: BrandWorkingHoursCopy
  blockTimeModal: BrandProCalendarBlockTimeModalCopy
  editBlockModal: BrandProCalendarEditBlockModalCopy
  bookingModal: BrandProCalendarBookingModalCopy
  confirmChangeModal: BrandProCalendarConfirmChangeModalCopy
}

/**
 * The twelve calendar swatch ids (K7). A pro picks one of these per service
 * offering (K8); the calendar paints it on the event card's accent stripe.
 *
 * 🔴 A FIXED set, deliberately — never a free hex picker. A raw colour skips
 * `[data-mode]` (a hue that reads on paper vanishes on ink), skips the contrast
 * budget, and is not caught by any static guard. Twelve tokens with a tuned
 * light/dark pair each is the only version that survives white-label.
 *
 * 🔴 A DEDICATED palette, not the brand hues — every one of those is
 * semantically loaded (`colorAmber` *is* `--tone-pending`, `colorEmber` *is*
 * `--tone-danger`, `colorFern` *is* `--tone-success`), so a service coloured
 * amber would read as "pending".
 */
export type CalendarSwatchId =
  | '01'
  | '02'
  | '03'
  | '04'
  | '05'
  | '06'
  | '07'
  | '08'
  | '09'
  | '10'
  | '11'
  | '12'

/** The per-mode swatch palette → `--swatch-01` … `--swatch-12`. */
export type BrandCalendarSwatches = Record<CalendarSwatchId, RgbTriplet>

export type BrandTokens = {
  colors: {
    // ── Background layers ─────────────────────────────────────────
    bgPrimary: RgbTriplet // darkest page bg → --bg-primary / --ink
    bgSecondary: RgbTriplet // elevated surface → --bg-secondary / --ink-2
    bgSurface: RgbTriplet // card / inner surface → --ink-3

    /**
     * The modal backdrop. A scrim's whole job is to sit BEHIND a panel and read
     * as darker (dark mode) or lighter (light mode) than the page it covers, so
     * it cannot be `bgPrimary`: `--overlay` is exactly `--bg-primary`, and over
     * the page ground a translucent fill of the ground colour composites back to
     * the ground colour at EVERY alpha. #922 moved 13 backdrops onto
     * `bg-overlay/N` to fix light mode and, as a side effect, flattened the dark
     * scrim from `rgb(3,6,6)` to `rgb(10,20,19)` — the page's own ink.
     *
     * Raising the alpha cannot undo that; only a separate colour can. Hence this
     * token: black in dark, the paper canvas in light. A white-label brand may
     * tint it, but it must stay clear of `bgPrimary` in dark or the backdrop
     * goes flat again.
     */
    scrim: RgbTriplet // modal backdrop, used with opacity → --scrim

    // ── Text layers ───────────────────────────────────────────────
    textPrimary: RgbTriplet // primary readable text → --text-primary / --paper
    textSecondary: RgbTriplet // dimmed text → --text-secondary / --paper-dim
    textMuted: RgbTriplet // very muted / placeholder → --text-muted / --paper-mute

    // ── Glass surface ─────────────────────────────────────────────
    surfaceGlass: RgbTriplet // used with opacity in CSS → --surface-glass

    // ── Accent ───────────────────────────────────────────────────
    accentPrimary: RgbTriplet // brand signature → --accent-primary / --terra
    accentPrimaryHover: RgbTriplet // hover/glow state → --terra-glow
    microAccent: RgbTriplet // warm highlight → --micro-accent
    onAccent: RgbTriplet // readable text/icon ON TOP of accentPrimary → --on-accent

    // ── Brand palette ────────────────────────────────────────────
    colorAcid: RgbTriplet // yellow-green CTAs / approvals → --acid
    colorFern: RgbTriplet // success / completed → --fern
    colorEmber: RgbTriplet // danger / cancelled / error → --ember
    colorAmber: RgbTriplet // pending / review / attention → --amber
  }

  /**
   * Per-service calendar colours → `--swatch-01` … `--swatch-12` (K7).
   * Filled by createBrandConfig from DEFAULT_CALENDAR_SWATCHES unless a brand
   * overrides it, so a white-label tenant gets a working palette for free and
   * can still repaint one.
   */
  calendarSwatches: BrandCalendarSwatches

  effects: {
    // ── Glass ─────────────────────────────────────────────────────
    glassBlurPx: number // 16–24 recommended
    glassOpacity: number // 0.06–0.12 recommended

    // ── Shadows ───────────────────────────────────────────────────
    shadowColor: RgbTriplet

    // ── Radii ─────────────────────────────────────────────────────
    radiusAppIconPx: number
    radiusCardPx: number
    radiusPanelPx: number
    radiusSheetPx: number
    radiusInnerPx: number
    radiusPillPx: number
  }

  typography: {
    fontSans: string // UI / body text → --font-sans
    fontDisplay: string // editorial headlines → --font-display
    fontMono: string // data, labels, caps → --font-mono
    letterSpacingCaps: string // caps labels → --ls-caps
    letterSpacingTight: string // editorial/display tightening → --ls-tight
  }

  layout: {
    pageMaxWidthPx: number // app content max width → --page-max-width
    mobileShellWidthPx: number // mobile shell / profile width → --mobile-shell-width
  }
}

export type BrandAssets = {
  mark: {
    /** Public path to the logo file, used by <Image>/<img> in the DOM. */
    src: string
    alt: string
    /**
     * Raw SVG markup of the mark, for contexts that can't reference a file —
     * favicon/apple-icon/OG ImageResponse routes embed this. Optional; those
     * routes fall back to The Eye when a brand omits it.
     */
    svg?: string
  }

  wordmark: {
    text: string // until you have an SVG wordmark
  }
}

export type BrandContact = {
  businessName: string // "Tovis Technology"
  supportEmail: string // "Support@tovis.app"
  location?: string // "Encinitas, CA"
}

export type BrandClientConsultResultsCopy = {
  backToBooking: string
  eyebrow: string
  title: string
  intro: string
  clientWordsTitle: string
  aiObservationsTitle: string
  aiObservationsBody: string
  currentLevelLabel: string
  toneLabel: string
  conditionLabel: string
  densityLabel: string
  textureLabel: string
  unknownLabel: string
  levelPrefix: string
  confidenceSuffix: string
  safetyTitle: string
  safetyEmpty: string
  safetyItemSuffix: string
  achievabilityTitle: string
  achievabilityLabels: Record<
    | 'LIKELY_SINGLE_APPOINTMENT'
    | 'LIKELY_MULTI_APPOINTMENT'
    | 'REQUIRES_PRO_ASSESSMENT'
    | 'UNKNOWN',
    string
  >
  recommendationsTitle: string
  recommendationDiscussionPrefix: string
  meCardEyebrow: string
  meCardTitle: string
  meCardBody: string
  meCardTapLabel: string
  meCardTappedLabel: string
  meCardSendingLabel: string
  meCardError: string
}

export type BrandConfig = {
  id: BrandId
  displayName: string // "TOVIS" — used anywhere the brand name appears in UI
  tagline?: string // "A New Age of Self Care"
  defaultMode: BrandMode
  tokensByMode: Record<BrandMode, BrandTokens>
  assets: BrandAssets
  contact: BrandContact
  proCalendar: BrandProCalendarCopy
  clientConsultResults: BrandClientConsultResultsCopy
}
