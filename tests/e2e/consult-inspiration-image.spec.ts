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
  captureState,
  CONSULT_FIXTURE_ID,
  consultLookup,
  lookSourceInspiration,
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
  },
): Promise<{ mediaRequests: () => number }> {
  let mediaRequests = 0

  // Most specific first: Playwright matches routes in registration order.
  await page.route(`**${MEDIA}`, async (route) => {
    mediaRequests += 1
    await options.media(route)
  })
  await page.route(`**${BASE}/inspiration`, async (route) =>
    route.fulfill({ json: { ok: true, inspiration: options.inspiration } }),
  )
  await page.route(`**${BASE}/capture`, async (route) =>
    route.fulfill({ json: { ok: true, capture: captureState } }),
  )
  await page.route(`**${BASE}`, async (route) =>
    route.fulfill({ json: { ok: true, consult: consultLookup } }),
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
const errorState = (page: Page) => page.getByTestId('inspiration-image-error')

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
