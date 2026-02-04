// app/admin/layout.tsx
import AdminGuard from './_components/AdminGuard'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <div className="min-h-screen text-textPrimary">
        {/* No header. Admin navigation lives in admin footer. */}
        <main className="mx-auto max-w-1100px px-4 py-5">{children}</main>
      </div>
    </AdminGuard>
  )
}
