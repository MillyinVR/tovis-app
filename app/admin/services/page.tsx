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

function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const base =
    'inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-extrabold transition-colors'
  const styles =
    variant === 'primary'
      ? 'bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
      : variant === 'danger'
        ? 'border border-toneDanger/40 text-toneDanger hover:bg-toneDanger/10'
        : 'border border-surfaceGlass/15 bg-bgSecondary text-textPrimary hover:border-surfaceGlass/25'

  return (
    <button {...props} className={[base, styles, props.className ?? ''].join(' ')}>
      {children}
    </button>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-surfaceGlass/12 bg-bgSecondary px-2 py-0.5 text-[11px] font-extrabold text-textSecondary">
      {children}
    </span>
  )
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
        isAddOnEligible: true,
        addOnGroup: true,
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
    <main className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-extrabold text-textPrimary">Services & Categories</h1>
          <p className="text-sm text-textSecondary">Manage the catalog. This is where the app stops being a toy.</p>
        </div>

        <Link
          href="/admin"
          className="text-xs font-extrabold text-textPrimary no-underline hover:text-textPrimary/90"
        >
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
              <Button type="submit">Create</Button>
            </div>
          </form>

          <div className="mt-4 grid gap-3">
            {topCats.map((c) => {
              const kids = childrenByParent.get(c.id) ?? []
              return (
                <div key={c.id} className="rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-extrabold text-textPrimary">
                      {c.name}{' '}
                      <span className="text-xs font-bold text-textSecondary">({c.slug})</span>
                    </div>

                    <form action={`/api/admin/categories/${encodeURIComponent(c.id)}`} method="post">
                      <input type="hidden" name="_method" value="PATCH" />
                      <input type="hidden" name="isActive" value={String(!c.isActive)} />
                      <Button type="submit" variant="ghost" className="rounded-full px-3 py-1.5">
                        {c.isActive ? 'Disable' : 'Enable'}
                      </Button>
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
                            <Button type="submit" variant="ghost" className="rounded-full px-3 py-1.5">
                              {k.isActive ? 'Disable' : 'Enable'}
                            </Button>
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
        <CardShell title="Services" subtitle={`${services.length} total`}>
          <form
            action="/api/admin/services"
            method="post"
            className="grid gap-3 rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/30 p-3"
          >
            <FieldLabel>Create service</FieldLabel>

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

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                name="defaultDurationMinutes"
                type="number"
                min={5}
                step={5}
                placeholder="Default duration (minutes)"
                required
              />
              <Input
                name="minPrice"
                type="text"
                inputMode="decimal"
                placeholder="Min price (ex: 45 or 45.00)"
                required
              />
            </div>

            <div className="grid gap-2 rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/20 p-3">
              <label className="flex items-center gap-2 text-sm text-textPrimary">
                <input
                  name="allowMobile"
                  type="checkbox"
                  value="true"
                  className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
                />
                <span className="font-bold text-textSecondary">Allow mobile</span>
              </label>

              <label className="flex items-center gap-2 text-sm text-textPrimary">
                <input
                  name="isAddOnEligible"
                  type="checkbox"
                  value="true"
                  className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
                />
                <span className="font-bold text-textSecondary">Add-on eligible</span>
              </label>

              <div className="grid gap-1">
                <div className="text-xs font-extrabold text-textSecondary">Add-on group (optional)</div>
                <Input name="addOnGroup" placeholder="Finish, Treatment, Upgrade, etc." />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit">Create</Button>
            </div>
          </form>

          <div className="mt-4 grid gap-3">
            {services.map((s) => (
              <div key={s.id} className="rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/20 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-textPrimary">
                      {s.name}{' '}
                      <span className="text-xs font-bold text-textSecondary">
                        · {s.category?.name || 'Uncategorized'} · {s.defaultDurationMinutes}m · {money(s.minPrice)}
                        {s.allowMobile ? ' · Mobile' : ''}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.isAddOnEligible ? <Pill>Add-on eligible</Pill> : <Pill>Not add-on</Pill>}
                      {s.addOnGroup ? <Pill>Group: {s.addOnGroup}</Pill> : <Pill>Group: —</Pill>}
                      <Pill>{s.isActive ? 'Active' : 'Disabled'}</Pill>
                    </div>
                  </div>

                  <form action={`/api/admin/services/${encodeURIComponent(s.id)}`} method="post">
                    <input type="hidden" name="_method" value="PATCH" />
                    <input type="hidden" name="isActive" value={String(!s.isActive)} />
                    <Button type="submit" variant="ghost" className="rounded-full px-3 py-1.5">
                      {s.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </form>
                </div>

                <div className="mt-3 flex justify-end">
                  <Link
                    href={`/admin/services/${encodeURIComponent(s.id)}`}
                    className="inline-flex items-center rounded-full border border-surfaceGlass/15 bg-bgSecondary px-4 py-2 text-xs font-extrabold text-textPrimary no-underline hover:border-surfaceGlass/25"
                  >
                    Edit + permissions
                  </Link>
                </div>
              </div>
            ))}

            {services.length === 0 ? <div className="text-sm text-textSecondary">No services yet.</div> : null}
          </div>
        </CardShell>
      </div>
    </main>
  )
}
