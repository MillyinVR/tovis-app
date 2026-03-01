// lib/search/filters.ts
export type SearchSort = 'DISTANCE' | 'RATING' | 'PRICE'

export type SearchFilters = {
  mobile?: boolean
  available?: 'TODAY' | 'SOON' // SOON = “next 24h” (explicit, avoids timezone fights)
  priceMax?: number | null
  minRating?: number | null
  sort?: SearchSort
}

function stripPhrases(input: string, phrases: string[]) {
  let s = input
  for (const p of phrases) s = s.replaceAll(p, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

export function parseIntentFromQuery(raw: string): { cleanQuery: string; inferred: SearchFilters } {
  const q = raw.trim().toLowerCase()

  const inferred: SearchFilters = {}

  // Intent modifiers
  const hasOpenNow = q.includes('open now') || q.includes('now')
  const hasToday = q.includes('today') || q.includes('same day') || q.includes('tonight')
  const hasMobile = q.includes('mobile') || q.includes('travel') || q.includes('at home') || q.includes('in-home')

  if (hasMobile) inferred.mobile = true
  if (hasToday) inferred.available = 'TODAY'
  else if (hasOpenNow) inferred.available = 'SOON'

  // Price parsing: “under 80”, “under $80”
  const under = q.match(/\bunder\s*\$?\s*(\d{1,4})\b/)
  if (under) inferred.priceMax = Number(under[1])

  // Clean query by removing the modifiers we recognized
  const cleanQuery = stripPhrases(q, [
    'open now',
    'same day',
    'tonight',
    'today',
    'mobile',
    'travel',
    'at home',
    'in-home',
  ])

  return { cleanQuery, inferred }
}