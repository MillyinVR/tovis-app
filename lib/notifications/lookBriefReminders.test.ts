import { expect, it } from 'vitest'
import { lookBriefReminderStage } from './lookBriefReminders'

it('escalates only before a future appointment within seventy-two hours', () => {
  const now = new Date('2026-09-08T12:00:00Z')
  const stage = (hours: number) => lookBriefReminderStage(new Date(now.getTime() + hours * 3_600_000), now)
  expect(stage(-1)).toBeNull()
  expect(stage(0)).toBeNull()
  expect(stage(0.5)).toBe('DUE')
  expect(stage(2)).toBe('DUE')
  expect(stage(2.01)).toBe('SOON')
  expect(stage(24)).toBe('SOON')
  expect(stage(24.01)).toBe('AHEAD')
  expect(stage(72)).toBe('AHEAD')
  expect(stage(72.01)).toBeNull()
})
