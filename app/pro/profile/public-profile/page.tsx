// app/pro/profile/public-profile/page.tsx
import { getCurrentUser } from '@/lib/currentUser'
import {
  buildWorkspaceOptions,
  workspaceCapabilityOf,
  type WorkspaceOption,
} from '@/lib/auth/workspaces'

import ProProfileManagementShell from './_components/ProProfileManagementShell'
import { loadProProfileManagementPage } from './_data/loadProProfileManagementPage'
import type { ProProfileManagementSearchParams } from './_data/proProfileManagementTypes'

export const dynamic = 'force-dynamic'

export default async function ProPublicProfilePage({
  searchParams,
}: {
  searchParams: Promise<ProProfileManagementSearchParams>
}) {
  const resolvedSearchParams = await searchParams

  const model = await loadProProfileManagementPage({
    searchParams: resolvedSearchParams,
  })

  const currentUser = await getCurrentUser().catch(() => null)
  const workspaces: WorkspaceOption[] = currentUser
    ? buildWorkspaceOptions(workspaceCapabilityOf(currentUser), currentUser.role)
    : []

  return <ProProfileManagementShell model={model} workspaces={workspaces} />
}