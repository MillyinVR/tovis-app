// lib/services/consultFacts.ts
//
// The consult's DIAGNOSTIC facts about a service — what the work can and
// cannot achieve — as one list, so the admin API, the admin form and anything
// that comes later agree on the field names without repeating them.
//
// 🔴 Why these exist. Measured in production on 2026-09-13: all twelve live
// `Service` rows had an EMPTY description, so the look-plan model was choosing
// a real client's services from a list of BARE NAMES. It had no way to know a
// toner cannot lighten by even one level, or that a highlight is chemical
// work. The facts are what let the consult DIAGNOSE — reason from where her
// hair is to where she wants it — instead of pattern-matching a service name.
//
// 🔴 The admin owns every value (Tori, 2026-09-13). Nothing here is hardcoded
// in the app: `prisma/data/service-consult-facts.sql` only ever fills a field
// nobody has set, so an edit made in the dashboard survives every seed run and
// every deploy.

/** The form/field names the admin surfaces post, in display order. */
export const CONSULT_FACT_FIELDS = [
  'consultSummary',
  'maxLiftLevels',
  'depositsTone',
  'isChemical',
  'changesShape',
  'addsLength',
  'limitations',
] as const

export type ConsultFactField = (typeof CONSULT_FACT_FIELDS)[number]

/** Levels of lightening. The DB CHECK enforces the same bounds. */
export const CONSULT_MAX_LIFT_LEVELS_MIN = 0
export const CONSULT_MAX_LIFT_LEVELS_MAX = 10

/**
 * What each field means, in the admin's words. These are the helper lines
 * under the inputs — write them for a salon owner, not an engineer.
 */
export const CONSULT_FACT_LABELS: Record<ConsultFactField, { label: string; help: string }> = {
  consultSummary: {
    label: 'What this service does',
    help: 'One sentence on what the work achieves. This is for the consultation engine, not the client — the client-facing wording is the description above.',
  },
  maxLiftLevels: {
    label: 'Levels of lightening',
    help: 'How many levels lighter this can take hair. Enter 0 if it cannot lighten at all — a toner or a gloss is 0. Leave blank only if you genuinely do not know. This is the single most important fact: it is what tells the consultation a dark base cannot reach blonde in one visit.',
  },
  depositsTone: {
    label: 'Changes or refreshes tone',
    help: 'Tick for anything that adds or adjusts tone — a gloss, a toner, a deposit-only colour.',
  },
  isChemical: {
    label: 'Chemical work',
    help: 'Tick if this involves colour or texture chemistry. It is what makes the consultation treat her history, patch tests and strand tests as relevant. Anything that lightens is always chemical.',
  },
  changesShape: {
    label: 'Cuts or reshapes',
    help: 'Tick if this changes the cut, shape or silhouette.',
  },
  addsLength: {
    label: 'Adds length or density',
    help: 'Tick for extensions and added hair — work that adds hair rather than altering what is already there.',
  },
  limitations: {
    label: 'What it cannot do',
    help: 'The honest limits. This is what stops the consultation promising something this service will never deliver — for example "cannot lighten" or "covers the top sections only".',
  },
}

/**
 * A service that LIGHTENS is chemical work, always. Enforced in the database
 * too (`Service_lift_implies_chemical`); this is the readable version, so an
 * admin is told why rather than shown a 500.
 */
export function consultFactsConflict(facts: {
  maxLiftLevels: number | null
  isChemical: boolean
}): string | null {
  if ((facts.maxLiftLevels ?? 0) > 0 && !facts.isChemical) {
    return 'A service that lightens is chemical work — tick "chemical work" as well, or set levels of lightening to 0.'
  }
  return null
}
