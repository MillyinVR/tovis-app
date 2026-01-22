// app/admin/layout.tsx
import Link from 'next/link'
import AdminGuard from './_components/AdminGuard'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'

export const dynamic = 'force-dynamic'

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-full border border-surfaceGlass/10 bg-bgSecondary px-3 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass/6"
    >
      {label}
    </Link>
  )
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const info = await getAdminUiPerms()
  const email = info?.email
  const perms = info?.perms

  return (
    <AdminGuard>
      <div className="min-h-screen text-textPrimary">
        <header className="sticky top-0 z-10 border-b border-surfaceGlass/10 bg-bgPrimary/80 backdrop-blur-app">
          <div className="mx-auto flex max-w-1100px items-center justify-between gap-3 px-4 py-3">
            <div className="grid">
              <div className="text-sm font-extrabold">Admin</div>
              <div className="text-xs text-textSecondary">{email ?? ''}</div>
            </div>

            <nav className="flex flex-wrap gap-2">
              <NavLink href="/admin" label="Dashboard" />
              {perms?.canReviewPros ? <NavLink href="/admin/professionals" label="Professionals" /> : null}
              {perms?.canManageCatalog ? (
                <>
                  <NavLink href="/admin/services" label="Services" />
                  <NavLink href="/admin/categories" label="Categories" />
                </>
              ) : null}
              {perms?.canManagePermissions ? <NavLink href="/admin/permissions" label="Permissions" /> : null}
              {perms?.canViewLogs ? <NavLink href="/admin/logs" label="Logs" /> : null}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-1100px px-4 py-5">{children}</main>
      </div>
    </AdminGuard>
  )
}
