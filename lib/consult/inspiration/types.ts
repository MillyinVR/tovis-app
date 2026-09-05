// lib/consult/inspiration/types.ts
//
// The shape of a guided-INSPIRATION pack as the server owns it, and of the
// contract-v2 payload one produces.
//
// v1 (lib/consult/inspirationPack.ts) was one hard-coded hair-colour
// questionnaire: seven fixed keys, a fixed option vocabulary, a three-detail
// completion gate, and a stored payload that carried the client's own words
// plus three DERIVED arrays. Every one of those facts was written twice — once
// in TypeScript and once in the `consult_inspiration_payload_guard` trigger —
// so a second family could not be asked a single different question without a
// migration.
//
// v2 keeps the same idea and moves the vocabulary into DATA. A pack is a list
// of questions with enum options; the payload stores the pack it was written
// under and the KEYS AND VALUES she picked, nothing else. Everything the pro
// brief and the analysis prompt read — her words, the possible professional
// reading, the catalogue note — is DERIVED on read from the pack the payload
// names, so there is exactly one definition of each and a stored row cannot
// disagree with it.
//
// What is NOT here, on purpose:
//   * free text. "Keys and enums only" is the storage contract, and it is what
//     lets the database guard validate a payload for a family it has never
//     heard of (a slug-shaped key, a token-shaped value) instead of pinning a
//     question list it would need a migration to widen.
//   * user-facing sentences that are not a question or an option label. The
//     step's own copy is the brand's (lib/brand/defaultClientConsultInspirationCopy.ts).

import type { BrandClientConsultInspirationCopy } from '@/lib/brand/types'
import type {
  ConsultInspirationAnswerDTO,
  ConsultInspirationCatalogGuidanceDTO,
  ConsultInspirationExactDetailDTO,
  ConsultInspirationQuestionDTO,
  ConsultInspirationSourceDTO,
} from '@/lib/dto/consult'

/** The contract version a stored guided-inspiration payload was written under. */
export const CONSULT_INSPIRATION_CONTRACT_V1 = 1 as const
export const CONSULT_INSPIRATION_CONTRACT_V2 = 2 as const

/** The `schemaVersion` column value a contract-v2 revision carries. */
export const CONSULT_INSPIRATION_V2_SCHEMA_VERSION = 2

export type ConsultInspirationCatalogDetail =
  ConsultInspirationCatalogGuidanceDTO['detail']

/**
 * Values that mean "nothing to record here". They may never be combined with
 * another selection, they never become an exact detail, and they never point
 * at a catalogue service. Shared by every pack so one list decides it.
 */
export const CONSULT_INSPIRATION_NEUTRAL_VALUES: ReadonlySet<string> = new Set([
  'none',
  'not-sure',
  'not-part-of-goal',
])

/**
 * 🔴 The shape the DATABASE guard enforces for a v2 payload, mirrored here so
 * the two cannot drift. The guard cannot know a pack's vocabulary — that is
 * the whole point of v2 — so it validates that keys are slug-shaped and values
 * are token-shaped, and the application validates them against the pack.
 *
 * Anything a pack adds must pass BOTH. `assertConsultInspirationPackWritable`
 * (registry.ts) proves it for every registered pack at test time, so a pack
 * whose new option the guard would refuse fails in CI rather than at the
 * client's last tap.
 */
export const CONSULT_INSPIRATION_QUESTION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
export const CONSULT_INSPIRATION_OPTION_VALUE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * The content the guard refuses anywhere in a payload, word-for-word from
 * `consult_inspiration_payload_guard` — this is a person's appearance and
 * identity, which the guided step has never been allowed to record. Kept in v2
 * unchanged (the P5c brief: "keep the word-regex").
 *
 * ⚠️ POSIX `\m…\M` are word boundaries, and a HYPHEN is one. An option value
 * like `face-framing` therefore MATCHES `\mface\M` and would be refused by the
 * database after passing every TypeScript check. Pack values avoid these words
 * as whole words; the assertion below is what proves it.
 */
export const CONSULT_INSPIRATION_FORBIDDEN_WORDS =
  /\b(face|eyes?|skin|undertone|identity|ethnic|ethnicity|race|health)\b/i

export type ConsultInspirationPackQuestion = ConsultInspirationQuestionDTO & {
  /** How a non-neutral selection here reads on the professional's brief. */
  readonly detailSentiment: ConsultInspirationExactDetailDTO['sentiment']
  /**
   * The catalogue detail a non-neutral selection here may point at — the
   * "this part of the look may be its own service" note. Null for questions
   * that describe the reference rather than ask for something.
   */
  readonly catalogDetail: ConsultInspirationCatalogDetail | null
  /**
   * Whether a selection here counts as a DETAIL SHE POINTED AT in the picture.
   *
   * False for the questions that ask about a service rather than about the
   * reference — "would you like to be walked through this?" is a preference,
   * not something she noticed. Contract v1 hard-coded exactly this exclusion
   * for `styling_walkthrough`; here it is pack data, so a new pack declares it
   * instead of the engine knowing a key by name.
   *
   * It no longer gates anything (v2 has no detail gate) — it is what
   * `specificDetailCount` reports.
   */
  readonly countsAsDetail: boolean
}

/**
 * Which steadying line the pack shows before its questions. A NAME, not a
 * sentence: the words live in the brand's copy table, and a pack that wanted
 * its own copy would be a second place to edit the same voice.
 */
export type ConsultInspirationReflectionPromptKey = Extract<
  keyof BrandClientConsultInspirationCopy,
  'reflectionPrompt' | 'reflectionPromptHair'
>

export type ConsultInspirationPackDefinition = {
  readonly id: string
  /** The one category slug that carries this pack ahead of the family rule. */
  readonly categorySlug: string | null
  readonly version: number
  readonly schemaVersion: number
  readonly reflectionPromptKey: ConsultInspirationReflectionPromptKey
  readonly questions: readonly ConsultInspirationPackQuestion[]
  /**
   * `${questionKey}:${optionValue}` → what a professional may READ into that
   * selection. Always hedged, always evidence-tagged as a client selection: it
   * is an interpretation of a tap, never an observation about the client.
   * A pair with no entry contributes no interpretation rather than a guess.
   */
  readonly possibleMeanings: Readonly<Record<string, string>>
}

/** A stored contract-v2 payload, normalized against the pack it names. */
export type ConsultInspirationPayloadV2 = {
  readonly packId: string
  readonly packVersion: number
  readonly schemaVersion: number
  readonly source: ConsultInspirationSourceDTO
  readonly inspirationId: string | null
  readonly complete: boolean
  /** Question key → the option values she picked, in pack option order. */
  readonly answers: Readonly<Record<string, readonly string[]>>
  /** Catalogue details this answer set pointed at, as ENUMS — the sentence is copy. */
  readonly catalogGuidance: readonly ConsultInspirationCatalogDetail[]
}

/**
 * ONE read view of a guided inspiration, whichever contract wrote it.
 *
 * v1 rows carry their derived arrays in the row and are read back as they were
 * stored; v2 rows carry keys and enums and have the same arrays DERIVED from
 * their pack. Readers get the same fields either way, which is what "v1 is
 * retained on every read path" means in practice: no reader branches on the
 * contract version, so none of them can forget to.
 */
export type ConsultInspirationReview = {
  readonly contractVersion:
    | typeof CONSULT_INSPIRATION_CONTRACT_V1
    | typeof CONSULT_INSPIRATION_CONTRACT_V2
  readonly schemaVersion: number
  /** The pack a v2 payload names. Null for v1, which had no pack. */
  readonly packId: string | null
  readonly packVersion: number | null
  readonly source: ConsultInspirationSourceDTO
  readonly inspirationId: string | null
  readonly complete: boolean
  readonly answers: ConsultInspirationAnswerDTO[]
  readonly exactClientDetails: ConsultInspirationExactDetailDTO[]
  readonly possibleProfessionalInterpretation: ConsultInspirationPossibleInterpretation[]
  readonly catalogGuidance: ConsultInspirationCatalogGuidanceDTO[]
}

export type ConsultInspirationPossibleInterpretation = {
  clientDetailValue: string
  possibleMeaning: string
  confidence: 'POSSIBLE'
  evidence: 'CLIENT_SELECTION'
}

export type ConsultInspirationProgress = {
  currentQuestion: ConsultInspirationQuestionDTO | null
  answeredQuestionCount: number
  specificDetailCount: number
  canComplete: boolean
  blocker: 'QUESTIONS_REMAINING' | null
}

export type ConsultInspirationOptionValues = ReadonlyArray<
  readonly [value: string, label: string]
>

export function inspirationOptions(
  values: ConsultInspirationOptionValues,
): ConsultInspirationQuestionDTO['options'] {
  return values.map(([value, label]) => ({ value, label }))
}

/**
 * One pack question. `allowText` is always false and `helpText` optional: v2
 * stores no free text, so the flag exists only because the wire DTO — which
 * still describes v1 rows to a client mid-consult — carries it.
 */
export function inspirationQuestion(args: {
  key: string
  label: string
  helpText?: string | null
  kind: 'SINGLE_SELECT' | 'MULTI_SELECT'
  options: ConsultInspirationOptionValues
  minSelections: number
  maxSelections: number
  detailSentiment: ConsultInspirationExactDetailDTO['sentiment']
  catalogDetail?: ConsultInspirationCatalogDetail | null
  countsAsDetail?: boolean
}): ConsultInspirationPackQuestion {
  return {
    key: args.key,
    label: args.label,
    helpText: args.helpText ?? null,
    kind: args.kind,
    options: inspirationOptions(args.options),
    minSelections: args.minSelections,
    maxSelections: args.maxSelections,
    allowText: false,
    detailSentiment: args.detailSentiment,
    catalogDetail: args.catalogDetail ?? null,
    countsAsDetail: args.countsAsDetail ?? true,
  }
}
