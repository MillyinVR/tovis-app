// app/_components/WorkspaceSwitchLauncher/WorkspaceSwitchLauncher.tsx
import { getCurrentUser } from '@/lib/currentUser'
import { buildWorkspaceOptions } from '@/lib/auth/workspaces'

import WorkspaceSwitchLauncherClient from './WorkspaceSwitchLauncherClient'

export const dynamic = 'force-dynamic'

/**
 * Persistent top-right control for jumping between the workspaces a user is
 * entitled to. Renders ONLY when the user can act in more than one workspace —
 * so a client-only account never sees it, while a pro (even while acting as a
 * client) and an admin always do. Mounted globally from the root layout.
 */
export default async function WorkspaceSwitchLauncher() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return null

  const options = buildWorkspaceOptions(
    {
      homeRole: user.homeRole,
      clientProfile: user.clientProfile,
      professionalProfile: user.professionalProfile,
    },
    user.role,
  )

  // buildWorkspaceOptions returns [] when there is only one workspace.
  if (options.length <= 1) return null

  return (
    <WorkspaceSwitchLauncherClient options={options} current={user.role} />
  )
}
