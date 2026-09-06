// tests/e2e/consult-early-photo.spec.ts
//
// P7a-1 — the early photo, driven in a real browser.
//
// Three claims that only a rendered page can settle, and that this repo has
// been bitten by before (`the-simulator-and-the-browser-find-what-tests-cannot`
// — five P5a defects survived 14k green tests):
//
//   1. ORDER. "The early photo comes after the coarse cards and before the
//      intake" is a claim about what is ON SCREEN, above what. A server test
//      asserting array indices proves the projection; it does not prove the
//      page renders that array in order, or renders the message at all.
//   2. The sticky Book CTA is genuinely PRESSABLE once the photo is in — not
//      merely present in the DOM with `disabled` cleared. `toBeInViewport` is
//      not pressable; the recorded lesson is to ask the document what is at the
//      point, so the assertion below uses `elementFromPoint`.
//   3. A REJECTED early photo leaves the client somewhere to go. The whole
//      stage is warning-only precisely so this is rare — but "corrupt image"
//      still refuses, and Part 0 rule 4 says a refusal must surface a retry
//      rather than a dead end.
//
// The consult API is stubbed from the same typed fixtures the P5b/P5d specs
// use, so a DTO change fails typecheck here rather than drifting.

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

async function stubThread(
  page: Page,
  args: {
    earlyPhoto: EarlyPhoto
    bookEnabled: boolean
    status?: 'EARLY_PHOTO_READY' | 'MEDIA_READY'
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
          earlyPhoto: args.earlyPhoto,
          bookEnabled: args.bookEnabled,
          status: args.status ?? 'MEDIA_READY',
        }),
      },
    }),
  )
  await page.route('https://storage.test/**', async (route: Route) =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: IMAGE_BYTES }),
  )
}

const accepted = (warningCode: string | null): EarlyPhoto => ({
  shotKey: 'early_photo',
  state: 'ACCEPTED',
  captureId: 'capture_early_1',
  qualityReasonCode: 'PASS',
  qualityWarningCode: warningCode as never,
  retakeTip: null,
  rawExpiresAt: '2026-09-07T18:00:00.000Z',
  purgedAt: null,
})

test.describe('P7a-1 the early photo', () => {
  test('renders after the coarse cards and BEFORE the intake and the guided pack', async ({
    page,
  }) => {
    await stubThread(page, {
      earlyPhoto: null,
      bookEnabled: false,
      status: 'EARLY_PHOTO_READY',
    })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // 🔴 Wait for the two things the ORDER is about to actually be on the page
    // before reading it. Without this the read races hydration: it passed on
    // the desktop viewport and failed on mobile-chrome, which is the slower
    // render — a flake that would have landed green on one project and red on
    // the other for reasons having nothing to do with the ordering.
    await expect(
      page.locator('[data-thread-message="photo:early_photo"]'),
    ).toBeAttached()
    await expect(
      page.locator('[data-thread-message^="inspiration:"]').first(),
    ).toBeAttached()

    // Every thread message the page rendered, in DOM order. Order is read off
    // the DOM rather than off the fixture, which is the whole point: the
    // fixture already knows the order, the PAGE is what is being tested.
    const ids = await page
      .locator('[data-thread-message]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-thread-message')),
      )

    const early = ids.indexOf('photo:early_photo')
    const lastCard = ids.findLastIndex((id) => id?.startsWith('inspiration:'))
    const firstGuided = ids.findIndex(
      (id) => id?.startsWith('photo:') && id !== 'photo:early_photo',
    )

    expect(early, 'the early photo message is on the page').toBeGreaterThan(-1)
    expect(lastCard, 'the coarse cards are on the page').toBeGreaterThan(-1)
    expect(early).toBeGreaterThan(lastCard)
    if (firstGuided > -1) expect(early).toBeLessThan(firstGuided)
  })

  test('a warm-lit camera-roll selfie is ACCEPTED with a warning and unlocks a PRESSABLE Book', async ({
    page,
  }) => {
    await stubThread(page, {
      earlyPhoto: accepted('WARM_INDOOR_LIGHT'),
      bookEnabled: true,
    })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const book = page.getByTestId('consult-thread-book-cta')
    await expect(book).toBeVisible()
    await expect(book).toBeEnabled()

    // 🔴 Enabled is not pressable. A sticky CTA lives in a fixed container, and
    // the recorded failure here is a fixed element that renders, reports
    // itself in the viewport, and has something else painted on top of it.
    // Ask the DOCUMENT what is at the button's own centre.
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

  test('an unreadable photo REJECTS with a retry, and Book stays locked', async ({
    page,
  }) => {
    await stubThread(page, {
      earlyPhoto: {
        shotKey: 'early_photo',
        state: 'REJECTED',
        captureId: 'capture_early_bad',
        qualityReasonCode: 'SUBJECT_NOT_VISIBLE',
        qualityWarningCode: null,
        retakeTip: 'We could not find a face — try again with your face in frame.',
        rawExpiresAt: '2026-09-07T18:00:00.000Z',
        purgedAt: null,
      },
      bookEnabled: false,
      status: 'EARLY_PHOTO_READY',
    })
    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // Part 0 rule 4: a refusal SURFACES. The retake tip is the client's way
    // forward, and it must be on screen — not only in the payload.
    await expect(
      page.getByText('We could not find a face', { exact: false }),
    ).toBeVisible()

    const book = page.getByTestId('consult-thread-book-cta')
    if (await book.count()) await expect(book).toBeDisabled()
  })
})
