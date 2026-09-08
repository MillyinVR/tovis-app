import { expect, test } from '@playwright/test'
import type { ConsultThreadQuestionMessageDTO } from '@/lib/dto/consult'
import { cardInspiration, CONSULT_FIXTURE_ID, threadFixture } from './fixtures/consultInspiration'
import { clientConsultQuestion } from '@/lib/brand/consultClientQuestionCopy'
import { HAIR_COLOR_INTAKE_PACK } from '@/lib/consult/intake/packs/hairColor'
import fixture from './fixtures/consultClientQuestion.json'
import { consultClientPlanCopy } from '@/lib/brand/consultClientPlanCopy'

test('plain-language treatment history fits a phone and still saves an uncertain answer', async ({ page }, testInfo) => {
  const source = HAIR_COLOR_INTAKE_PACK.questions.find(q => q.key === 'other_chemical_history')!
  const question = clientConsultQuestion(HAIR_COLOR_INTAKE_PACK.id, source)
  expect(question).toEqual(fixture) // Also rendered by the native app tests.
  const message: ConsultThreadQuestionMessageDTO = { kind: 'QUESTION', id: 'intake:other_chemical_history', author: 'APP', state: 'OPEN',
    answer: null, packVersion: HAIR_COLOR_INTAKE_PACK.version, schemaVersion: HAIR_COLOR_INTAKE_PACK.schemaVersion, question }
  const thread = threadFixture({ inspiration: cardInspiration })
  thread.messages = [message]
  thread.nextOpenMessageId = message.id
  const base = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`
  await page.route(`**${base}/thread`, route => route.fulfill({ json: { ok: true, thread } }))
  await page.route(`**${base}/intake`, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, intake: { latestRevision: null } } })
    expect(route.request().postDataJSON()).toMatchObject({ answers: { other_chemical_history: 'not-sure' }, packVersion: HAIR_COLOR_INTAKE_PACK.version })
    message.answer = 'not-sure'; message.state = 'DONE'; thread.nextOpenMessageId = null
    return route.fulfill({ json: { ok: true, intake: { progress: { canComplete: false } } } })
  })
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  await expect(page.getByText(consultClientPlanCopy.pageIntro, { exact: true })).toBeVisible()
  await expect(page.getByText(question.label, { exact: true })).toBeVisible()
  await expect(page.getByText(question.helpText!, { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('client-wording.png'), fullPage: true })
  await page.getByRole('button', { name: 'Not sure', exact: true }).click()
  await expect(page.locator('[data-thread-message="intake:other_chemical_history"]')).toContainText('Not sure')
  await page.reload()
  await expect(page.locator('[data-thread-message="intake:other_chemical_history"]')).toContainText('Not sure')
})
