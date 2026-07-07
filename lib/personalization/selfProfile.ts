// lib/personalization/selfProfile.ts
//
// User-level self-profile (personalization spec §6.6): optional, fully
// user-entered chip answers about the person — hair type/length/color, skin
// type/concern — plus declared category interests (the "new-client onboarding
// chips" cold-start prong from spec §2.1). Stored as ClientProfile.selfProfile
// (JSONB) and validated HERE on write AND read, the same SSOT pattern as
// Board.answers (lib/boards/context.ts).
//
// Guardrail alignment (spec guardrail #5): everything in this module is
// explicit and user-entered. Nothing is ever inferred from the client's photos
// or behavior; every field is skippable, editable, and clearable.
//
// Current consumers:
//   - `interests` feeds category affinity in the For You feed
//     (lib/looks/forYouFeed.ts) — an explicit taste statement that gives a
//     brand-new client a non-empty feed signal from day one.
//   - The hair/skin fields are STORED but not yet scored: representation and
//     feasibility matching (spec §6.6 uses 1–2) need look-side content
//     attributes and the visual-embedding pipeline (§6.0), so their scoring
//     lands with that step. Skin-tone-range is deliberately not asked yet —
//     it only serves representation matching, so the (sensitive) question
//     waits until the consumer exists.
//
// This module is pure — no Prisma, no clock reads. Persistence lives in
// lib/personalization/selfProfileStore.ts.

import type {
  BoardAnswers,
  BoardQuestionDef,
} from '@/lib/boards/context'

/** Single-choice self-profile fields (chip questions). */
export const SELF_PROFILE_FIELD_KEYS = [
  'hair_type',
  'hair_length',
  'hair_color',
  'skin_type',
  'skin_concern',
] as const

export type SelfProfileFieldKey = (typeof SELF_PROFILE_FIELD_KEYS)[number]

/**
 * The chip questions shown wherever the self-profile is edited (settings,
 * onboarding). Option values for hair_length / hair_color / skin_type /
 * skin_concern intentionally match the corresponding board-question option
 * values in lib/boards/context.ts so board answers can write through 1:1.
 */
export const SELF_PROFILE_QUESTIONS: readonly (BoardQuestionDef & {
  key: SelfProfileFieldKey
})[] = [
  {
    key: 'hair_type',
    label: 'Your hair type?',
    options: [
      { value: 'straight', label: 'Straight' },
      { value: 'wavy', label: 'Wavy' },
      { value: 'curly', label: 'Curly' },
      { value: 'coily', label: 'Coily' },
    ],
  },
  {
    key: 'hair_length',
    label: 'How long is your hair?',
    options: [
      { value: 'short', label: 'Short' },
      { value: 'medium', label: 'Medium' },
      { value: 'long', label: 'Long' },
    ],
  },
  {
    key: 'hair_color',
    label: 'Your current hair color?',
    options: [
      { value: 'blonde', label: 'Blonde' },
      { value: 'brunette', label: 'Brunette' },
      { value: 'black', label: 'Black' },
      { value: 'red', label: 'Red' },
      { value: 'gray', label: 'Gray / silver' },
      { value: 'other', label: 'Something else' },
    ],
  },
  {
    key: 'skin_type',
    label: 'How would you describe your skin?',
    options: [
      { value: 'oily', label: 'Oily' },
      { value: 'dry', label: 'Dry' },
      { value: 'combination', label: 'Combination' },
      { value: 'sensitive', label: 'Sensitive' },
      { value: 'normal', label: 'Normal' },
    ],
  },
  {
    key: 'skin_concern',
    label: 'What matters most for your skin?',
    options: [
      { value: 'acne', label: 'Breakouts' },
      { value: 'aging', label: 'Fine lines' },
      { value: 'dullness', label: 'Dullness' },
      { value: 'redness', label: 'Redness' },
      { value: 'texture', label: 'Texture' },
    ],
  },
]

const SELF_PROFILE_QUESTIONS_BY_KEY = new Map(
  SELF_PROFILE_QUESTIONS.map((question) => [question.key, question]),
)

// ---------------------------------------------------------------------------
// Interests (multi-select) — the onboarding cold-start chips (spec §2.1/§6.1)
// ---------------------------------------------------------------------------

export type SelfProfileInterestOption = {
  value: string
  label: string
  /** ServiceCategory slugs this interest implies (best-effort matches against
   *  the live catalog — a slug that doesn't exist simply never matches). */
  categorySlugs: readonly string[]
}

export const SELF_PROFILE_INTEREST_OPTIONS: readonly SelfProfileInterestOption[] =
  [
    { value: 'hair', label: 'Hair', categorySlugs: ['hair'] },
    { value: 'hair-color', label: 'Hair color', categorySlugs: ['hair-color'] },
    { value: 'makeup', label: 'Makeup', categorySlugs: ['makeup'] },
    {
      value: 'nails',
      label: 'Nails',
      categorySlugs: ['nails', 'nails-enhancements'],
    },
    {
      value: 'skincare',
      label: 'Skincare',
      categorySlugs: ['skincare', 'facials'],
    },
    {
      value: 'brows',
      label: 'Brows / lashes',
      categorySlugs: ['brows', 'permanent-makeup'],
    },
  ]

const INTEREST_OPTIONS_BY_VALUE = new Map(
  SELF_PROFILE_INTEREST_OPTIONS.map((option) => [option.value, option]),
)

// ---------------------------------------------------------------------------
// Shape + validation
// ---------------------------------------------------------------------------

/** The validated self-profile as stored in ClientProfile.selfProfile. */
export type ClientSelfProfile = Partial<
  Record<SelfProfileFieldKey, string>
> & {
  interests?: string[]
}

/**
 * Validate a raw stored/incoming value into a ClientSelfProfile: keep only
 * known field keys whose value is one of that question's option values, and
 * known interest values (deduped, in option order). Returns null when nothing
 * valid remains (stored as SQL NULL, not {}). Also used on READ so a stale or
 * hand-edited value can never leak past this module.
 */
export function normalizeSelfProfile(raw: unknown): ClientSelfProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const record: Record<string, unknown> = { ...raw }
  const normalized: ClientSelfProfile = {}

  for (const question of SELF_PROFILE_QUESTIONS) {
    const value = record[question.key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (question.options.some((option) => option.value === trimmed)) {
      normalized[question.key] = trimmed
    }
  }

  const rawInterests = record.interests
  if (Array.isArray(rawInterests)) {
    const chosen = new Set<string>()
    for (const entry of rawInterests) {
      if (typeof entry !== 'string') continue
      const trimmed = entry.trim()
      if (INTEREST_OPTIONS_BY_VALUE.has(trimmed)) chosen.add(trimmed)
    }
    if (chosen.size > 0) {
      normalized.interests = SELF_PROFILE_INTEREST_OPTIONS.filter((option) =>
        chosen.has(option.value),
      ).map((option) => option.value)
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

// ---------------------------------------------------------------------------
// Write-boundary input parsing (PATCH semantics)
// ---------------------------------------------------------------------------

/**
 * A patch: absent key = untouched; null = explicit clear; string / string[] =
 * set (must be a valid option value or the parse fails).
 */
export type SelfProfilePatch = Partial<
  Record<SelfProfileFieldKey, string | null>
> & {
  interests?: string[] | null
}

export type SelfProfileInputError = {
  code: 'INVALID_SELF_PROFILE_FIELD'
  message: string
}

export type SelfProfileInputResult =
  | { ok: true; value: SelfProfilePatch }
  | { ok: false; error: SelfProfileInputError }

function invalidField(key: string): SelfProfileInputResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_SELF_PROFILE_FIELD',
      message: `Invalid value for ${key}.`,
    },
  }
}

/**
 * Parse the self-profile fields off a request body. Absent keys stay absent
 * (PATCH semantics); `null` / `''` are explicit clears. Malformed values are a
 * 400-shaped error, never silently coerced.
 */
export function parseSelfProfileInput(
  body: Record<string, unknown>,
): SelfProfileInputResult {
  const value: SelfProfilePatch = {}

  for (const key of SELF_PROFILE_FIELD_KEYS) {
    if (!(key in body) || body[key] === undefined) continue

    const raw = body[key]
    if (raw === null || raw === '') {
      value[key] = null
      continue
    }
    if (typeof raw !== 'string') return invalidField(key)

    const trimmed = raw.trim()
    const question = SELF_PROFILE_QUESTIONS_BY_KEY.get(key)
    if (!question?.options.some((option) => option.value === trimmed)) {
      return invalidField(key)
    }
    value[key] = trimmed
  }

  if ('interests' in body && body.interests !== undefined) {
    const raw = body.interests
    if (raw === null) {
      value.interests = null
    } else if (Array.isArray(raw)) {
      const interests: string[] = []
      for (const entry of raw) {
        if (typeof entry !== 'string') return invalidField('interests')
        const trimmed = entry.trim()
        if (!INTEREST_OPTIONS_BY_VALUE.has(trimmed)) {
          return invalidField('interests')
        }
        interests.push(trimmed)
      }
      value.interests = interests
    } else {
      return invalidField('interests')
    }
  }

  return { ok: true, value }
}

/**
 * Apply a patch to the current profile, returning the next normalized profile
 * (or null when nothing remains). Pure.
 */
export function applySelfProfilePatch(
  current: ClientSelfProfile | null,
  patch: SelfProfilePatch,
): ClientSelfProfile | null {
  const merged: Record<string, unknown> = { ...(current ?? {}) }

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key]
    } else if (value !== undefined) {
      merged[key] = value
    }
  }

  return normalizeSelfProfile(merged)
}

// ---------------------------------------------------------------------------
// Board-answer write-through (spec §7.3): person-describing board answers may
// be saved to the self-profile — one tap, never silent.
// ---------------------------------------------------------------------------

/**
 * Board question keys that describe the PERSON (not the occasion) → the
 * self-profile field they write through to. Option values match 1:1 by
 * construction (see SELF_PROFILE_QUESTIONS); anything that drifts is dropped
 * by normalizeSelfProfile rather than stored invalid.
 */
export const BOARD_ANSWER_WRITE_THROUGH: Readonly<
  Record<string, SelfProfileFieldKey>
> = {
  hair_length: 'hair_length',
  current_color: 'hair_color',
  skin_type: 'skin_type',
  main_concern: 'skin_concern',
}

/**
 * Extract the person-describing subset of a board's answers as a self-profile
 * patch (sets only — a write-through never clears anything). Returns null when
 * the answers carry nothing person-describing.
 */
export function extractSelfProfileWriteThrough(
  answers: BoardAnswers | null | undefined,
): SelfProfilePatch | null {
  if (!answers) return null

  const patch: SelfProfilePatch = {}
  for (const [answerKey, fieldKey] of Object.entries(
    BOARD_ANSWER_WRITE_THROUGH,
  )) {
    const value = answers[answerKey]
    if (typeof value === 'string' && value.trim()) {
      patch[fieldKey] = value.trim()
    }
  }

  return Object.keys(patch).length > 0 ? patch : null
}

// ---------------------------------------------------------------------------
// Feed signals
// ---------------------------------------------------------------------------

/**
 * The ServiceCategory slugs a profile's declared interests imply — folded into
 * category affinity by the For You feed (explicit taste, so a brand-new client
 * gets a signal before any like/save history exists).
 */
export function selfProfileInterestCategorySlugs(
  profile: ClientSelfProfile | null,
): string[] {
  if (!profile?.interests?.length) return []

  const slugs = new Set<string>()
  for (const value of profile.interests) {
    const option = INTEREST_OPTIONS_BY_VALUE.get(value)
    if (!option) continue
    for (const slug of option.categorySlugs) slugs.add(slug)
  }

  return [...slugs]
}
