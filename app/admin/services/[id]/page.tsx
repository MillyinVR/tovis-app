// app/admin/services/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { AdminPermissionRole, ProfessionType } from '@prisma/client'
import AdminGuard from '../../_components/AdminGuard'

export const dynamic = 'force-dynamic'

export default async function AdminServiceDetailPage({ params }: { params: { id: string } }) {
  const service = await prisma.service.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      description: true,
      defaultDurationMinutes: true,
      minPrice: true,
      defaultImageUrl: true,
      allowMobile: true,
      isActive: true,
      categoryId: true,
      permissions: { select: { id: true, professionType: true, stateCode: true } },
      category: { select: { name: true } },
    },
  })

  if (!service) notFound()

  const categories = await prisma.serviceCategory.findMany({
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, parentId: true },
    take: 500,
  })

  // Build checkbox defaults properly:
  // - checked if there exists ANY permission for that professionType (any state)
  const checkedByProfession = new Set(service.permissions.map((p) => p.professionType))

  const allProfessions = Object.values(ProfessionType)

  return (
    <AdminGuard
      from={`/admin/services/${encodeURIComponent(service.id)}`}
      allowedRoles={[AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT]}
      scope={{ serviceId: service.id, categoryId: service.categoryId }}
    >
      <main style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>{service.name}</h1>
            <div style={{ color: '#6b7280', fontSize: 13 }}>Category: {service.category?.name || '—'}</div>
          </div>
          <Link href="/admin/services" style={{ fontSize: 12, fontWeight: 900, textDecoration: 'none', color: '#111' }}>
            ← Back
          </Link>
        </div>

        <section style={{ border: '1px solid #eee', background: '#fff', borderRadius: 16, padding: 16, display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 900 }}>Edit service</div>

          <form action={`/api/admin/services/${encodeURIComponent(service.id)}`} method="post" style={{ display: 'grid', gap: 10 }}>
            <input type="hidden" name="_method" value="PATCH" />

            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Name</div>
              <input name="name" defaultValue={service.name} required style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }} />
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Category</div>
              <select name="categoryId" defaultValue={service.categoryId} required style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? '  ↳ ' : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Default duration (minutes)</div>
              <input
                name="defaultDurationMinutes"
                type="number"
                min={5}
                step={5}
                defaultValue={service.defaultDurationMinutes}
                required
                style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Min price</div>
              <input
                name="minPrice"
                type="number"
                min={0}
                step="0.01"
                defaultValue={String(service.minPrice)}
                required
                style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Description (optional)</div>
              <textarea name="description" defaultValue={service.description ?? ''} rows={3} style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }} />
            </label>

            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <input name="allowMobile" type="checkbox" value="true" defaultChecked={service.allowMobile} />
              Allow mobile
            </label>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="submit" style={{ border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 12, padding: '10px 12px', fontWeight: 900 }}>
                Save
              </button>
            </div>
          </form>
        </section>

        <section style={{ border: '1px solid #eee', background: '#fff', borderRadius: 16, padding: 16, display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 900 }}>Permissions</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Choose which professions can offer this service. Optional: limit to a state (2-letter code). Leaving state blank = all states.
          </div>

          <form action={`/api/admin/services/${encodeURIComponent(service.id)}/permissions`} method="post" style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>State code filter (optional)</div>
              <input name="stateCode" placeholder="CA" maxLength={2} style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }} />
            </label>

            <div style={{ display: 'grid', gap: 8 }}>
              {allProfessions.map((pt) => (
                <label key={pt} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" name="professionType" value={pt} defaultChecked={checkedByProfession.has(pt)} />
                  {pt}
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="submit" style={{ border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 12, padding: '10px 12px', fontWeight: 900 }}>
                Replace permissions
              </button>
            </div>
          </form>

          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900, marginBottom: 8 }}>Current permissions</div>
            {service.permissions.length ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {service.permissions.map((p) => (
                  <div key={p.id} style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 900 }}>{p.professionType}</span>
                    <span style={{ color: '#6b7280' }}> {p.stateCode ? `· ${p.stateCode}` : '· All states'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#6b7280', fontSize: 13 }}>No permissions set yet.</div>
            )}
          </div>
        </section>
      </main>
    </AdminGuard>
  )
}
