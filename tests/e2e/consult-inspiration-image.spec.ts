// tests/e2e/consult-inspiration-image.spec.ts
//
// B4 (docs/consult/tovis-ai-consult-handoff.md Part 1): the inspiration media
// has to be ON SCREEN at the "what did you like about it?" step, and when it
// cannot be, the client has to be TOLD.
//
// Driven in a real browser because the two defects this guards are invisible to
// a unit test:
//
//   1. `imageReadEndpoint` is a typed contract — whatever it names must answer
//      `{ url, expiresInSeconds }`. It used to fork on the source and point a
//      look-anchored consult at `/api/v1/looks/{id}`, which answers a look DTO.
//      The panel read `undefined` off it, rendered a broken image, and
//      scheduled its next refresh from `NaN` — and `setTimeout(fn, NaN)` fires
//      on the next tick, so the page refetched forever. A REQUEST COUNT over
//      wall-clock is the only thing that catches that. Measured before the fix:
//      4,457 reads in six seconds.
//
//      The assertion is that the count does not GROW, plus a small ceiling on
//      the initial burst — not an exact 1. `next dev` runs under React strict
//      mode and double-invokes every effect, so a mount costs 2 requests
//      locally and 1 against the production build CI serves.
//
//   2. The failure was silent. The client sat in front of an empty panel with
//      nothing to read and nothing to press.
//
// The consult API is stubbed from `fixtures/consultInspiration.ts` (typed as
// the real DTOs, so a contract change fails typecheck here) — the page shell
// needs only an authenticated CLIENT, and every stage comes over the API. The
// server half — a Look resolving to a real signed/public URL, and refusing the
// moment the look stops being viewable by both parties — is proven against real
// PostgreSQL in tests/integration/consult-look-anchor.test.ts.

import { expect, test, type Page, type Route } from '@playwright/test'

import {
  cardInspiration,
  CONSULT_FIXTURE_ID,
  generalServiceInspiration,
  lookSourceInspiration,
  threadFixture,
  uploadSourceInspiration,
  withAnalysisReady,
  withCardsAnswered,
} from './fixtures/consultInspiration'

const BASE = `/api/v1/client/consult/${CONSULT_FIXTURE_ID}`
const MEDIA = `${BASE}/inspiration/media`

// A 1x1 transparent gif — the bytes behind the signed URL, so a rendered <img>
// proves the src resolved rather than that the network happened to be up.
const IMAGE_BYTES = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
)

/** `next dev` double-invokes effects under React strict mode; `next start`
 *  does not. One mount is therefore 1 read in CI and 2 locally. */
const STRICT_MODE_MOUNT_READS = 2

async function stubConsult(
  page: Page,
  options: {
    inspiration: typeof lookSourceInspiration
    media: (route: Route) => Promise<void>
    bookEnabled?: boolean
    slotOverrides?: Record<string, 'EMPTY' | 'ACCEPTED' | 'REJECTED'>
    /** P7a-1: the early photo's slot. Accepted, and the chat moves on to the pack. */
    earlyPhoto?: Parameters<typeof threadFixture>[0]['earlyPhoto']
    /** P5b: how POST /inspiration/read answers. */
    read?: (route: Route) => Promise<void>
  },
): Promise<{
  mediaRequests: () => number
  readRequests: () => number
  /** Change what the next thread read answers with — the state after a read. */
  setInspiration: (inspiration: typeof lookSourceInspiration) => void
}> {
  let mediaRequests = 0
  const current = { inspiration: options.inspiration }

  // Most specific first: Playwright matches routes in registration order.
  await page.route(`**${MEDIA}`, async (route) => {
    mediaRequests += 1
    await options.media(route)
  })
  // P5b: the inspiration READ stage. Counted, and answered by the caller when
  // it cares — most tests here predate the stage and serve a source with no
  // `analysisReady` at all, which the page must leave alone.
  let readRequests = 0
  await page.route(`**${BASE}/inspiration/read`, async (route) => {
    readRequests += 1
    await (options.read ?? ((r: Route) => r.fulfill({ status: 404, json: { ok: false } })))(
      route,
    )
  })
  // P5a: ONE read drives the page. The stage endpoints still exist and still
  // serve mutations; the page no longer reads them.
  await page.route(`**${BASE}/thread`, async (route) =>
    route.fulfill({
      json: {
        ok: true,
        thread: threadFixture({
          inspiration: current.inspiration,
          bookEnabled: options.bookEnabled,
          slotOverrides: options.slotOverrides,
          earlyPhoto: options.earlyPhoto,
        }),
      },
    }),
  )
  await page.route('https://storage.test/**', async (route) =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: IMAGE_BYTES }),
  )

  return {
    mediaRequests: () => mediaRequests,
    readRequests: () => readRequests,
    setInspiration: (inspiration) => {
      current.inspiration = inspiration
    },
  }
}

function signedRead(expiresInSeconds: number) {
  return {
    ok: true,
    url: `https://storage.test/read/${expiresInSeconds}?token=read-token`,
    expiresInSeconds,
  }
}

const photo = (page: Page) =>
  page.getByRole('img', { name: 'Your inspiration photo' })

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
const errorState = (page: Page) => page.getByTestId('consult-inspiration-image-error')

test.describe('consult inspiration image', () => {
  test('renders for a LOOK-anchored consult and reads once, not in a loop', async ({
    page,
  }) => {
    const { mediaRequests } = await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await expect(photo(page)).toBeVisible()
    await expect(photo(page)).toHaveJSProperty('complete', true)
    await expect(errorState(page)).toHaveCount(0)
    const afterMount = mediaRequests()
    expect(afterMount).toBeLessThanOrEqual(STRICT_MODE_MOUNT_READS)

    // The renewal is scheduled for ~9 minutes out. Anything that reads the
    // expiry wrong (undefined → NaN, or a delay of 0) shows up here as a
    // climbing count long before then.
    await page.waitForTimeout(6_000)
    expect(mediaRequests()).toBe(afterMount)
  })

  test('renders for an UPLOAD-source consult', async ({ page }) => {
    const { mediaRequests } = await stubConsult(page, {
      inspiration: uploadSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await expect(photo(page)).toBeVisible()
    await expect(errorState(page)).toHaveCount(0)
    expect(mediaRequests()).toBeLessThanOrEqual(STRICT_MODE_MOUNT_READS)
  })

  test('surfaces a failed read with a retry instead of an empty panel', async ({
    page,
  }) => {
    const { mediaRequests } = await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) =>
        route.fulfill({
          status: 503,
          json: { ok: false, error: 'Private inspiration storage is unavailable.' },
        }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await expect(errorState(page)).toBeVisible()
    await expect(photo(page)).toHaveCount(0)
    await expect(page.getByText('Loading your inspiration photo…')).toHaveCount(0)

    // A failure schedules NOTHING. Waiting is the assertion.
    const afterMount = mediaRequests()
    expect(afterMount).toBeLessThanOrEqual(STRICT_MODE_MOUNT_READS)
    await page.waitForTimeout(6_000)
    expect(mediaRequests()).toBe(afterMount)

    // Retry is the ONLY thing that reads again — exactly once per press.
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(errorState(page)).toBeVisible()
    expect(mediaRequests()).toBe(afterMount + 1)
  })

  test('treats a wrong-shaped 200 as a failure, not as a URL', async ({
    page,
  }) => {
    // Exactly the old bug: the endpoint answered a look DTO — a 200 with no
    // `url` and no `expiresInSeconds`. Fail CLOSED and schedule nothing.
    const { mediaRequests } = await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) =>
        route.fulfill({
          json: { ok: true, look: { id: 'look_fixture_1', caption: 'A look' } },
        }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await expect(errorState(page)).toBeVisible()
    await expect(photo(page)).toHaveCount(0)
    const afterMount = mediaRequests()
    expect(afterMount).toBeLessThanOrEqual(STRICT_MODE_MOUNT_READS)
    await page.waitForTimeout(6_000)
    expect(mediaRequests()).toBe(afterMount)
  })
})

// ── P5a — the consult as a THREAD ───────────────────────────────────────────
//
// Driven in a real browser for the reasons a unit test cannot cover: the sticky
// CTA is a layout claim, "no free-text input" is a claim about what the DOM
// contains, and "resume lands on the open step" is a scroll claim. All three
// were green in every unit test while being wrong on screen.

test.describe('consult thread', () => {
  test('renders the flow as a chat: the opening line, ONE open step, and nothing after it', async ({
    page,
  }) => {
    await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // The opening bubble and the inspiration step — the one the server says
    // is next — are on screen. The photo requests are NOT: one thing at a time
    // (Tori, 2026-09-11), so a step she has not reached is not on the page,
    // dimmed or otherwise.
    await expect(
      page.getByText('Love this one.', { exact: false }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: 'Which color or colors in this picture are your favorite?',
      }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Face front' })).toHaveCount(0)
    await expect(page.locator('[data-thread-message="photo:early_photo"]')).toHaveCount(0)
  })

  test('has NO free-text input anywhere in the thread', async ({ page }) => {
    await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
    await expect(
      page.getByRole('heading', {
        name: 'Which color or colors in this picture are your favorite?',
      }),
    ).toBeVisible()

    // Every prompt is a tappable card. A textarea or a text input anywhere here
    // means the deterministic-and-free property has quietly been given up.
    await expect(page.locator('textarea')).toHaveCount(0)
    await expect(page.locator('input[type="text"]')).toHaveCount(0)
  })

  test('renders a CONTRACT-V2 pack card — its own question, its own options, no text box', async ({
    page,
  }) => {
    // P5c. The card is built from whatever question the server sent, so a pack
    // for a family that is not hair has to render with nothing colour-specific
    // left on screen. Driven in a browser because the failure it guards — a
    // client that switches on the seven v1 question keys and renders nothing —
    // is invisible to every test that asserts on the DTO.
    await stubConsult(page, {
      inspiration: generalServiceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    await expect(
      page.getByRole('heading', { name: 'What do you like most about this picture?' }),
    ).toBeVisible()
    for (const option of ['The color', 'The shape', 'The finish', 'The overall look']) {
      await expect(page.getByRole('button', { name: option, exact: true })).toBeVisible()
    }
    // Not one colour question, and no way to type: v2 stores keys and enums.
    await expect(
      page.getByText('Which color or colors in this picture are your favorite?'),
    ).toHaveCount(0)
    await expect(page.locator('textarea')).toHaveCount(0)
    await expect(page.locator('input[type="text"]')).toHaveCount(0)
  })

  test('shows a sent photo as sent, the refused one as the open step, and the next not yet', async ({ page }) => {
    // The chat has reached the guided pack: the cards are answered, the early
    // photo is in, the first guided shot was accepted and the second refused.
    await stubConsult(page, {
      inspiration: withCardsAnswered(cardInspiration),
      media: (route) => route.fulfill({ json: signedRead(600) }),
      earlyPhoto: ACCEPTED_SELFIE,
      slotOverrides: { hair_left: 'REJECTED', hair_right: 'EMPTY' },
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // Accepted and refused are visibly different things — the failure this
    // guards is a sent photo reading as one never taken. The accepted shot is
    // history (her line says it passed); the refused one is the open step,
    // with its retake; the shot after it is not on the page yet.
    await expect(page.getByText('Passed').first()).toBeVisible()
    await expect(page.getByText('Retake').first()).toBeVisible()
    await expect(page.getByText('Needed')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Right side' })).toHaveCount(0)
  })

  test('Book the look is disabled until a selfie is in, and says why', async ({
    page,
  }) => {
    await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
      bookEnabled: false,
      slotOverrides: { face_front: 'EMPTY' },
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const cta = page.getByRole('button', { name: 'Book the look' })
    await expect(cta).toBeVisible()
    await expect(cta).toBeDisabled()
    // A dead button with no explanation is what makes a client think the app is
    // broken, so the reason is part of the assertion.
    await expect(
      page.getByText('Send one photo of yourself and this opens up.'),
    ).toBeVisible()
  })

  test('Book the look goes live once the selfie is accepted', async ({
    page,
  }) => {
    await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
      bookEnabled: true,
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const cta = page.getByRole('button', { name: 'Book the look' })
    await expect(cta).toBeVisible()
    await expect(cta).toBeEnabled()
    await expect(
      page.getByText('Send one photo of yourself and this opens up.'),
    ).toHaveCount(0)
  })

  // ── P5b: the read stage, in a real browser ───────────────────────────────
  //
  // Three things a unit test cannot see: that the page ASKS exactly once (it is
  // a paid call on an effect — the same shape that produced 4,457 requests in
  // six seconds above), that a failure is READABLE rather than an empty pause,
  // and that none of it takes the Book button away.

  test('asks for the reading once, shows that it is happening, and stops asking', async ({
    page,
  }) => {
    const stub = await stubConsult(page, {
      inspiration: withAnalysisReady(lookSourceInspiration, false),
      media: (route) => route.fulfill({ json: signedRead(600) }),
      read: async (route) => {
        // The server answers with the state it just produced.
        stub.setInspiration(withAnalysisReady(lookSourceInspiration, true))
        await route.fulfill({
          json: {
            ok: true,
            read: true,
            inspiration: withAnalysisReady(lookSourceInspiration, true),
          },
        })
      },
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // It asked, and the client was told what was happening while it did.
    await expect
      .poll(() => stub.readRequests(), { timeout: 10_000 })
      .toBeGreaterThan(0)
    await expect(page.getByTestId('consult-inspiration-read-error')).toHaveCount(0)

    // Once the reading exists it stops asking. A count that climbs here is the
    // effect re-firing on every poll — a paid call on a loop.
    await page.waitForTimeout(6_000)
    expect(stub.readRequests()).toBeLessThanOrEqual(STRICT_MODE_MOUNT_READS)
    await expect(page.getByTestId('consult-inspiration-reading')).toHaveCount(0)
  })

  test('surfaces an unreadable photograph, and retries only when asked', async ({
    page,
  }) => {
    const stub = await stubConsult(page, {
      inspiration: withAnalysisReady(lookSourceInspiration, false),
      media: (route) => route.fulfill({ json: signedRead(600) }),
      read: (route) =>
        route.fulfill({
          status: 422,
          json: {
            ok: false,
            error: 'We couldn’t read this one — try another photo or a clearer shot.',
            code: 'CONSULT_INSPIRATION_ANALYSIS_UNREADABLE',
          },
        }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    const failure = page.getByTestId('consult-inspiration-read-error')
    await expect(failure).toBeVisible()
    await expect(
      failure.getByText('We couldn’t read this one — try another photo or a clearer shot.'),
    ).toBeVisible()

    // 🔴 A failure leaves `analysisReady` false. The effect must NOT read that
    // as "ask again" — the guard is the inspiration id it last asked about, so
    // a failed read waits for the button. A climbing count here is a paid call
    // firing on every poll of a consult whose photo cannot be read.
    const afterMount = stub.readRequests()
    expect(afterMount).toBeLessThanOrEqual(STRICT_MODE_MOUNT_READS)
    await page.waitForTimeout(6_000)
    expect(stub.readRequests()).toBe(afterMount)

    // And the spark is still bookable. Nothing about a model may take the CTA
    // away (handoff Part 2 — booking runs the ordinary look path).
    await expect(page.getByRole('button', { name: 'Book the look' })).toBeEnabled()

    await page.getByRole('button', { name: 'Have another go' }).click()
    await expect
      .poll(() => stub.readRequests(), { timeout: 10_000 })
      .toBe(afterMount + 1)
  })

  test('leaves a server with no read stage alone', async ({ page }) => {
    // Every other fixture in this file omits `analysisReady` entirely, which is
    // what a pre-P5b server answers. Absent is NOT "false": there is no read
    // route on such a server, so asking would be a POST at a 404 on a loop.
    const stub = await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
    await expect(photo(page)).toBeVisible()
    await page.waitForTimeout(3_000)
    expect(stub.readRequests()).toBe(0)
  })

  test('the sticky CTA stays on screen while the thread scrolls', async ({
    page,
  }) => {
    await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)
    const cta = page.getByRole('button', { name: 'Book the look' })
    await expect(cta).toBeVisible()

    // Scroll to the very bottom of a seven-photo thread and it is still there.
    await page.mouse.wheel(0, 4000)
    await page.waitForTimeout(500)
    await expect(cta).toBeInViewport()

    // 🔴 `toBeInViewport` is NOT enough, and this is the assertion that matters.
    // The first build of this footer was pinned to `bottom-0`, which pins to the
    // bottom of the scrollport — underneath the app shell's FIXED bottom nav.
    // It rendered, it was in the viewport, and it was covered edge to edge: the
    // button could not be pressed. Only asking the document what is actually at
    // the button's own centre catches that.
    const topmost = await cta.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      return hit === node || node.contains(hit) ? 'cta' : (hit?.tagName ?? 'nothing')
    })
    expect(topmost).toBe('cta')
  })
})
