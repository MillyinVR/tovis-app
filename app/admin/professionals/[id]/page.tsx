// app/admin/professionals/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Params = { id: string }

type VerificationDoc = {
  id: string
  type: string
  status: string
  createdAt: Date
  reviewedAt: Date | null
  label: string | null
  imageUrl: string | null
  url: string | null
  adminNote: string | null
}

export default async function AdminProfessionalDetailPage({ params }: { params: Params }) {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'ADMIN') redirect(`/login?from=/admin/professionals/${encodeURIComponent(params.id)}`)

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: params.id }, // ✅ unique
    select: {
      id: true,
      userId: true,
      businessName: true,
      bio: true,
      avatarUrl: true,
      professionType: true,
      location: true,
      city: true,
      state: true,
      postalCode: true,

      licenseNumber: true,
      licenseState: true,
      licenseExpiry: true,
      licenseVerified: true,
      verificationStatus: true,

      autoAcceptBookings: true,
      timeZone: true,
      workingHours: true,

      // ✅ you were reading pro.user.*
      user: { select: { email: true, createdAt: true } },

      // ✅ you were reading pro.verificationDocs
      verificationDocs: {
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          label: true,
          imageUrl: true,
          url: true,
          adminNote: true,
        },
        orderBy: { createdAt: 'desc' },
      },

      // Optional: for admin context
      _count: { select: { bookings: true, offerings: true, waitlistEntries: true } },
    },
  })

  if (!pro) return notFound()

  const docs = (pro.verificationDocs ?? []) as VerificationDoc[]
  const joined = pro.user?.createdAt ? new Date(pro.user.createdAt).toLocaleString() : ''

  return (
    <main style={{ maxWidth: 1000, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>
            {pro.businessName || 'Unnamed professional'}
          </h1>
          <p style={{ margin: '6px 0 0', color: '#6b7280' }}>
            {pro.user?.email || 'No email'} {joined ? `· Joined ${joined}` : ''}
          </p>
        </div>

        <a
          href="/admin/professionals"
          style={{
            textDecoration: 'none',
            border: '1px solid #ddd',
            borderRadius: 999,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 900,
            color: '#111',
            background: '#fff',
          }}
        >
          Back
        </a>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ border: '1px solid #eee', borderRadius: 16, background: '#fff', padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
            <div style={{ fontWeight: 900 }}>Overview</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Status: <b>{String(pro.verificationStatus)}</b> · License: <b>{pro.licenseVerified ? 'Verified' : 'Not verified'}</b>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, color: '#111', display: 'grid', gap: 6 }}>
            <div>
              <b>Location:</b>{' '}
              {pro.city || pro.location ? `${pro.city || pro.location}${pro.state ? `, ${pro.state}` : ''}` : '—'}
            </div>
            <div>
              <b>Profession:</b> {pro.professionType || '—'}
            </div>
            <div>
              <b>Counts:</b> {pro._count?.offerings ?? 0} offerings · {pro._count?.bookings ?? 0} bookings ·{' '}
              {pro._count?.waitlistEntries ?? 0} waitlist
            </div>
          </div>
        </div>

        <div style={{ border: '1px solid #eee', borderRadius: 16, background: '#fff', padding: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Verification documents</div>

          {docs.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>No documents uploaded yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {docs.map((d: VerificationDoc) => {
                const createdAt = d.createdAt ? new Date(d.createdAt).toLocaleString() : ''
                return (
                  <div key={d.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 900 }}>{String(d.type)}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {String(d.status)} {createdAt ? `· ${createdAt}` : ''}
                      </div>
                    </div>

                    {d.label ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{d.label}</div> : null}

                    {d.adminNote ? (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                        <b>Admin note:</b> {d.adminNote}
                      </div>
                    ) : null}

                    {(d.imageUrl || d.url) ? (
                      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        {d.imageUrl ? (
                          <a
                            href={d.imageUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              textDecoration: 'none',
                              border: '1px solid #ddd',
                              borderRadius: 999,
                              padding: '8px 12px',
                              fontSize: 12,
                              fontWeight: 900,
                              color: '#111',
                              background: '#fff',
                            }}
                          >
                            View image
                          </a>
                        ) : null}
                        {d.url ? (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              textDecoration: 'none',
                              border: '1px solid #111',
                              borderRadius: 999,
                              padding: '8px 12px',
                              fontSize: 12,
                              fontWeight: 900,
                              color: '#fff',
                              background: '#111',
                            }}
                          >
                            Open file
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
