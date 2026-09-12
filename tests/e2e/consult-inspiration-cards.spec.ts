// tests/e2e/consult-inspiration-cards.spec.ts
//
// P5d — the inspiration CARDS, in a real browser.
//
// Three things here are invisible to a unit test, and each of them has already
// shipped broken in this repo at least once:
//
//   1. THE CROP IS GEOMETRY. "The coarse crops visibly correspond to colour vs
//      shape" is a claim about pixels on a screen. A projection test can assert
//      that two different region objects were sent; only a browser can say the
//      two boxes actually render at different sizes and positions.
//   2. THE ORDER IS THE PRODUCT. Stage 2's rule is no jargon before its
//      picture: crop, THEN the plain word, THEN the question. That is a
//      measurement of where things sit on the page, not of what a component
//      returns.
//   3. THE MEASURED IMAGE. React does not fire `onLoad` for an `<img>` that was
//      already `complete` when the handler attached — the normal case here,
//      because every card after the first shows the same cached photograph. A
//      crop that only measured in `onLoad` sits square and wrong on exactly the
//      cards the client scrolls to second, and every jsdom test passes because
//      jsdom fires load by hand.

import { expect, test, type Page, type Route } from '@playwright/test'

import {
  cardInspiration,
  CONSULT_FIXTURE_ID,
  threadFixture,
} from './fixtures/consultInspiration'

const BASE = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`

/**
 * A 2x3 PNG — deliberately NOT square and not 1x1.
 *
 * The crop's aspect ratio is `region.w * naturalWidth / (region.h *
 * naturalHeight)`, so a square source would make a measurement bug invisible:
 * every crop would come out square whether the natural size was read or not.
 */
const IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAFUlEQVR4nGP8z8Dwn4GBgYGJAQpgDABLegQBI9jVMwAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * The chat shows one step at a time. `cardInspiration` opens on the spark card;
 * `PREP_CARD_OPEN` is the same consult one answer later, standing on the prep
 * card with its crop and its plain word.
 */
const PREP_CARD_OPEN = {
  ...cardInspiration,
  cards: (cardInspiration.cards ?? []).map((card, index) =>
    index === 0 ? { ...card, selectedValues: ['the-color'] } : card,
  ),
}

async function stubCardConsult(page: Page, inspiration = cardInspiration) {
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
  let mediaReads = 0
  await page.route('https://storage.test/**', async (route: Route) => {
    mediaReads += 1
    await route.fulfill({ status: 200, contentType: 'image/png', body: IMAGE_BYTES })
  })
  await page.route(`**${BASE}/thread`, async (route: Route) =>
    route.fulfill({
      json: { ok: true, thread: threadFixture({ inspiration }) },
    }),
  )
  return { mediaReads: () => mediaReads }
}

test.describe('consult inspiration cards', () => {
  test('shows the crop, then the plain word, then the question', async ({ page }) => {
    await stubCardConsult(page, PREP_CARD_OPEN)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const name = page.getByTestId('consult-inspiration-card-name')
    await expect(name).toHaveText(
      'This is the cooler, silvery cast in it — some people call it ash.',
    )

    // 🔴 The ORDER, measured. The prep card's crop is above its name, and its
    // name is above the question. A card that named the thing before showing it
    // would pass every assertion about content and fail this one.
    const prepCard = page
      .getByTestId('consult-inspiration-card-name')
      .locator('xpath=ancestor::*[.//*[@data-testid="consult-inspiration-crop"]][1]')
    const crop = prepCard.getByTestId('consult-inspiration-crop').first()
    const prompt = prepCard.getByTestId('consult-inspiration-card-prompt')
    const cropBox = await crop.boundingBox()
    const nameBox = await name.boundingBox()
    const promptBox = await prompt.boundingBox()
    expect(cropBox).not.toBeNull()
    // Measured against the crop's MIDPOINT, not its bottom edge. The defect
    // this guards is a name rendered ABOVE its picture, which is half a card
    // away; a bottom-edge comparison is a half-pixel away, and CI's renderer
    // lands the name exactly on `bottom - 1` where a local Chrome does not.
    expect(nameBox!.y).toBeGreaterThan(cropBox!.y + cropBox!.height / 2)
    expect(promptBox!.y).toBeGreaterThan(nameBox!.y)

    // The three answers, and no way to type.
    for (const label of ['Yes', 'Not this', 'Not sure']) {
      await expect(prepCard.getByRole('button', { name: label })).toBeVisible()
    }
    await expect(prepCard.locator('textarea, input[type="text"]')).toHaveCount(0)
  })

  test('🔴 the colour crop and the shape crop are different pictures', async ({
    page,
  }) => {
    await stubCardConsult(page)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const sparkPrompt = page
      .getByTestId('consult-inspiration-card-prompt')
      .filter({ hasText: 'What made you stop scrolling?' })
    await expect(sparkPrompt).toBeVisible()
    // 🔴 ONCE. The question used to render twice — the card asked it, and the
    // answer form asked it again above the plain-language name, which puts the
    // jargon-free word AFTER the question it was there to make answerable.
    await expect(
      page.getByText('What made you stop scrolling?', { exact: true }),
    ).toHaveCount(1)
    const sparkCard = sparkPrompt.locator(
      'xpath=ancestor::*[.//*[@data-testid="consult-inspiration-crop"]][1]',
    )

    // Two of the four options carry a crop; "the whole thing" and "not sure"
    // are about the whole picture and show it whole. The caption under a crop
    // has its own testid because the same words are also on the answer BUTTON —
    // which is correct (she reads the label, then presses it) and ambiguous to
    // a text locator.
    await expect(
      sparkCard.getByTestId('consult-inspiration-option-label'),
    ).toHaveText(['The color', 'The shape of it'])

    const colour = sparkCard
      .getByRole('button', { name: /^The color — tap to see the whole photo$/ })
      .first()
    const shape = sparkCard
      .getByRole('button', { name: /^The shape of it — tap to see the whole photo$/ })
      .first()
    const colourStyle = await colour.evaluate((el) => {
      const style = getComputedStyle(el)
      return { size: style.backgroundSize, position: style.backgroundPosition }
    })
    const shapeStyle = await shape.evaluate((el) => {
      const style = getComputedStyle(el)
      return { size: style.backgroundSize, position: style.backgroundPosition }
    })
    // Different region → different scale AND different offset. Equal values
    // mean the two options are showing the client the same picture twice and
    // asking her to tell them apart.
    expect(colourStyle.size).not.toBe(shapeStyle.size)
    expect(colourStyle.position).not.toBe(shapeStyle.position)

    // 🔴 The natural size was actually READ. The source is 2x3, and the colour
    // crop is 0.4 wide by 0.4 tall, so its box is (0.4*2)/(0.4*3) = 0.667 wide
    // for its height. An unmeasured crop falls back to 1/1 — a square — which
    // is exactly what an onLoad-only measurement produces on a cached image.
    const box = await colour.boundingBox()
    expect(box!.width / box!.height).toBeGreaterThan(0.55)
    expect(box!.width / box!.height).toBeLessThan(0.8)
  })

  test('fetches the reference ONCE for every card on the thread', async ({ page }) => {
    const { mediaReads } = await stubCardConsult(page, PREP_CARD_OPEN)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
    await expect(
      page.getByTestId('consult-inspiration-card-name'),
    ).toBeVisible()
    await page.waitForTimeout(1_500)
    // The chat paints the reference as her own photo in the history, then
    // again as the prep card's crop — two images of one photograph, and every
    // later card will be another. They all point at the SAME signed URL, so
    // the browser fetches the bytes once. A per-card signed read would be the
    // P1 refetch bug arrived at from the other direction.
    expect(mediaReads()).toBeLessThanOrEqual(2)
  })

  test('opens the whole photo when a crop is tapped', async ({ page }) => {
    await stubCardConsult(page)
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await expect(page.getByTestId('consult-inspiration-fullscreen')).toHaveCount(0)
    await page.getByTestId('consult-inspiration-crop').first().click()
    await expect(page.getByTestId('consult-inspiration-fullscreen')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByTestId('consult-inspiration-fullscreen')).toHaveCount(0)
  })
})
