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
    <div style={{ minHeight: '100vh', background: '#fafafa', fontFamily: 'system-ui' }}>
      {/* Top bar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'rgba(250,250,250,0.9)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid #eee',
        }}
      >
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 800 }}>Client</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#111' }}>Hi, {displayName}</div>
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
      style={{
        textDecoration: 'none',
        border: '1px solid #e5e7eb',
        background: '#fff',
        color: '#111',
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
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 18,
        padding: '0 6px',
        borderRadius: 999,
        border: '1px solid #fde68a',
        background: '#fffbeb',
        color: '#854d0e',
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
