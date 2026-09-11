// lib/consult/briefTopLine.ts
//
// C2-6a — the one-line synthesis at the top of the pro Brief (gap G6).
//
//   "Client wants [what she tapped] because the goal is [why]. Must preserve
//    [keep] and avoid [avoids]."
//
// Deterministic and pure: no model call, no database. Every phrase comes from
// lib/brand/consultProBriefTopLineCopy.ts or, for a region she tapped on the
// reference, from the inspiration copy's own short names — the same table the
// client's understanding check reads, so the pro and the client are shown the
// same words for the same tap. A clause with no evidence behind it is omitted;
// nothing is ever filled in, and no internal code can reach the sentence
// because the copy tables are keyed BY code and hold only words.
//
// It is composed at READ time in lib/consult/proBrief.ts, not stored in the
// Brief payload: that payload is re-derived and byte-compared on every read
// (lib/consult/immutableResult.ts), so a new field there would invalidate every
// Brief already written.
//
// `reason_now` (C2-6c) does not exist yet. When it lands it becomes a third
// input to the "because" clause; the sentence reads correctly without it.

import {
  consultProBriefTopLineCopy,
  type ConsultProBriefTopLineCopy,
} from '@/lib/brand/consultProBriefTopLineCopy'
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import type { BrandClientConsultInspirationCopy } from '@/lib/brand/types'
import type {
  ConsultBriefClientIntakeItemDTO,
  ConsultInspirationExactDetailDTO,
  ConsultInspirationSourceDTO,
} from '@/lib/dto/consult'

import {
  KEEP_AS_IS_KEY,
  PREP_CARD_ATTRIBUTES,
  SPARK_FOCUS_KEY,
} from './inspiration/cardQuestions'
import {
  deriveConsultInspirationPreferences,
  joinClauses,
  type ConsultInspirationCardReading,
} from './inspiration/cards'
import type { ConsultInspirationPackDefinition } from './inspiration/types'
import { resolveVisualDialogueQuestion } from './inspiration/visualDialogue'

/** The card taps behind one Brief, as the read path already has them. */
export type ConsultBriefTopLineInspiration = {
  source: ConsultInspirationSourceDTO
  /** Null on contract v1, which asked the seven fixed questions, not cards. */
  pack: ConsultInspirationPackDefinition | null
  /** The reading of THIS Brief's reference, or null when there is none. */
  reading: ConsultInspirationCardReading | null
  /** Question key -> selected values. */
  answers: Readonly<Record<string, readonly string[]>>
  /** Only read on contract v1, whose answers already carry their labels. */
  exactClientDetails: readonly ConsultInspirationExactDetailDTO[]
}

export type ConsultBriefTopLineArgs = {
  inspiration: ConsultBriefTopLineInspiration | null
  clientIntake: readonly Pick<
    ConsultBriefClientIntakeItemDTO,
    'questionKey' | 'answerCode'
  >[]
  copy?: ConsultProBriefTopLineCopy
  inspirationCopy?: BrandClientConsultInspirationCopy
}

const LOOK_MATCH_KEY = 'look_match'
const KEEP_NATURAL_VALUE = 'keep-natural'
const WHOLE_THING_VALUE = 'the-whole-thing'

/** `tone:COOL` → ['tone', 'COOL']; anything else → null. */
const PAIR_PATTERN = new RegExp(
  `^(${PREP_CARD_ATTRIBUTES.join('|')}):([A-Z0-9_]+)$`,
)

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template,
  )
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)]
}

/**
 * A tapped region in words. The short name is the reading's own description
 * of THIS photograph ("cool, silvery cast"); the fallback names the attribute
 * without describing it, and is only reached for a value the short-name table
 * does not carry.
 */
function regionName(
  pair: string,
  attribute: string,
  copy: ConsultProBriefTopLineCopy,
  inspirationCopy: BrandClientConsultInspirationCopy,
): string | null {
  const short = inspirationCopy.cards.attributeShortNames[pair]
  if (short) return fill(copy.regionWant, { name: short })
  return inspirationCopy.cards.attributeFallbackNames[attribute] ?? null
}

type Clauses = {
  wants: string[]
  avoids: string[]
  keep: string[]
  lookMatch: string | null
}

function inspirationClauses(
  inspiration: ConsultBriefTopLineInspiration,
  copy: ConsultProBriefTopLineCopy,
  inspirationCopy: BrandClientConsultInspirationCopy,
): Clauses {
  const clauses: Clauses = { wants: [], avoids: [], keep: [], lookMatch: null }
  let wholeThing = false

  if (inspiration.pack) {
    const { pack, answers, reading } = inspiration
    for (const value of answers[SPARK_FOCUS_KEY] ?? []) {
      if (value === WHOLE_THING_VALUE) wholeThing = true
      const phrase = copy.sparkFocus[value]
      if (phrase) clauses.wants.push(phrase)
    }

    // The same interpretation the analysis and the understanding check
    // receive, including archived per-attribute cards: an `attribute:VALUE`
    // pair only for an attribute the reading actually settled, so a tap on a
    // region this photograph never answered contributes nothing.
    const preferences = deriveConsultInspirationPreferences({
      pack,
      reading,
      copy: inspirationCopy,
      answers,
    })
    for (const [source, target] of [
      [preferences.wants, clauses.wants],
      [preferences.avoids, clauses.avoids],
    ] as const) {
      for (const entry of source) {
        const match = PAIR_PATTERN.exec(entry)
        if (!match?.[1]) continue
        const name = regionName(entry, match[1], copy, inspirationCopy)
        if (name) target.push(name)
      }
    }

    for (const value of answers[KEEP_AS_IS_KEY] ?? []) {
      const phrase = copy.keep[`${KEEP_AS_IS_KEY}:${value}`]
      if (phrase) clauses.keep.push(phrase)
    }
    // The v5 root card's "keep my natural root color" — read only when that
    // card was actually shown to her, which is the card's own rule.
    for (const question of pack.questions) {
      if (!question.visualDialogue) continue
      if (!answers[question.key]?.includes(KEEP_NATURAL_VALUE)) continue
      if (!resolveVisualDialogueQuestion(question, answers, reading)) continue
      const phrase = copy.keep[`${question.key}:${KEEP_NATURAL_VALUE}`]
      if (phrase) clauses.keep.push(phrase)
    }

    const lookMatch = answers[LOOK_MATCH_KEY]?.[0]
    clauses.lookMatch = lookMatch ? (copy.lookMatch[lookMatch] ?? null) : null
  } else {
    // Contract v1 stored the label she chose beside the value, and its
    // questions are not cards, so its details are already words.
    for (const detail of inspiration.exactClientDetails) {
      if (detail.sentiment === 'LIKE') clauses.wants.push(lowerFirst(detail.clientWords))
      else if (detail.sentiment === 'DISLIKE') clauses.avoids.push(lowerFirst(detail.clientWords))
    }
  }

  // A region she both loved and would change is a question for the pro, not
  // a want — the understanding check gives it its own clause; here it is left
  // out of both lists rather than asserted either way.
  const contested = new Set(clauses.wants.filter((item) => clauses.avoids.includes(item)))
  clauses.wants = unique(clauses.wants.filter((item) => !contested.has(item)))
  clauses.avoids = unique(clauses.avoids.filter((item) => !contested.has(item)))
  clauses.keep = unique(clauses.keep)

  // She brought a picture and pointed at it as a whole, or at nothing the
  // reading could settle: the picture itself is the want.
  if (inspiration.source !== 'NONE' && (wholeThing || clauses.wants.length === 0)) {
    clauses.wants = unique([copy.overallLook, ...clauses.wants])
  }
  return clauses
}

/**
 * ONE sentence pair for this Brief version, or null when nothing the client
 * said supports a single clause.
 */
export function composeConsultBriefTopLine(args: ConsultBriefTopLineArgs): string | null {
  const copy = args.copy ?? consultProBriefTopLineCopy
  const inspirationCopy = args.inspirationCopy ?? defaultClientConsultInspirationCopy
  const clauses: Clauses = args.inspiration
    ? inspirationClauses(args.inspiration, copy, inspirationCopy)
    : { wants: [], avoids: [], keep: [], lookMatch: null }

  const intake = new Map(args.clientIntake.map((item) => [item.questionKey, item.answerCode]))
  const scale = copy.changeScale[intake.get('change_scale') ?? ''] ?? null
  const direction = copy.goalDirection[intake.get('goal_direction') ?? ''] ?? null
  const upkeep = copy.maintenanceAvoid[intake.get('maintenance_tolerance') ?? ''] ?? null
  if (upkeep) clauses.avoids = unique([...clauses.avoids, upkeep])

  const goal =
    scale && direction
      ? fill(copy.goalScaleAndDirection, { scale, direction })
      : (scale ?? direction)

  let first: string | null = null
  if (clauses.wants.length > 0) {
    first =
      fill(copy.wants, { wants: joinClauses(clauses.wants, copy.conjunction) }) +
      (clauses.lookMatch ?? '') +
      (goal ? fill(copy.because, { goal }) : '')
  } else if (goal) {
    first = fill(copy.goalOnly, { goal })
  }

  let second: string | null = null
  const keep = joinClauses(clauses.keep, copy.conjunction)
  const avoids = joinClauses(clauses.avoids, copy.conjunction)
  if (keep && avoids) second = fill(copy.preserveAndAvoid, { keep, avoids })
  else if (keep) second = fill(copy.preserve, { keep })
  else if (avoids) second = fill(copy.avoid, { avoids })

  const sentences = [first, second].filter((sentence): sentence is string => sentence !== null)
  return sentences.length > 0 ? sentences.map((sentence) => `${sentence}.`).join(' ') : null
}
