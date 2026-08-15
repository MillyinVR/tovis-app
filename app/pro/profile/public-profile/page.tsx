// app/pro/profile/public-profile/page.tsx
import { getCurrentUser } from '@/lib/currentUser'
import {
  buildWorkspaceOptions,
  workspaceCapabilityOf,
  type WorkspaceOption,
} from '@/lib/auth/workspaces'

import { redirect } from 'next/navigation'

import { PRO_PORTFOLIO_ROUTES } from '@/app/pro/portfolio/_data/proPortfolioTypes'

import ProProfileManagementShell from './_components/ProProfileManagementShell'
import {
  isRetiredPortfolioTab,
  loadProProfileManagementPage,
} from './_data/loadProProfileManagementPage'
import type { ProProfileManagementSearchParams } from './_data/proProfileManagementTypes'

export const dynamic = 'force-dynamic'

export default async function ProPublicProfilePage({
  searchParams,
}: {
  searchParams: Promise<ProProfileManagementSearchParams>
}) {
  const resolvedSearchParams = await searchParams

  // The Portfolio tab moved to `/pro/portfolio`. Redirect before the loader
  // runs so a bookmarked `?tab=portfolio` lands on the library rather than
  // silently falling through to a different tab.
  if (isRetiredPortfolioTab(resolvedSearchParams)) {
    redirect(PRO_PORTFOLIO_ROUTES.portfolio)
  }

  const model = await loadProProfileManagementPage({
    searchParams: resolvedSearchParams,
  })

  const currentUser = await getCurrentUser().catch(() => null)
  const workspaces: WorkspaceOption[] = currentUser
    ? buildWorkspaceOptions(workspaceCapabilityOf(currentUser), currentUser.role)
    : []

  return <ProProfileManagementShell model={model} workspaces={workspaces} />
}