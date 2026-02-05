// app/(main)/layout.tsx
import type { ReactNode } from 'react'
import { getCurrentUser } from '@/lib/currentUser'
import FooterShell from '@/app/_components/FooterShell'

export const dynamic = 'force-dynamic'

export default async function MainLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser().catch(() => null)

  const role =
    user?.role === 'PRO'
      ? 'PRO'
      : user?.role === 'CLIENT'
        ? 'CLIENT'
        : user?.role === 'ADMIN'
          ? 'ADMIN'
          : 'GUEST'

  return (
    <div className="min-h-dvh bg-bgPrimary text-textPrimary">
      {/* This padding prevents content hiding under the footer for ALL roles */}
      <div style={{ paddingBottom: 'calc(var(--app-footer-space, 0px) + env(safe-area-inset-bottom))' }}>
        {children}
      </div>

      <FooterShell role={role} messagesBadge={null} />
    </div>
  )
}
