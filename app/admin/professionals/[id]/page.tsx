// app/admin/professionals/[id]/page.tsx
import AdminGuard from '../../_components/AdminGuard'
import { prisma } from '@/lib/prisma'
import { AdminPermissionRole, ProfessionalLocationType } from '@prisma/client'
import AdminProActions from './AdminProActions'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function fmtUtcDate(d: Date) {
  const tz = sanitizeTimeZone('UTC', 'UTC')
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d)
}

function fmtUtcDateTime(d: Date) {
  const tz = sanitizeTimeZone('UTC', 'UTC')
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(d)
}

function formatLocationLabel(loc: {
  type: ProfessionalLocationType
  name: string | null
  formattedAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
} | null) {
  if (!loc) return 'No location yet'

  const mode =
    loc.type === ProfessionalLocationType.SALON
      ? 'Salon'
      : loc.type === ProfessionalLocationType.SUITE
        ? 'Suite'
        : loc.type === ProfessionalLocationType.MOBILE_BASE
          ? 'Mobile'
          : String(loc.type)

  // Prefer formattedAddress, else fall back to city/state, else just mode
  const where =
    loc.formattedAddress?.trim() ||
    [loc.city?.trim(), loc.state?.trim()].filter(Boolean).join(', ') ||
    loc.postalCode?.trim() ||
    ''

  const named = loc.name?.trim()
  if (named && where) return `${named} · ${where} · ${mode}`
  if (named) return `${named} · ${mode}`
  if (where) return `${where} · ${mode}`
  return mode
}

export default async function AdminProfessionalDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params

  const pro = await prisma.professionalProfile.findUnique({
    where: { id },
    select: {
      id: true,
      businessName: true,
      bio: true,
      professionType: true,

      licenseState: true,
      licenseNumber: true,
      licenseExpiry: true,
      licenseVerified: true,
      verificationStatus: true,

      user: { select: { email: true } },

      // ✅ NEW location system
      locations: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          type: true,
          name: true,
          isPrimary: true,
          isBookable: true,

          formattedAddress: true,
          city: true,
          state: true,
          postalCode: true,
          countryCode: true,
          placeId: true,

          lat: true,
          lng: true,
          timeZone: true,
          createdAt: true,
        },
        take: 50,
      },

      verificationDocs: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          status: true,
          label: true,
          imageUrl: true,
          url: true,
          createdAt: true,
          adminNote: true,
        },
        take: 50,
      },
    },
  })

  const fromHref = `/admin/professionals/${encodeURIComponent(id)}`

  if (!pro) {
    return (
      <AdminGuard
        from={fromHref}
        allowedRoles={[AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER]}
        scope={{ professionalId: id }}
      >
        <main className="mx-auto w-full max-w-960px px-4 pb-10 pt-6">
          <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] font-semibold text-textSecondary">
            Professional not found.
          </div>
        </main>
      </AdminGuard>
    )
  }

  const proId = pro.id
  const from = `/admin/professionals/${encodeURIComponent(proId)}`

  const proName = pro.businessName || 'Unnamed business'
  const email = pro.user?.email || 'No email'
  const profession = pro.professionType || 'Unknown'

  const primaryLoc = pro.locations.find((l) => l.isPrimary) ?? pro.locations[0] ?? null
  const locationLabel = formatLocationLabel(primaryLoc)

  const licenseLine = (() => {
    const state = pro.licenseState || '??'
    const num = pro.licenseNumber || '—'
    const exp = pro.licenseExpiry ? ` · Exp ${fmtUtcDate(new Date(pro.licenseExpiry))}` : ''
    return `License: ${state} ${num}${exp}`
  })()

  const card = 'tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4'
  const hint = 'text-[12px] font-semibold text-textSecondary'

  return (
    <AdminGuard
      from={from}
      allowedRoles={[AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER]}
      scope={{ professionalId: proId }}
    >
      <main className="mx-auto w-full max-w-960px px-4 pb-10 pt-6">
        <div className="grid gap-4">
          {/* PRO SUMMARY + ACTIONS */}
          <section className={card}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-240px">
                <div className="text-[16px] font-black text-textPrimary">{proName}</div>
                <div className={`${hint} mt-1`}>{email}</div>

                <div className={`${hint} mt-2`}>
                  {profession} · {locationLabel}
                </div>

                <div className={`${hint} mt-1`}>{licenseLine}</div>

                {primaryLoc ? (
                  <div className={`${hint} mt-1`}>
                    Location type:{' '}
                    <span className="font-black text-textPrimary">{String(primaryLoc.type)}</span>
                    {primaryLoc.isBookable ? <span className="ml-2 opacity-80">· bookable</span> : null}
                    {primaryLoc.timeZone ? <span className="ml-2 opacity-80">· {primaryLoc.timeZone}</span> : null}
                  </div>
                ) : null}
              </div>

              {/* Keep mutations in client component so auth cookies are included. */}
              <AdminProActions
                professionalId={proId}
                currentStatus={pro.verificationStatus}
                licenseVerified={pro.licenseVerified}
              />
            </div>

            {pro.bio ? (
              <div className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-textPrimary/90">
                {pro.bio}
              </div>
            ) : null}

            <div className={`${hint} mt-3`}>
              Current: <span className="font-black text-textPrimary">{pro.verificationStatus}</span> · License
              verified: <span className="font-black text-textPrimary">{String(pro.licenseVerified)}</span>
              <span className="ml-2 opacity-80">· Times shown in UTC</span>
            </div>
          </section>

          {/* OPTIONAL: LOCATIONS LIST (handy for debugging / future UI)
              Delete this section if you don’t want it. */}
          {pro.locations.length ? (
            <section className={card}>
              <div className="text-[14px] font-black text-textPrimary">Locations</div>
              <div className={`${hint} mt-1`}>Primary first.</div>

              <div className="mt-4 grid gap-2">
                {pro.locations.map((l) => (
                  <div key={l.id} className="rounded-card border border-white/10 bg-bgPrimary p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div className="text-[13px] font-black text-textPrimary">
                        {formatLocationLabel(l)}
                        {l.isPrimary ? <span className="ml-2 text-[12px] font-semibold text-accentPrimary">(Primary)</span> : null}
                      </div>
                      <div className={hint}>{fmtUtcDateTime(new Date(l.createdAt))}</div>
                    </div>

                    <div className={`${hint} mt-2`}>
                      Type: <span className="font-black text-textPrimary">{String(l.type)}</span>
                      {' · '}
                      Bookable: <span className="font-black text-textPrimary">{String(l.isBookable)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* VERIFICATION DOCS */}
          <section className={card}>
            <div className="text-[14px] font-black text-textPrimary">Verification documents</div>
            <div className={`${hint} mt-1`}>Newest first. Times shown in UTC.</div>

            {pro.verificationDocs.length === 0 ? (
              <div className="mt-3 text-[13px] font-semibold text-textSecondary">No docs uploaded.</div>
            ) : (
              <div className="mt-4 grid gap-3">
                {pro.verificationDocs.map((d) => {
                  const href = d.url || d.imageUrl || null
                  const created = fmtUtcDateTime(new Date(d.createdAt))

                  return (
                    <div key={d.id} className="rounded-card border border-white/10 bg-bgPrimary p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <div className="text-[13px] font-black text-textPrimary">
                          {d.type}{' '}
                          <span className="text-[12px] font-semibold text-textSecondary">({d.status})</span>
                        </div>
                        <div className={hint}>{created}</div>
                      </div>

                      {d.label ? <div className={`${hint} mt-2`}>{d.label}</div> : null}

                      {href ? (
                        <div className="mt-3">
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                          >
                            Open document
                          </a>
                        </div>
                      ) : null}

                      {d.adminNote ? (
                        <div className={`${hint} mt-3`}>
                          Admin note: <span className="text-textPrimary">{d.adminNote}</span>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </AdminGuard>
  )
}