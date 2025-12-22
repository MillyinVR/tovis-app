// app/admin/professionals/[id]/page.tsx
import AdminGuard from '../../_components/AdminGuard'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { AdminPermissionRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

function baseUrl() {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env
  // dev fallback
  return 'http://localhost:3000'
}

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

  if (!pro) {
    return (
      <AdminGuard from={`/admin/professionals/${encodeURIComponent(id)}`} allowedRoles={[AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER]} scope={{ professionalId: id }}>
        <div style={{ border: '1px solid #eee', borderRadius: 16, padding: 16, background: '#fff' }}>
          Professional not found.
        </div>
      </AdminGuard>
    )
  }

  const proId = pro.id

  async function action(formData: FormData) {
    'use server'
    const intent = String(formData.get('intent') || '')
    const url = `${baseUrl()}/api/admin/professionals/${encodeURIComponent(proId)}`

    async function doPatch(body: any) {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      return res
    }

    if (intent === 'approve') {
      await doPatch({ verificationStatus: 'APPROVED' }).catch(() => null)
      redirect(`/admin/professionals/${encodeURIComponent(proId)}`)
    }

    if (intent === 'reject') {
      await doPatch({ verificationStatus: 'REJECTED' }).catch(() => null)
      redirect(`/admin/professionals/${encodeURIComponent(proId)}`)
    }

    if (intent === 'toggle_license') {
      const current = await prisma.professionalProfile.findUnique({
        where: { id: proId },
        select: { licenseVerified: true },
      })
      await doPatch({ licenseVerified: !current?.licenseVerified }).catch(() => null)
      redirect(`/admin/professionals/${encodeURIComponent(proId)}`)
    }
  }

  return (
    <AdminGuard
      from={`/admin/professionals/${encodeURIComponent(proId)}`}
      allowedRoles={[AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER]}
      scope={{ professionalId: proId }}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ border: '1px solid #eee', borderRadius: 16, padding: 16, background: '#fff' }}>
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

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <form action={action}>
                <input type="hidden" name="intent" value="approve" />
                <button
                  style={{
                    borderRadius: 12,
                    border: '1px solid #111',
                    padding: '10px 12px',
                    fontWeight: 1000,
                    background: '#111',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Approve
                </button>
              </form>

              <form action={action}>
                <input type="hidden" name="intent" value="reject" />
                <button
                  style={{
                    borderRadius: 12,
                    border: '1px solid #e5e7eb',
                    padding: '10px 12px',
                    fontWeight: 1000,
                    background: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Reject
                </button>
              </form>

              <form action={action}>
                <input type="hidden" name="intent" value="toggle_license" />
                <button
                  style={{
                    borderRadius: 12,
                    border: '1px solid #e5e7eb',
                    padding: '10px 12px',
                    fontWeight: 1000,
                    background: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  {pro.licenseVerified ? 'Unverify license' : 'Verify license'}
                </button>
              </form>
            </div>
          </div>

          {pro.bio ? <div style={{ marginTop: 10, fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{pro.bio}</div> : null}

          <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
            Current: <b>{pro.verificationStatus}</b> · License verified: <b>{String(pro.licenseVerified)}</b>
          </div>
        </div>

        <div style={{ border: '1px solid #eee', borderRadius: 16, padding: 16, background: '#fff' }}>
          <div style={{ fontWeight: 1000, marginBottom: 10 }}>Verification documents</div>
          {pro.verificationDocs.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6b7280' }}>No docs uploaded.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {pro.verificationDocs.map((d) => (
                <div key={d.id} style={{ border: '1px solid #f3f4f6', borderRadius: 14, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 1000 }}>
                      {d.type}{' '}
                      <span style={{ fontWeight: 800, fontSize: 12, color: '#6b7280' }}>({d.status})</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(d.createdAt).toLocaleString()}</div>
                  </div>

                  {d.label ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{d.label}</div> : null}

                  {d.url || d.imageUrl ? (
                    <div style={{ fontSize: 12, marginTop: 8 }}>
                      <a href={d.url || d.imageUrl || '#'} target="_blank" rel="noreferrer">
                        Open document
                      </a>
                    </div>
                  ) : null}

                  {d.adminNote ? (
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Admin note: {d.adminNote}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminGuard>
  )
}
