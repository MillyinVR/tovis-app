// lib/consult/providerSchema.ts
//
// What the Messages API's structured-output validator actually accepts in
// `output_config.format.schema`, and the one place a consult schema is put
// through it before it is sent.
//
// 🔴 This file exists because of a shipped 400. `service-analysis-v3` (and v2
// before it) declared `minimum`/`maximum` on its confidence numbers and the
// hair level, and `maxItems`/`uniqueItems` on its evidence arrays. The API
// rejects all four:
//
//   400 invalid_request_error
//   output_config.format.schema: For 'number' type, properties maximum,
//   minimum are not supported
//
// so `runConsultAnalysis` threw `unavailable` on the FIRST provider call, for
// every consult, and the client saw CONSULT_ANALYSIS_UNAVAILABLE. Measured
// against the live API on 2026-09-04 with `claude-sonnet-5`; the capture gate
// (`captureVision.ts`) was never affected because its schema uses none of
// these keywords, which is why photo checks worked and analysis did not.
//
// Nothing is lost by stripping them: every bound they expressed is re-checked
// on the way back in, by the server, in `sanitizeAnalysis` /
// `sanitizeConsultInspirationAnalysis` — a provider's own schema was never
// what made those bounds true. The keywords stay in the schema constants as
// documentation of intent; this function removes them at the boundary, so a
// future author can keep writing the honest schema and cannot resurrect the
// 400 by adding one back.
//
// Measured support, same run (`claude-sonnet-5`, 2026-09-04):
//   accepted → enum · const · pattern · minLength · maxLength ·
//              `minItems: 0 | 1` · required · additionalProperties ·
//              description · nullable unions (`type: ['object','null']`)
//   rejected → number/integer `minimum` `maximum` `multipleOf` ·
//              array `maxItems` `uniqueItems` · array `minItems` with any
//              value other than 0 or 1 ("'minItems' values other than 0 or 1
//              are not supported (got: [6, ∞])" — v3 asks for exactly seven
//              style directions)
//
// There is a second, separate limit this file cannot fix by deletion: the
// compiled grammar has a size budget, and deeply-nested repeated objects blow
// it ("The compiled grammar is too large"). That is a schema DESIGN
// constraint, not a keyword to strip — see the region encoding in
// `inspirationVision.ts` for how one schema was reshaped to fit.

/** Keywords the structured-output validator rejects, by the type they sit on. */
const UNSUPPORTED_BY_TYPE: ReadonlyArray<{
  types: readonly string[]
  keywords: readonly string[]
}> = [
  { types: ['number', 'integer'], keywords: ['minimum', 'maximum', 'multipleOf'] },
  { types: ['array'], keywords: ['maxItems', 'uniqueItems'] },
]

/** `minItems` survives only at 0 or 1; any other value is rejected outright. */
function minItemsIsSupported(value: unknown): boolean {
  return value === 0 || value === 1
}

function declaredTypes(node: Record<string, unknown>): string[] {
  const type = node.type
  if (typeof type === 'string') return [type]
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === 'string')
  return []
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A deep copy of `schema` with every keyword the API rejects removed.
 *
 * Applied at the call site, to the schema object handed to
 * `output_config.format.schema` — never to the exported constants, which the
 * schema tests and the DB guards still read as the statement of intent.
 */
export function toProviderOutputSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!isPlainObject(value)) return value
    const types = declaredTypes(value)
    const drop = new Set<string>()
    for (const rule of UNSUPPORTED_BY_TYPE) {
      if (types.some((type) => rule.types.includes(type))) {
        for (const keyword of rule.keywords) drop.add(keyword)
      }
    }
    if (types.includes('array') && !minItemsIsSupported(value.minItems)) {
      drop.add('minItems')
    }
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (drop.has(key)) continue
      result[key] = walk(child)
    }
    return result
  }
  const result = walk(schema)
  if (!isPlainObject(result)) {
    // Unreachable for an object input; keeps the return type honest without a
    // cast, which the house rules forbid.
    return {}
  }
  return result
}

/**
 * Every rejected keyword still present anywhere in `schema`, as dotted paths.
 * The test that keeps this file honest asserts this is empty for every schema
 * the consult sends; exported so a new engine can assert the same thing.
 */
export function findUnsupportedProviderSchemaKeywords(
  schema: Record<string, unknown>,
): string[] {
  const found: string[] = []
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (!isPlainObject(value)) return
    const types = declaredTypes(value)
    for (const rule of UNSUPPORTED_BY_TYPE) {
      if (!types.some((type) => rule.types.includes(type))) continue
      for (const keyword of rule.keywords) {
        if (keyword in value) found.push(path ? `${path}.${keyword}` : keyword)
      }
    }
    if (
      types.includes('array') &&
      'minItems' in value &&
      !minItemsIsSupported(value.minItems)
    ) {
      found.push(path ? `${path}.minItems` : 'minItems')
    }
    for (const [key, child] of Object.entries(value)) {
      walk(child, path ? `${path}.${key}` : key)
    }
  }
  walk(schema, '')
  return found
}
