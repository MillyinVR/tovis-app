// app/admin/page.tsx
import Link from 'next/link'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'

export const dynamic = 'force-dynamic'

function Card({
  title,
  desc,
  href,
  cta,
}: {
  title: string
  desc: string
  href: string
  cta: string
}) {
  return (
    <Link
      href={href}
      className="border border-surfaceGlass/10 bg-bgSecondary text-textPrimary"
      style={{
        textDecoration: 'none',
        borderRadius: 16,
        padding: 16,
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ fontWeight: 1000 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.4 }}>{desc}</div>
      <div style={{ fontSize: 12, fontWeight: 1000, marginTop: 6 }}>{cta} →</div>
    </Link>
  )
}

export default async function AdminHomePage() {
  const info = await getAdminUiPerms()
  const perms = info?.perms

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 1000 }}>Admin Dashboard</h1>
        <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
          Approve pros, manage services/categories, and keep the platform from turning into a thrift-store clearance bin.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
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
            <Card
              title="Services"
              desc="Curate service definitions, guardrails, and allowed service list."
              href="/admin/services"
              cta="Manage services"
            />
            <Card
              title="Categories"
              desc="Control taxonomy so discovery and trending don’t become chaos."
              href="/admin/categories"
              cta="Manage categories"
            />
          </>
        ) : null}

        {perms?.canManagePermissions ? (
          <Card
            title="Permissions"
            desc="Scope what admins can do (support/reviewer/super admin)."
            href="/admin/permissions"
            cta="Manage permissions"
          />
        ) : null}

        {perms?.canViewLogs ? (
          <Card
            title="Logs"
            desc="Audit trail for admin actions. Trust issues, but make them productive."
            href="/admin/logs"
            cta="View logs"
          />
        ) : null}
      </div>

      <div className="bg-bgSecondary" style={{ border: '1px dashed #e5e7eb', borderRadius: 16, padding: 14 }}>
        <div style={{ fontWeight: 1000, marginBottom: 6 }}>Next we’re building</div>
        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
          1) Pro approval workflow (status + notes + audit trail), 2) Services/categories CRUD, 3) License expiry dashboard + reminders.
        </div>
      </div>
    </div>
  )
}
