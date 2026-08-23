// lib/consult/providerModel.ts
//
// Allowlist for the consult provider-model env overrides
// (`AI_CONSULT_ANALYSIS_MODEL`, `AI_CONSULT_CAPTURE_MODEL`). Client photos are
// sent to whatever model these resolve to, so an env typo must fail the call
// closed rather than silently routing photos to an unintended model. The list
// is deliberately exactly the pinned pilot model (the checked-in default of
// both engines); any different model must be added here in a reviewed change,
// never by env alone.

export const CONSULT_PROVIDER_MODEL_ALLOWLIST: readonly string[] = [
  'claude-sonnet-5',
]

export function isAllowedConsultProviderModel(model: string): boolean {
  return CONSULT_PROVIDER_MODEL_ALLOWLIST.includes(model)
}
