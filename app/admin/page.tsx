// app/admin/page.tsx
import Link from 'next/link'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'

export const dynamic = 'force-dynamic'

function Card({ title, desc, href, cta }: { title: string; desc: string; href: string; cta: string }) {
  return (
    <Link
      href={href}
      className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4 text-textPrimary hover:bg-surfaceGlass/6"
    >
      <div className="text-sm font-extrabold">{title}</div>
      <div className="text-sm text-textSecondary">{desc}</div>
      <div className="mt-1 text-xs font-black text-accentPrimary">
        {cta} <span aria-hidden>→</span>
      </div>
    </Link>
  )
}

export default async function AdminHomePage() {
  const info = await getAdminUiPerms()
  const perms = info?.perms

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-xl font-extrabold">Admin Dashboard</h1>
        <p className="text-sm text-textSecondary">
          Approve pros, manage services/categories, and keep the platform from turning into a dumpster fire with push
          notifications.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {perms?.canReviewPros ? (
          <Card
            title="Professionals queue"
            desc="Review applications, approve/decline, flag for changes, suspend if needed."
            href="/admin/professionals"
            cta="Open queue"
          />
        ) : null}

        {perms?.canManageCatalog ? (
          <>
            <Card title="Services" desc="Curate service definitions and guardrails." href="/admin/services" cta="Manage services" />
            <Card title="Categories" desc="Control taxonomy so discovery stays sane." href="/admin/categories" cta="Manage categories" />
          </>
        ) : null}

        {perms?.canManagePermissions ? (
          <Card title="Permissions" desc="Scope what admins can do." href="/admin/permissions" cta="Manage permissions" />
        ) : null}

        {perms?.canViewLogs ? <Card title="Logs" desc="Audit trail for admin actions." href="/admin/logs" cta="View logs" /> : null}
      </div>

      <div className="rounded-card border border-surfaceGlass/12 bg-bgSecondary p-4">
        <div className="text-sm font-extrabold">Next we’re building</div>
        <div className="mt-1 text-sm text-textSecondary">
          1) Pro approval workflow, 2) Services/categories CRUD, 3) License expiry dashboard + reminders.
        </div>
      </div>

      <div className="text-xs text-textSecondary">
        <Link href="/" className="font-black text-textPrimary/90 hover:text-textPrimary">
          Back to app
        </Link>
      </div>
    </div>
  )
}
