// app/pro/portfolio/page.tsx
import type { Metadata } from 'next'

import ProPortfolioScreen from './_components/ProPortfolioScreen'
import {
  loadProPortfolioPage,
  type ProPortfolioSearchParams,
} from './_data/loadProPortfolioPage'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Portfolio',
}

export default async function ProPortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<ProPortfolioSearchParams>
}) {
  const resolved = searchParams ? await searchParams : null
  const model = await loadProPortfolioPage({ searchParams: resolved })

  return <ProPortfolioScreen model={model} />
}
