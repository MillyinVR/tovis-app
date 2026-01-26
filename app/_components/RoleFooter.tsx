// app/_components/RoleFooter.tsx
import { getCurrentUser } from '@/lib/currentUser'
import FooterShell, { type AppRole } from './FooterShell'
import { clampSmallCount, getUnreadThreadCountForUser } from '@/lib/messagesUnread'

export const dynamic = 'force-dynamic'

export default async function RoleFooter() {
  const user = await getCurrentUser().catch(() => null)

  const role: AppRole =
    user?.role === 'PRO'
      ? 'PRO'
      : user?.role === 'CLIENT'
        ? 'CLIENT'
        : user?.role === 'ADMIN'
          ? 'ADMIN'
          : 'GUEST'

  let messagesBadge: string | null = null

  if ((role === 'CLIENT' || role === 'PRO') && user?.id) {
    messagesBadge = await getUnreadThreadCountForUser(user.id)
      .then(clampSmallCount)
      .catch(() => null)
  }

  return <FooterShell role={role} messagesBadge={messagesBadge} />
}
