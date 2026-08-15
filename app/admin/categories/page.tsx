// app/admin/categories/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Button, FieldLabel, Select, TextInput } from '@/app/_components/ui'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'

export const dynamic = 'force-dynamic'

export default async function AdminCategoriesPage() {
  const info = await getAdminUiPerms()
  if (!info) redirect('/login?from=/admin/categories')
  if (!info.perms.canManageCatalog) redirect('/admin')

  const categories = await prisma.serviceCategory.findMany({
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, parentId: true, isActive: true },
    take: 2000,
  })

  const topCats = categories.filter((c) => !c.parentId)
  const childrenByParent = new Map<string, typeof categories>()
  for (const c of categories) {
    if (!c.parentId) continue
    const arr = childrenByParent.get(c.parentId) ?? []
    arr.push(c)
    childrenByParent.set(c.parentId, arr)
  }

  return (
    <main className="grid gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-extrabold">Categories</h1>
          <div className="text-sm text-textSecondary">Taxonomy control so discovery doesn’t become chaos.</div>
        </div>

        <Link
          href="/admin"
          className="text-xs font-black text-textPrimary/85 hover:text-textPrimary"
        >
          ← Admin Home
        </Link>
      </div>

      <section className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-extrabold">All categories</div>
          <span className="text-xs text-textSecondary">{categories.length} total</span>
        </div>

        <form
          action="/api/v1/admin/categories"
          method="post"
          className="mt-3 grid gap-3 border-t border-surfaceGlass/10 pt-3"
        >
          <FieldLabel>Create category</FieldLabel>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput name="name" placeholder="Name (ex: Hair)" required />
            <TextInput name="slug" placeholder="Slug (ex: hair)" required />
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
            <Button type="submit" variant="accent" fill="soft" size="sm">Create</Button>
          </div>
        </form>

        <div className="mt-4 grid gap-3">
          {topCats.map((c) => {
            const kids = childrenByParent.get(c.id) ?? []
            return (
              <div key={c.id} className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <div className="text-sm font-extrabold">
                      {c.name}{' '}
                      <span className="text-xs font-black text-textSecondary">({c.slug})</span>
                    </div>
                    <div className="text-xs text-textSecondary">
                      {kids.length ? `${kids.length} subcategor${kids.length === 1 ? 'y' : 'ies'}` : 'No subcategories yet.'}
                    </div>
                  </div>

                  <form action={`/api/v1/admin/categories/${encodeURIComponent(c.id)}`} method="post">
                    <input type="hidden" name="_method" value="PATCH" />
                    <input type="hidden" name="isActive" value={String(!c.isActive)} />
                    <Button type="submit" variant="neutral" fill="soft" size="xs">
                      {c.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </form>
                </div>

                {kids.length ? (
                  <div className="mt-3 grid gap-2 border-t border-surfaceGlass/10 pt-3">
                    {kids.map((k) => (
                      <div key={k.id} className="flex items-center justify-between gap-3">
                        <div className="text-sm">
                          <span className="font-extrabold">{k.name}</span>{' '}
                          <span className="text-xs font-black text-textSecondary">({k.slug})</span>
                        </div>

                        <form action={`/api/v1/admin/categories/${encodeURIComponent(k.id)}`} method="post">
                          <input type="hidden" name="_method" value="PATCH" />
                          <input type="hidden" name="isActive" value={String(!k.isActive)} />
                          <Button type="submit" variant="neutral" fill="soft" size="xs">
                            {k.isActive ? 'Disable' : 'Enable'}
                          </Button>
                        </form>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}
