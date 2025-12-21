// app/admin/professionals/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type VerificationDocLite = {
  id: string
  type: string
  status: string
  createdAt: Date
  reviewedAt: Date | null
}

export default async function AdminProfessionalsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'ADMIN') redirect('/login?from=/admin/professionals')

  const pros = await prisma.professionalProfile.findMany({
    orderBy: { user: { createdAt: 'desc' } }, // ✅ ProfessionalProfile has no createdAt in your schema
    take: 200,
    select: {
      id: true,
      userId: true,
      businessName: true,
      avatarUrl: true,
      city: true,
      state: true,
      location: true,
      professionType: true,
      licenseVerified: true,
      verificationStatus: true,
      licenseExpiry: true,

      // ✅ you were using pro.user.* in the UI, so you must select it
      user: { select: { email: true, createdAt: true } },

      // ✅ you were using pro.verificationDocs in the UI, so you must select it
      verificationDocs: {
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  })

  return (
    <main style={{ maxWidth: 1100, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Professionals</h1>
          <p style={{ margin: '6px 0 0', color: '#6b7280' }}>
            Review and approve professionals. Because trust is kind of important in beauty.
          </p>
        </div>

        <a
          href="/admin"
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
          Admin home
        </a>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ border: '1px solid #eee', borderRadius: 16, background: '#fff' }}>
        <div style={{ padding: 14, borderBottom: '1px solid #eee', fontWeight: 900 }}>
          Latest ({pros.length})
        </div>

        <div style={{ display: 'grid' }}>
          {pros.map((p) => {
            const email = p.user?.email ?? '(no email?)'
            const created = p.user?.createdAt ? new Date(p.user.createdAt).toLocaleDateString() : ''
            const docs = (p.verificationDocs ?? []) as VerificationDocLite[]
            const pendingDocs = docs.filter((d) => String(d.status) === 'PENDING').length

            return (
              <Link
                key={p.id}
                href={`/admin/professionals/${encodeURIComponent(p.id)}`}
                style={{
                  padding: 14,
                  display: 'grid',
                  gap: 6,
                  textDecoration: 'none',
                  color: '#111',
                  borderTop: '1px solid #eee',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 900 }}>
                    {p.businessName || 'Unnamed professional'}
                    <span style={{ marginLeft: 8, color: '#6b7280', fontWeight: 700, fontSize: 12 }}>{email}</span>
                  </div>

                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {p.verificationStatus} · {p.licenseVerified ? 'License verified' : 'Not verified'}
                    {pendingDocs ? ` · ${pendingDocs} pending doc${pendingDocs === 1 ? '' : 's'}` : ''}
                  </div>
                </div>

                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  {p.city || p.location ? `${p.city || p.location}${p.state ? `, ${p.state}` : ''}` : 'No location yet'}
                  {created ? ` · Joined ${created}` : ''}
                </div>
              </Link>
            )
          })}

          {pros.length === 0 ? (
            <div style={{ padding: 14, color: '#6b7280', fontSize: 13 }}>No professionals found.</div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
