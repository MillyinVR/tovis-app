// app/admin/services/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'

export const dynamic = 'force-dynamic'

function money(v: any) {
  try {
    const n = Number(v)
    if (!Number.isFinite(n)) return String(v ?? '—')
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n)
  } catch {
    return String(v ?? '—')
  }
}

export default async function AdminServicesPage() {
  const info = await getAdminUiPerms()
  if (!info) redirect('/login?from=/admin/services')
  if (!info.perms.canManageCatalog) redirect('/admin')

  const [categories, services] = await Promise.all([
    prisma.serviceCategory.findMany({
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, parentId: true, isActive: true },
      take: 500,
    }),
    prisma.service.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        isActive: true,
        allowMobile: true,
        defaultDurationMinutes: true,
        minPrice: true,
        category: { select: { id: true, name: true } },
      },
      take: 500,
    }),
  ])

  const topCats = categories.filter((c) => !c.parentId)
  const childrenByParent = new Map<string, typeof categories>()
  for (const c of categories) {
    if (!c.parentId) continue
    const arr = childrenByParent.get(c.parentId) ?? []
    arr.push(c)
    childrenByParent.set(c.parentId, arr)
  }

  return (
    <main style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Services & Categories</h1>
          <div style={{ color: '#6b7280', fontSize: 13 }}>Manage the catalog. This is where the app stops being a toy.</div>
        </div>
        <Link href="/admin" style={{ fontSize: 12, fontWeight: 900, textDecoration: 'none', color: '#111' }}>
          ← Admin Home
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 14 }}>
        {/* Categories */}
        <section style={{ border: '1px solid #eee', background: '#fff', borderRadius: 16, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Categories</div>
            <span style={{ fontSize: 12, color: '#6b7280' }}>{categories.length} total</span>
          </div>

          <form
            action="/api/admin/categories"
            method="post"
            style={{ display: 'grid', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}
          >
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Create category</div>

            <input name="name" placeholder="Name (ex: Hair)" required style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }} />
            <input name="slug" placeholder="Slug (ex: hair)" required style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }} />

            <select name="parentId" defaultValue="" style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }}>
              <option value="">No parent (top-level)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.slug})
                </option>
              ))}
            </select>

            <button
              type="submit"
              style={{ border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 12, padding: '10px 12px', fontWeight: 900 }}
            >
              Create
            </button>
          </form>

          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {topCats.map((c) => {
              const kids = childrenByParent.get(c.id) ?? []
              return (
                <div key={c.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontWeight: 900 }}>
                      {c.name} <span style={{ color: '#6b7280', fontSize: 12 }}>({c.slug})</span>
                    </div>
                    <form action={`/api/admin/categories/${encodeURIComponent(c.id)}`} method="post">
                      <input type="hidden" name="_method" value="PATCH" />
                      <input type="hidden" name="isActive" value={String(!c.isActive)} />
                      <button
                        type="submit"
                        style={{
                          border: '1px solid #ddd',
                          background: '#fff',
                          borderRadius: 999,
                          padding: '6px 10px',
                          fontSize: 12,
                          fontWeight: 900,
                          cursor: 'pointer',
                        }}
                      >
                        {c.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </form>
                  </div>

                  {kids.length ? (
                    <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                      {kids.map((k) => (
                        <div key={k.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
                          <div style={{ fontSize: 13 }}>
                            <span style={{ fontWeight: 900 }}>{k.name}</span> <span style={{ color: '#6b7280' }}>({k.slug})</span>
                          </div>
                          <form action={`/api/admin/categories/${encodeURIComponent(k.id)}`} method="post">
                            <input type="hidden" name="_method" value="PATCH" />
                            <input type="hidden" name="isActive" value={String(!k.isActive)} />
                            <button
                              type="submit"
                              style={{
                                border: '1px solid #ddd',
                                background: '#fff',
                                borderRadius: 999,
                                padding: '6px 10px',
                                fontSize: 12,
                                fontWeight: 900,
                                cursor: 'pointer',
                              }}
                            >
                              {k.isActive ? 'Disable' : 'Enable'}
                            </button>
                          </form>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>No subcategories yet.</div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Services */}
        <section style={{ border: '1px solid #eee', background: '#fff', borderRadius: 16, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Services</div>
            <span style={{ fontSize: 12, color: '#6b7280' }}>{services.length} total</span>
          </div>

          <form
            action="/api/admin/services"
            method="post"
            style={{ display: 'grid', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}
          >
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Create service</div>

            <input name="name" placeholder="Service name (ex: Haircut)" required style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }} />

            <select name="categoryId" required style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }}>
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentId ? '  ↳ ' : ''}
                  {c.name}
                </option>
              ))}
            </select>

            <input name="defaultDurationMinutes" type="number" min={5} step={5} placeholder="Default duration (minutes)" required style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }} />
            <input name="minPrice" type="number" min={0} step="0.01" placeholder="Min price (ex: 45.00)" required style={{ border: '1px solid #ddd', borderRadius: 12, padding: 10 }} />

            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <input name="allowMobile" type="checkbox" value="true" />
              Allow mobile
            </label>

            <button
              type="submit"
              style={{ border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 12, padding: '10px 12px', fontWeight: 900 }}
            >
              Create
            </button>
          </form>

          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {services.map((s) => (
              <div key={s.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 900 }}>
                    {s.name}{' '}
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      · {s.category?.name || 'Uncategorized'} · {s.defaultDurationMinutes}m · {money(s.minPrice)}
                      {s.allowMobile ? ' · Mobile' : ''}
                    </span>
                  </div>

                  <form action={`/api/admin/services/${encodeURIComponent(s.id)}`} method="post">
                    <input type="hidden" name="_method" value="PATCH" />
                    <input type="hidden" name="isActive" value={String(!s.isActive)} />
                    <button
                      type="submit"
                      style={{
                        border: '1px solid #ddd',
                        background: '#fff',
                        borderRadius: 999,
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                    >
                      {s.isActive ? 'Disable' : 'Enable'}
                    </button>
                  </form>
                </div>

                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                  <Link
                    href={`/admin/services/${encodeURIComponent(s.id)}`}
                    style={{
                      textDecoration: 'none',
                      border: '1px solid #ddd',
                      borderRadius: 999,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 900,
                      color: '#111',
                    }}
                  >
                    Edit + permissions
                  </Link>
                </div>
              </div>
            ))}

            {services.length === 0 ? <div style={{ color: '#6b7280', fontSize: 13 }}>No services yet.</div> : null}
          </div>
        </section>
      </div>
    </main>
  )
}
