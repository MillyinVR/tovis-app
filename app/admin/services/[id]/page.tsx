// app/admin/services/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { AdminPermissionRole, ProfessionType } from '@prisma/client'
import AdminGuard from '../../_components/AdminGuard'

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

function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'gold' | 'danger' | 'success'
}) {
  const base =
    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-extrabold'
  const tones: Record<typeof tone, string> = {
    neutral: 'border-surfaceGlass/10 bg-bgPrimary/25 text-textPrimary',
    gold: 'border-accentPrimary/25 bg-accentPrimary/10 text-textPrimary',
    success: 'border-[rgb(var(--tone-success))/0.25] bg-[rgb(var(--tone-success))/0.10] text-textPrimary',
    danger: 'border-[rgb(var(--tone-danger))/0.25] bg-[rgb(var(--tone-danger))/0.10] text-textPrimary',
  }
  return <span className={`${base} ${tones[tone]}`}>{children}</span>
}

function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'gold'
}) {
  const base =
    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-extrabold'
  const tones: Record<typeof tone, string> = {
    neutral: 'border-surfaceGlass/10 bg-bgSecondary text-textPrimary',
    gold: 'border-accentPrimary/25 bg-accentPrimary/10 text-textPrimary',
  }
  return <span className={`${base} ${tones[tone]}`}>{children}</span>
}

function CardShell({
  title,
  subtitle,
  right,
  children,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-sm font-extrabold text-textPrimary">{title}</div>
          {subtitle ? <div className="text-xs text-textSecondary">{subtitle}</div> : null}
        </div>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
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

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
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

function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  const base =
    'inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-extrabold transition-colors'
  const styles =
    variant === 'primary'
      ? 'bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
      : 'border border-surfaceGlass/15 bg-bgSecondary text-textPrimary hover:border-surfaceGlass/25'

  return (
    <button {...props} className={[base, styles, props.className ?? ''].join(' ')}>
      {children}
    </button>
  )
}

function ToggleRow({
  label,
  checked,
  name,
  value = 'true',
}: {
  label: string
  checked: boolean
  name: string
  value?: string
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-textPrimary">
      <input
        name={name}
        type="checkbox"
        value={value}
        defaultChecked={checked}
        className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
      />
      <span className="font-bold text-textSecondary">{label}</span>
    </label>
  )
}

function EmptyState({
  title,
  body,
}: {
  title: string
  body: string
}) {
  return (
    <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-4">
      <div className="text-sm font-extrabold text-textPrimary">{title}</div>
      <div className="mt-1 text-sm text-textSecondary">{body}</div>
    </div>
  )
}

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

  const checkedByProfession = new Set(service.permissions.map((p) => p.professionType))
  const allProfessions = Object.values(ProfessionType)

  const headerChips = (
    <>
      <Chip tone={service.isActive ? 'success' : 'danger'}>
        {service.isActive ? 'Active' : 'Disabled'}
      </Chip>
      {service.allowMobile ? <Chip tone="gold">Mobile</Chip> : <Chip>Salon-only</Chip>}
      <Chip>{service.defaultDurationMinutes}m</Chip>
      <Chip tone="gold">{money(service.minPrice)}</Chip>
      <Chip>{service.category?.name || '— Category'}</Chip>
    </>
  )

  return (
    <AdminGuard
      from={`/admin/services/${encodeURIComponent(service.id)}`}
      allowedRoles={[AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT]}
      scope={{ serviceId: service.id, categoryId: service.categoryId }}
    >
      <main className="grid gap-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-2">
            <h1 className="text-2xl font-extrabold text-textPrimary">{service.name}</h1>
            <div className="flex flex-wrap gap-2">{headerChips}</div>
            {service.description ? (
              <p className="max-w-3xl text-sm text-textSecondary">{service.description}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/services"
              className="rounded-full border border-surfaceGlass/15 bg-bgSecondary px-3 py-2 text-xs font-extrabold text-textPrimary no-underline hover:border-surfaceGlass/25"
            >
              ← Back
            </Link>
          </div>
        </div>

        {/* Layout: preview + edit */}
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          {/* Preview */}
          <CardShell
            title="Default media"
            subtitle="Used as a fallback image when pros don’t upload one."
            right={
              service.defaultImageUrl ? (
                <Badge tone="gold">Has image</Badge>
              ) : (
                <Badge>None</Badge>
              )
            }
          >
            {service.defaultImageUrl ? (
              <div className="grid gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={service.defaultImageUrl}
                  alt={`${service.name} default`}
                  className="aspect-square w-full rounded-2xl border border-surfaceGlass/10 object-cover bg-bgPrimary/20"
                />
                <div className="rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/20 p-3">
                  <div className="text-xs font-extrabold text-textSecondary">URL</div>
                  <div className="mt-1 break-all text-xs text-textPrimary">{service.defaultImageUrl}</div>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No default image"
                body="Add one later if you want the catalog to feel less like an unfinished government form."
              />
            )}
          </CardShell>

          {/* Edit */}
          <CardShell title="Edit service" subtitle="Update name, category, pricing, and description.">
            <form
              action={`/api/admin/services/${encodeURIComponent(service.id)}`}
              method="post"
              className="grid gap-3"
            >
              <input type="hidden" name="_method" value="PATCH" />

              <label className="grid gap-2">
                <FieldLabel>Name</FieldLabel>
                <Input name="name" defaultValue={service.name} required />
              </label>

              <label className="grid gap-2">
                <FieldLabel>Category</FieldLabel>
                <Select name="categoryId" defaultValue={service.categoryId} required>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parentId ? '↳ ' : ''}
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2">
                  <FieldLabel>Default duration (minutes)</FieldLabel>
                  <Input
                    name="defaultDurationMinutes"
                    type="number"
                    min={5}
                    step={5}
                    defaultValue={service.defaultDurationMinutes}
                    required
                  />
                </label>

                <label className="grid gap-2">
                  <FieldLabel>Min price</FieldLabel>
                  <Input
                    name="minPrice"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={String(service.minPrice)}
                    required
                  />
                </label>
              </div>

              <label className="grid gap-2">
                <FieldLabel>Description (optional)</FieldLabel>
                <Textarea name="description" defaultValue={service.description ?? ''} rows={3} />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4">
                  <ToggleRow name="allowMobile" checked={service.allowMobile} label="Allow mobile" />
                </div>

                <div className="flex items-center gap-2">
                  <Button type="submit">Save</Button>
                </div>
              </div>

              <div className="rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/20 p-3 text-xs text-textSecondary">
                Tip: if you ever add “defaultImageUrl” editing, make it a separate guarded input so nobody pastes a cursed URL and blames you.
              </div>
            </form>
          </CardShell>
        </div>

        {/* Permissions */}
        <CardShell
          title="Permissions"
          subtitle="Choose which professions can offer this service. Optional: limit to a state (2-letter code). Leaving blank = all states."
          right={
            <Badge tone="gold">{service.permissions.length ? `${service.permissions.length} rules` : '0 rules'}</Badge>
          }
        >
          <form
            action={`/api/admin/services/${encodeURIComponent(service.id)}/permissions`}
            method="post"
            className="grid gap-3"
          >
            <label className="grid gap-2">
              <FieldLabel>State code filter (optional)</FieldLabel>
              <Input name="stateCode" placeholder="CA" maxLength={2} />
            </label>

            <div className="grid gap-2 rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-textSecondary">Allowed professions</div>
                <div className="text-[11px] text-textSecondary">
                  Checked = allowed (subject to optional state filter)
                </div>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {allProfessions.map((pt) => (
                  <label key={pt} className="flex items-center gap-2 text-sm text-textPrimary">
                    <input
                      type="checkbox"
                      name="professionType"
                      value={pt}
                      defaultChecked={checkedByProfession.has(pt)}
                      className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
                    />
                    <span className="font-bold text-textSecondary">{pt}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit">Replace permissions</Button>
            </div>
          </form>

          <div className="mt-4 border-t border-surfaceGlass/10 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold text-textSecondary">Current permissions</div>
              <div className="text-[11px] text-textSecondary">
                State blank = all states
              </div>
            </div>

            {service.permissions.length ? (
              <div className="mt-2 grid gap-2">
                {service.permissions.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/20 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="gold">{p.professionType}</Badge>
                      <Badge>{p.stateCode ? p.stateCode : 'All states'}</Badge>
                    </div>
                    <div className="text-xs text-textSecondary">Rule ID: {p.id}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-textSecondary">No permissions set yet.</div>
            )}
          </div>
        </CardShell>
      </main>
    </AdminGuard>
  )
}
