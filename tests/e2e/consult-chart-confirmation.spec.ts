import { expect, test } from '@playwright/test'
import { cardInspiration, CONSULT_FIXTURE_ID, threadFixture } from './fixtures/consultInspiration'
import { defaultClientConsultThreadCopy as copy } from '@/lib/brand/defaultClientConsultThreadCopy'

test('dated chart review persists the explicit choice and resumes the thread', async ({ page }, testInfo) => {
  const base = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`
  const thread = threadFixture({ inspiration: cardInspiration, status: 'INTAKE_IN_PROGRESS' })
  const fingerprint = 'a'.repeat(64)
  thread.messages = [{ kind: 'QUESTION', id: 'chart-review', author: 'APP', state: 'OPEN',
    chartReviewFingerprint: fingerprint, answer: null, packVersion: 4, schemaVersion: 2,
    question: { key: 'chart_review', kind: 'SINGLE_SELECT', requirement: 'REQUIRED',
      label: 'Anything done outside the app since your last visit on August 1, 2026?',
      helpText: 'Please check these chart details before confirming: Box dye? Never (July 30, 2026).',
      options: [{ value: 'CONFIRMED', label: copy.chartReviewConfirm }, { value: 'BOX_DYE_ONLY', label: copy.chartReviewBoxDyeOnly },
        { value: 'CHANGED', label: copy.chartReviewChanged }] } }]
  thread.nextOpenMessageId = 'chart-review'
  await page.route(`**${base}/thread`, route => route.fulfill({ json: { ok: true, thread } }))
  await page.route(`**${base}/chart-review`, async route => {
    expect(route.request().postDataJSON()).toMatchObject({ fingerprint, decision: 'BOX_DYE_ONLY' })
    thread.messages = [{ kind: 'TEXT', id: 'saved', author: 'APP', state: 'DONE', text: 'Your confirmed history is saved.' }]
    thread.nextOpenMessageId = null
    await route.fulfill({ json: { ok: true } })
  })
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  const card = page.locator('[data-thread-message="chart-review"]')
  await expect(card).toContainText('July 30, 2026')
  const box = await card.boundingBox()
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
  await card.screenshot({ path: testInfo.outputPath('chart-confirmation.png') })
  await card.getByRole('button', { name: copy.chartReviewBoxDyeOnly }).click()
  await expect(page.getByText('Your confirmed history is saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Your confirmed history is saved.')).toBeVisible()
})
