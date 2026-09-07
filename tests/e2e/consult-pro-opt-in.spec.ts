// tests/e2e/consult-pro-opt-in.spec.ts
//
// P7a-5 — the gated CTA and the money line, in a real browser.
//
// The server tests prove the PROJECTION. This proves the page: that a disabled
// CTA is still on screen with its reason under it (the whole reason
// PREP_REQUIRED is not in the hide list), that the money line renders where a
// client will actually read it, and — the recorded lesson from P5a, where five
// defects survived 14k green tests — that the released button is genuinely
// PRESSABLE rather than merely `enabled` under something else.

import { expect, test, type Page, type Route } from '@playwright/test'

import {
  cardInspiration,
  CONSULT_FIXTURE_ID,
  threadFixture,
} from './fixtures/consultInspiration'

const BASE = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`

const IMAGE_BYTES = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
)

type EarlyPhoto = Parameters<typeof threadFixture>[0]['earlyPhoto']

const acceptedSelfie: EarlyPhoto = {
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

async function stubThread(
  page: Page,
  args: {
    bookEnabled?: boolean
    bookPrepRequired?: boolean
    bookPriceNote?: string | null
  },
): Promise<void> {
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
  await page.route(`**${BASE}/thread`, async (route: Route) =>
    route.fulfill({
      json: {
        ok: true,
        thread: threadFixture({
          inspiration: cardInspiration,
          earlyPhoto: acceptedSelfie,
          status: 'EARLY_PHOTO_READY',
          bookEnabled: args.bookEnabled ?? true,
          bookPrepRequired: args.bookPrepRequired,
          bookPriceNote: args.bookPriceNote ?? null,
        }),
      },
    }),
  )
  await page.route('https://storage.test/**', async (route: Route) =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: IMAGE_BYTES }),
  )
}

test.describe('P7a-5 book after prep', () => {
  test('the gated CTA is VISIBLE, disabled, and says why', async ({ page }) => {
    await stubThread(page, {
      bookPrepRequired: true,
      bookPriceNote: 'From $180 · $25.00 deposit',
    })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const book = page.getByTestId('consult-thread-book-cta')
    // 🔴 VISIBLE, not hidden. This is the one gate the client can clear herself
    // — by answering the questions above the button — so hiding it would take
    // away the only thing telling her that answering leads anywhere.
    await expect(book).toBeVisible()
    await expect(book).toBeDisabled()

    await expect(
      page.getByTestId('consult-thread-book-gate-note'),
    ).toHaveText('Susie asks clients to finish a few questions first.')
  })

  test('the money line renders under the CTA, gated or not', async ({ page }) => {
    await stubThread(page, {
      bookPrepRequired: true,
      bookPriceNote: 'From $180 · $25.00 deposit',
    })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // A client about to answer three questions so she can book deserves to
    // know a deposit is waiting on the other side of them.
    await expect(page.getByTestId('consult-thread-book-price-note')).toHaveText(
      'From $180 · $25.00 deposit',
    )
  })

  test('a percentage deposit is shown as a PERCENTAGE, never as dollars', async ({
    page,
  }) => {
    await stubThread(page, { bookPriceNote: 'From $180 · 20% deposit' })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const note = page.getByTestId('consult-thread-book-price-note')
    await expect(note).toHaveText('From $180 · 20% deposit')
    // At the spark there is no location mode and no add-ons, so a dollar
    // figure here would be a guess presented as a promise.
    await expect(note).not.toContainText('$36')
  })

  test('once prep is in, the CTA is enabled AND actually pressable', async ({
    page,
  }) => {
    await stubThread(page, {
      bookEnabled: true,
      bookPriceNote: 'From $180 · $25.00 deposit',
    })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const book = page.getByTestId('consult-thread-book-cta')
    await expect(book).toBeVisible()
    await expect(book).toBeEnabled()
    await expect(
      page.getByTestId('consult-thread-book-gate-note'),
    ).toHaveCount(0)

    // 🔴 Enabled is not pressable. The sticky CTA lives in a fixed container,
    // and the recorded failure is a fixed element that renders, reports itself
    // in the viewport, and has something painted on top of it. Ask the DOCUMENT
    // what is at the button's own centre.
    const box = await book.boundingBox()
    expect(box, 'the CTA has a box').not.toBeNull()
    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return el?.closest('[data-testid="consult-thread-book-cta"]') !== null
      },
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    )
    expect(hit, 'the CTA is what is painted at its own centre').toBe(true)
  })

  test('a pro with no settings shows the price and no gate note', async ({
    page,
  }) => {
    await stubThread(page, { bookEnabled: true, bookPriceNote: 'From $180' })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await expect(page.getByTestId('consult-thread-book-cta')).toBeEnabled()
    await expect(page.getByTestId('consult-thread-book-price-note')).toHaveText(
      'From $180',
    )
    await expect(
      page.getByTestId('consult-thread-book-gate-note'),
    ).toHaveCount(0)
  })
})
