// app/admin/professionals/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import AdminGuard from '../_components/AdminGuard'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'

export const dynamic = 'force-dynamic'

function Pill({ label }: { label: string }) {
  return (
    <span
      className="border border-surfaceGlass/10 bg-bgSecondary"
      style={{
        fontSize: 12,
        fontWeight: 900,
        padding: '4px 10px',
        borderRadius: 999,
      }}
    >
      {label}
    </span>
  )
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'border border-surfaceGlass/25 bg-bgPrimary text-textPrimary'
          : 'border border-surfaceGlass/10 bg-bgSecondary text-textPrimary'
      }
      style={{
        textDecoration: 'none',
        fontSize: 13,
        fontWeight: 1000,
        padding: '8px 10px',
        borderRadius: 999,
      }}
    >
      {label}
    </Link>
  )
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
      location: true,
      professionType: true,
      licenseState: true,
      licenseNumber: true,
      licenseExpiry: true,
      licenseVerified: true,
      verificationStatus: true,
      user: { select: { email: true } },
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
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 1000 }}>Professionals</h1>
            <div style={{ marginTop: 6, fontSize: 13, color: '#6b7280' }}>
              Review applications, approve/decline, and keep the marketplace from becoming Craigslist.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Tab href="/admin/professionals?status=PENDING" label="Pending" active={verificationStatus === 'PENDING'} />
            <Tab href="/admin/professionals?status=APPROVED" label="Approved" active={verificationStatus === 'APPROVED'} />
            <Tab href="/admin/professionals?status=REJECTED" label="Rejected" active={verificationStatus === 'REJECTED'} />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {pros.length === 0 ? (
            <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 16, padding: 16 }}>
              Nothing here. Humans are either behaving or you haven’t seeded pros.
            </div>
          ) : (
            pros.map((p) => (
              <Link
                key={p.id}
                href={`/admin/professionals/${encodeURIComponent(p.id)}`}
                className="text-textPrimary" style={{ textDecoration: 'none' }}
              >
                <div
                  className="border border-surfaceGlass/10 bg-bgSecondary" style={{
                    borderRadius: 16,
                    padding: 14,
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontWeight: 1000 }}>
                        {p.businessName || 'Unnamed business'}{' '}
                        <span style={{ fontWeight: 700, color: '#6b7280', fontSize: 12 }}>({p.user.email})</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#6b7280' }}>
                        {p.professionType || 'Unknown profession'} · {p.location || 'No location'}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        License: {p.licenseState || '??'} {p.licenseNumber || '—'}{' '}
                        {p.licenseExpiry ? `· Exp ${new Date(p.licenseExpiry).toLocaleDateString()}` : ''}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Pill label={`Status: ${p.verificationStatus}`} />
                      <Pill label={p.licenseVerified ? 'License Verified' : 'License NOT Verified'} />
                      <Pill label={`Docs: ${p.verificationDocs.length}`} />
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: '#6b7280' }}>Open to review →</div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </AdminGuard>
  )
}
