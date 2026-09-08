import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { runConsultInspirationVision } from '@/lib/consult/inspirationVision'
import { buildConsultInspirationCards } from '@/lib/consult/inspiration/cards'
import { HAIR_COLOR_INSPIRATION_CARD_PACK as pack } from '@/lib/consult/inspiration/packs/hairColor'
import { defaultClientConsultInspirationCopy as copy } from '@/lib/brand/defaultClientConsultInspirationCopy'

/** One synthetic reference through the real reader and the production card builder.
 * This is a reachability/localization smoke check, not a stylist-quality benchmark.
 */
it('a real reference reading produces located visual questions', async () => {
  const reference = 'eval/consult/hair-color/v1/fixtures/synthetic-i-hair_back.jpg'
  const result = await runConsultInspirationVision({
    image: { base64: readFileSync(reference).toString('base64'), mediaType: 'image/jpeg' },
  })
  const cards = buildConsultInspirationCards({
    pack, copy, reading: result.analysis, professionalDisplayName: 'Sam',
    answers: { spark_focus: ['the-color'], keep_as_is: ['my-length'], look_match: ['adapt-selected-parts'] },
  }).coarse.filter((card) => card.attribute !== null)
  expect(cards.length).toBeGreaterThan(0)
  for (const card of cards) {
    expect(card.region).not.toBeNull()
    expect(card.region!.w).toBeGreaterThan(0)
    expect(card.region!.h).toBeGreaterThan(0)
    expect(card.question.options.length).toBeGreaterThan(1)
  }
  if (process.env.TOVIS_VISUAL_EVAL_OUTPUT) {
    mkdirSync(process.env.TOVIS_VISUAL_EVAL_OUTPUT, { recursive: true })
    writeFileSync(path.join(process.env.TOVIS_VISUAL_EVAL_OUTPUT, 'reference-reading.json'), JSON.stringify({ reference, model: result.model, reading: result.analysis, cards }, null, 2))
  }
})
