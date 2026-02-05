// app/admin/services/page.tsx

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'
import ServiceHeroGrid from './_components/ServiceHeroGrid'
import ServicesBrowseBar from './_components/ServicesBrowseBar'
import ServicesCreateWizard from './_components/ServicesCreateWizard'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

type CategoryRow = {
  id: string
  name: string
  slug: string
  parentId: string | null
  isActive: boolean
}

type CategoryDTO = { id: string; name: string; parentId: string | null }

type ServiceDTO = {
  id: string
  name: string
  description: string | null
  defaultDurationMinutes: number | null
  minPrice: string | null
  defaultImageUrl: string | null
  allowMobile: boolean
  isActive: boolean
  isAddOnEligible: boolean
  addOnGroup: string | null
  categoryId: string | null
  categoryName: string | null
}

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

function firstStr(v: string | string[] | undefined) {
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

function asBool01(v: string | string[] | undefined, defaultOne = true) {
  const s = String(firstStr(v)).trim()
  if (!s) return defaultOne
  return s !== '0'
}

function asPosInt(v: string | string[] | undefined, fallback: number) {
  const s = String(firstStr(v)).trim()
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function buildCategoryIndex(categories: CategoryRow[]) {
  const byId = new Map<string, CategoryRow>()
  const childrenByParent = new Map<string, CategoryRow[]>()

  for (const c of categories) {
    byId.set(c.id, c)
    if (c.parentId) {
      const pid = c.parentId
      const arr = childrenByParent.get(pid) ?? []
      arr.push(c)
      childrenByParent.set(pid, arr)
    }
  }

  // ensure deterministic child ordering even if DB ordering changes later
  for (const [pid, kids] of childrenByParent.entries()) {
    kids.sort((a, b) => a.name.localeCompare(b.name))
    childrenByParent.set(pid, kids)
  }

  const top = categories.filter((c) => !c.parentId).slice().sort((a, b) => a.name.localeCompare(b.name))

  return { byId, childrenByParent, top }
}

function resolveCategoryIdsFilter(args: {
  categoryId: string
  includeChildren: boolean
  byId: Map<string, CategoryRow>
  childrenByParent: Map<string, CategoryRow[]>
}) {
  const { categoryId, includeChildren, byId, childrenByParent } = args
  const picked = byId.get(categoryId)
  if (!picked) return null

  if (!includeChildren) return [categoryId]

  // include children only when top-level
  if (picked.parentId) return [categoryId]

  const kids = childrenByParent.get(categoryId) ?? []
  return [categoryId, ...kids.map((k) => k.id)]
}

export default async function AdminServicesPage(props: { searchParams?: SearchParams }) {
  const info = await getAdminUiPerms()
  if (!info) redirect('/login?from=/admin/services')
  if (!info.perms.canManageCatalog) redirect('/admin')

  const sp = (await props.searchParams) ?? {}

  const q = String(firstStr(sp.q)).trim()
  const activeOnly = asBool01(sp.active, true)

  const categoryFilter = String(firstStr(sp.cat)).trim()
  const includeChildren = asBool01(sp.kids, true)

  const requestedPage = asPosInt(sp.page, 1)
  const per = clamp(asPosInt(sp.per, 36), 12, 120)

  // Categories: load once (admin catalog sizes can get big; keep this high but sane)
  const rawCategories = await prisma.serviceCategory.findMany({
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, parentId: true, isActive: true },
    take: 4000,
  })

  const categories: CategoryRow[] = rawCategories.map((c) => ({
    id: String(c.id),
    name: c.name,
    slug: c.slug,
    parentId: c.parentId ? String(c.parentId) : null,
    isActive: Boolean(c.isActive),
  }))

  const { byId, childrenByParent, top } = buildCategoryIndex(categories)

  const categoryIdsToInclude =
    categoryFilter && byId.has(categoryFilter)
      ? resolveCategoryIdsFilter({
          categoryId: categoryFilter,
          includeChildren,
          byId,
          childrenByParent,
        })
      : null

  // Build Prisma where clause (typed-ish, avoid any)
  const where = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { category: { name: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
    ...(activeOnly ? { isActive: true } : {}),
    ...(categoryIdsToInclude ? { categoryId: { in: categoryIdsToInclude } } : {}),
  }

  // ✅ Correct pagination:
  // 1) count
  // 2) clamp page
  // 3) fetch using clamped page
  const total = await prisma.service.count({ where })

  const totalPages = Math.max(1, Math.ceil(total / per))
  const page = clamp(requestedPage, 1, totalPages)

  const services = await prisma.service.findMany({
    where,
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
  })

  const categoryPayload: CategoryDTO[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId,
  }))

  const servicesPayload: ServiceDTO[] = services.map((s) => ({
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
            {top.map((c) => {
              const kids = childrenByParent.get(c.id) ?? []
              return (
                <div key={c.id} className="rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-extrabold text-textPrimary">
                      {c.name} <span className="text-xs font-bold text-textSecondary">({c.slug})</span>
                    </div>

                    <form action={`/api/admin/categories/${encodeURIComponent(c.id)}`} method="post">
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

                          <form action={`/api/admin/categories/${encodeURIComponent(k.id)}`} method="post">
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
          <ServicesCreateWizard categories={categoryPayload} />


          {/* Browse + pagination */}
          <div className="mt-4">
            <ServicesBrowseBar
              categories={categoryPayload}
              initial={{
                q,
                active: activeOnly ? '1' : '0',
                cat: categoryFilter || '',
                kids: includeChildren ? '1' : '0',
                per: String(per),
                page,
              }}
              stats={{ total, totalPages }}
            />
          </div>

          {/* Hero grid */}
          <div className="mt-4">
            <ServiceHeroGrid services={servicesPayload} categories={categoryPayload} />
          </div>
        </CardShell>
      </div>
    </main>
  )
}
