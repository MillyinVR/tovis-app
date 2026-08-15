// app/pro/media/page.tsx
import { permanentRedirect } from 'next/navigation'

import { PRO_PORTFOLIO_ROUTES } from '@/app/pro/portfolio/_data/proPortfolioTypes'

export const dynamic = 'force-dynamic'

/**
 * "My media" is retired — `/pro/portfolio` is one library whose top zone IS the
 * public portfolio.
 *
 * This page could ADD to the portfolio but had no sense of it as a composition,
 * while the profile's Portfolio tab could only REMOVE. Splitting one job across
 * two screens is what made a pro curate their portfolio from every page except
 * the portfolio page.
 *
 * 🔴 Redirect rather than delete. Pros have this URL in muscle memory and in
 * bookmarks, and `/pro/media/new` (the upload flow) still lives underneath this
 * segment — it is NOT retired and must keep resolving.
 */
export default function ProMediaPage() {
  permanentRedirect(PRO_PORTFOLIO_ROUTES.portfolio)
}
