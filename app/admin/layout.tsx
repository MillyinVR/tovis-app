// app/admin/layout.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: 'none',
        color: '#111',
        fontWeight: 900,
        fontSize: 13,
        padding: '8px 10px',
        borderRadius: 999,
        border: '1px solid #e5e7eb',
        background: '#fff',
      }}
    >
      {label}
    </Link>
  )
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null)

  // Hard gate: only ADMINs belong here.
  if (!user) redirect('/login?from=/admin')
  if (user.role !== 'ADMIN') redirect('/')

  return (
    <div style={{ fontFamily: 'system-ui' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#fff',
          borderBottom: '1px solid #eee',
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            padding: '14px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'grid' }}>
            <div style={{ fontWeight: 1000, fontSize: 15 }}>Admin</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{user.email}</div>
          </div>

          <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <NavLink href="/admin" label="Dashboard" />
            <NavLink href="/admin/professionals" label="Professionals" />
            <NavLink href="/admin/services" label="Services" />
            <NavLink href="/admin/categories" label="Categories" />
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px' }}>{children}</main>
    </div>
  )
}
