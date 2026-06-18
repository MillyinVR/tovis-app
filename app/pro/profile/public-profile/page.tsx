// app/pro/profile/public-profile/page.tsx
import { getCurrentUser } from '@/lib/currentUser'
import { buildWorkspaceOptions, type WorkspaceOption } from '@/lib/auth/workspaces'

import ProProfileManagementShell from './_components/ProProfileManagementShell'
import { loadProProfileManagementPage } from './_data/loadProProfileManagementPage'
import type { ProProfileManagementSearchParams } from './_data/proProfileManagementTypes'

export const dynamic = 'force-dynamic'

export default async function ProPublicProfilePage({
  searchParams,
}: {
  searchParams: Promise<ProProfileManagementSearchParams>
}) {
  const model = await loadProProfileManagementPage({
    searchParams: await searchParams,
  })

  const currentUser = await getCurrentUser().catch(() => null)
  const workspaces: WorkspaceOption[] = currentUser
    ? buildWorkspaceOptions(
        {
          homeRole: currentUser.homeRole,
          clientProfile: currentUser.clientProfile,
          professionalProfile: currentUser.professionalProfile,
        },
        currentUser.role,
      )
    : []

  return <ProProfileManagementShell model={model} workspaces={workspaces} />
}