// tests/e2e/consult-plan-versions.spec.ts
//
// P7a-3 — the versioned plan and its diff bubble, in a real browser.
//
// The projection is proved against real PostgreSQL in
// tests/integration/consult-lifecycle-open.test.ts. What only a browser can say
// is whether the client can READ it, and three of these claims are geometry or
// ordering rather than content:
//
//   1. THE BUBBLE COMES AFTER THE PLAN. "What changed" is only meaningful below
//      the thing it changed. That is a measurement of where two elements sit,
//      and a projection test that asserts array order cannot see a layout that
//      hoists one of them.
//   2. AN EMPTY DIFF STILL SPEAKS. A rerun that reached the same answer is a
//      real outcome with its own sentence. The obvious implementation renders
//      nothing at all for it, which looks exactly like the client's edit having
//      been dropped — and looks identical in every unit test, because the
//      message object is still in the array.
//   3. THE OLD VALUE IS VISIBLY OLD. "One visit → More than one visit" is only
//      legible if the first half reads as struck through. That is a computed
//      style, not a string.

import { expect, test, type Page, type Route } from '@playwright/test'

import {
  cardInspiration,
  CONSULT_FIXTURE_ID,
  threadFixture,
} from './fixtures/consultInspiration'

const BASE = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`

/** The two rows a real v1 → v2 rerun produced in the integration suite. */
const CHANGES = [
  {
    key: 'achievability',
    label: 'How big a job it is',
    from: 'One visit',
    to: 'More than one visit',
  },
  {
    key: 'steps',
    label: 'What we’d do',
    from: 'Gloss & Tone',
    to: 'Balayage → Gloss & Tone',
  },
]

async function stubThread(
  page: Page,
  plan: Parameters<typeof threadFixture>[0]['plan'],
) {
  await page.route(`**${BASE}/inspiration/media`, async (route: Route) =>
    route.fulfill({ status: 404, json: { ok: false } }),
  )
  await page.route(`**${BASE}/inspiration/read`, async (route: Route) =>
    route.fulfill({ status: 404, json: { ok: false } }),
  )
  await page.route(`**${BASE}/thread`, async (route: Route) =>
    route.fulfill({
      json: {
        ok: true,
        thread: threadFixture({
          inspiration: cardInspiration,
          status: 'COMPLETED',
          plan,
        }),
      },
    }),
  )
}

test.describe('the plan is versioned', () => {
  test('the diff bubble sits BELOW the plan and names both values', async ({
    page,
  }) => {
    await stubThread(page, {
      version: 2,
      updates: [{ version: 2, changes: CHANGES }],
    })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const bubble = page.getByTestId('consult-plan-update')
    await expect(bubble).toHaveCount(1)
    await expect(bubble).toHaveAttribute('data-plan-version', '2')
    await expect(bubble).toContainText('Your plan moved')

    // 🔴 ORDER, measured. The plan card is the current state; the bubble is
    // what happened since. A layout that floated the bubble above it would read
    // as "here is a change" before the client has seen the thing it changed.
    const planText = page.getByText(
      'Here’s where you’re starting from and what it would take.',
      { exact: false },
    )
    const planBox = await planText.boundingBox()
    const bubbleBox = await bubble.boundingBox()
    expect(planBox).not.toBeNull()
    expect(bubbleBox).not.toBeNull()
    expect(bubbleBox!.y).toBeGreaterThan(planBox!.y)

    // Both rows, both halves of each.
    const rows = page.getByTestId('consult-plan-change')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('How big a job it is')
    await expect(rows.first()).toContainText('One visit')
    await expect(rows.first()).toContainText('More than one visit')
    await expect(rows.nth(1)).toContainText('Balayage')

    // 🔴 The OLD value reads as old. Without the strike-through the row is
    // "One visit → More than one visit" as one flat sentence, which is a
    // sentence about neither.
    const oldValue = rows.first().locator('span').first()
    await expect(oldValue).toHaveCSS('text-decoration-line', 'line-through')
  })

  test('🔴 a rerun that changed nothing still says so', async ({ page }) => {
    await stubThread(page, {
      version: 2,
      updates: [{ version: 2, changes: [] }],
    })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // The bubble is on screen, with the server's own sentence for this case,
    // and no empty table under it.
    const bubble = page.getByTestId('consult-plan-update')
    await expect(bubble).toBeVisible()
    await expect(bubble).toContainText('the plan still holds')
    await expect(page.getByTestId('consult-plan-change')).toHaveCount(0)
  })

  test('says an update is coming instead of showing a plan she knows is stale', async ({
    page,
  }) => {
    await stubThread(page, { version: 1, updatePending: true })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await expect(
      page.getByText('I’m having another look', { exact: false }),
    ).toBeVisible()
    // The "here is your plan" line is NOT also on screen: she told us it was
    // out of date, and showing both would be the thread arguing with itself.
    await expect(
      page.getByText('Here’s where you’re starting from', { exact: false }),
    ).toHaveCount(0)
    await expect(page.getByTestId('consult-plan-update')).toHaveCount(0)
  })

  test('a consult that has only ever run once shows no version bubble', async ({
    page,
  }) => {
    await stubThread(page, { version: 1 })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await expect(
      page.getByText('Here’s where you’re starting from', { exact: false }),
    ).toBeVisible()
    // Nothing to differ from, so nothing to say. A "version 1 of 1" chip on
    // every finished consult is noise that teaches her to stop reading the one
    // that matters.
    await expect(page.getByTestId('consult-plan-update')).toHaveCount(0)
  })
})
