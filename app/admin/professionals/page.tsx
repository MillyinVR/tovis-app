// app/admin/professionals/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import AdminGuard from '../_components/AdminGuard'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'
import { ProfessionalLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-surfaceGlass/12 bg-bgSecondary px-3 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={[
        'inline-flex items-center rounded-full border px-3 py-2 text-xs font-extrabold',
        'transition-colors',
        active
          ? 'border-surfaceGlass/25 bg-bgPrimary text-textPrimary'
          : 'border-surfaceGlass/10 bg-bgSecondary text-textPrimary hover:border-surfaceGlass/20',
      ].join(' ')}
    >
      {label}
    </Link>
  )
}

function formatLocationLabel(loc: {
  type: ProfessionalLocationType
  formattedAddress: string | null
  city: string | null
  state: string | null
} | null) {
  if (!loc) return 'No location yet'

  const where =
    loc.formattedAddress?.trim() ||
    [loc.city?.trim(), loc.state?.trim()].filter(Boolean).join(', ') ||
    ''

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

  if (where) return `${where} · ${mode}`
  return mode || 'Location set'
}

export default async function AdminProfessionalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const info = await getAdminUiPerms()
  if (!info) redirect('/login?from=/admin/professionals')
  if (!info.perms.canReviewPros) redirect('/admin')

  const sp = await searchParams
  const status = (sp.status || 'PENDING').toUpperCase()

  const allowed = new Set(['PENDING', 'APPROVED', 'REJECTED'])
  const verificationStatus = allowed.has(status) ? (status as any) : 'PENDING'

  const pros = await prisma.professionalProfile.findMany({
    where: { verificationStatus },
    orderBy: [{ licenseVerified: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      businessName: true,
      avatarUrl: true,
      professionType: true,
      licenseState: true,
      licenseNumber: true,
      licenseExpiry: true,
      licenseVerified: true,
      verificationStatus: true,
      user: { select: { email: true } },

      // ✅ New location system (primary ProfessionalLocation)
      locations: {
        where: { isPrimary: true },
        take: 1,
        select: {
          type: true,
          formattedAddress: true,
          city: true,
          state: true,
        },
      },

      verificationDocs: {
        select: { id: true, type: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 3,
      },
    },
    take: 200,
  })

  return (
    <AdminGuard>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h1 className="text-xl font-extrabold text-textPrimary">Professionals</h1>
            <p className="text-sm text-textSecondary">
              Review applications, approve/decline, and keep the marketplace from becoming Craigslist.
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Tab href="/admin/professionals?status=PENDING" label="Pending" active={verificationStatus === 'PENDING'} />
            <Tab
              href="/admin/professionals?status=APPROVED"
              label="Approved"
              active={verificationStatus === 'APPROVED'}
            />
            <Tab
              href="/admin/professionals?status=REJECTED"
              label="Rejected"
              active={verificationStatus === 'REJECTED'}
            />
          </div>
        </div>

        <div className="grid gap-3">
          {pros.length === 0 ? (
            <div className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4 text-sm text-textSecondary">
              Nothing here. Humans are either behaving, or you haven’t seeded pros.
            </div>
          ) : (
            pros.map((p) => {
              const primaryLoc = p.locations?.[0] ?? null
              const locationLabel = formatLocationLabel(primaryLoc)

              return (
                <Link
                  key={p.id}
                  href={`/admin/professionals/${encodeURIComponent(p.id)}`}
                  className="text-textPrimary no-underline"
                >
                  <div className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4 transition-colors hover:border-surfaceGlass/20">
                    <div className="flex flex-wrap justify-between gap-3">
                      <div className="grid gap-1">
                        <div className="text-sm font-extrabold">
                          {p.businessName || 'Unnamed business'}{' '}
                          <span className="text-xs font-bold text-textSecondary">({p.user.email})</span>
                        </div>

                        <div className="text-sm text-textSecondary">
                          {p.professionType || 'Unknown profession'} · {locationLabel}
                        </div>

                        <div className="text-xs text-textSecondary">
                          License: {p.licenseState || '??'} {p.licenseNumber || '—'}
                          {p.licenseExpiry ? (
                            <span>
                              {' '}
                              · Exp {new Date(p.licenseExpiry).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Pill>Status: {String(p.verificationStatus)}</Pill>
                        <Pill>{p.licenseVerified ? 'License Verified' : 'License NOT Verified'}</Pill>
                        <Pill>Docs: {p.verificationDocs.length}</Pill>
                      </div>
                    </div>

                    <div className="mt-3 text-xs font-bold text-textSecondary">Open to review →</div>
                  </div>
                </Link>
              )
            })
          )}
        </div>
      </div>
    </AdminGuard>
  )
}
