// app/admin/permissions/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type PermissionRole = 'SUPER_ADMIN' | 'SUPPORT' | 'REVIEWER'

function Badge({ text }: { text: string }) {
  return (
    <span
      className="border border-surfaceGlass/10 bg-bgSecondary"
      style={{
        fontSize: 12,
        fontWeight: 900,
        padding: '4px 8px',
        borderRadius: 999,
      }}
    >
      {text}
    </span>
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
      role: 'SUPER_ADMIN' as any, // works whether role is enum or string in Prisma
      professionalId: null,
      serviceId: null,
      categoryId: null,
    },
    select: { id: true },
  })

  if (!superAdmin) {
    return (
      <div style={{ fontFamily: 'system-ui' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 1000 }}>Admin Permissions</h1>
        <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
          Forbidden. You’re an admin, not a god.
        </p>
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
      select: { id: true, businessName: true, city: true, state: true },
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

  const proOptions = professionals.map((p) => ({
    id: p.id,
    label: `${p.businessName ?? 'Unnamed pro'}${
      p.city || p.state ? ` • ${[p.city, p.state].filter(Boolean).join(', ')}` : ''
    }`,
  }))

  const serviceOptions = services.map((s) => ({ id: s.id, label: s.name }))
  const categoryOptions = categories.map((c) => ({ id: c.id, label: `${c.name} (${c.slug})` }))

  const userById = new Map(users.map((u) => [u.id, u]))

  const labelFor = (kind: 'professional' | 'service' | 'category', id: string | null) => {
    if (!id) return '—'
    const list = kind === 'professional' ? proOptions : kind === 'service' ? serviceOptions : categoryOptions
    return list.find((x) => x.id === id)?.label ?? id
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 1000 }}>Admin Permissions</h1>
        <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.4 }}>
          Give admins scoped power so “ADMIN” doesn’t mean “free-for-all.”
        </p>
      </div>

      {/* Create permission */}
      <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 16, padding: 14 }}>
        <div style={{ fontWeight: 1000, marginBottom: 10 }}>Assign permission</div>

        <form
          action="/api/admin/permissions"
          method="post"
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            alignItems: 'end',
          }}
        >
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Admin user</div>
            <select name="adminUserId" required style={{ padding: 10, borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <option value="">Select…</option>
              {users
                .filter((u) => u.role === 'ADMIN')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Permission role</div>
            <select name="role" required style={{ padding: 10, borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <option value="SUPPORT">SUPPORT (services/categories)</option>
              <option value="REVIEWER">REVIEWER (pro approvals)</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN (everything)</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Scope: Professional (optional)</div>
            <select name="professionalId" style={{ padding: 10, borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <option value="">None</option>
              {proOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Scope: Service (optional)</div>
            <select name="serviceId" style={{ padding: 10, borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <option value="">None</option>
              {serviceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Scope: Category (optional)</div>
            <select name="categoryId" style={{ padding: 10, borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <option value="">None</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover"
            style={{
              padding: '10px 12px',
              borderRadius: 12,
              fontWeight: 900,
              cursor: 'pointer',
              height: 42,
            }}
          >
            Add permission
          </button>
        </form>

        <p style={{ margin: '10px 0 0', fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
          Tip: leave all scope fields blank to create a global permission for that role.
        </p>
      </div>

      {/* Existing permissions */}
      <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 16, padding: 14 }}>
        <div style={{ fontWeight: 1000, marginBottom: 10 }}>Existing permissions</div>

        {permissions.length === 0 ? (
          <div style={{ fontSize: 13, color: '#6b7280' }}>No permissions yet. Bold strategy.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {permissions.map((p) => {
              const u = userById.get(p.adminUserId)
              return (
                <div
                  key={p.id}
                  className="border border-surfaceGlass/10"
                  style={{
                    borderRadius: 14,
                    padding: 12,
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Badge text={String(p.role) as PermissionRole} />
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{u?.email ?? p.adminUserId}</div>
                  </div>

                  <div style={{ display: 'grid', gap: 4, fontSize: 13, color: '#374151' }}>
                    <div>
                      Professional: <span style={{ fontWeight: 700 }}>{labelFor('professional', p.professionalId)}</span>
                    </div>
                    <div>
                      Service: <span style={{ fontWeight: 700 }}>{labelFor('service', p.serviceId)}</span>
                    </div>
                    <div>
                      Category: <span style={{ fontWeight: 700 }}>{labelFor('category', p.categoryId)}</span>
                    </div>
                  </div>

                  <form action={`/api/admin/permissions/${encodeURIComponent(p.id)}`} method="post">
                    <input type="hidden" name="_method" value="DELETE" />
                    <button
                      type="submit"
                      className="bg-bgSecondary"
                      style={{
                        padding: '8px 10px',
                        borderRadius: 12,
                        border: '1px solid #ef4444',
                        color: '#b91c1c',
                        fontWeight: 900,
                        cursor: 'pointer',
                        width: 'fit-content',
                      }}
                    >
                      Remove
                    </button>
                  </form>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
