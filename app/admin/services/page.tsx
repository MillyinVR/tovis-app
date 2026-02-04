// app/admin/services/page.tsx

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'
import ServiceHeroGrid from './_components/ServiceHeroGrid'
import ServicesBrowseBar from './_components/ServicesBrowseBar'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function CardShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-sm font-extrabold text-textPrimary">{title}</div>
          {subtitle ? <div className="text-xs text-textSecondary">{subtitle}</div> : null}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-extrabold text-textSecondary">{children}</div>
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        'w-full rounded-xl border border-surfaceGlass/15 bg-bgPrimary/40 px-3 py-2 text-sm text-textPrimary',
        'placeholder:text-textSecondary/70 outline-none',
        'focus:border-surfaceGlass/30',
        props.className ?? '',
      ].join(' ')}
    />
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        'w-full rounded-xl border border-surfaceGlass/15 bg-bgPrimary/40 px-3 py-2 text-sm text-textPrimary',
        'outline-none focus:border-surfaceGlass/30',
        props.className ?? '',
      ].join(' ')}
    />
  )
}

function toStr(v: string | string[] | undefined) {
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

function toInt(v: string, fallback: number) {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export default async function AdminServicesPage(props: { searchParams?: SearchParams }) {
  const info = await getAdminUiPerms()
  if (!info) redirect('/login?from=/admin/services')
  if (!info.perms.canManageCatalog) redirect('/admin')

  const sp = (await props.searchParams) ?? {}

  const q = String(toStr(sp.q)).trim()
  const activeOnly = toStr(sp.active || '1') !== '0'

  const categoryFilter = String(toStr(sp.cat)).trim()
  const includeChildren = toStr(sp.kids || '1') !== '0'
  const page = toInt(toStr(sp.page || '1'), 1)
  const per = Math.min(120, Math.max(12, toInt(toStr(sp.per || '36'), 36)))

  const categories = await prisma.serviceCategory.findMany({
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, parentId: true, isActive: true },
    take: 2000,
  })

  const catById = new Map<string, (typeof categories)[number]>()
  for (const c of categories) catById.set(String(c.id), c)

  // Resolve category IDs to include (category + optional children)
  let categoryIdsToInclude: string[] | null = null
  if (categoryFilter) {
    const picked = catById.get(categoryFilter)
    if (picked) {
      const isTop = !picked.parentId
      if (isTop && includeChildren) {
        const kids = categories.filter((c) => String(c.parentId || '') === categoryFilter).map((c) => String(c.id))
        categoryIdsToInclude = [categoryFilter, ...kids]
      } else {
        categoryIdsToInclude = [categoryFilter]
      }
    }
  }

  const whereClause: any = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { category: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(activeOnly ? { isActive: true } : {}),
    ...(categoryIdsToInclude ? { categoryId: { in: categoryIdsToInclude } } : {}),
  }

  const [total, services] = await Promise.all([
    prisma.service.count({ where: whereClause }),
    prisma.service.findMany({
      where: whereClause,
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
      skip: (page - 1) * per,
      take: per,
      select: {
        id: true,
        name: true,
        description: true,
        categoryId: true,
        isActive: true,
        allowMobile: true,
        defaultDurationMinutes: true,
        minPrice: true,
        defaultImageUrl: true,
        isAddOnEligible: true,
        addOnGroup: true,
        category: { select: { id: true, name: true } },
      },
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / per))
  const clampedPage = Math.min(Math.max(1, page), totalPages)

  const categoryPayload = categories.map((c) => ({
    id: String(c.id),
    name: c.name,
    parentId: c.parentId ? String(c.parentId) : null,
  }))

  const servicesPayload = services.map((s) => ({
    id: String(s.id),
    name: s.name,
    description: s.description ?? null,
    categoryId: s.categoryId ? String(s.categoryId) : null,
    categoryName: s.category?.name ?? null,
    isActive: Boolean(s.isActive),
    allowMobile: Boolean(s.allowMobile),
    defaultDurationMinutes: s.defaultDurationMinutes ?? null,
    minPrice: s.minPrice ? String(s.minPrice) : null,
    defaultImageUrl: s.defaultImageUrl ?? null,
    isAddOnEligible: Boolean(s.isAddOnEligible),
    addOnGroup: s.addOnGroup ?? null,
  }))

  const topCats = categories.filter((c) => !c.parentId)
  const childrenByParent = new Map<string, typeof categories>()
  for (const c of categories) {
    if (!c.parentId) continue
    const pid = String(c.parentId)
    const arr = childrenByParent.get(pid) ?? []
    arr.push(c)
    childrenByParent.set(pid, arr)
  }

  return (
    <main className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-extrabold text-textPrimary">Services & Categories</h1>
          <p className="text-sm text-textSecondary">Manage the catalog. This is where the app stops being a toy.</p>
        </div>

        <Link href="/admin" className="text-xs font-extrabold text-textPrimary no-underline hover:text-textPrimary/90">
          ← Admin Home
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        {/* Categories */}
        <CardShell title="Categories" subtitle={`${categories.length} total`}>
          <form
            action="/api/admin/categories"
            method="post"
            className="grid gap-3 rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/30 p-3"
          >
            <FieldLabel>Create category</FieldLabel>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input name="name" placeholder="Name (ex: Hair)" required />
              <Input name="slug" placeholder="Slug (ex: hair)" required />
            </div>

            <Select name="parentId" defaultValue="">
              <option value="">No parent (top-level)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.slug})
                </option>
              ))}
            </Select>

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-full border border-accentPrimary/45 bg-accentPrimary/15 px-4 py-2 text-xs font-black text-accentPrimary hover:bg-accentPrimary/20 hover:border-accentPrimary/60 active:scale-[0.98] transition"
              >
                Create
              </button>
            </div>
          </form>

          <div className="mt-4 grid gap-3">
            {topCats.map((c) => {
              const kids = childrenByParent.get(String(c.id)) ?? []
              return (
                <div key={c.id} className="rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-extrabold text-textPrimary">
                      {c.name} <span className="text-xs font-bold text-textSecondary">({c.slug})</span>
                    </div>

                    <form action={`/api/admin/categories/${encodeURIComponent(String(c.id))}`} method="post">
                      <input type="hidden" name="_method" value="PATCH" />
                      <input type="hidden" name="isActive" value={String(!c.isActive)} />
                      <button
                        type="submit"
                        className="rounded-full border border-surfaceGlass/15 bg-bgSecondary px-3 py-1.5 text-xs font-extrabold text-textPrimary hover:border-surfaceGlass/25"
                      >
                        {c.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </form>
                  </div>

                  {kids.length ? (
                    <div className="mt-3 grid gap-2">
                      {kids.map((k) => (
                        <div
                          key={k.id}
                          className="flex flex-wrap items-center justify-between gap-3 border-t border-surfaceGlass/10 pt-2"
                        >
                          <div className="text-sm text-textPrimary">
                            <span className="font-extrabold">{k.name}</span>{' '}
                            <span className="text-xs text-textSecondary">({k.slug})</span>
                          </div>

                          <form action={`/api/admin/categories/${encodeURIComponent(String(k.id))}`} method="post">
                            <input type="hidden" name="_method" value="PATCH" />
                            <input type="hidden" name="isActive" value={String(!k.isActive)} />
                            <button
                              type="submit"
                              className="rounded-full border border-surfaceGlass/15 bg-bgSecondary px-3 py-1.5 text-xs font-extrabold text-textPrimary hover:border-surfaceGlass/25"
                            >
                              {k.isActive ? 'Disable' : 'Enable'}
                            </button>
                          </form>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-textSecondary">No subcategories yet.</div>
                  )}
                </div>
              )
            })}
          </div>
        </CardShell>

        {/* Services */}
        <CardShell title="Services" subtitle={`${total} total • ordered by category`}>
          {/* Create service (unchanged) */}
          <form
            action="/api/admin/services"
            method="post"
            className="grid gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/30 p-3"
          >
            <FieldLabel>Create service</FieldLabel>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input name="name" placeholder="Service name (ex: Haircut)" required />

              <Select name="categoryId" required defaultValue="">
                <option value="" disabled>
                  Select category
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? '↳ ' : ''}
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input name="minPrice" placeholder="Min price (ex: 45 or 45.00)" />
              <Input name="defaultDurationMinutes" placeholder="Default minutes (ex: 60)" />
            </div>

            <label className="flex items-center gap-2 text-xs font-black text-textPrimary">
              <input
                type="checkbox"
                name="allowMobile"
                value="true"
                className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
              />
              Allow mobile by default
            </label>

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-full border border-accentPrimary/45 bg-accentPrimary/15 px-4 py-2 text-xs font-black text-accentPrimary hover:bg-accentPrimary/20 hover:border-accentPrimary/60 active:scale-[0.98] transition"
              >
                Create
              </button>
            </div>

            <div className="text-[11px] text-textSecondary">
              After creating, you’ll be taken to the service detail page to review and refine.
            </div>
          </form>

          {/* ✅ Sticky browse + pagination */}
          <div className="mt-4">
            <ServicesBrowseBar
              categories={categoryPayload}
              initial={{
                q,
                active: activeOnly ? '1' : '0',
                cat: categoryFilter || '',
                kids: includeChildren ? '1' : '0',
                per: String(per),
                page: clampedPage,
              }}
              stats={{ total, totalPages }}
            />
          </div>

          {/* ✅ Hero cards */}
          <div className="mt-4">
            <ServiceHeroGrid services={servicesPayload} categories={categoryPayload} />
          </div>
        </CardShell>
      </div>
    </main>
  )
}
