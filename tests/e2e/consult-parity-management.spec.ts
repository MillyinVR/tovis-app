import { expect, test } from '@playwright/test'
import { cardInspiration, CONSULT_FIXTURE_ID, threadFixture } from './fixtures/consultInspiration'
import { defaultClientConsultThreadCopy as copy } from '@/lib/brand/defaultClientConsultThreadCopy'
import type { ConsultThreadQuestionMessageDTO } from '@/lib/dto/consult'

function fixture() {
  const thread = threadFixture({ inspiration: cardInspiration, status: 'MEDIA_READY' })
  const question: ConsultThreadQuestionMessageDTO = { kind: 'QUESTION', id: 'intake:box_dye_history', author: 'APP', state: 'DONE',
    answer: 'never', packVersion: 4, schemaVersion: 2,
    question: { key: 'box_dye_history', label: 'Have you used box dye?', helpText: null, kind: 'SINGLE_SELECT', requirement: 'REQUIRED',
      options: [{ value: 'never', label: 'Never' }, { value: 'yes', label: 'Yes, I have' }] } }
  thread.messages = [question]
  thread.nextOpenMessageId = null
  thread.controls = { inputsOpen: true, canEditAnswers: true, canDelete: true, revokeAcceptanceId: 'acceptance-1' }
  return { thread, question }
}
const base = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`

test('edit answers preserves the complete revision, survives reload, and fits a phone', async ({ page }, testInfo) => {
  const { thread, question } = fixture()
  await page.route(`**${base}/thread`, route => route.fulfill({ json: { ok: true, thread } }))
  await page.route(`**${base}/intake`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, intake: { latestRevision: { complete: true, answers: { box_dye_history: question.answer, hidden_history: 'preserved' } } } } })
    expect(route.request().postDataJSON()).toMatchObject({ complete: true, answers: { box_dye_history: 'yes', hidden_history: 'preserved' }, packVersion: 4, schemaVersion: 2 })
    question.answer = 'yes'
    await route.fulfill({ json: { ok: true, intake: { latestRevision: { complete: true }, progress: { canComplete: true } } } })
  })
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  await expect(page.getByRole('button', { name: 'Yes, I have', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: copy.management.edit, exact: true }).click()
  await page.getByRole('button', { name: 'Yes, I have', exact: true }).click()
  await expect(page.locator('[data-thread-message="intake:box_dye_history"]')).toContainText('Yes, I have')
  await page.getByRole('button', { name: copy.management.done, exact: true }).click()
  await page.reload()
  await expect(page.locator('[data-thread-message="intake:box_dye_history"]')).toContainText('Yes, I have')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('consult-parity-management.png'), fullPage: true })
})

test('deletion needs confirmation, preserves a failed attempt, and then returns Home', async ({ page }) => {
  const { thread } = fixture()
  await page.route(`**${base}/thread`, route => route.fulfill({ json: { ok: true, thread } }))
  let attempts = 0
  await page.route(`**${base}`, route => { attempts++; return route.fulfill({ status: attempts === 1 ? 503 : 200, json: { ok: attempts > 1 } }) })
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  await page.getByRole('button', { name: copy.homeSessions.delete, exact: true }).click()
  expect(attempts).toBe(0)
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: copy.homeSessions.keep }).click()
  expect(attempts).toBe(0)
  await page.getByRole('button', { name: copy.homeSessions.delete, exact: true }).click()
  await dialog.getByRole('button', { name: copy.homeSessions.delete, exact: true }).click()
  await expect(page.getByText(copy.homeSessions.failed, { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: copy.homeSessions.delete, exact: true }).click()
  await expect(page).toHaveURL(/\/client$/)
})

test('consent revocation is explicit and the closed response removes input controls', async ({ page }) => {
  const { thread } = fixture()
  await page.route(`**${base}/thread`, route => route.fulfill({ json: { ok: true, thread } }))
  let revoked = false
  await page.route(`**${base}/agreements/revoke`, route => {
    expect(route.request().postDataJSON()).toMatchObject({ acceptanceId: 'acceptance-1' })
    revoked = true
    thread.controls = { inputsOpen: false, canEditAnswers: false, canDelete: true, revokeAcceptanceId: null }
    thread.messages = [{ kind: 'TEXT', id: 'stopped', author: 'APP', state: 'DONE', text: 'You stopped this consultation.' }]
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  await page.getByRole('button', { name: copy.management.revoke, exact: true }).click()
  expect(revoked).toBe(false)
  await page.getByRole('alertdialog').getByRole('button', { name: copy.management.revokeConfirm, exact: true }).click()
  await expect(page.getByText('You stopped this consultation.')).toBeVisible()
  await expect(page.getByRole('button', { name: copy.management.edit, exact: true })).toHaveCount(0)
})

test('booked closed consultations expose neither editing nor deletion', async ({ page }) => {
  const { thread } = fixture()
  thread.controls = { inputsOpen: false, canEditAnswers: false, canDelete: false, revokeAcceptanceId: null }
  await page.route(`**${base}/thread`, route => route.fulfill({ json: { ok: true, thread } }))
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  await expect(page.getByText('Have you used box dye?')).toBeVisible()
  await expect(page.getByRole('button', { name: copy.management.edit, exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: copy.homeSessions.delete, exact: true })).toHaveCount(0)
})

test('editing an inspiration card starts with the saved selection and persists a replacement', async ({ page }) => {
  const inspiration = structuredClone(cardInspiration)
  const card = inspiration.cards?.[0]
  if (!card) throw new Error('Missing inspiration card fixture')
  card.selectedValues = ['the-color']
  const thread = threadFixture({ inspiration })
  thread.controls = { inputsOpen: true, canEditAnswers: true, canDelete: true, revokeAcceptanceId: null }
  thread.messages = thread.messages.filter(message => message.kind === 'INSPIRATION' && message.card?.questionKey === card.questionKey)
  thread.nextOpenMessageId = null
  await page.route(`**${base}/thread`, route => route.fulfill({ json: { ok: true, thread } }))
  await page.route(`**${base}/inspiration/media`, route => route.fulfill({ status: 503, json: { ok: false } }))
  await page.route(`**${base}/inspiration/answers`, route => {
    expect(route.request().postDataJSON()).toMatchObject({ questionKey: 'spark_focus', selectedValues: ['the-shape'], schemaVersion: 2 })
    card.selectedValues = ['the-shape']
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  await page.getByRole('button', { name: copy.management.edit, exact: true }).click()
  const message = page.locator('[data-thread-message="inspiration:spark_focus"]')
  await expect(message.getByRole('button', { name: 'Next', exact: true })).toBeEnabled()
  await message.getByRole('button', { name: 'The shape of it', exact: true }).click()
  await message.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: copy.management.done, exact: true }).click()
  await page.reload()
  await expect(message.getByText('The shape of it', { exact: true })).toBeVisible()
})
