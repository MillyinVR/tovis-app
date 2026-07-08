// lib/boards/context.ts
//
// Board creation-context: the "what's this board for?" signal captured once at
// board creation (personalization spec §7–8) — the highest-payoff,
// lowest-creepiness personalization input because the client TELLS us, in
// context, instead of us inferring.
//
// Three pieces, all optional and all skippable in the UI:
//   - `type`       what the board is for (BoardType enum, default GENERAL)
//   - `eventDate`  the calendar date the board counts down to (bridal/prom)
//   - `answers`    2–3 chip questions per type (spec §7.3), validated here
//
// This module is the single source of truth for the question sets, the answer
// validation, and how a board's declared purpose maps onto For You feed
// signals (occasion tag slugs + service-category slugs). It is pure — no
// Prisma, no clock reads — so everything is unit-testable.

import { BoardType } from '@prisma/client'

const DAY_MS = 24 * 60 * 60 * 1000

export const BOARD_TYPE_VALUES: readonly BoardType[] = [
  BoardType.GENERAL,
  BoardType.BRIDAL,
  BoardType.PROM,
  BoardType.SKINCARE,
  BoardType.PERMANENT_MAKEUP,
  BoardType.COLOR_TRANSFORMATION,
  BoardType.NAILS,
]

/** Human labels for the board-type chips. */
export const BOARD_TYPE_LABELS: Record<BoardType, string> = {
  GENERAL: 'Just collecting',
  BRIDAL: 'Wedding',
  PROM: 'Prom',
  SKINCARE: 'Facial / skincare',
  PERMANENT_MAKEUP: 'Brows / permanent makeup',
  COLOR_TRANSFORMATION: 'Color / transformation',
  NAILS: 'Nails',
}

export function parseBoardType(
  value: string | null | undefined,
): BoardType | null {
  if (typeof value !== 'string') return null
  const upper = value.trim().toUpperCase()
  if (!upper) return null

  return BOARD_TYPE_VALUES.find((type) => type === upper) ?? null
}

// ---------------------------------------------------------------------------
// Event date (bridal / prom)
// ---------------------------------------------------------------------------

/** Board types whose creation flow asks for an event date. */
const EVENT_DATE_BOARD_TYPES: ReadonlySet<BoardType> = new Set([
  BoardType.BRIDAL,
  BoardType.PROM,
])

export function boardTypeWantsEventDate(type: BoardType): boolean {
  return EVENT_DATE_BOARD_TYPES.has(type)
}

/** What the countdown counts down TO, per event-dated type ("42 days until …"). */
export const BOARD_EVENT_NOUNS: Partial<Record<BoardType, string>> = {
  BRIDAL: 'your wedding',
  PROM: 'prom',
}

const BOARD_EVENT_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/

// Sanity bounds, not business rules — just reject typos like year 0206.
const BOARD_EVENT_DATE_MIN_YEAR = 2000
const BOARD_EVENT_DATE_MAX_YEAR = 2100

/**
 * Parse a strict `YYYY-MM-DD` calendar date into a UTC-midnight Date (the JS
 * representation Prisma uses for a `@db.Date` column). Returns null for
 * anything malformed, impossible (2026-02-30), or outside sane year bounds.
 * An event date is a CALENDAR date — no time-of-day or timezone is involved,
 * so this deliberately never touches viewer/server timezones.
 */
export function parseBoardEventDateYmd(
  value: string | null | undefined,
): Date | null {
  if (typeof value !== 'string') return null

  const match = BOARD_EVENT_DATE_REGEX.exec(value.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (year < BOARD_EVENT_DATE_MIN_YEAR || year > BOARD_EVENT_DATE_MAX_YEAR) {
    return null
  }

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

/** Serialize a `@db.Date` value (UTC midnight) back to `YYYY-MM-DD`. */
export function boardEventDateToYmd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Whole calendar days from `today` (interpreted in the viewer's local
 * calendar) to an event ymd — the "42 days until prom" number. Pure calendar
 * math: both sides become a UTC day index, so DST and timezones can't skew
 * the count. Negative = the event has passed; null = malformed ymd.
 */
export function daysUntilEvent(eventYmd: string, today: Date): number | null {
  const match = BOARD_EVENT_DATE_REGEX.exec(eventYmd)
  if (!match) return null

  const eventDay = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  )
  const todayDay = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )

  return Math.round((eventDay - todayDay) / DAY_MS)
}

// ---------------------------------------------------------------------------
// Creation questions (spec §7.3) + answer validation
// ---------------------------------------------------------------------------

export type BoardQuestionOption = {
  value: string
  label: string
}

export type BoardQuestionDef = {
  /** Stable snake_case key stored in Board.answers. */
  key: string
  /** Question copy shown above the chips. */
  label: string
  options: readonly BoardQuestionOption[]
}

function question(
  key: string,
  label: string,
  options: ReadonlyArray<readonly [string, string]>,
): BoardQuestionDef {
  return {
    key,
    label,
    options: options.map(([value, optionLabel]) => ({
      value,
      label: optionLabel,
    })),
  }
}

const HAIR_LENGTH_OPTIONS = [
  ['short', 'Short'],
  ['medium', 'Medium'],
  ['long', 'Long'],
] as const

/**
 * The 2–3 chip questions asked per board type (spec §7.3) — asked ONCE at
 * creation, always skippable, chips over free text. The date question for
 * bridal/prom is handled separately via boardTypeWantsEventDate (dates get a
 * native picker, not chips).
 */
export const BOARD_QUESTION_SETS: Record<
  BoardType,
  readonly BoardQuestionDef[]
> = {
  GENERAL: [],
  BRIDAL: [
    question('hair_length', 'How long is your hair right now?', HAIR_LENGTH_OPTIONS),
    question('trial_timeline', 'When would you want a trial?', [
      ['6-8-weeks-before', '6–8 weeks before'],
      ['2-4-weeks-before', '2–4 weeks before'],
      ['no-trial', 'No trial needed'],
    ]),
  ],
  PROM: [
    question('dress_color', 'What color is your dress?', [
      ['red', 'Red'],
      ['pink', 'Pink'],
      ['blue', 'Blue'],
      ['green', 'Green'],
      ['black', 'Black'],
      ['white', 'White'],
      ['metallic', 'Gold / silver'],
      ['undecided', 'Still deciding'],
    ]),
    question('hair_length', 'How long is your hair right now?', HAIR_LENGTH_OPTIONS),
  ],
  SKINCARE: [
    question('skin_type', 'How would you describe your skin?', [
      ['oily', 'Oily'],
      ['dry', 'Dry'],
      ['combination', 'Combination'],
      ['sensitive', 'Sensitive'],
      ['normal', 'Normal'],
    ]),
    question('main_concern', 'What matters most to you?', [
      ['acne', 'Breakouts'],
      ['aging', 'Fine lines'],
      ['dullness', 'Dullness'],
      ['redness', 'Redness'],
      ['texture', 'Texture'],
    ]),
    question('had_facial_before', 'Ever had a facial before?', [
      ['yes', 'Yes'],
      ['no', 'First time'],
    ]),
  ],
  // Sensitive/high-commitment service — the "hesitation" question is worded
  // with warmth per spec §7.2 ("what do you want to feel confident about"),
  // never "what are your hesitations".
  PERMANENT_MAKEUP: [
    question('had_it_before', 'Have you had it done before?', [
      ['yes', 'Yes'],
      ['no', 'First time'],
    ]),
    question(
      'confidence_topic',
      'What do you want to feel confident about before booking?',
      [
        ['healing-process', 'The healing process'],
        ['pain-level', 'How it feels'],
        ['natural-look', 'It looking natural'],
        ['cost', 'Cost'],
      ],
    ),
    question('brow_situation', 'Your brows today?', [
      ['sparse', 'Sparse'],
      ['over-plucked', 'Over-plucked'],
      ['patchy', 'Patchy'],
      ['full-but-undefined', 'Full but undefined'],
    ]),
  ],
  COLOR_TRANSFORMATION: [
    question('current_color', 'Your current color?', [
      ['blonde', 'Blonde'],
      ['brunette', 'Brunette'],
      ['black', 'Black'],
      ['red', 'Red'],
      ['gray', 'Gray / silver'],
      ['other', 'Something else'],
    ]),
    question('dream_color', 'Your dream color?', [
      ['blonde', 'Blonde'],
      ['brunette', 'Brunette'],
      ['black', 'Black'],
      ['red', 'Red'],
      ['fantasy', 'Fantasy / vivid'],
      ['not-sure', 'Not sure yet'],
    ]),
    // Maps onto the commitment-tier idea (spec §5.3): subtle vs total change.
    question('change_scale', 'How big a change are you after?', [
      ['subtle', 'Subtle'],
      ['noticeable', 'Noticeable'],
      ['total', 'Total transformation'],
    ]),
  ],
  NAILS: [
    question('length_preference', 'What length do you like?', [
      ['short', 'Short'],
      ['medium', 'Medium'],
      ['long', 'Long'],
      ['extra-long', 'Extra long'],
    ]),
    question('occasion', 'What are these for?', [
      ['everyday', 'Everyday'],
      ['event', 'An event'],
      ['vacation', 'Vacation'],
    ]),
  ],
}

/** Answers as stored in Board.answers: question key → chosen option value. */
export type BoardAnswers = Record<string, string>

/**
 * Validate raw answers against the question set for `type`: keep only known
 * keys whose value is one of that question's option values; drop everything
 * else. Returns null when nothing valid remains (stored as SQL NULL, not {}).
 * Also used on READ so a stale answer (e.g. after a type change written by an
 * older client) can never leak past this module.
 */
export function normalizeBoardAnswers(
  type: BoardType,
  raw: unknown,
): BoardAnswers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const record: Record<string, unknown> = { ...raw }
  const normalized: BoardAnswers = {}

  for (const def of BOARD_QUESTION_SETS[type]) {
    const value = record[def.key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (def.options.some((option) => option.value === trimmed)) {
      normalized[def.key] = trimmed
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

// ---------------------------------------------------------------------------
// Write-boundary input parsing (shared by the API routes + server action)
// ---------------------------------------------------------------------------

export type BoardContextInput = {
  type?: BoardType
  eventDate?: Date | null
  answers?: unknown
}

export type BoardContextInputError = {
  code: 'INVALID_BOARD_TYPE' | 'INVALID_BOARD_EVENT_DATE' | 'INVALID_BOARD_ANSWERS'
  message: string
}

export type BoardContextInputResult =
  | { ok: true; value: BoardContextInput }
  | { ok: false; error: BoardContextInputError }

/**
 * Parse the optional context fields (`type`, `eventDate`, `answers`) off a
 * request body / form payload. Absent keys stay absent (PATCH semantics);
 * `eventDate: null` and `answers: null` are explicit clears. Malformed values
 * are a 400-shaped error, never silently coerced.
 */
export function parseBoardContextInput(
  body: Record<string, unknown>,
): BoardContextInputResult {
  const value: BoardContextInput = {}

  if ('type' in body && body.type !== undefined) {
    const type = typeof body.type === 'string' ? parseBoardType(body.type) : null
    if (!type) {
      return {
        ok: false,
        error: {
          code: 'INVALID_BOARD_TYPE',
          message: 'Invalid board type.',
        },
      }
    }
    value.type = type
  }

  if ('eventDate' in body && body.eventDate !== undefined) {
    if (body.eventDate === null || body.eventDate === '') {
      value.eventDate = null
    } else {
      const eventDate =
        typeof body.eventDate === 'string'
          ? parseBoardEventDateYmd(body.eventDate)
          : null
      if (!eventDate) {
        return {
          ok: false,
          error: {
            code: 'INVALID_BOARD_EVENT_DATE',
            message: 'Invalid event date — use YYYY-MM-DD.',
          },
        }
      }
      value.eventDate = eventDate
    }
  }

  if ('answers' in body && body.answers !== undefined) {
    if (
      body.answers !== null &&
      (typeof body.answers !== 'object' || Array.isArray(body.answers))
    ) {
      return {
        ok: false,
        error: {
          code: 'INVALID_BOARD_ANSWERS',
          message: 'Invalid board answers.',
        },
      }
    }
    value.answers = body.answers
  }

  return { ok: true, value }
}

// ---------------------------------------------------------------------------
// For You feed signals (spec §8 — what the declared purpose boosts)
// ---------------------------------------------------------------------------

export type BoardTypeFeedSignals = {
  /**
   * LookTag slugs (lib/looks/tags.ts normalized form: lowercase ascii
   * alphanumerics) that read as this occasion. Matched against a look's
   * caption hashtags for the occasion boost.
   */
  tagSlugs: readonly string[]
  /** ServiceCategory slugs this purpose implies an interest in. */
  categorySlugs: readonly string[]
}

/**
 * How each declared board purpose maps onto feed signals. Tag slugs are
 * best-effort matches against organic caption hashtags; category slugs are
 * best-effort matches against the live service catalog — a slug that doesn't
 * exist in either simply never matches (harmless).
 */
export const BOARD_TYPE_FEED_SIGNALS: Record<BoardType, BoardTypeFeedSignals> =
  {
    GENERAL: { tagSlugs: [], categorySlugs: [] },
    BRIDAL: {
      tagSlugs: ['bridal', 'wedding', 'bride', 'updo'],
      categorySlugs: ['hair', 'makeup'],
    },
    PROM: {
      tagSlugs: ['prom', 'promhair', 'updo'],
      categorySlugs: ['hair', 'makeup'],
    },
    SKINCARE: {
      tagSlugs: ['facial', 'skincare'],
      categorySlugs: ['skincare', 'facials'],
    },
    PERMANENT_MAKEUP: {
      tagSlugs: ['microblading', 'permanentmakeup', 'pmu', 'browtattoo'],
      categorySlugs: ['brows', 'permanent-makeup'],
    },
    COLOR_TRANSFORMATION: {
      tagSlugs: ['balayage', 'haircolor', 'highlights', 'colormelt'],
      categorySlugs: ['hair-color'],
    },
    NAILS: {
      tagSlugs: ['nails', 'nailart'],
      categorySlugs: ['nails', 'nails-enhancements'],
    },
  }

// ---------------------------------------------------------------------------
// Answer feed signals (spec §4.4 service_specific_match) — how a board's chip
// answers boost the board feed. Same best-effort philosophy as
// BOARD_TYPE_FEED_SIGNALS: an answer value maps to LookTag slugs that read as
// that answer, matched against a candidate look's caption hashtags. Only the
// clearly-VISUAL answers map (a dress color, a dream hair color, a skin
// concern) — timeline/"had it before?"/hesitation answers describe the person's
// context, not the look, so they contribute nothing here. A slug that never
// appears in the tag corpus simply never matches (harmless). True structured
// attribute matching (hair length ↔ a look's actual hair length) needs
// look-side attributes we don't have yet (§6.6 deferral) — this tag-level match
// is the buildable approximation, consistent with how occasion_tag_match works.
// ---------------------------------------------------------------------------

/**
 * Per board type: answer key → answer value → LookTag slugs that value implies.
 * Values are the validated option values from BOARD_QUESTION_SETS; anything
 * not listed here (or an answer key absent from a type) contributes no signal.
 */
export const BOARD_ANSWER_FEED_SIGNALS: Partial<
  Record<BoardType, Record<string, Record<string, readonly string[]>>>
> = {
  PROM: {
    dress_color: {
      red: ['red'],
      pink: ['pink'],
      blue: ['blue'],
      green: ['green'],
      black: ['black'],
      white: ['white'],
      metallic: ['gold', 'silver', 'metallic'],
      // "undecided" carries no color signal.
    },
  },
  SKINCARE: {
    main_concern: {
      acne: ['acne', 'acnetreatment'],
      aging: ['antiaging', 'antiageing'],
      dullness: ['glow', 'brightening'],
      redness: ['redness', 'rosacea'],
      texture: ['texture', 'resurfacing'],
    },
  },
  COLOR_TRANSFORMATION: {
    current_color: {
      blonde: ['blonde'],
      brunette: ['brunette'],
      black: ['blackhair'],
      red: ['redhair', 'copper'],
      gray: ['grayhair', 'silverhair'],
      // "other" carries no reliable color signal.
    },
    dream_color: {
      blonde: ['blonde', 'blondehair'],
      brunette: ['brunette'],
      black: ['blackhair'],
      red: ['redhair', 'copper'],
      fantasy: ['vivid', 'fantasycolor', 'vividhair'],
      // "not-sure" carries no color signal.
    },
    change_scale: {
      total: ['transformation', 'hairtransformation'],
      // subtle / noticeable are too weak to tag-match reliably.
    },
  },
  NAILS: {
    occasion: {
      event: ['eventnails'],
      vacation: ['vacationnails'],
      // "everyday" is too generic to tag-match.
    },
  },
}

/**
 * The LookTag slugs a board's (validated) answers imply — the retrieval +
 * scoring signal for §4.4's service_specific_match. Deduped, order-stable.
 * Empty when the board carries no answers or none of them are visual. Pure.
 */
export function boardAnswerFeedTagSlugs(
  type: BoardType,
  answers: BoardAnswers | null | undefined,
): string[] {
  if (!answers) return []

  const perType = BOARD_ANSWER_FEED_SIGNALS[type]
  if (!perType) return []

  const slugs = new Set<string>()
  for (const [answerKey, byValue] of Object.entries(perType)) {
    const value = answers[answerKey]
    if (typeof value !== 'string') continue
    for (const slug of byValue[value] ?? []) slugs.add(slug)
  }

  return [...slugs]
}

// ---------------------------------------------------------------------------
// Event proximity (spec §8 countdown + §6.2 sharp post-event decay)
// ---------------------------------------------------------------------------

export const BOARD_EVENT_PROXIMITY = {
  // A dated purpose is always a stronger signal than an undated one, and the
  // signal should RAMP as the event approaches — that's the "42 days until
  // prom" relationship the spec is after.
  noDateFactor: 0.5,
  // Within this many days of the event the signal is at full strength.
  fullWindowDays: 30,
  // Beyond fullWindowDays the factor tapers linearly, reaching the far floor
  // at this horizon (a wedding 6 months out still colors the feed, gently).
  taperEndDays: 180,
  farFloor: 0.5,
  // Sharp decay after the event passes (spec §6.2): fades to zero across this
  // many days, then the occasion stops shaping the feed entirely.
  postEventGraceDays: 3,
} as const

/**
 * How strongly a board's occasion should shape the feed right now, in [0, 1].
 * Pure calendar-day math on UTC days — `eventDate` is a `@db.Date` (UTC
 * midnight) and day-level precision is all a ranking weight needs.
 */
export function computeBoardEventProximity(
  eventDate: Date | null,
  now: Date,
): number {
  const {
    noDateFactor,
    fullWindowDays,
    taperEndDays,
    farFloor,
    postEventGraceDays,
  } = BOARD_EVENT_PROXIMITY

  if (!(eventDate instanceof Date) || Number.isNaN(eventDate.getTime())) {
    return noDateFactor
  }

  const eventDay = Math.floor(eventDate.getTime() / DAY_MS)
  const nowDay = Math.floor(now.getTime() / DAY_MS)
  const daysUntil = eventDay - nowDay

  if (daysUntil >= 0) {
    if (daysUntil <= fullWindowDays) return 1
    if (daysUntil >= taperEndDays) return farFloor
    const progress =
      (daysUntil - fullWindowDays) / (taperEndDays - fullWindowDays)
    return 1 - progress * (1 - farFloor)
  }

  const daysPast = -daysUntil
  if (daysPast >= postEventGraceDays) return 0
  return 1 - daysPast / postEventGraceDays
}
