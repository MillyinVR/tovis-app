// app/client/layout.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function clampSmallCount(n: number) {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client')
  }

  // Policy A: badge = unread notifications (we only clear them when user visits the booking page)
  const unreadAftercareCount = await prisma.clientNotification.count({
    where: {
      clientId: user.clientProfile.id,
      type: 'AFTERCARE',
      readAt: null,
    } as any,
  })

  const aftercareBadge = clampSmallCount(unreadAftercareCount)

  const displayName = user.clientProfile?.firstName || user.email || 'there'

  return (
    <div className="min-h-screen bg-bgPrimary text-textPrimary" style={{ fontFamily: 'system-ui' }}>
      {/* Top bar */}
      <header
        className="border-b border-surfaceGlass/10"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'rgb(var(--bg-primary) / 0.72)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <div className="text-textSecondary" style={{ fontSize: 12, fontWeight: 800 }}>
                Client
              </div>
              <div className="text-textPrimary" style={{ fontSize: 16, fontWeight: 900 }}>
                Hi, {displayName}
              </div>
            </div>

            {/* Nav */}
            <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
              <NavLink href="/client">Dashboard</NavLink>
              <NavLink href="/client/bookings">Bookings</NavLink>

              <NavLink href="/client/aftercare" rightSlot={aftercareBadge ? <BadgeDot label={aftercareBadge} /> : null}>
                Aftercare
              </NavLink>

              <NavLink href="/client/settings">Settings</NavLink>
            </nav>
          </div>
        </div>
      </header>

      {/* Page content */}
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '18px 16px 90px' }}>{children}</div>
    </div>
  )
}

function NavLink({
  href,
  children,
  rightSlot,
}: {
  href: string
  children: React.ReactNode
  rightSlot?: React.ReactNode
}) {
  return (
    <a
      href={href}
      className="border border-surfaceGlass/10 bg-bgSecondary text-textPrimary"
      style={{
        textDecoration: 'none',
        borderRadius: 999,
        padding: '8px 12px',
        fontSize: 12,
        fontWeight: 900,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span>{children}</span>
      {rightSlot}
    </a>
  )
}

function BadgeDot({ label }: { label: string }) {
  return (
    <span
      className="border border-accentPrimary/35 bg-accentPrimary/12 text-accentPrimary"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 18,
        padding: '0 6px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 900,
        lineHeight: 1,
      }}
      title="Unread aftercare"
    >
      {label}
    </span>
  )
}
