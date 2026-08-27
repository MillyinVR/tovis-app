// app/pro/migrate/_utils/parseDurationMinutes.ts
//
// Duration cell → minutes, for imported service menus. Competitor exports
// write durations every which way — "90", "90 min", "1:30", "1.5 hr",
// "3 hours", "1h 15m" — and grabbing the first bare number reads "3 hours"
// as three MINUTES, which then books a three-minute Balayage. Units first,
// bare number only as the fallback.

export function parseDurationMinutes(value: string | undefined): number | null {
  if (!value) return null
  const s = value.toLowerCase().replace(/,/g, ' ').trim()
  if (!s) return null

  // "1:30" / "01:05" — hours:minutes
  const clock = s.match(/^(\d{1,2}):(\d{2})(?!\d)/)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])

  // "1.5 hr" / "3 hours" / "1h 15m" / "45 min" — unit-tagged parts
  const hours = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?![a-z])/)
  const minutes = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)(?![a-z])/)
  if (hours || minutes) {
    const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)
    return Number.isFinite(total) && total > 0 ? Math.round(total) : null
  }

  // bare number — assume minutes (the dominant export format)
  const bare = s.match(/\d+(?:\.\d+)?/)
  return bare ? Math.round(Number(bare[0])) : null
}
