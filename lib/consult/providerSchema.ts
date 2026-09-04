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
// ── The second limit: SIZE, which deletion cannot fix ───────────────────────
//
// There are two further ceilings, and they are independent — a schema can pass
// one and fail the other:
//
//   400 The compiled grammar is too large, which would cause performance
//       issues. Simplify your tool schemas or reduce the number of strict
//       tools.
//   400 Schema is too complex for compilation. Try reducing the number of
//       tools or simplifying tool schemas.
//
// Neither is a keyword to strip; both are schema DESIGN constraints. They are
// what kept `runConsultAnalysis` from ever completing: its output schema was
// roughly 2.4x over budget, and no single-call arrangement of its fields fits
// (measured 2026-09-04 — the slimmest one-call design hits the first ceiling,
// and the maximally-shared variant hits the second).
//
// Measured cost model, `claude-sonnet-5`, 2026-09-04. The unit is one required
// property holding an enum; a schema carries about 72 of them. Found by
// bisecting each construct against the live API — the 400 is immediate and
// free, so a probe costs nothing but a round trip:
//
//   enum, whether 5 members or 40 ........................ 1
//   string, unbounded or maxLength 120 or 400 ............ 1
//   `const`, a number, an integer ........................ 1
//   nullable integer, pattern-constrained string ......... 2
//   array of enum, whatever the cap ...................... 3
//   `{min, max}` confidence object ....................... 3
//   a whole observation, INLINE .......................... 8
//   the same observation behind `$ref`, per extra site ... 1
//   an UNREFERENCED `$def` ............................... 7
//
// Two consequences, both counter-intuitive:
//
//   * VOCABULARY IS FREE, STRUCTURE IS THE WHOLE COST. A forty-member enum
//     costs what a five-member one does; `maxLength` costs nothing at all.
//     Shortening an enum has never bought anything. Removing an object has.
//   * `$defs` + `$ref` DEDUPE. Eleven inline copies of one observation are
//     refused; eleven `$ref`s to a single `$def` compile, and so do thirty.
//     A `$def` nothing references still costs full price, so leave none behind.
//
// 🔴 And the trap that comes with sharing: a `$def` carries its constraints to
// every site that references it. Hoisting the analysis evidence array into one
// shared `$def` silently dropped the `minItems: 1` that style directions had
// stated inline — and the live model took the permission, omitting citations
// in four runs out of four. `minItems` survives this boundary at 0 or 1
// exactly, so it is one of the few bounds the grammar can still enforce; where
// two sites need different bounds, they need two `$defs`.
//
// See also the region encoding in `inspirationVision.ts`, where a nullable
// four-number object at seven repetitions was reshaped into a
// pattern-constrained string for the same reason.
//
// ── 🔴 The rule underneath all of this ─────────────────────────────────────
//
// A CONSTRAINT THE GRAMMAR DOES NOT HOLD IS NOT A CONSTRAINT. Six of them were
// found in one sitting (2026-09-04) by sending the real schemas to the real
// model, and the live model violated every single one:
//
//   1. `minimum`/`maximum` on the confidence numbers — STRIPPED, so nothing
//      stated the scale, and the model answered on 0..10.
//   2. `minItems: 1` on style-direction evidence — lost when the array was
//      hoisted into a shared `$def`, and directions came back citing nothing,
//      four runs out of four.
//   3. `minItems: 7` / `maxItems: 7` on the style-direction array — BOTH
//      stripped, so the count was never enforced and fewer than seven came
//      back. Now an object keyed by domain, because `required` DOES survive.
//   4. The safety-code enum — the full vocabulary was offered when the intake
//      could support only part of it, so the model raised a code the policy
//      then refused, discarding a complete paid analysis.
//   5. `maxLength` on the free-text fields — the subtlest, because it is
//      ACCEPTED and therefore looks enforced. It does not bind: a live call
//      returned 255 characters against a 240 limit and 329 against 320.
//   6. And the original: rejected keywords 400ing the request outright.
//
// A seventh sits OUTSIDE the schema entirely and belongs with them, because it
// is the same mistake: `applyConsultSafetyFlagPolicy` requires the service
// lens to contain one of three literal phrases (`unknown`, `not collected`,
// `not provided`) when the intake did not ask, and the prompt only ever said
// "say they are unknown". The live model wrote "was not asked in the intake" —
// honest, accurate, and refused. Intermittently, too, since a different
// synonym came out each run. A rule enforced on an exact string has to state
// that string; asking for the meaning gets you the meaning.
//
// Three ways out, in order of preference:
//   * RESHAPE so the grammar can hold it — `required` on an object instead of
//     `minItems` on an array; a per-run enum instead of a post-hoc filter.
//   * STATE IT IN `description`, which is accepted, costs nothing in the size
//     budget, and demonstrably works — it is what fixed the confidence scale.
//   * KEEP THE SERVER CHECK REGARDLESS. It is what makes the bound true; the
//     schema only decides whether the model finds out before or after you pay.
//
// And the reason none of this was known until now: every consult test mocks
// the provider. `tests/live/consult-provider-schema.test.ts` is the one that
// cannot lie about it.

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
