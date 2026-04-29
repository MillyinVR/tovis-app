// lib/brand/types.ts

export type BrandId = string // 'tovis' | 'salon-xyz' | 'school-abc' | ...

export type BrandMode = 'dark' | 'light'

export type RgbTriplet = `${number} ${number} ${number}`

export type BrandCalendarViewKey = 'day' | 'week' | 'month'

export type BrandCalendarStatusKey =
  | 'accepted'
  | 'pending'
  | 'completed'
  | 'waitlist'
  | 'blocked'
  | 'cancelled'

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
  editSchedule: string
  editHours: string
  hideHours: string
  autoAccept: string
  approveRequest: string
  denyRequest: string
  viewAllRequests: string
  messageClient: string
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
}

export type BrandProCalendarLegendCopy = {
  accepted: string
  pending: string
  completed: string
  waitlist: string
  blocked: string
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

export type BrandTokens = {
  colors: {
    // ── Background layers ─────────────────────────────────────────
    bgPrimary: RgbTriplet // darkest page bg → --bg-primary / --ink
    bgSecondary: RgbTriplet // elevated surface → --bg-secondary / --ink-2
    bgSurface: RgbTriplet // card / inner surface → --ink-3

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

    // ── Brand palette ────────────────────────────────────────────
    colorAcid: RgbTriplet // yellow-green CTAs / approvals → --acid
    colorFern: RgbTriplet // success / completed → --fern
    colorEmber: RgbTriplet // danger / cancelled / error → --ember
    colorAmber: RgbTriplet // pending / review / attention → --amber
  }

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
    // Keep it simple now: PNG path. Later swap to SVG path with same key.
    src: string
    alt: string
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

export type BrandConfig = {
  id: BrandId
  displayName: string // "TOVIS" — used anywhere the brand name appears in UI
  tagline?: string // "A New Age of Self Care"
  defaultMode: BrandMode
  tokensByMode: Record<BrandMode, BrandTokens>
  assets: BrandAssets
  contact: BrandContact
  proCalendar: BrandProCalendarCopy
}