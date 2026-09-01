// app/pro/portfolio/page.tsx
import { permanentRedirect } from 'next/navigation'

import type { ProPortfolioSearchParams } from './_data/loadProPortfolioPage'
import {
  isProPortfolioFilterKey,
  proLibraryHref,
} from './_data/proPortfolioTypes'

export const dynamic = 'force-dynamic'

/**
 * The library moved onto the pro's own profile, where their work belongs and
 * where the app actually navigates.
 *
 * 🔴 Redirect rather than delete. This route was the merged library for a while,
 * and `/pro/media` still redirects into it, so pros have it in bookmarks — and
 * a group's "Show N more" and every filter chip used to write `?filter=` URLs
 * against it. Both params are carried across so an old link lands on the same
 * view rather than on an unfiltered grid.
 */
export default async function ProPortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<ProPortfolioSearchParams>
}) {
  const resolved = searchParams ? await searchParams : null

  const rawFilter = Array.isArray(resolved?.filter)
    ? resolved?.filter[0]
    : resolved?.filter
  const rawQuery = Array.isArray(resolved?.q) ? resolved?.q[0] : resolved?.q

  permanentRedirect(
    proLibraryHref({
      filter: isProPortfolioFilterKey(rawFilter) ? rawFilter : undefined,
      q: rawQuery ?? null,
    }),
  )
}
