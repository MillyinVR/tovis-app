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
  /**
   * Trails the live mm:ss on a HOLD tile — "07:42 left". A fragment rather than
   * a whole sentence because the number is the message and the tile is narrow;
   * the countdown itself is formatted by `lib/booking/holdCountdown` so the pro
   * and the client read the same clock.
   */
  holdTimeLeft: string
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
  /** Book the Look: a consult started from a look goes back to the look. */
  backToLook: string
  eyebrow: string
  title: string
  intro: string
  clientWordsTitle: string
  aiObservationsTitle: string
  aiObservationsBody: string
  /**
   * Schema v4 reports the two named ends of the head, so the screen names
   * them too. v3's single "Current level range" tile rendered a min/max pair
   * as "Levels 5–7", which reads as base-to-lightest — a claim the model was
   * never asked to make (lib/consult/hairLevel.ts).
   */
  baseLevelLabel: string
  lightestLevelLabel: string
  toneLabel: string
  conditionLabel: string
  densityLabel: string
  textureLabel: string
  unknownLabel: string
  /** Prefixes ONE level, e.g. "Level 7". */
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
  // Full-analysis feature profile + per-domain style directions (schema v2).
  profileTitle: string
  profileBody: string
  profileLabels: Record<
    | 'skinUndertone'
    | 'contrastLevel'
    | 'colorSeason'
    | 'faceProportion'
    | 'jawline'
    | 'foreheadProportion'
    | 'featureBalance'
    | 'eyeShape'
    | 'eyeSpacing'
    | 'browDensity'
    | 'browShape',
    string
  >
  styleDirectionsTitle: string
  styleDirectionsBody: string
  styleDomainLabels: Record<
    | 'HAIR_COLOR_HARMONY'
    | 'CUT_AND_SHAPE'
    | 'BANGS'
    | 'BROWS'
    | 'LASHES'
    | 'MAKEUP'
    | 'COLOR_PALETTE',
    string
  >
  whyItFlattersLabel: string
  recommendationsTitle: string
  /**
   * The heading when the analysis produced exactly ONE recommendation. A lone
   * result is valid (Tori, 2026-09-04) and should read as the pro's considered
   * answer, not as a list that came up short.
   */
  singleRecommendationTitle: string
  recommendationDiscussionPrefix: string
  /**
   * Book the Look, B4b — the CTA that turns a finished look-anchored consult
   * into a booking. Rendered only when the consult is anchored to a LOOK; a
   * booking-anchored consult (#1016) already has its booking.
   */
  bookLookTitle: string
  bookLookBody: string
  bookLookCta: string
  meCardEyebrow: string
  meCardTitle: string
  meCardBody: string
  meCardTapLabel: string
  meCardTappedLabel: string
  meCardSendingLabel: string
  meCardError: string
}

/**
 * Book the Look, B4b — chrome for the client's booking door on a look-anchored
 * consult. See lib/brand/defaultClientConsultBookingCopy.ts: the price label,
 * the estimate framing and the commit sentence are NOT here — the server
 * composes those onto ConsultBookingProposalDTO so the page cannot promise
 * something the booking will not do.
 */
/**
 * The client consult's capture step. The photo count and which views a pack
 * asks for are SERVED (`capture.shotPack`), so this copy carries slots, not
 * numbers: three packs exist today (hair 7, face 3, area 3) and a fourth must
 * not need a copy change. `lib/consult/captureCopy.ts` fills the slots.
 */
export type BrandClientConsultCaptureCopy = {
  eyebrow: string
  title: string
  /** `{count}` → the pack's slot count in words ("seven"). */
  introCountLine: string
  /** `{hair}`/`{face}` → counts in words; used when the pack has hair views. */
  introHairAndFaceViews: string
  /** `{face}` → count in words; used when the pack is face views only. */
  introFaceViews: string
  /** Used when the pack shows a treatment area (with or without a face view). */
  introAreaViews: string
  /** `{count}` → the pack's slot count in words. */
  introPartialAllowed: string
}

/**
 * P5a — the consult THREAD's system bubbles ("the consult is a chat").
 *
 * Every sentence the app says in its OWN voice lives here, so the wording can
 * be edited without touching code. Warm, short, no jargon before its picture,
 * never a question that sounds like a test — and never impersonating the pro:
 * the pro is the RECIPIENT of the Brief, not a character in the thread.
 *
 * `{pro}` is the professional's public display name; `{service}` the service in
 * the client's own language. A slot is filled by lib/consult/threadCopy.ts,
 * never by a caller assembling the sentence itself.
 */
export type BrandClientConsultThreadCopy = {
  /** The first bubble, when the service is known / when it is not. */
  openingWithService: string
  opening: string

  /** Consent, in the thread. `{pro}` is the professional. */
  consentIntro: string
  /** Shown instead when the client previously revoked and is resuming. */
  consentResume: string

  /** Before the first intake question. */
  intakeIntro: string
  /** After the last intake question is answered. */
  intakeDone: string

  /** The inspiration card's own framing, before a reference exists. */
  inspirationSourceIntro: string
  /**
   * P5b — while the vision model is reading the reference she just gave.
   * A few seconds, and it happens before she is asked anything about the
   * picture, so it says what is happening rather than asking her to wait.
   */
  inspirationReading: string
  /** The button on a read that failed. The REASON comes from the server. */
  inspirationReadRetryLabel: string
  /** Once a reference is on screen. */
  inspirationIntro: string
  /** When the client has answered enough to move on. */
  inspirationDone: string

  /** Before the photo requests. */
  captureIntro: string
  /** When every requested photo is accepted. */
  captureDone: string
  /** When some were skipped but the client can still continue. */
  capturePartial: string

  /** The plan card, before the run is started. */
  planAwaitingStart: string
  /** While the background run is going. */
  planRunning: string
  /** Once a result exists. */
  planReady: string

  /** The booking confirmation. `{pro}` is the professional. */
  booked: string
  /** The bubble that turns the rest of the thread into prep. `{pro}`. */
  prepIntro: string
  /**
   * Posted once the analysis has produced an estimate for an already-booked
   * consult — the moment the provisional price firms up. `{pro}`.
   */
  estimateReady: string

  /** The sticky CTA's label, and the hints under it while it is not live. */
  bookCtaLabel: string
  bookCtaSelfieRequired: string
  bookCtaNotBookable: string

  /** A consult that was stopped server-side, and one the client revoked. */
  stopped: string
  stoppedRevoked: string

  /**
   * What `{pro}` becomes when the professional has no usable name token at all.
   * The display-name SSOT's own fallback is "Professional", which is correct and
   * cold; the thread's voice needs its own.
   */
  proFallback: string
}

export type BrandClientConsultBookingCopy = {
  backToResults: string
  eyebrow: string
  title: string
  intro: string

  modeTitle: string
  modeBody: string
  modeSalonLabel: string
  modeMobileLabel: string
  modeUnavailableLabel: string

  proposalTitle: string
  proposalBody: string
  durationLabel: string
  chooseTimeCta: string
  chooseModeFirst: string

  refusalTitle: string
  /** One explained state per typed refusal — never a dead end. */
  refusalMessages: Record<
    | 'ESTIMATE_MISSING'
    | 'ESTIMATE_REFUSED'
    | 'SAFETY_REVIEW_REQUIRED'
    | 'OFFERING_OFF_MENU'
    | 'MODE_NOT_OFFERED'
    | 'MODE_PRICE_UNSET'
    | 'MODE_DURATION_UNSET'
    | 'PRO_SCHEDULING_NOT_READY'
    | 'SLOT_TOO_LONG',
    string
  >
  /** Used when a future server adds a refusal code this build doesn't know. */
  refusalMessageUnknown: string
  messageProCta: string

  reviewEyebrow: string
  reviewTitle: string

  /**
   * Book the Look, B7 — the enhancement offer on the review step
   * (docs/product/BOOK-THE-LOOK-DIRECTION.md, decision 10).
   *
   * ⚠️ Chrome only, again. The reason a client is shown for each enhancement is
   * the ANALYSIS's own sentence and arrives on
   * `ConsultBookingProposalRecommendationDTO.outcome`; so do its "+$40" and
   * "+20 min". Nothing here may name a service — that is decision 1, and the
   * wire deliberately carries no service name to name.
   *
   * `enhancementsBody` is load-bearing rather than decorative: it is where the
   * screen says out loud that nothing is added unless she adds it.
   */
  enhancementsTitle: string
  enhancementsBody: string
  enhancementAddLabel: string
  enhancementAddedLabel: string
  enhancementsPendingLabel: string

  /**
   * The booking sheet's title when the look being booked has no name of its own
   * (Tori, 2026-08-31, riding B5).
   *
   * The sheet's fallback chain is `look name → this → "Book an appointment"`,
   * and it applies ONLY on the consult path. The named-service door keeps the
   * service name it has always fallen back to — that is a client who picked a
   * service and should see it. On the consult path there is no service the
   * client chose, and naming one is the exact taxonomy leak B1 removed from
   * every other look surface.
   */
  sheetUnnamedLookTitle: string
}

/**
 * P5d — every word an inspiration CARD says, keyed by what it is about.
 *
 * A card is a crop of the client's reference plus a plain-language name for
 * what is in the crop plus a question. None of those three are stored: the
 * payload holds question keys and option enums only (P5c), so the sentence a
 * card shows is resolved HERE at read time, from the pack's key and the
 * reading's enum. Editing a line changes every consult at once, including the
 * ones already answered.
 *
 * 🔴 Keyed by ATTRIBUTE AND VALUE, never by service family. `tone:COOL` reads
 * the same whichever pack asked it, and the reason a light-blonde reference
 * never produces a copper card is that no card exists for a value the model
 * did not read — not that a family's list happens to omit one.
 *
 * A pack question whose entries are missing here fails
 * `assertConsultInspirationCardCopy` in the registry's own test, so a card
 * with no words is a red build rather than a blank card on a client's screen.
 */
export type BrandClientConsultInspirationCardCopy = {
  /** Question key → the question, as the client is asked it. */
  prompts: Readonly<Record<string, string>>
  /** `${questionKey}:${optionValue}` → the option's label. */
  optionLabels: Readonly<Record<string, string>>
  /**
   * `${analysisAttribute}:${value}` → the plain-language name shown AFTER the
   * crop, never before it. "This is the cooler, silvery cast in the blonde —
   * some people call it ash": the picture first, the word second, and the word
   * is offered rather than assumed.
   */
  attributeNames: Readonly<Record<string, string>>
  /**
   * `${analysisAttribute}` → the clause the understanding check uses for
   * something the photograph could not settle ("aren’t sure how bright yet").
   * Part 0 rule 8: the consult says what it could not see.
   */
  unsureClauses: Readonly<Record<string, string>>
  /**
   * `${optionValue}` of the spark card → its clause in the understanding
   * check, with no reading to lean on ("like the color in it").
   */
  sparkClauses: Readonly<Record<string, string>>
  /**
   * The same clauses with a `{subject}` slot, used when the reading CAN name
   * what she pointed at — "like the light blonde" rather than "like the color
   * in it". The subject comes from `attributeShortNames`.
   */
  sparkClausesWithSubject: Readonly<Record<string, string>>
  /**
   * `${analysisAttribute}:${value}` → the same thing as a NOUN PHRASE, for
   * dropping into a sentence. `attributeNames` is a whole sentence shown under
   * a crop; this is the two or three words that fit inside another one.
   */
  attributeShortNames: Readonly<Record<string, string>>
  /** `${optionValue}` of the keep card → its clause ("want to keep your length"). */
  keepClauses: Readonly<Record<string, string>>
  /** The understanding check's opening word, before the clauses. */
  understandingLead: string
  /** The conjunction before the last clause. */
  understandingConjunction: string
  /** The closing sentence. `{pro}` is filled with the professional's name. */
  understandingClose: string
  /** Used when she answered nothing the sentence could describe. */
  understandingFallback: string
}

/**
 * P5c — the guided-inspiration step's own sentences.
 *
 * Question and option LABELS for a contract-v1 consult are not here: they
 * belong to the pack it serves (lib/consult/inspiration/packs/). A contract-v2
 * CARD pack's labels ARE here, in `cards` — see the type above for why.
 */
export type BrandClientConsultInspirationCopy = {
  /** What a reference picture is for, shown before she is asked for one. */
  introduction: string
  /** 🔴 That it is a reference and not a promise. Shown with the picture. */
  referenceNote: string
  /**
   * The steadying line before the questions, for a pack whose subject is not
   * hair. Packs choose between this and the hair variant by name
   * (`reflectionPromptKey`), so the copy stays in one file and the choice
   * stays with the pack.
   */
  reflectionPrompt: string
  /** The hair variant, which can afford to name colour, length and fullness. */
  reflectionPromptHair: string
  /**
   * The note attached to a detail that may be a separate service. Filled in on
   * READ: a contract-v2 payload stores which details it applies to as enums,
   * never the sentence, so editing this line changes every consult at once.
   */
  catalogGuidanceNote: string
  /** P5d — the cards' own words, keyed by attribute and value. */
  cards: BrandClientConsultInspirationCardCopy
}

/**
 * Homepage feature state. Exactly two values on purpose — see
 * lib/brand/defaultHomeCopy.ts for what each means and why there is no third.
 */
export type BrandHomeFeatureState = 'live' | 'rolling-out'

export type BrandHomeFeature = {
  title: string
  body: string
  state: BrandHomeFeatureState
  /**
   * Never rendered. Names the file, deploy, or runtime probe (and its date)
   * that makes `state` true, so the next session re-checks instead of trusting.
   */
  evidence: string
}

/** Public homepage copy (app/page.tsx). See lib/brand/defaultHomeCopy.ts. */
export type BrandHomeCopy = {
  /** ISO date of the last pass that re-verified EVERY feature row. */
  verifiedOn: string
  /** The same date as literal prose — no Date formatting, no timezone. */
  verifiedOnLabel: string
  hero: {
    eyebrow: string
    headlineTop: string
    headlineBottom: string
    intro: string
    ctaClient: string
    ctaPro: string
    ctaBrowse: string
    ctaWhy: string
  }
  legend: {
    body: string
    live: string
    rollingOut: string
  }
  /** One typographic band: the thesis in four beats, rendered large. */
  manifesto: string[]
  loop: { label: string; title: string; steps: BrandHomeFeature[] }
  /**
   * What one account replaces. Every row names a tool a pro pays for or
   * juggles today and the shipped thing that stands in for it; the section is
   * a single claim, so it carries one evidence line rather than one per row.
   */
  replaces: {
    label: string
    title: string
    body: string
    items: { tool: string; withWhat: string }[]
    evidence: string
  }
  clients: { label: string; title: string; features: BrandHomeFeature[] }
  pros: { label: string; title: string; features: BrandHomeFeature[] }
  money: BrandHomeFeature & { label: string; cta: string }
  next: { label: string; title: string; body: string; verifiedPrefix: string }
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
  clientConsultCapture: BrandClientConsultCaptureCopy
  clientConsultBooking: BrandClientConsultBookingCopy
  clientConsultThread: BrandClientConsultThreadCopy
  clientConsultInspiration: BrandClientConsultInspirationCopy
  home: BrandHomeCopy
}
