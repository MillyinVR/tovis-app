// tests/e2e/signup.spec.ts
//
// Browser e2e for client and pro signup:
//   pnpm test:e2e:local -- signup.spec.ts
//
// Requirements (all provided by .env.e2e.local):
// - app served against the docker test database (the webServer inherits the
//   dotenv environment when Playwright starts it; do NOT reuse a dev server
//   that was started with .env.local, or signups will hit the dev database
//   and real Twilio/Postmark credentials)
// - Cloudflare Turnstile test keys (always-pass)
// - Twilio/Postmark/DCA left unconfigured so no real provider calls happen
//
// Google geocode/places/timezone proxies are intercepted at the browser
// network layer, so no Google key or network calls are needed for these specs.
// Everything else (register API, Prisma writes, cookies, redirects) is real.

import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

test.use({ storageState: { cookies: [], origins: [] } })

const tag = `e2e_signup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

let emailCounter = 0
let phoneCounter = 0

function nextEmail(label: string): string {
  emailCounter += 1
  return `${tag}_${label}_${emailCounter}@example.com`
}

function nextPhone(): string {
  phoneCounter += 1
  const suffix = (Date.now() + phoneCounter) % 10_000_000
  return `619${String(suffix).padStart(7, '0')}`
}

const GEO = {
  lat: 32.7157,
  lng: -117.1611,
  postalCode: '92101',
  city: 'San Diego',
  state: 'CA',
  countryCode: 'US',
}

async function interceptGoogleProxies(page: Page) {
  await page.route('**/api/google/geocode*', (route) =>
    route.fulfill({ json: { geo: GEO } }),
  )

  await page.route('**/api/google/timezone*', (route) =>
    route.fulfill({ json: { timeZoneId: 'America/Los_Angeles' } }),
  )

  await page.route('**/api/google/places/autocomplete*', (route) =>
    route.fulfill({
      json: {
        predictions: [
          {
            placeId: 'place_e2e_signup',
            description: '123 Main St, San Diego, CA 92101, USA',
            mainText: '123 Main St',
            secondaryText: 'San Diego, CA 92101, USA',
          },
        ],
      },
    }),
  )

  await page.route('**/api/google/places/details*', (route) =>
    route.fulfill({
      json: {
        place: {
          placeId: 'place_e2e_signup',
          name: 'E2E Test Salon',
          formattedAddress: '123 Main St, San Diego, CA 92101',
          ...GEO,
        },
      },
    }),
  )
}

async function fillSharedIdentityFields(
  page: Page,
  args: { email: string; phone: string },
) {
  await page.getByLabel('First name').fill('E2E')
  await page.getByLabel('Last name').fill('Signup')
  await page.getByLabel(/^Phone/).fill(args.phone)
  await page.getByLabel('Email address').fill(args.email)
  await page.getByLabel('Password', { exact: true }).fill('SuperSecret123!')

  await page
    .getByRole('checkbox', { name: /transactional SMS/i })
    .check()
  await page.getByRole('checkbox', { name: /I agree to the Terms/i }).check()
}

async function expectSignedUpAndOnVerifyPhone(page: Page) {
  await page.waitForURL('**/verify-phone**', { timeout: 30_000 })

  const cookies = await page.context().cookies()
  const authCookie = cookies.find((c) => c.name === 'tovis_token')
  expect(authCookie?.value).toBeTruthy()
  expect(authCookie?.httpOnly).toBe(true)
}

test.describe('signup flows', () => {
  test.afterAll(async () => {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) return

    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    try {
      const users = await db.user.findMany({
        where: { email: { contains: tag } },
        select: { id: true },
      })
      const userIds = users.map((u) => u.id)

      const pros = await db.professionalProfile.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      })
      const proIds = pros.map((p) => p.id)

      await db.professionalLocation.deleteMany({
        where: { professionalId: { in: proIds } },
      })
      await db.professionalProfile.deleteMany({
        where: { id: { in: proIds } },
      })
      await db.clientProfile.deleteMany({ where: { userId: { in: userIds } } })
      await db.emailVerificationToken.deleteMany({
        where: { userId: { in: userIds } },
      })
      await db.user.deleteMany({ where: { id: { in: userIds } } })
    } finally {
      await db.$disconnect()
    }
  })

  test('signup chooser routes to the client and pro forms', async ({
    page,
  }) => {
    await page.goto('/signup')

    await page
      .getByRole('link', { name: /I’m a Client — Book services/ })
      .click()
    await page.waitForURL('**/signup/client**')
    await expect(
      page.getByRole('button', { name: 'Create Client Account' }),
    ).toBeVisible()

    await page.goto('/signup')
    await page.getByRole('link', { name: /I’m a Pro — Offer services/ }).click()
    await page.waitForURL('**/signup/pro**')
    await expect(
      page.getByRole('button', { name: 'Create Pro Account' }),
    ).toBeVisible()
  })

  test('client can sign up with a confirmed ZIP and lands on verify-phone', async ({
    page,
  }) => {
    await interceptGoogleProxies(page)
    await page.goto('/signup/client')

    const email = nextEmail('client')
    const phone = nextPhone()

    await page.getByLabel('First name').fill('E2E')
    await page.getByLabel('Last name').fill('Client')

    const zipInput = page.getByLabel(/ZIP code/i)
    await zipInput.fill('92101')
    await zipInput.blur()
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()
    await expect(page.getByText(/San Diego, CA/)).toBeVisible()

    await page.getByLabel(/^Phone/).fill(phone)
    await page.getByLabel('Email address').fill(email)
    await page.getByLabel('Password', { exact: true }).fill('SuperSecret123!')
    await page.getByRole('checkbox', { name: /transactional SMS/i }).check()
    await page
      .getByRole('checkbox', { name: /I agree to the Terms/i })
      .check()

    const submit = page.getByRole('button', { name: 'Create Client Account' })
    await expect(submit).toBeEnabled()
    await submit.click()

    await expectSignedUpAndOnVerifyPhone(page)

    const cookies = await page.context().cookies()
    const zipCookie = cookies.find((c) => c.name === 'tovis_client_zip')
    expect(zipCookie?.value).toBe('92101')
  })

  test('salon pro can sign up by picking an address from autocomplete', async ({
    page,
  }) => {
    await interceptGoogleProxies(page)
    await page.goto('/signup/pro')

    await page.getByRole('combobox').first().selectOption('MAKEUP_ARTIST')
    await page.getByRole('button', { name: 'In salon / suite' }).click()

    const addressInput = page.getByPlaceholder(
      'Search your salon / suite address',
    )
    await addressInput.fill('123 Main St')
    await page.getByRole('button', { name: /123 Main St/ }).click()
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()

    await fillSharedIdentityFields(page, {
      email: nextEmail('pro_salon'),
      phone: nextPhone(),
    })

    const submit = page.getByRole('button', { name: 'Create Pro Account' })
    await expect(submit).toBeEnabled()
    await submit.click()

    await expectSignedUpAndOnVerifyPhone(page)

    const cookies = await page.context().cookies()
    expect(cookies.find((c) => c.name === 'tovis_client_zip')).toBeUndefined()
  })

  test('mobile pro can sign up with a confirmed base ZIP and radius', async ({
    page,
  }) => {
    await interceptGoogleProxies(page)
    await page.goto('/signup/pro')

    await page.getByRole('combobox').first().selectOption('MASSAGE_THERAPIST')
    await page.getByRole('button', { name: 'Mobile', exact: true }).click()

    await page
      .getByPlaceholder('Enter your ZIP code (e.g. 92101)')
      .fill('92101')
    await page.getByRole('button', { name: 'Confirm ZIP' }).click()
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()

    await page.getByLabel('Mobile radius (miles)').fill('25')

    await fillSharedIdentityFields(page, {
      email: nextEmail('pro_mobile'),
      phone: nextPhone(),
    })

    const submit = page.getByRole('button', { name: 'Create Pro Account' })
    await expect(submit).toBeEnabled()
    await submit.click()

    await expectSignedUpAndOnVerifyPhone(page)
  })

  test('licensed pro still signs up when DCA verification is unavailable', async ({
    page,
  }) => {
    await interceptGoogleProxies(page)
    await page.goto('/signup/pro')

    await page.getByRole('combobox').first().selectOption('ESTHETICIAN')
    await expect(page.getByText('California license')).toBeVisible()
    await page.getByLabel('License number').fill('Z123456')

    const addressInput = page.getByPlaceholder(
      'Search your salon / suite address',
    )
    await addressInput.fill('123 Main St')
    await page.getByRole('button', { name: /123 Main St/ }).click()
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()

    await fillSharedIdentityFields(page, {
      email: nextEmail('pro_licensed'),
      phone: nextPhone(),
    })

    const submit = page.getByRole('button', { name: 'Create Pro Account' })
    await expect(submit).toBeEnabled()
    await submit.click()

    // DCA is intentionally unconfigured in the e2e env, so signup must
    // degrade to the manual-review path instead of blocking the account.
    await expectSignedUpAndOnVerifyPhone(page)
  })
})
