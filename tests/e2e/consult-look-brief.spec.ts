import { expect, test } from '@playwright/test'
import type { ConsultClientResultsDTO } from '@/lib/dto/consult'
import { cardInspiration, CONSULT_FIXTURE_ID, threadFixture } from './fixtures/consultInspiration'
import profileResults from './fixtures/consultProfileResults.json'
import { plan, brief } from './fixtures/consultLookBrief'

for (const inputsOpen of [true, false]) {
test(`client chooses and confirms the look with first-visit totals (inputs open: ${inputsOpen})`, async ({ page }, testInfo) => {
  const base = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`
  const thread = threadFixture({ inspiration: cardInspiration, status: 'COMPLETED', plan: { version: 1 } })
  thread.controls = { inputsOpen, canEditAnswers: inputsOpen, canDelete: false, revokeAcceptanceId: null }
  let current = { ...structuredClone(brief), inputOpen: inputsOpen }
  function results(): ConsultClientResultsDTO {
    return { ...profileResults as ConsultClientResultsDTO, consultId: CONSULT_FIXTURE_ID, lookPlan: plan, lookBrief: current }
  }
  await page.route(`**${base}/inspiration/media`, route => route.fulfill({ status: 404, json: { ok: false } }))
  await page.route(`**${base}/inspiration/read`, route => route.fulfill({ status: 404, json: { ok: false } }))
  await page.route(`**${base}/thread`, route => {
    for (const message of thread.messages) if (message.kind === 'PLAN') message.results = results()
    return route.fulfill({ json: { ok: true, thread } })
  })
  await page.route(`**${base}/look-plan/choice`, async route => {
    expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: 3, pathIndex: 0, locationType: 'SALON' })
    current = { ...current, version: 4, selectedPathIndex: 0, selectedLocationType: 'SALON', professionalConfirmed: false }
    await route.fulfill({ json: { ok: true, lookBrief: current } })
  })
  await page.route(`**${base}/look-plan/acknowledge`, async route => {
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: 4 })
    current = { ...current, clientConfirmed: true }
    await route.fulfill({ json: { ok: true, lookBrief: current } })
  })
  await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
  const card = page.getByRole('region', { name: 'Your look plan' })
  await expect(card).toContainText('First appointment: $180.00 · 90 min')
  await expect(card).toContainText('Whole transformation: $360.00 · 180 min')
  await expect(card).toContainText('Warm and buttery, with your natural root.')
  await expect(card).not.toContainText('Internal dimensional color service')
  await card.getByRole('button', { name: 'Choose this look' }).click()
  await expect(card).toContainText('Version 4')
  await card.getByRole('button', { name: 'Confirm this look' }).click()
  await expect(card).toContainText('Client confirmed this version.')
  await expect(card).toContainText('Waiting for pro confirmation.')
  await card.screenshot({ path: testInfo.outputPath('confirmed-look.png') })
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
})
}
