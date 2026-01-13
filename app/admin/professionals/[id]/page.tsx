// app/admin/professionals/[id]/page.tsx
import AdminGuard from '../../_components/AdminGuard'
import { prisma } from '@/lib/prisma'
import { AdminPermissionRole } from '@prisma/client'
import AdminProActions from './AdminProActions'

export const dynamic = 'force-dynamic'

export default async function AdminProfessionalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const pro = await prisma.professionalProfile.findUnique({
    where: { id },
    select: {
      id: true,
      businessName: true,
      bio: true,
      location: true,
      professionType: true,
      licenseState: true,
      licenseNumber: true,
      licenseExpiry: true,
      licenseVerified: true,
      verificationStatus: true,
      user: { select: { email: true } },
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

  // Still wrap the "not found" state in AdminGuard so unauthorized people don't learn anything.
  if (!pro) {
    return (
      <AdminGuard
        from={`/admin/professionals/${encodeURIComponent(id)}`}
        allowedRoles={[AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER]}
        scope={{ professionalId: id }}
      >
        <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 16, padding: 16 }}>
          Professional not found.
        </div>
      </AdminGuard>
    )
  }

  const proId = pro.id

  return (
    <AdminGuard
      from={`/admin/professionals/${encodeURIComponent(proId)}`}
      allowedRoles={[AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER]}
      scope={{ professionalId: proId }}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {/* PRO SUMMARY + ACTIONS */}
        <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 16, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 18, fontWeight: 1000 }}>{pro.businessName || 'Unnamed business'}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>{pro.user.email}</div>

              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {pro.professionType || 'Unknown'} · {pro.location || 'No location'}
              </div>

              <div style={{ fontSize: 12, color: '#6b7280' }}>
                License: {pro.licenseState || '??'} {pro.licenseNumber || '—'}{' '}
                {pro.licenseExpiry ? `· Exp ${new Date(pro.licenseExpiry).toLocaleDateString()}` : ''}
              </div>
            </div>

            {/* IMPORTANT:
                Use the client component for mutations so auth cookies are included.
                Server actions calling /api/* will bite you later. */}
            <AdminProActions
              professionalId={proId}
              currentStatus={pro.verificationStatus}
              licenseVerified={pro.licenseVerified}
            />
          </div>

          {pro.bio ? (
            <div style={{ marginTop: 10, fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{pro.bio}</div>
          ) : null}

          <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
            Current: <b>{pro.verificationStatus}</b> · License verified: <b>{String(pro.licenseVerified)}</b>
          </div>
        </div>

        {/* VERIFICATION DOCS */}
        <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 16, padding: 16 }}>
          <div style={{ fontWeight: 1000, marginBottom: 10 }}>Verification documents</div>

          {pro.verificationDocs.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6b7280' }}>No docs uploaded.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {pro.verificationDocs.map((d) => {
                const href = d.url || d.imageUrl || null
                return (
                  <div key={d.id} style={{ border: '1px solid #f3f4f6', borderRadius: 14, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 1000 }}>
                        {d.type}{' '}
                        <span style={{ fontWeight: 800, fontSize: 12, color: '#6b7280' }}>({d.status})</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(d.createdAt).toLocaleString()}</div>
                    </div>

                    {d.label ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{d.label}</div> : null}

                    {href ? (
                      <div style={{ fontSize: 12, marginTop: 8 }}>
                        <a href={href} target="_blank" rel="noreferrer">
                          Open document
                        </a>
                      </div>
                    ) : null}

                    {d.adminNote ? (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Admin note: {d.adminNote}</div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </AdminGuard>
  )
}
