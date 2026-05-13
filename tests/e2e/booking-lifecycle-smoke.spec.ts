// tests/e2e/booking-lifecycle-smoke.spec.ts
import { expect, test } from '@playwright/test'
import fs from 'node:fs'

const PRO_STORAGE_STATE = process.env.E2E_PRO_STORAGE_STATE ?? ''
const BOOKING_ID = process.env.E2E_LIFECYCLE_BOOKING_ID ?? ''

const hasRequiredSeed =
  PRO_STORAGE_STATE.trim().length > 0 &&
  BOOKING_ID.trim().length > 0 &&
  fs.existsSync(PRO_STORAGE_STATE)

function sessionHref(bookingId: string): string {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/session`
}

function afterPhotosHref(bookingId: string): string {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/session/after-photos`
}

function aftercareHref(bookingId: string): string {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`
}

test.describe('booking lifecycle smoke', () => {
  test.skip(
    !hasRequiredSeed,
    [
      'Requires seeded lifecycle data before running.',
      'Set E2E_PRO_STORAGE_STATE to an authenticated Pro storageState file.',
      'Set E2E_LIFECYCLE_BOOKING_ID to a seeded booking owned by that Pro.',
    ].join(' '),
  )

  test.use({ storageState: PRO_STORAGE_STATE })

  test('Pro can resume lifecycle closeout without direct Complete Session path', async ({
    page,
  }) => {
    await page.goto(sessionHref(BOOKING_ID))

    await expect(page.getByRole('heading', { name: /wrap-up|after photos|finish review|session complete/i })).toBeVisible()

    await expect(page.getByText(/complete session/i)).toHaveCount(0)
    await expect(page.getByText(/finish closeout/i).or(page.getByText(/go to wrap-up/i))).toBeVisible()

    await page.goto(afterPhotosHref(BOOKING_ID))

    await expect(page.getByRole('heading', { name: /after photos/i })).toBeVisible()
    await expect(page.getByText(/upload after photos/i)).toBeVisible()

    await page.goto(aftercareHref(BOOKING_ID))

    await expect(page.getByText(/client-facing/i)).toBeVisible()
    await expect(page.getByText(/send to client|send update to client/i)).toBeVisible()
  })

  test('Pro bookings list exposes active bookings and resume session path', async ({
    page,
  }) => {
    await page.goto('/pro/bookings?status=IN_PROGRESS')

    await expect(page.getByRole('link', { name: /active/i })).toBeVisible()
    await expect(page.getByText(/in progress/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /resume session/i })).toBeVisible()

    const resumeLink = page.getByRole('link', { name: /resume session/i }).first()

    await expect(resumeLink).toHaveAttribute(
      'href',
      new RegExp(`/pro/bookings/[^/]+/session$`),
    )
  })
})