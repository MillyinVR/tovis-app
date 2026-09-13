// lib/consult/testServiceFacts.ts
//
// The diagnostic-fact columns a `ConsultProMenuOffering.service` carries, as a
// fixture default: "we were never told anything about this service".
//
// Exists so a test menu is one spread rather than seven repeated literals, and
// so ADDING a fact later is one edit here instead of a sweep through every
// consult suite. A test that cares about a fact overrides it explicitly, which
// also makes the ones that matter to that test visible at a glance.
export const UNSPECIFIED_SERVICE_FACTS = {
  consultSummary: null,
  maxLiftLevels: null,
  depositsTone: false,
  isChemical: false,
  changesShape: false,
  addsLength: false,
  limitations: null,
} as const
