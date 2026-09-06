import type { BrandClientConsultPlanDiffCopy } from './types'

// P7a-3 — how a change to the plan is described, to the client and to the pro.
//
// One table for both, deliberately: the whole point of a versioned Brief is
// that "your plan went from one visit to two" and what the pro reads about the
// same change are the same sentence. Two tables would be two sentences within a
// release of each other.
//
// Voice rules (handoff Part 2): plain nouns, nothing that presumes knowledge,
// no jargon before its picture. "Level" survives because the plan card has
// already shown her the number next to her own hair.
export const defaultClientConsultPlanDiffCopy: BrandClientConsultPlanDiffCopy = {
  achievabilityLabel: 'How big a job it is',
  stepsLabel: 'What we’d do',
  safetyLabel: 'Things to talk through',
  baseLevelLabel: 'Where your roots are now',
  lightestLevelLabel: 'Your lightest bits now',

  // An arrow, not a comma: the steps are ordered, and a comma reads as a set.
  stepSeparator: ' → ',

  achievabilitySingle: 'One visit',
  achievabilityMulti: 'More than one visit',
  achievabilityAssessment: 'Your pro will need to see it first',
  achievabilityUnknown: 'Not clear yet',
}
