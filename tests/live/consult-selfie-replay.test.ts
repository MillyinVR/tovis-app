// tests/live/consult-selfie-replay.test.ts
//
// 🔴 A REPLAY OF A REAL PRODUCTION CONSULT, against the real model.
//
// The measurement this exists for. Session cmtymyxha0006jx04coexgpu2 in
// production is a SELFIE-ONLY consult: exactly one capture, an `early_photo`
// carrying WARM_INDOOR_LIGHT. Two analyses were stored from it under prompt
// v9, and both came back:
//
//   profile known ......... 5/12 (rev 20) and 6/12 (rev 22)
//   always UNKNOWN ........ colorSeason, eyeShape, eyeSpacing,
//                           faceProportion, foreheadProportion, jawline
//   style directions ...... 7 of 7 the literal "place holder" (rev 20)
//   look plan ............. PRO_REVIEW with ZERO paths (both)
//
// Meanwhile the face-colour COMPANION read 8 of its 9 observations from the
// SAME photograph, including `chinContour` and `faceWidthBalance` — geometry
// the profile call reported as UNKNOWN. The only difference was one sentence
// in the prompt. v10 gives the profile call that sentence.
//
// So this run has a falsifiable prediction:
//   * geometry (jawline, faceProportion, foreheadProportion, eyeShape,
//     eyeSpacing) should now be READ, not UNKNOWN
//   * colorSeason and skinUndertone should STAY unknown — a warm room really
//     does invent those, and v10 says so explicitly
//   * the look plan should return at least one PATH
//
// It is not asserted as a pass/fail gate on the model's judgement: it PRINTS
// the comparison and fails only on the structural claims the code controls.
//
//   ANTHROPIC_API_KEY=… npx vitest run tests/live/consult-selfie-replay.test.ts \
//     --config vitest.live.config.mts
//
// Costs real money (~$0.10). Needs TOVIS_LIVE_CONSULT_REPLAY=1 and the photo
// at tests/live/.fixtures/selfie.jpg, which is NOT committed — it is a real
// client's face. Download it from the private bucket before running.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { ConsultServiceFamily } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { runConsultAnalysis } from '@/lib/consult/analysisEngine'
import { HAIR_COLOR_CAPTURE_PACK } from '@/lib/consult/capture/packs/hairColorDaylight'

const PHOTO = join(process.cwd(), 'tests', 'live', '.fixtures', 'selfie.jpg')
const ENABLED = process.env.TOVIS_LIVE_CONSULT_REPLAY === '1' && existsSync(PHOTO)

/** What production actually stored from this photograph, under v9. */
const BASELINE_UNKNOWN = [
  'colorSeason', 'eyeShape', 'eyeSpacing',
  'faceProportion', 'foreheadProportion', 'jawline',
] as const
/** The five v10 is meant to unlock. colorSeason is deliberately NOT one. */
const GEOMETRY = ['jawline', 'faceProportion', 'foreheadProportion', 'eyeShape', 'eyeSpacing'] as const

/** The real intake from that session (hair-general v3). */
const INTAKE: Record<string, string> = {
  change_scale: 'noticeable',
  goal_direction: 'length',
  prior_reaction: 'no',
  chemical_history: 'within-6-months',
  prior_lightening: 'over-12-months',
  maintenance_tolerance: 'high',
}

/** The pro's real production menu, with the diagnostic facts #1169 added. */
const MENU = [
  { name: 'Full Head Highlight', consultSummary: 'Lightened pieces woven throughout the whole head for overall brightness.', maxLiftLevels: 4, depositsTone: true, isChemical: true, changesShape: false, addsLength: false, limitations: 'Lightens pieces, not the base between them.' },
  { name: 'Partial Highlight', consultSummary: 'Lightened pieces through the top and sides, where the light hits.', maxLiftLevels: 4, depositsTone: true, isChemical: true, changesShape: false, addsLength: false, limitations: 'Covers the top and face-framing sections only.' },
  { name: 'Root touch up', consultSummary: 'Covers regrowth at the root, matched to the existing colour.', maxLiftLevels: 1, depositsTone: true, isChemical: true, changesShape: false, addsLength: false, limitations: 'Treats the regrowth only.' },
  { name: 'Toner', consultSummary: 'Adjusts and refines tone — takes brassiness down, evens the result.', maxLiftLevels: 0, depositsTone: true, isChemical: true, changesShape: false, addsLength: false, limitations: 'Cannot lighten hair by even one level.' },
  { name: 'iTip install', consultSummary: 'Individual strands attached with small beaded tips, for added length and fullness.', maxLiftLevels: 0, depositsTone: false, isChemical: false, changesShape: false, addsLength: true, limitations: 'Adds length and density. Does not change the colour of her own hair.' },
  { name: 'iTip Maintenance', consultSummary: 'Moves grown-out iTip strands back up to the root.', maxLiftLevels: 0, depositsTone: false, isChemical: false, changesShape: false, addsLength: true, limitations: 'Maintains an existing install; adds no new hair.' },
  { name: 'Cut', consultSummary: 'Shapes the hair she already has: length, weight and silhouette.', maxLiftLevels: 0, depositsTone: false, isChemical: false, changesShape: true, addsLength: false, limitations: 'Changes shape only. Cannot add length.' },
].map((service, index) => ({
  id: `offering-${index}`, serviceId: `service-${index}`,
  offersInSalon: true, offersMobile: false,
  salonPriceStartingAt: null, salonDurationMinutes: null,
  mobilePriceStartingAt: null, mobileDurationMinutes: null,
  service: { ...service, description: null, categoryId: 'cat-hair', defaultDurationMinutes: 90 },
}))

describe.skipIf(!ENABLED)('the real selfie, replayed against the live model', () => {
  it('reads the geometry v9 refused, and returns a bookable path', { timeout: 600_000 }, async () => {
    const result = await runConsultAnalysis({
      service: {
        family: ConsultServiceFamily.HAIR,
        categoryName: 'Hair',
        serviceName: null,
        menuServiceNames: MENU.map((offering) => offering.service.name),
        menuOfferings: MENU as never,
        lookPlanning: true,
      },
      intake: INTAKE,
      intakeItems: Object.entries(INTAKE).map(([questionKey, answerCode]) => ({
        questionKey, answerCode, question: questionKey, answer: answerCode,
      })),
      capturePack: { id: HAIR_COLOR_CAPTURE_PACK.id, shotKeys: HAIR_COLOR_CAPTURE_PACK.shots.map((shot) => shot.key) },
      captures: [{
        shotKey: 'early_photo',
        image: { base64: readFileSync(PHOTO).toString('base64'), mediaType: 'image/jpeg' },
        qualityWarningCode: 'WARM_INDOOR_LIGHT',
      }] as never,
      inspiration: { source: 'NONE', analysis: null, answers: [], wants: [], avoids: [], unsure: [], keep: [] } as never,
      safetyCodes: [],
    })

    const profile = result.analysis.profile as Record<string, { value: string; confidence: { min: number; max: number }; evidence: string[] }>
    const known = Object.entries(profile).filter(([, o]) => o?.value && o.value !== 'UNKNOWN')

    console.log(`\n── PROFILE ${known.length}/${Object.keys(profile).length} known (v9 stored 5/12 and 6/12) ──`)
    for (const [field, o] of Object.entries(profile)) {
      const flag = (GEOMETRY as readonly string[]).includes(field) ? ' ←' : ''
      console.log(`  ${field.padEnd(20)} ${String(o?.value).padEnd(18)} ${o?.confidence?.min}–${o?.confidence?.max}  [${o?.evidence?.join(',')}]${flag}`)
    }
    const geometryRead = GEOMETRY.filter((f) => profile[f]?.value && profile[f]!.value !== 'UNKNOWN')
    console.log(`\n  GEOMETRY v10 targets: ${geometryRead.length}/${GEOMETRY.length} read — ${geometryRead.join(', ') || 'NONE'}`)
    console.log(`  v9 baseline for these: 0/${GEOMETRY.length}`)

    const directions = result.analysis.styleDirections ?? []
    const placeholders = directions.filter((d) =>
      /place\s*holder/i.test(`${d.title} ${d.direction} ${d.whyItFlatters}`))
    console.log(`\n── STYLE DIRECTIONS ${directions.length}, placeholders ${placeholders.length} (v9 rev 20: 7/7) ──`)
    for (const d of directions) console.log(`  ${d.domain}: ${d.title} — ${d.direction.slice(0, 90)}`)

    const plan = result.analysis.lookPlan
    console.log(`\n── LOOK PLAN ── blocker=${plan?.blocker} tier=${plan?.tier} paths=${plan?.paths.length ?? 0} (v9: 0 paths, PRO_REVIEW)`)
    for (const path of plan?.paths ?? []) {
      console.log(`  • ${path.title}`)
      path.visits.forEach((v, i) => console.log(`      visit ${i + 1}: ${v.services.join(' + ')}`))
    }
    console.log(`  nextStep: ${plan?.nextStep}`)
    console.log(`  model: ${result.model}\n`)

    // The structural claims this repo controls, as assertions. The model's
    // judgement is printed above and read by a human, not gated here.
    expect(result.analysis.profile).toBeTruthy()
    expect(directions.length).toBe(7)
  })
})
