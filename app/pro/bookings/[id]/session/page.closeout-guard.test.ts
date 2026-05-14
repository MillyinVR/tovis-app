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

  it('routes wrap-up through final review and after photos, not direct completion', () => {
    expect(source).toContain('async function wrapUpAction')
    expect(source).toContain('confirmBookingFinalReview')
    expect(source).toContain('redirect(afterPhotosHref(bookingId))')
    expect(source).toContain('Finish closeout')
  })

  it('allows read-only DONE rendering for already-completed sessions', () => {
    expect(source).toContain("screenKey === 'DONE'")
    expect(source).toContain('function DoneView')
  })
})