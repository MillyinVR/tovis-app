import { expect, it } from 'vitest'
import { lookProposalDurationMinutes } from './lookProposalSummary'
it('shows only resolved, complete version-pinned appointment timing', () => {
  const items = [{ durationMinutes: 120 }, { durationMinutes: 30 }]
  expect(lookProposalDurationMinutes({ items })).toBeNull()
  expect(lookProposalDurationMinutes({ lookBriefVersionId: 'brief-4', items })).toBe(150)
  expect(lookProposalDurationMinutes({ lookBriefVersionId: 'brief-4', items: [{ durationMinutes: null }] })).toBeNull()
  expect(lookProposalDurationMinutes({ lookBriefVersionId: 'brief-4', items: [] })).toBeNull()
})
