import { expect, test } from '@playwright/test'

test('Home confirms deletion, keeps a failed deletion retryable, and removes only the chosen consult', async ({ page }) => {
  const items = ['first', 'second'].map(id => ({ id, lookPostId: `look-${id}`, professionalId: 'pro', professionalName: `Look ${id}`, updatedAt: '2026-09-07T20:00:00Z', canResume: true }))
  await page.route('**/api/v1/client/consult/sessions', route => route.fulfill({ json: { ok: true, consultations: items, nextCursor: null } }))
  let attempts = 0
  await page.route('**/api/v1/client/consult/first', route => {
    attempts += 1
    return route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { ok: false } : { ok: true, deleted: true } })
  })
  await page.goto('/client')
  const section = page.getByRole('region', { name: 'Your look consultations' })
  await expect(section.getByText('Look first', { exact: true })).toBeVisible()
  const first = section.locator('article').filter({ hasText: 'Look first' })
  await first.getByRole('button', { name: 'Delete consultation', exact: true }).click()
  expect(attempts).toBe(0)
  await first.getByRole('button', { name: 'Keep consultation', exact: true }).click()
  expect(attempts).toBe(0)
  await first.getByRole('button', { name: 'Delete consultation', exact: true }).click()
  await first.getByRole('button', { name: 'Delete consultation', exact: true }).click()
  await expect(first.getByRole('alert')).toBeVisible()
  await first.getByRole('button', { name: 'Delete consultation', exact: true }).click()
  await expect(first).toHaveCount(0)
  await expect(section.getByText('Look second', { exact: true })).toBeVisible()
  await expect(section.getByRole('link', { name: 'Continue consultation' })).toHaveAttribute('href', '/client/consult/second')
  await section.screenshot({ path: test.info().outputPath('consult-home.png') })
})
