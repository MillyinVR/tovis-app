// app/admin/permissions/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { AdminPermissionRole, ProfessionalLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function roleLabel(role: AdminPermissionRole) {
  if (role === AdminPermissionRole.SUPER_ADMIN) return 'SUPER_ADMIN'
  if (role === AdminPermissionRole.REVIEWER) return 'REVIEWER'
  return 'SUPPORT'
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-surfaceGlass/12 bg-bgSecondary px-2 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-black text-textSecondary">{children}</div>
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props
  return (
    <select
      {...rest}
      className={[
        'w-full rounded-card border border-surfaceGlass/12 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none',
        'focus:border-accentPrimary/50 focus:ring-2 focus:ring-accentPrimary/20',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </select>
  )
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, children, ...rest } = props
  return (
    <button
      {...rest}
      className={[
        'inline-flex h-10 items-center justify-center rounded-full border border-accentPrimary/45 bg-accentPrimary/15 px-4 text-xs font-black text-accentPrimary',
        'hover:bg-accentPrimary/20 hover:border-accentPrimary/60',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function DangerButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, children, ...rest } = props
  return (
    <button
      {...rest}
      className={[
        'inline-flex items-center justify-center rounded-full border border-toneDanger/40 bg-toneDanger/10 px-3 py-2 text-xs font-black text-toneDanger',
        'hover:bg-toneDanger/15 hover:border-toneDanger/55',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export default async function AdminPermissionsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login?from=/admin/permissions')
  if (user.role !== 'ADMIN') redirect('/')

  // Require SUPER_ADMIN permission to view/manage permissions
  const superAdmin = await prisma.adminPermission.findFirst({
    where: {
      adminUserId: user.id,
      role: AdminPermissionRole.SUPER_ADMIN,
      professionalId: null,
      serviceId: null,
      categoryId: null,
    },
    select: { id: true },
  })

  if (!superAdmin) {
    return (
      <div className="grid gap-2">
        <h1 className="text-xl font-extrabold">Admin Permissions</h1>
        <p className="text-sm text-textSecondary">Forbidden. You’re an admin, not a god.</p>
      </div>
    )
  }

  const [users, permissions, professionals, services, categories] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, role: true },
      orderBy: { email: 'asc' },
      take: 5000,
    }),
    prisma.adminPermission.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        role: true,
        adminUserId: true,
        professionalId: true,
        serviceId: true,
        categoryId: true,
        createdAt: true,
      },
      take: 5000,
    }),
    prisma.professionalProfile.findMany({
      select: {
        id: true,
        businessName: true,
        locations: {
          where: { isPrimary: true },
          take: 1,
          select: {
            type: true,
            name: true,
            formattedAddress: true,
            city: true,
            state: true,
          },
        },
      },
      orderBy: { id: 'asc' },
      take: 2000,
    }),
    prisma.service.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 2000,
    }),
    prisma.serviceCategory.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
      take: 2000,
    }),
  ])

  const proOptions = professionals.map((p) => {
    const loc = p.locations?.[0] ?? null
    const mode =
  loc?.type === ProfessionalLocationType.SALON
    ? 'Salon'
    : loc?.type === ProfessionalLocationType.SUITE
      ? 'Suite'
      : loc?.type === ProfessionalLocationType.MOBILE_BASE
        ? 'Mobile'
        : loc?.type
          ? String(loc.type)
          : null


    const whereText =
      loc?.formattedAddress?.trim() ||
      [loc?.city, loc?.state].filter(Boolean).join(', ') ||
      ''

    const suffix = whereText
      ? ` • ${whereText}${mode ? ` • ${mode}` : ''}`
      : mode
        ? ` • ${mode}`
        : ' • No location yet'

    return {
      id: p.id,
      label: `${p.businessName ?? 'Unnamed pro'}${suffix}`,
    }
  })

  const serviceOptions = services.map((s) => ({ id: s.id, label: s.name }))
  const categoryOptions = categories.map((c) => ({ id: c.id, label: `${c.name} (${c.slug})` }))
  const userById = new Map(users.map((u) => [u.id, u]))

  const labelFor = (kind: 'professional' | 'service' | 'category', id: string | null) => {
    if (!id) return '—'
    const list = kind === 'professional' ? proOptions : kind === 'service' ? serviceOptions : categoryOptions
    return list.find((x) => x.id === id)?.label ?? id
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-xl font-extrabold">Admin Permissions</h1>
        <p className="text-sm text-textSecondary">
          Give admins scoped power so “ADMIN” doesn’t mean “free-for-all.”
        </p>
      </div>

      {/* Create permission */}
      <section className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div className="text-sm font-extrabold">Assign permission</div>
          <Link href="/admin" className="text-xs font-black text-textPrimary/80 hover:text-textPrimary">
            ← Admin Home
          </Link>
        </div>

        <form
          action="/api/admin/permissions"
          method="post"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          <label className="grid gap-1.5">
            <FieldLabel>Admin user</FieldLabel>
            <Select name="adminUserId" required defaultValue="">
              <option value="">Select…</option>
              {users
                .filter((u) => u.role === 'ADMIN')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
            </Select>
          </label>

          <label className="grid gap-1.5">
            <FieldLabel>Permission role</FieldLabel>
            <Select name="role" required defaultValue="SUPPORT">
              <option value="SUPPORT">SUPPORT (services/categories)</option>
              <option value="REVIEWER">REVIEWER (pro approvals)</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN (everything)</option>
            </Select>
          </label>

          <label className="grid gap-1.5">
            <FieldLabel>Scope: Professional (optional)</FieldLabel>
            <Select name="professionalId" defaultValue="">
              <option value="">None</option>
              {proOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="grid gap-1.5">
            <FieldLabel>Scope: Service (optional)</FieldLabel>
            <Select name="serviceId" defaultValue="">
              <option value="">None</option>
              {serviceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="grid gap-1.5">
            <FieldLabel>Scope: Category (optional)</FieldLabel>
            <Select name="categoryId" defaultValue="">
              <option value="">None</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>

          <div className="flex items-end">
            <PrimaryButton type="submit" className="w-full md:w-auto">
              Add permission
            </PrimaryButton>
          </div>
        </form>

        <p className="mt-3 text-xs text-textSecondary">
          Tip: leave all scope fields blank to create a global permission for that role.
        </p>
      </section>

      {/* Existing permissions */}
      <section className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
        <div className="mb-3 text-sm font-extrabold">Existing permissions</div>

        {permissions.length === 0 ? (
          <div className="text-sm text-textSecondary">No permissions yet. Bold strategy.</div>
        ) : (
          <div className="grid gap-3">
            {permissions.map((p) => {
              const u = userById.get(p.adminUserId)
              return (
                <div key={p.id} className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{roleLabel(p.role)}</Badge>
                    <div className="text-sm font-extrabold">{u?.email ?? p.adminUserId}</div>
                  </div>

                  <div className="mt-2 grid gap-1 text-sm text-textSecondary">
                    <div>
                      <span className="font-black text-textPrimary/90">Professional:</span>{' '}
                      <span className="text-textPrimary">{labelFor('professional', p.professionalId)}</span>
                    </div>
                    <div>
                      <span className="font-black text-textPrimary/90">Service:</span>{' '}
                      <span className="text-textPrimary">{labelFor('service', p.serviceId)}</span>
                    </div>
                    <div>
                      <span className="font-black text-textPrimary/90">Category:</span>{' '}
                      <span className="text-textPrimary">{labelFor('category', p.categoryId)}</span>
                    </div>
                  </div>

                  <form className="mt-3" action={`/api/admin/permissions/${encodeURIComponent(p.id)}`} method="post">
                    <input type="hidden" name="_method" value="DELETE" />
                    <DangerButton type="submit">Remove</DangerButton>
                  </form>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
