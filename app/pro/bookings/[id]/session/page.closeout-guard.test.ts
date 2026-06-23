// app/pro/bookings/[id]/session/page.closeout-guard.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('pro booking session closeout guard', () => {
  const pagePath = path.join(__dirname, 'page.tsx')
  const source = fs.readFileSync(pagePath, 'utf8')

  it('does not bind a direct SessionStep.DONE transition action', () => {
    expect(source).not.toMatch(
      /transitionAction\.bind\(\s*null,\s*bookingId,\s*SessionStep\.DONE\s*\)/,
    )

    expect(source).not.toMatch(
      /const\s+to[A-Za-z0-9_]*\s*=\s*transitionAction\.bind\(\s*null,\s*bookingId,\s*SessionStep\.DONE\s*\)/,
    )
  })

  it('does not submit DONE as nextStep in a transitionSessionStep call', () => {
    expect(source).not.toMatch(/nextStep:\s*SessionStep\.DONE/)
    expect(source).not.toMatch(/nextStep:\s*['"]DONE['"]/)
  })

  it('routes finish through final-review finalization and after photos, not direct completion', () => {
    // Finishing the service finalizes the menu (FINISH_REVIEW) and lands on
    // after photos via the shared helper — never a direct jump to completion.
    expect(source).toContain('async function finishServiceAction')
    expect(source).toContain('finishSessionToAfterPhotos')
    expect(source).toContain('redirect(afterPhotosHref(bookingId))')
    expect(source).toContain('Finish closeout')
  })

  it('finalizes the booking review inside the finish helper', () => {
    const helperPath = path.join(
      __dirname,
      '../../../../../lib/booking/finishSessionToAfterPhotos.ts',
    )
    const helperSource = fs.readFileSync(helperPath, 'utf8')

    expect(helperSource).toContain('finishBookingSession')
    expect(helperSource).toContain('confirmBookingFinalReview')
  })

  it('allows read-only DONE rendering for already-completed sessions', () => {
    expect(source).toContain("screenKey === 'DONE'")
    expect(source).toContain('function DoneView')
  })
})