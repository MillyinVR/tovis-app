// app/_components/RoleFooter.tsx
import { getCurrentUser } from '@/lib/currentUser'
import FooterShell, { type AppRole } from './FooterShell'
import { clampSmallCount, getUnreadThreadCountForUser } from '@/lib/messagesUnread'

export const dynamic = 'force-dynamic'

function toAppRole(user: Awaited<ReturnType<typeof getCurrentUser>> | null): AppRole {
  const r = user?.role
  return r === 'PRO' ? 'PRO' : r === 'CLIENT' ? 'CLIENT' : r === 'ADMIN' ? 'ADMIN' : 'GUEST'
}

export default async function RoleFooter() {
  const user = await getCurrentUser().catch(() => null)
  const role = toAppRole(user)

  let messagesBadge: string | null = null
  if ((role === 'CLIENT' || role === 'PRO') && user?.id) {
    try {
      const count = await getUnreadThreadCountForUser(user.id)
      messagesBadge = clampSmallCount(count)
    } catch {
      messagesBadge = null
    }
  }

  return <FooterShell role={role} messagesBadge={messagesBadge} />
}