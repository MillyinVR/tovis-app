import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

// C2-6a — the top line of the pro Brief at a phone width and a desktop width.
//
// The pro Brief is server-rendered from the database (there is no client
// route to mock), so this renders the SHIPPING component to markup, dresses it
// in the app's own stylesheet — fetched from a public page of the running
// server, so it is the built CSS in CI and the dev CSS locally — and measures
// it in a real browser at both widths. What it proves: the line is the first
// thing in the Brief, it is rendered whole, and it wraps inside the viewport
// rather than pushing the page sideways. What it does not prove: that a pro
// reached this screen by signing in.
//
// The markup is rendered OUT OF PROCESS (tests/e2e/utils/
// renderProConsultBriefMarkup.ts): Playwright compiles every `.tsx` module it
// loads with its own JSX runtime, and React's server renderer refuses what
// comes out. Both projects run this, and each sets the viewport itself, so
// the device profile does not decide the width under test.

const TOP_LINE =
  'Client wants the color, the light blonde, and the cool, silvery cast (as close to the picture as possible) because the goal is a change people will notice, mainly going lighter. Must preserve the length and the natural roots and avoid heavy upkeep.'

const markup = execFileSync(
  'pnpm',
  ['exec', 'tsx', 'tests/e2e/utils/renderProConsultBriefMarkup.ts', TOP_LINE],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
)

test.use({ storageState: { cookies: [], origins: [] } })

for (const width of [375, 1024]) {
  test(`the top line leads the pro Brief and fits at ${width}px`, async ({ page }, testInfo) => {
    // The app's real stylesheet(s), from a page that needs no session.
    await page.goto('/login')
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map((link) => link.href),
    )
    expect(hrefs.length).toBeGreaterThan(0)
    const styles = await Promise.all(
      hrefs.map(async (href) => {
        const response = await page.request.get(href)
        expect(response.ok()).toBe(true)
        return response.text()
      }),
    )

    await page.setViewportSize({ width, height: 900 })
    await page.setContent(
      `<!doctype html><html data-mode="light"><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles
        .map((css) => `<style>${css}</style>`)
        .join('')}</head><body><main class="px-4 py-6">${markup}</main></body></html>`,
    )

    const line = page.getByTestId('consult-brief-top-line')
    await expect(line).toBeVisible()
    await expect(line).toHaveText(TOP_LINE)
    // First thing in the Brief, above the version banner and everything else.
    await expect(page.locator('article > :first-child')).toHaveAttribute('data-testid', 'consult-brief-top-line')

    const box = await line.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    // Wrapped, not clipped: a sentence pair this long cannot sit on one line
    // at either width, so a single-line-tall box means the text was cut.
    const lineHeight = await line.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
    expect(box!.height).toBeGreaterThan(lineHeight * 2)
    // The page itself never scrolls sideways.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(width)

    await page.screenshot({ path: testInfo.outputPath(`pro-brief-top-line-${width}.png`), fullPage: false })
  })
}
