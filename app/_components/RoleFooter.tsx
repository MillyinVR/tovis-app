// app/_components/RoleFooter.tsx
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import FooterShell, { type AppRole } from './FooterShell'

function clampSmallCount(n: number) {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

export default async function RoleFooter() {
  const user = await getCurrentUser().catch(() => null)

  const role: AppRole =
    user?.role === 'PRO' ? 'PRO' :
    user?.role === 'CLIENT' ? 'CLIENT' :
    user?.role === 'ADMIN' ? 'ADMIN' :
    'GUEST'

  // Optional: client aftercare badge (unread count)
  let clientInboxBadge: string | null = null

  if (role === 'CLIENT' && user?.clientProfile?.id) {
    const unreadAftercareCount = await prisma.clientNotification.count({
      where: {
        clientId: user.clientProfile.id,
        type: 'AFTERCARE',
        readAt: null,
      } as any,
    })

    clientInboxBadge = clampSmallCount(unreadAftercareCount)
  }

  return <FooterShell role={role} clientInboxBadge={clientInboxBadge} />
}
