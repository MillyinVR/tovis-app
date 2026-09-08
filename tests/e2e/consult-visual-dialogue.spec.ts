import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { defaultClientConsultInspirationCopy as copy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { buildConsultInspirationCards } from '@/lib/consult/inspiration/cards'
import { HAIR_COLOR_INSPIRATION_CARD_PACK as pack } from '@/lib/consult/inspiration/packs/hairColor'
import { applyConsultInspirationReopen, evaluateConsultInspirationProgress } from '@/lib/consult/inspiration/registry'
import type { ConsultInspirationAnalysisAttributesDTO, ConsultInspirationStateDTO } from '@/lib/dto/consult'
import { cardInspiration, CONSULT_FIXTURE_ID, threadFixture } from './fixtures/consultInspiration'

const base = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`
function observed<T extends string>(value: T, region = { x: 0.3, y: 0.5, w: 0.4, h: 0.35 }) {
  return { value, region, confidence: { min: 0.4, max: 0.65 }, evidence: ['inspiration' as const] }
}
// Synthetic fixture with separate root and length rectangles; this test checks
// rendered geometry and interaction, not the quality of a model's localization.
const reading: ConsultInspirationAnalysisAttributesDTO = {
  baseLevel: observed('LEVEL_6', { x: 0.35, y: 0.05, w: 0.3, h: 0.2 }),
  lightestLevel: observed('LEVEL_9'), tone: observed('NEUTRAL'),
  rootBlend: observed('SHADOW_ROOT', { x: 0.3, y: 0.07, w: 0.4, h: 0.22 }),
  technique: observed('UNKNOWN'), placement: observed('MIDS_TO_ENDS'),
  finish: observed('UNKNOWN'), dimension: observed('MEDIUM'),
}

test('walks root crops into length crops using the server questions and remembers each choice', async ({ page }) => {
  let answers: Record<string, readonly string[]> = { spark_focus: ['the-color'], keep_as_is: ['my-length'], look_match: ['adapt-selected-parts'] }
  const submissions: string[] = []
  function state(): ConsultInspirationStateDTO {
    const cards = buildConsultInspirationCards({ pack, answers, reading, copy, professionalDisplayName: 'Susie' }).coarse
    const progress = evaluateConsultInspirationProgress(pack, answers, copy, null, reading)
    return { ...cardInspiration, source: cardInspiration.source ? { ...cardInspiration.source, analysisReady: true } : null,
      progress: { ...progress, requiredSpecificDetailCount: 0 },
      cards: cards.filter((card) => card.selectedValues.length > 0 || card.questionKey === progress.currentQuestion?.key),
    }
  }
  await page.route(`**${base}/thread`, (route) => route.fulfill({ json: { ok: true, thread: threadFixture({ inspiration: state() }) } }))
  await page.route(`**${base}/inspiration/media`, (route) => route.fulfill({ json: { ok: true, url: 'https://storage.test/reference.jpg', expiresInSeconds: 600 } }))
  await page.route('https://storage.test/**', (route) => route.fulfill({ contentType: 'image/jpeg', body: readFileSync('eval/consult/hair-color/v1/fixtures/synthetic-i-hair_back.jpg') }))
  await page.route(`**${base}/inspiration/answers`, async (route) => {
    const input: { questionKey: string; selectedValues: string[] } = route.request().postDataJSON()
    const question = pack.questions.find((q) => q.key === input.questionKey)!
    submissions.push(input.questionKey)
    answers = applyConsultInspirationReopen(question, input.selectedValues, answers)
    await route.fulfill({ json: { ok: true, state: state(), replayed: false } })
  })
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  const roots = page.getByRole('button', { name: 'Keep my natural root color', exact: true })
  await expect(roots).toBeVisible()
  const rootCrop = page.getByRole('button', { name: 'Color to consider for your roots — tap to see the whole photo', exact: true })
  const rootSize = await rootCrop.evaluate((element) => getComputedStyle(element).backgroundSize)
  await roots.click()
  await page.getByRole('button', { name: 'Next', exact: true }).last().click()
  await expect(page.getByText('Looking here, where would you like the brightness to start?', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Closer to my roots', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'A gradual change from dark to light near my scalp', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).last().click()
  await expect(page.getByText('How do you feel about how light this part is?', { exact: true })).toBeVisible()
  const endsCrop = page.getByRole('button', { name: 'The lightest part — tap to see the whole photo', exact: true })
  const endsSize = await endsCrop.evaluate((element) => getComputedStyle(element).backgroundSize)
  expect(endsSize).not.toBe(rootSize)
  expect(submissions).toEqual(['color_roots', 'color_root_blend'])
  await endsCrop.scrollIntoViewIfNeeded()
  const lightnessCard = page.getByTestId('consult-inspiration-card-prompt').filter({ hasText: 'How do you feel about how light this part is?' }).locator('..')
  await lightnessCard.screenshot({ path: test.info().outputPath('visual-dialogue.png') })
  await page.getByRole('button', { name: 'A little less light for me', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).last().click()
  await expect(page.getByText('Is it this particular shade you like, or would you change the shade?', { exact: true })).toBeVisible()
})
