// app/(main)/book ing/AvailabilityDrawer/utils/mergeAvailableDays.ts
import type { AvailabilityDaySummary } from '../types'

export function mergeAvailableDays(
  current: AvailabilityDaySummary[],
  incoming: AvailabilityDaySummary[],
): AvailabilityDaySummary[] {
  const byDate = new Map<string, AvailabilityDaySummary>()

  for (const row of current) {
    byDate.set(row.date, row)
  }

  for (const row of incoming) {
    byDate.set(row.date, row)
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  )
}