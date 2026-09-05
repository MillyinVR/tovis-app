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
  CONSULT_FIXTURE_ID,
  lookSourceInspiration,
  threadFixture,
  uploadSourceInspiration,
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
  },
): Promise<{ mediaRequests: () => number }> {
  let mediaRequests = 0

  // Most specific first: Playwright matches routes in registration order.
  await page.route(`**${MEDIA}`, async (route) => {
    mediaRequests += 1
    await options.media(route)
  })
  // P5a: ONE read drives the page. The stage endpoints still exist and still
  // serve mutations; the page no longer reads them.
  await page.route(`**${BASE}/thread`, async (route) =>
    route.fulfill({
      json: {
        ok: true,
        thread: threadFixture({
          inspiration: options.inspiration,
          bookEnabled: options.bookEnabled,
          slotOverrides: options.slotOverrides,
        }),
      },
    }),
  )
  await page.route('https://storage.test/**', async (route) =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: IMAGE_BYTES }),
  )

  return { mediaRequests: () => mediaRequests }
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
  test('renders the flow as a thread, with history left on screen', async ({
    page,
  }) => {
    await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // The opening bubble, an inspiration card and every photo request are all
    // on ONE screen. The wizard this replaces showed exactly one of them.
    await expect(
      page.getByText('Love this one.', { exact: false }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: 'Which color or colors in this picture are your favorite?',
      }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Face front' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Eyes & brows' })).toBeVisible()
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

  test('shows each photo request with its served badge', async ({ page }) => {
    await stubConsult(page, {
      inspiration: lookSourceInspiration,
      media: (route) => route.fulfill({ json: signedRead(600) }),
      slotOverrides: { face_front: 'EMPTY', eyes_closeup: 'REJECTED' },
    })

    await page.goto(`/client/consult/${CONSULT_FIXTURE_ID}`)

    // Accepted, outstanding and refused are three visibly different things —
    // the failure this guards is a sent photo reading as one never taken.
    await expect(page.getByText('Passed').first()).toBeVisible()
    await expect(page.getByText('Needed').first()).toBeVisible()
    await expect(page.getByText('Retake').first()).toBeVisible()
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
