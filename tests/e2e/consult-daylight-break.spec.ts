// tests/e2e/consult-daylight-break.spec.ts
//
// The daylight break (Tori, 2026-09-12). Walking the web consult, she reached
// the daylight photos and the chat asked for them "to finish up" with no way
// past them — the plan card was below the one-step-at-a-time cut. Now, at the
// first daylight photo, when her look can already be built, there is a clean
// stop: build it now, or add the photos first. Both say why the photos are
// wanted (daylight shows her truest colour) and that she can come back to them
// any time before her appointment.
//
// Driven in a browser because every claim here is about what is ON SCREEN at
// the cut: the choice in place of a camera card, the plan card not yet, the
// way out under the photo once she chose photos, and — after "build now" —
// the photos still there as one-line "add this photo" rows above her plan.

import { expect, test, type Page, type Route } from '@playwright/test'

import {
  CONSULT_FIXTURE_ID,
  cardInspiration,
  threadFixture,
  withCardsAnswered,
} from './fixtures/consultInspiration'

const BASE = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`

const IMAGE_BYTES = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
)

const ACCEPTED_SELFIE: Parameters<typeof threadFixture>[0]['earlyPhoto'] = {
  shotKey: 'early_photo',
  state: 'ACCEPTED',
  captureId: 'capture_early_1',
  qualityReasonCode: 'PASS',
  qualityWarningCode: null,
  retakeTip: null,
  rawExpiresAt: '2026-09-07T18:00:00.000Z',
  purgedAt: null,
  attemptCount: 1,
  previousReasonCode: null,
}

/** Every daylight photo still to send. */
const NO_DAYLIGHT_PHOTOS: Record<string, 'EMPTY'> = {
  hair_back: 'EMPTY',
  hair_left: 'EMPTY',
  hair_right: 'EMPTY',
  hair_crown: 'EMPTY',
  face_front: 'EMPTY',
  face_side: 'EMPTY',
  eyes_closeup: 'EMPTY',
}

/**
 * A hair consult that reached ANALYSIS_PENDING off the early photo alone: the
 * reference step done, the intake in, the plan card startable, and not one
 * daylight photo sent. The thread the break is for.
 */
const CHOOSING: Parameters<typeof threadFixture>[0] = {
  inspiration: withCardsAnswered(cardInspiration),
  earlyPhoto: ACCEPTED_SELFIE,
  slotOverrides: NO_DAYLIGHT_PHOTOS,
  status: 'ANALYSIS_PENDING',
  planStartable: true,
}

/** The same consult once she said "build my look now" and the plan landed. */
const BUILT_WITHOUT_THEM: Parameters<typeof threadFixture>[0] = {
  inspiration: withCardsAnswered(cardInspiration),
  earlyPhoto: ACCEPTED_SELFIE,
  slotOverrides: NO_DAYLIGHT_PHOTOS,
  status: 'COMPLETED',
  plan: { version: 1 },
}

async function stubConsult(page: Page, fixture: Parameters<typeof threadFixture>[0]) {
  const current = { fixture }
  const analysisPosts: unknown[] = []
  const proceedPosts: unknown[] = []
  await page.route(`**${BASE}/inspiration/media`, async (route: Route) =>
    route.fulfill({
      json: { ok: true, url: 'https://storage.test/read/600?token=read-token', expiresInSeconds: 600 },
    }),
  )
  await page.route(`**${BASE}/inspiration/read`, async (route: Route) =>
    route.fulfill({ status: 404, json: { ok: false } }),
  )
  await page.route('https://storage.test/**', async (route: Route) =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: IMAGE_BYTES }),
  )
  await page.route(`**${BASE}/capture/proceed`, async (route: Route) => {
    proceedPosts.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true } })
  })
  await page.route(`**${BASE}/analysis`, async (route: Route) => {
    analysisPosts.push(route.request().postDataJSON())
    // The start claims the run; the next read is the thread after it.
    current.fixture = BUILT_WITHOUT_THEM
    await route.fulfill({ json: { ok: true } })
  })
  await page.route(`**${BASE}/thread`, async (route: Route) =>
    route.fulfill({ json: { ok: true, thread: threadFixture(current.fixture) } }),
  )
  return { analysisPosts, proceedPosts }
}

test.describe('the daylight break', () => {
  test('🔴 at the first daylight photo the choice stands where the camera card was, and says why the photos matter', async ({ page }) => {
    await stubConsult(page, CHOOSING)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const choice = page.getByTestId('consult-daylight-choice')
    await expect(choice).toBeVisible()
    await expect(page.getByRole('button', { name: 'Build my look now' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add daylight photos first' })).toBeVisible()

    // The reason, in words she reads: daylight shows her truest colour, and
    // she can come back to the photos any time.
    await expect(page.getByText('truest colour').first()).toBeVisible()
    await expect(page.getByText('any time before your appointment').first()).toBeVisible()

    // No camera card yet, and the plan card is still below the cut — the
    // choice IS the step. "Needed" is the badge the camera card wears.
    await expect(page.getByRole('heading', { name: 'Hair back' })).toHaveCount(0)
    await expect(page.getByText('Needed')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Build my plan' })).toHaveCount(0)
  })

  test('"Add daylight photos first" brings the camera card, with the way out underneath', async ({ page }) => {
    const { analysisPosts } = await stubConsult(page, CHOOSING)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await page.getByRole('button', { name: 'Add daylight photos first' }).click()

    // The first daylight photo, as a camera card; the choice is gone.
    await expect(page.getByRole('heading', { name: 'Hair back' })).toBeVisible()
    await expect(page.getByText('Needed').first()).toBeVisible()
    await expect(page.getByTestId('consult-daylight-choice')).toHaveCount(0)
    // And still one thing at a time: the second photo is not on the page.
    await expect(page.getByRole('heading', { name: 'Left side' })).toHaveCount(0)

    // The exit stays a tap away, and says what a skipped photo costs: unknown,
    // not a guess.
    await expect(page.getByText('comes back as unknown')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Build my look now' })).toBeVisible()
    expect(analysisPosts).toHaveLength(0)
  })

  test('🔴 "Build my look now" starts the plan, and the photos stay — as rows she can come back to, above her plan', async ({ page }) => {
    const { analysisPosts, proceedPosts } = await stubConsult(page, CHOOSING)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await page.getByRole('button', { name: 'Build my look now' }).click()

    // The plan card was already startable, so the tap is ONE start — no
    // partial-pack door first — echoing the versions the card carried.
    await expect.poll(() => analysisPosts.length).toBe(1)
    expect(proceedPosts).toHaveLength(0)
    expect(analysisPosts[0]).toMatchObject({ schemaVersion: 4, promptVersion: 'service-analysis-v5' })

    // Her answer and the standing invitation, in the chat.
    await expect(page.getByText('Build my look now', { exact: true })).toBeVisible()
    await expect(page.getByText('Add your daylight photos whenever you like')).toBeVisible()

    // Seven photos still wanted: one line each, with the way to add it — not
    // seven camera cards between her and the plan.
    const later = page.getByTestId('consult-daylight-later')
    await expect(later).toHaveCount(7)
    await expect(page.getByText('Add this photo')).toHaveCount(7)
    await expect(page.getByText('Needed')).toHaveCount(0)
    await expect(page.getByTestId('consult-daylight-choice')).toHaveCount(0)

    // And the plan is reached, below them.
    await expect(page.getByText('Here’s where you’re starting from')).toBeVisible()
    const rows = await later.first().boundingBox()
    const plan = await page.getByText('Here’s where you’re starting from').boundingBox()
    expect(rows!.y).toBeLessThan(plan!.y)
  })
})
