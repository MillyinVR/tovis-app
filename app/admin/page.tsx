// app/admin/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'

export const dynamic = 'force-dynamic'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function Card({
  title,
  desc,
  href,
  cta,
  tone = 'default',
}: {
  title: string
  desc: string
  href: string
  cta: string
  tone?: 'default' | 'highlight'
}) {
  return (
    <Link
      href={href}
      className={cx(
        'group grid gap-2 rounded-card border p-4 transition',
        'bg-bgSecondary text-textPrimary',
        tone === 'highlight'
          ? 'border-accentPrimary/20 hover:border-accentPrimary/28 hover:bg-accentPrimary/8'
          : 'border-surfaceGlass/10 hover:border-surfaceGlass/16 hover:bg-surfaceGlass/6',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-extrabold">{title}</div>
        <span
          aria-hidden="true"
          className={cx(
            'mt-0.5 inline-flex h-6 items-center justify-center rounded-full border px-2 text-[11px] font-black',
            tone === 'highlight'
              ? 'border-accentPrimary/25 bg-accentPrimary/10 text-accentPrimary'
              : 'border-surfaceGlass/14 bg-bgPrimary/20 text-textSecondary',
          )}
        >
          Tool
        </span>
      </div>

      <div className="text-sm text-textSecondary">{desc}</div>

      <div className="mt-1 inline-flex items-center gap-2 text-xs font-black text-accentPrimary">
        <span>{cta}</span>
        <span aria-hidden="true" className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">
          →
        </span>
      </div>
    </Link>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <div className="text-sm font-extrabold">{title}</div>
        {subtitle ? <div className="text-sm text-textSecondary">{subtitle}</div> : null}
      </div>
      {children}
    </div>
  )
}

export default async function AdminHomePage() {
  // ✅ Consistent with other admin pages: require auth/permissions object
  const info = await getAdminUiPerms()
  if (!info) redirect('/login?from=/admin')

  const perms = info.perms

  const canSeeAny =
    Boolean(perms.canReviewPros) ||
    Boolean(perms.canManageCatalog) ||
    Boolean(perms.canManagePermissions) ||
    Boolean(perms.canViewLogs)

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h1 className="text-xl font-extrabold">Admin Dashboard</h1>
        <p className="text-sm text-textSecondary">
          Approve pros, manage services/categories, and keep the platform from turning into a dumpster fire with push
          notifications.
        </p>
      </div>

      <Section title="Operations" subtitle="The stuff that makes the real world work: cards, attribution, and onboarding flows.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card
            title="NFC Cards"
            desc="Generate cards + short codes, copy tap URLs, and ship physical cards without chaos."
            href="/admin/nfc"
            cta="Manage cards"
            tone="highlight"
          />
        </div>
      </Section>

      <Section title="Core admin tools" subtitle="Platform control panels. Use wisely. Or at least use them with supervision.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {perms.canReviewPros ? (
            <Card
              title="Professionals queue"
              desc="Review applications, approve/decline, flag for changes, suspend if needed."
              href="/admin/professionals"
              cta="Open queue"
            />
          ) : null}

          {perms.canManageCatalog ? (
            <>
              <Card title="Services" desc="Curate service definitions and guardrails." href="/admin/services" cta="Manage services" />
              <Card
                title="Categories"
                desc="Control taxonomy so discovery stays sane."
                href="/admin/categories"
                cta="Manage categories"
              />
            </>
          ) : null}

          {perms.canManagePermissions ? (
            <Card title="Permissions" desc="Scope what admins can do." href="/admin/permissions" cta="Manage permissions" />
          ) : null}

          {perms.canViewLogs ? (
            <Card title="Logs" desc="Audit trail for admin actions." href="/admin/logs" cta="View logs" />
          ) : null}

          {!canSeeAny ? (
            <div className="rounded-card border border-surfaceGlass/12 bg-bgSecondary p-4 sm:col-span-2 lg:col-span-3">
              <div className="text-sm font-extrabold">No admin permissions assigned</div>
              <div className="mt-1 text-sm text-textSecondary">
                You’re an admin user, but your UI permissions are currently empty. Assign permissions in{' '}
                <span className="font-black text-textPrimary/90">Admin → Permissions</span> or update your seed/roles.
              </div>
            </div>
          ) : null}
        </div>
      </Section>

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