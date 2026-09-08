import { expect, test } from '@playwright/test'
import type { ConsultClientResultsDTO } from '@/lib/dto/consult'
import { cardInspiration, CONSULT_FIXTURE_ID, threadFixture } from './fixtures/consultInspiration'
import profileResults from './fixtures/consultProfileResults.json'

// Verify that the chat keeps the detail optional and makes it readable when
// requested, on both desktop and mobile widths.
test('client can expand the photo observations and optional style explanations', async ({ page }, testInfo) => {
  const base = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`
  const thread = threadFixture({ inspiration: cardInspiration, status: 'COMPLETED', plan: { version: 1 } })
  for (const message of thread.messages) {
    if (message.kind === 'PLAN') message.results = profileResults as ConsultClientResultsDTO
  }
  await page.route(`**${base}/inspiration/media`, route => route.fulfill({ status: 404, json: { ok: false } }))
  await page.route(`**${base}/inspiration/read`, route => route.fulfill({ status: 404, json: { ok: false } }))
  await page.route(`**${base}/thread`, route => route.fulfill({ json: { ok: true, thread } }))
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  const details = page.locator('details').filter({ hasText: 'Your feature profile' })
  await expect(details).toBeVisible()
  await expect(details.getByText('Visible eye color', { exact: true })).not.toBeVisible()
  await details.locator('summary').click()
  await expect(details.getByText('Visible eye color', { exact: true })).toBeVisible()
  await expect(details.getByText('brown', { exact: true })).toBeVisible()
  await expect(details).toContainText('Your preferences come first.')
  const firstDirection = profileResults.styleDirections[0]
  if (!firstDirection) throw new Error('The profile fixture needs a style direction')
  await expect(details).toContainText(firstDirection.whyItFlatters)
  await details.getByText('Visible eye color', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('profile-details.png') })
  const box = await details.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
})
