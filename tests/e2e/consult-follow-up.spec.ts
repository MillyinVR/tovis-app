// tests/e2e/consult-follow-up.spec.ts
//
// P5g — the two region moves and the adaptive follow-ups, in a real browser.
//
// What is invisible to a unit test here, and why each one is worth a browser:
//
//   1. A REGION IS A PLACE ON A PHOTOGRAPH. "Every readable attribute is drawn
//      on the picture as a tappable area" is a claim about pixels. A projection
//      test can say three different region objects were sent; only a browser
//      can say the three boxes render at three different places, over the
//      image, and can actually be pressed.
//   2. TAPPABLE ≠ VISIBLE. `toBeInViewport` is not the same as pressable — a
//      box behind the image, or with the image painted over it, passes every
//      visibility assertion and eats the tap. `elementFromPoint` is what
//      settles it.
//   3. THE FALLBACK IS SOMETHING SHE READS. Part 0 rule 4 forbids a silent
//      fallback, and "the client is told" is a sentence on a screen.

import { expect, test, type Page, type Route } from '@playwright/test'

import {
  CONSULT_FIXTURE_ID,
  regionPickerInspiration,
  threadFixture,
  withCardsAnswered,
} from './fixtures/consultInspiration'

const BASE = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`

/** A 2x3 PNG — not square, so an unmeasured aspect ratio would show. */
const IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAFUlEQVR4nGP8z8Dwn4GBgYGJAQpgDABLegQBI9jVMwAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * The chat shows one step at a time, so each describe starts from the thread
 * that has REACHED its step: the region picker as the open card, or — with the
 * cards answered and the plan built — the follow-up round.
 */
async function stubConsult(
  page: Page,
  fixture: Parameters<typeof threadFixture>[0] = { inspiration: regionPickerInspiration },
) {
  const followUpPosts: unknown[] = []
  await page.route(`**${BASE}/inspiration/media`, async (route: Route) =>
    route.fulfill({
      json: {
        ok: true,
        url: 'https://storage.test/read/600?token=read-token',
        expiresInSeconds: 600,
      },
    }),
  )
  await page.route(`**${BASE}/inspiration/read`, async (route: Route) =>
    route.fulfill({ status: 404, json: { ok: false } }),
  )
  await page.route('https://storage.test/**', async (route: Route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: IMAGE_BYTES }),
  )
  await page.route(`**${BASE}/follow-up`, async (route: Route) => {
    followUpPosts.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true, followUp: null, nextRoundCreated: false } })
  })
  await page.route(`**${BASE}/inspiration/answers`, async (route: Route) =>
    route.fulfill({ json: { ok: true, inspiration: regionPickerInspiration, replayed: false } }),
  )
  await page.route(`**${BASE}/thread`, async (route: Route) =>
    route.fulfill({ json: { ok: true, thread: threadFixture(fixture) } }),
  )
  return { followUpPosts }
}

/** The thread after the plan: every card answered, the follow-ups begun. */
const AFTER_THE_PLAN: Parameters<typeof threadFixture>[0] = {
  inspiration: withCardsAnswered(regionPickerInspiration),
  plan: { version: 1 },
  followUps: true,
}

test.describe('P5g — tap what you love', () => {
  test('🔴 every readable attribute is a box on the photograph, in its own place', async ({
    page,
  }) => {
    await stubConsult(page)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const picker = page.getByTestId('consult-region-picker')
    await expect(picker).toBeVisible()

    const boxes = await Promise.all(
      ['base-level', 'lightest-level', 'tone'].map(async (value) => {
        const region = page.getByTestId(`consult-region-${value}`)
        await expect(region).toBeVisible()
        return { value, box: (await region.boundingBox())! }
      }),
    )

    // Three boxes, three PLACES. The root reading is high in the frame and the
    // lightest pieces are low; two boxes at the same coordinates would be two
    // areas she cannot tell apart, which is the whole feature failing quietly.
    const base = boxes.find((b) => b.value === 'base-level')!.box
    const lightest = boxes.find((b) => b.value === 'lightest-level')!.box
    const tone = boxes.find((b) => b.value === 'tone')!.box
    expect(base.y).toBeLessThan(tone.y)
    expect(tone.y).toBeLessThan(lightest.y)

    // And each sits INSIDE the picture, not beside it.
    const pickerBox = (await picker.boundingBox())!
    for (const { box } of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(pickerBox.x - 1)
      expect(box.y).toBeGreaterThanOrEqual(pickerBox.y - 1)
      expect(box.x + box.width).toBeLessThanOrEqual(pickerBox.x + pickerBox.width + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(pickerBox.y + pickerBox.height + 1)
    }
  })

  test('🔴 a region is actually PRESSABLE, not merely visible', async ({ page }) => {
    await stubConsult(page)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const tone = page.getByTestId('consult-region-tone')
    await expect(tone).toBeVisible()
    // ⚠️ Scroll FIRST. `elementFromPoint` takes VIEWPORT coordinates, and a box
    // below the fold returns null — which reads exactly like "something is
    // covering it" and is not. Playwright's own `.click()` scrolls for you,
    // which is why the zoom test below passes either way and this one has to
    // say so out loud.
    await tone.scrollIntoViewIfNeeded()
    const box = (await tone.boundingBox())!

    // 🔴 `toBeVisible` says the element is laid out. It does NOT say a tap
    // lands on it — the image is painted in the same stacking context, and a
    // box behind it looks identical and eats every press. This is the check
    // that tells the difference.
    const topmost = await page.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y)
        return element?.getAttribute('data-testid') ?? element?.tagName ?? null
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    )
    expect(topmost).toBe('consult-region-tone')
  })

  test('tapping a region zooms to it and names it UNDER the crop', async ({ page }) => {
    await stubConsult(page)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await page.getByTestId('consult-region-tone').click()

    // The picker is replaced by the zoom — one thing at a time, and a box drawn
    // over a zoomed crop would point at the wrong part of it.
    await expect(page.getByTestId('consult-region-picker')).toHaveCount(0)
    const zoomName = page.getByTestId('consult-region-zoom-name')
    await expect(zoomName).toHaveText('cool, silvery cast')

    // 🔴 UNDER the crop. Stage 2's rule survives the redesign: she is looking
    // at the silvery part of her own photograph before anything calls it ash.
    const crop = page.getByTestId('consult-inspiration-crop').first()
    const cropBox = (await crop.boundingBox())!
    const nameBox = (await zoomName.boundingBox())!
    expect(nameBox.y).toBeGreaterThan(cropBox.y + cropBox.height / 2)

    await page.getByRole('button', { name: 'Back to the whole photo' }).click()
    await expect(page.getByTestId('consult-region-picker')).toBeVisible()
  })

  test('multi-select reads back in words, and Next needs a selection', async ({
    page,
  }) => {
    await stubConsult(page)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const next = page
      .getByTestId('consult-region-picker')
      .locator('xpath=ancestor::*[.//button[normalize-space()="Next"]][1]')
      .getByRole('button', { name: 'Next', exact: true })
    await expect(next).toBeDisabled()

    await page.getByTestId('consult-region-tone').click()
    await page.getByRole('button', { name: 'Back to the whole photo' }).click()
    await page.getByTestId('consult-region-lightest-level').click()
    await page.getByRole('button', { name: 'Back to the whole photo' }).click()

    // A row of highlighted boxes is not a receipt — she reads back what she
    // said, in the words her own photograph produced.
    await expect(page.getByTestId('consult-region-selection')).toHaveText(
      'light blonde, cool, silvery cast',
    )
    await expect(next).toBeEnabled()
  })
})

test.describe('P5g — the adaptive follow-ups', () => {
  test('renders as question cards after the plan, one open at a time', async ({
    page,
  }) => {
    await stubConsult(page, AFTER_THE_PLAN)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const questions = page.getByTestId('consult-follow-up-question')
    await expect(questions.first()).toContainText(
      'You’re at a light brown now and you loved the ash',
    )

    // 🔴 AFTER the plan. A follow-up is generated from everything above it, so
    // one rendered before the plan would be a question that could not have been
    // asked yet.
    const planBox = (await page.getByText('Here’s where you’re starting from', {
      exact: false,
    }).first().boundingBox()) ?? (await page.getByTestId('consult-follow-up-question').first().boundingBox())!
    const firstQuestionBox = (await questions.first().boundingBox())!
    expect(firstQuestionBox.y).toBeGreaterThan(planBox.y)
    // One open at a time means ONE on screen: the second round is not on the
    // page until the first is answered.
    await expect(questions).toHaveCount(1)
  })

  test('🔴 the fallback says so, out loud', async ({ page }) => {
    // Round 1 answered, so the fallback round is the open step.
    await stubConsult(page, { ...AFTER_THE_PLAN, followUps: { openRound: 2 } })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // Part 0 rule 4 forbids a silent fallback, and one she cannot see is a
    // silent one. The bubble is the server's own sentence.
    await expect(
      page.getByText('I couldn’t think of the next question just now', {
        exact: false,
      }),
    ).toBeVisible()

    const fallbackCard = page.locator('[data-testid="consult-follow-up-question"][data-fallback="true"]')
    await expect(fallbackCard).toHaveText(
      'When did you last use henna or another plant-based hair dye?',
    )
  })

  test('answering posts the key and the enum, and nothing else', async ({ page }) => {
    const { followUpPosts } = await stubConsult(page, AFTER_THE_PLAN)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await page.getByTestId('consult-follow-up-option-within-3-months').click()
    await expect.poll(() => followUpPosts.length).toBe(1)

    const [posted] = followUpPosts as [Record<string, unknown>]
    expect(posted.questionKey).toBe('prior_lightening')
    expect(posted.selectedValues).toEqual(['within-3-months'])
    // 🔴 The device sends no routing. WHERE this lands — the intake revision or
    // the round — is the server's decision, and a client that could say would
    // be a client that could say it wrong.
    expect(Object.keys(posted).sort()).toEqual([
      'idempotencyKey',
      'questionKey',
      'selectedValues',
    ])
  })

  test('there is no way to type a follow-up answer', async ({ page }) => {
    await stubConsult(page, AFTER_THE_PLAN)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
    const card = page
      .getByTestId('consult-follow-up-question')
      .first()
      .locator('xpath=ancestor::*[1]')
    await expect(card.locator('textarea, input[type="text"]')).toHaveCount(0)
  })
})
