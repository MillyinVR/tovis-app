import type { ConsultInspirationAnalysisAttributesDTO, ConsultInspirationAnalysisFieldDTO } from '@/lib/dto/consult'

/**
 * How sure the reading has to be before a prep card is built from it.
 *
 * The reading answers with a RANGE (`{min, max}`), and this is a floor on the
 * LOW end: "I am at least this sure". A card is a sentence put in front of a
 * client as a description of her reference, so a reading the model itself
 * disclaimed has no business being said out loud. Such an attribute is not
 * silently dropped — it becomes the "we couldn't tell yet" clause in the
 * understanding check, which is the honest version of the same information.
 *
 * 🔴 0.35, and the number is CALIBRATED, not picked. The only inspiration
 * confidences this repo records are 0.4–0.65 for an observation the model made
 * and 0.05–0.3 for one it did not (the shape asserted in
 * tests/live/consult-provider-schema.test.ts and produced by the integration
 * fakes). A floor of 0.5 — the obvious guess, and the one this was first
 * written as — sits ABOVE the low end of a perfectly good reading, so every
 * prep card would have been suppressed and the feature would have looked
 * built and done nothing. The floor's job is only to exclude a KNOWN value the
 * model hedged into the unread band; `value === 'UNKNOWN'` already excludes
 * the rest.
 *
 * ⚠️ NOT calibrated against a real corpus of references — there is no such
 * corpus in this repo. It is one named constant so re-cutting it against real
 * readings is one edit and one test.
 */
export const CONSULT_INSPIRATION_PREP_CARD_MIN_CONFIDENCE = 0.35

/** Is this attribute worth showing the client as a card of its own? */
export function consultInspirationAttributeIsCardworthy(
  reading: ConsultInspirationAnalysisAttributesDTO | null,
  attribute: ConsultInspirationAnalysisFieldDTO,
): boolean {
  const observed = reading?.[attribute]
  if (!observed || observed.value === 'UNKNOWN') return false
  return observed.confidence.min >= CONSULT_INSPIRATION_PREP_CARD_MIN_CONFIDENCE
}

