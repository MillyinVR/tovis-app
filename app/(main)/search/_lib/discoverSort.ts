// app/(main)/search/_lib/discoverSort.ts
//
// Client-side sort for the discover/search pro results. The API already orders
// each returned page server-side (`/api/v1/search/pros?sort=…`); this re-sorts
// the accumulated page in place so appended/merged results stay ordered and the
// grid/map cards agree. DISTANCE/RATING/NAME re-sort by the exact field the
// server ordered on (the DTO exposes each), so the two agree; PRICE re-sorts by
// the displayed `minPrice`, which can differ slightly from the server key — see
// its branch below.

import type { ApiPro } from './discoverProTypes'

export type SortMode = 'DISTANCE' | 'NAME' | 'RATING' | 'PRICE'

export function isSortMode(value: string): value is SortMode {
  return (
    value === 'DISTANCE' ||
    value === 'NAME' ||
    value === 'RATING' ||
    value === 'PRICE'
  )
}

/** Re-sort a page of pros by the chosen mode. Stable, so equal keys keep the
 *  server's tie-break order (Array.prototype.sort is stable). */
export function sortPros(list: ApiPro[], mode: SortMode): ApiPro[] {
  const sorted = [...list]

  if (mode === 'NAME') {
    sorted.sort((a, b) => (a.businessName || '').localeCompare(b.businessName || ''))
    return sorted
  }

  if (mode === 'RATING') {
    sorted.sort((a, b) => {
      const aRating = typeof a.ratingAvg === 'number' ? a.ratingAvg : -1
      const bRating = typeof b.ratingAvg === 'number' ? b.ratingAvg : -1
      if (bRating !== aRating) return bRating - aRating
      return (b.ratingCount ?? 0) - (a.ratingCount ?? 0)
    })
    return sorted
  }

  if (mode === 'PRICE') {
    // Cheapest first, by the `minPrice` the card actually shows (the DTO sets it
    // to minMobilePrice when mobile-only, else minAnyPrice — lib/search/pros.ts).
    // That's the displayed starting price, NOT the server's price sort key
    // (`COALESCE(minMobilePrice, minAnyPrice)`), so for a mobile-offering pro the
    // two can differ; sorting by the visible number is the intuitive choice.
    // Pros without a price sort last (NULLS-LAST parity); equal prices keep the
    // server's name/id tie-break (Array.sort is stable).
    sorted.sort((a, b) => {
      const aPrice = typeof a.minPrice === 'number' ? a.minPrice : Number.POSITIVE_INFINITY
      const bPrice = typeof b.minPrice === 'number' ? b.minPrice : Number.POSITIVE_INFINITY

      return aPrice - bPrice
    })
    return sorted
  }

  // DISTANCE — null distances sort last (matches the API's NULLS LAST).
  sorted.sort((a, b) => {
    const aDistance = typeof a.distanceMiles === 'number' ? a.distanceMiles : Number.POSITIVE_INFINITY
    const bDistance = typeof b.distanceMiles === 'number' ? b.distanceMiles : Number.POSITIVE_INFINITY

    return aDistance - bDistance
  })

  return sorted
}
