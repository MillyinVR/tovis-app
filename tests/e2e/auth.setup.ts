import { test as setup, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const AUTH_DIR = path.join(process.cwd(), 'playwright', '.auth')
const CLIENT_AUTH_FILE = path.join(AUTH_DIR, 'client.json')

setup('authenticate client test account', async ({ page }) => {
  await mkdir(AUTH_DIR, { recursive: true })

  await page.goto('/login?from=%2Flooks&reason=booking')

  const emailInput = page
    .locator('input[type="email"], input[name="email"]')
    .first()
  const passwordInput = page
    .locator('input[type="password"], input[name="password"]')
    .first()
  const submitButton = page
    .getByRole('button', { name: /log in|login|sign in/i })
    .first()

  await expect(emailInput).toBeVisible()
  await expect(passwordInput).toBeVisible()
  await expect(submitButton).toBeVisible()

  await emailInput.fill('client@tovis.app')
  await passwordInput.fill('password123')

  await submitButton.click()

  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 15_000,
    }),
    expect(page.getByText(/too many requests/i)).toBeVisible({
      timeout: 15_000,
    }).then(() => {
      throw new Error(
        'Login was rate-limited for client@tovis.app. Wait for the throttle window to clear, then rerun the auth setup.',
      )
    }),
    expect(page.getByText(/invalid|incorrect|unauthorized/i)).toBeVisible({
      timeout: 15_000,
    }).then(() => {
      throw new Error(
        'Login failed for client@tovis.app. Check that the credentials are correct and that the account is active.',
      )
    }),
  ])

  await expect(page.getByRole('link', { name: /log in/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /sign up/i })).toHaveCount(0)

  await page.context().storageState({ path: CLIENT_AUTH_FILE })
})