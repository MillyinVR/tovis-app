import type { EditorialCampaign } from './editorialCampaign'
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
   * Rule 8, said about the LIGHT: shown only when most of the frames the
   * reading actually used were shot in warm or cast light.
   *
   * Warm light stopped refusing a photo on 2026-09-07, which is why this line
   * has to exist. Before, a warm frame never reached the analysis at all; now
   * it can, so the plan owes her the caveat instead of the refusal. `{warm}`
   * and `{total}` are counts — the sentence names them so she can check it
   * against the photographs she remembers taking.
   */
  warmLightCaveat: string
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
/**
 * P7a-3 — the words a plan diff is said in, for BOTH audiences.
 *
 * The client's "plan updated" bubble and the pro's Brief diff read the same
 * labels from here, because the one failure a versioned Brief exists to prevent
 * is the two of them describing the same change differently.
 */
export type BrandClientConsultPlanDiffCopy = {
  /** Row labels. Plain nouns — never a field path. */
  achievabilityLabel: string
  stepsLabel: string
  safetyLabel: string
  baseLevelLabel: string
  lightestLevelLabel: string
  /** What joins the ordered steps when they are shown as one line. */
  stepSeparator: string
  /** The four achievability values, as sentences. */
  achievabilitySingle: string
  achievabilityMulti: string
  achievabilityAssessment: string
  achievabilityUnknown: string
}

/**
 * P7a-4 — one prep reminder's notification title and body.
 *
 * `{pro}` and `{deadline}` are filled by the emitter
 * (lib/notifications/consultPrepReminders.ts) through the same substitution
 * the thread bubbles use.
 */
export type BrandClientConsultPrepMessage = {
  title: string
  body: string
}

/**
 * The four escalating prep reminders, in the order they fire.
 *
 * `booked` goes out immediately when the appointment is made; the other three
 * are scheduled against the DEADLINE, not the appointment — 72 hours before
 * it, 24 hours before it, and on the day it falls (Tori, 2026-09-06). Keyed by
 * what the client is being told rather than by an offset, so a category whose
 * N makes "72 hours before the deadline" land somewhere else still says the
 * right thing.
 */
export type BrandClientConsultPrepCopy = {
  /** Immediately on booking: the deadline exists and here is when it is. */
  booked: BrandClientConsultPrepMessage
  /** 72 hours before the deadline. */
  ahead: BrandClientConsultPrepMessage
  /** 24 hours before the deadline. */
  soon: BrandClientConsultPrepMessage
  /** On the deadline itself. The LAST one — nothing fires after it. */
  due: BrandClientConsultPrepMessage
}

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
  /**
   * Shown in place of the guided pack while the guided stage is not open yet
   * (P3b) — before booking and intake, the photos simply are not asked for.
   */
  captureLockedBeforeBooking: string
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
   * P7a-4 — posted when the LAST safety answer lands.
   *
   * It marks the one moment in prep that is genuinely finished, and it is the
   * thing that stops the reminders. It says so, because a client who has just
   * been nudged three times deserves to know the nudging is over.
   */
  prepComplete: string
  /**
   * P7a-4 — the standing "these are due by <date>" line, while any safety
   * answer is still outstanding. `{pro}` and `{deadline}`.
   *
   * A DATE, never a countdown: a thread is re-read days later, and "2 days
   * left" is wrong the moment she closes the app.
   */
  prepDeadlineDue: string
  /**
   * Posted once the analysis has produced an estimate for an already-booked
   * consult — the moment the provisional price firms up. `{pro}`.
   */
  estimateReady: string

  /**
   * P5g — the bubble above the adaptive follow-up questions. `{pro}`.
   *
   * Said once, before the first one. A sentence above each of up to nine
   * questions would be nine sentences nobody asked for — the same rule the
   * inspiration cards follow.
   */
  followUpIntro: string
  /**
   * 🔴 P5g — said out loud when the follow-up call FAILED and she is being
   * asked the pack's own remaining safety questions instead.
   *
   * Part 0 rule 4 forbids a silent fallback, and a fallback the client cannot
   * see is a silent one. It must not apologise its way into sounding broken,
   * and it must not pretend the questions below are the clever ones.
   */
  followUpFallback: string
  /** Said when there is nothing left worth asking — the honest end of prep. */
  followUpDone: string

  /**
   * The keep-my-photos choice, above the Book button.
   *
   * 🔴 P7a-3 rewrote this because the shipped sentence became FALSE: it told
   * every client "photos are deleted after analysis either way", and with the
   * box ticked they are now kept through the appointment so the plan can be
   * reworked. A consent control that misdescribes what it consents to is worse
   * than no control.
   */
  chartCopyLabel: string

  /** The sticky CTA's label, and the hints under it while it is not live. */
  bookCtaLabel: string
  bookCtaSelfieRequired: string
  bookCtaNotBookable: string
  /**
   * P7a-5 — the pro asks for the safety answers before she holds a slot in this
   * service category. Carries `{pro}`, so it is filled and sent by the SERVER
   * (`ConsultThreadBookCtaDTO.gateNote`), not composed on either device.
   */
  bookCtaPrepRequired: string
  /**
   * P7a-5 — the money line under the CTA, assembled server-side into
   * `ConsultThreadBookCtaDTO.priceNote`.
   *
   * ⚠️ `depositFlat` / `depositPercent` / `prepay` are the three honest states,
   * and they are NOT interchangeable. A percentage deposit has no dollar figure
   * at the spark (no location mode, no add-ons chosen yet), and a
   * prepay-required service takes the WHOLE price, not a deposit — calling that
   * "$X deposit" would understate what the tap is about to charge.
   *
   * `noteSeparator` joins the price half to the money half. It is punctuation,
   * but it lives here so a white-label deployment that wants a line break or a
   * bullet is not editing a component.
   */
  bookCtaDepositFlat: string
  bookCtaDepositPercent: string
  bookCtaPrepay: string
  bookCtaNoteSeparator: string
  /**
   * P7a-5 — the deposit sentence appended to the booking confirmation bubble.
   *
   * By this point the deposit is a STAMPED number on the booking, so `{amount}`
   * is the real figure even when the pro's rule was a percentage — this is the
   * one place a percent deposit can honestly be shown in dollars.
   */
  bookedDepositNote: string

  /**
   * P7a-3 — the consult is a living document until the appointment.
   *
   * `planUpdating` is the plan card while a rerun she asked for is queued or
   * running; `planUpdated` heads the diff bubble; `planUnchanged` is the same
   * bubble when the rerun produced the same answer, which is a real and
   * reassuring outcome rather than something to hide.
   */
  planUpdating: string
  planUpdated: string
  planUnchanged: string
  /**
   * She changed something but her raw photos are gone — she did not opt into
   * keeping them, so completion purged them at the 24h mark. Never a silent
   * reuse of the old observations (Part 0 rule 4).
   */
  planNeedsPhoto: string
  /** The consult has spent its allowance of plan updates. */
  planUpdateLimitReached: string
  /**
   * The appointment started (or is over), so nothing more can be added. Warm,
   * not a shutter coming down: this is the consult having worked.
   */
  appointmentStarted: string

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
  /**
   * P5g — `${analysisAttribute}` → what to call a tappable REGION when the
   * reading's own short name is missing.
   *
   * A region picker labels each area with the phrase for what was actually
   * read there ("cool, silvery cast"), which describes THIS photograph. This
   * map is the per-attribute fallback for a value no short name covers yet: it
   * names the attribute rather than the reading, which is vaguer but never
   * wrong, and it is what stops a label rendering as `tone:COOL`.
   *
   * ⚠️ String-keyed like every sibling map in this type, so a missing
   * attribute is not a type error. `cards.test.ts` asserts one entry per
   * analysis attribute instead — the same shape of proof
   * `assertConsultInspirationPackWritable` gives the packs.
   */
  attributeFallbackNames: Readonly<Record<string, string>>
  /**
   * P5g — ONE way to say where she is starting from, e.g. "your light brown,
   * golden base".
   *
   * 🔴 Composed once per plan version and reused VERBATIM by every follow-up
   * round. Left to the model, round 1 said "your current light brown base" and
   * round 2 said "a golden base" about the same head of hair — two descriptions
   * of one fact, in two questions she reads minutes apart.
   *
   * ⚠️ It describes HER hair, not the reference, and it still lives in the
   * inspiration card copy — because the LEVEL half is `attributeShortNames`
   * ("light brown" for `baseLevel:LEVEL_6`) and one vocabulary for hair levels
   * is the point. A second copy of those ten words would be the thing that
   * drifts.
   */
  startingPoint: BrandClientConsultStartingPointCopy
}

/** See `BrandClientConsultInspirationCardCopy.startingPoint`. */
export type BrandClientConsultStartingPointCopy = {
  /**
   * The ANALYSIS tone enum → the word a question may say. Distinct from
   * `attributeShortNames`' `tone:` entries, which describe the REFERENCE on a
   * different (three-value) vocabulary.
   */
  toneNames: Readonly<Record<string, string>>
  /** `{level}` and `{tone}`, when the plan settled both. */
  withLevelAndTone: string
  /** When only one of them was read. Both are filled from the same maps. */
  levelOnly: string
  toneOnly: string
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

/**
 * A feature given the spotlight treatment: the same checkable row, plus the
 * label above the card and the chips beneath it.
 *
 * ⚠️ A chip is rendered copy, so it is a CLAIM at the smallest size on the
 * page, where it is least likely to be re-read. Every chip must be covered by
 * the row's own `evidence`, and where a row is `rolling-out` the last chip
 * names the limit (the beta, the pilot) rather than leaving the caveat to the
 * state pill alone.
 */
export type BrandHomeSpotlightFeature = BrandHomeFeature & {
  eyebrow: string
  /** Second paragraph, set quieter than `body`. */
  aside: string
  chips: string[]
}

/**
 * The chart band: one feature given a whole band because it is the thing that
 * compounds. Promoted out of `clients.features` the same way a spotlight row
 * is, so the claim still lives in exactly one place.
 */
export type BrandHomeChartBand = BrandHomeFeature & {
  label: string
  /** Tail of the title, painted in the brand gradient. */
  titleAccent: string
  /** Second paragraph, set quieter than `body`. Carries the consent rule. */
  aside: string
  /** Three short answers: what it holds, when it is read, who decides. */
  points: { label: string; body: string }[]
}

export type BrandHomeCardPreview = {
  trigger: string
  previewLabel: string
  brandName: string
  tier: string
  markSrc: string
  serial: string
  note: string
  finish: 'neutral' | 'gold'
}

/** Public homepage copy (app/page.tsx). See lib/brand/defaultHomeCopy.ts. */
export type BrandHomeCopy = {
  campaign?: EditorialCampaign
  /** Brand-owned imagery and clearly labelled previews; never live feature claims. */
  editorial: {
    heroImage: { src: string; alt: string }
    looks: { src: string; alt: string; label: string }[]
    location: string
    discoveryTitle: string
    placeholderLabel: string
    categories: string[]
    journey: { title: string; body: string }[]
    journeyNote: string
    trustTitle: string
    trustBody: string
    foundingTitle: string
    foundingBody: string
    foundingCard: string
    foundingPreview?: BrandHomeCardPreview
    progressionCards: Record<string, BrandHomeCardPreview>
    upcomingLabel: string
    progression: string[]
    progressionBody: string
  }
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
  /** Chip labels only. The chips explain themselves; there is no legend prose (Tori, 2026-09-05). */
  legend: {
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
  clients: { label: string; title: string; intro: string; features: BrandHomeFeature[] }
  chart: BrandHomeChartBand
  /**
   * The two-card feature spotlight. A promoted pair, not a third list: a
   * spotlight row is a full feature (state + evidence, held to the same tests)
   * that has been LIFTED out of `clients`/`pros` rather than copied, so no
   * title appears twice and the counts stay honest.
   */
  spotlight: {
    label: string
    title: string
    /** Tail of the title, painted in the brand gradient. */
    titleAccent: string
    features: BrandHomeSpotlightFeature[]
  }
  pros: { label: string; title: string; intro: string; features: BrandHomeFeature[] }
  money: BrandHomeFeature & { label: string; cta: string }
  /** Closing call to action. Repeats the hero's buttons; makes no new claim. */
  closer: { title: string; titleAccent: string }
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
  /** P7a-4 — the escalating prep-deadline reminders. */
  clientConsultPrep: BrandClientConsultPrepCopy
  clientConsultPlanDiff: BrandClientConsultPlanDiffCopy
  clientConsultInspiration: BrandClientConsultInspirationCopy
  home: BrandHomeCopy
}
