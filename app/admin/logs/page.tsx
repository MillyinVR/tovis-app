// app/admin/logs/page.tsx
import AdminGuard from '../_components/AdminGuard'
import { prisma } from '@/lib/prisma'
import { AdminPermissionRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export default async function AdminLogsPage() {
  const logs = await prisma.adminActionLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      action: true,
      note: true,
      adminUser: { select: { email: true } },
      professional: { select: { id: true, businessName: true } },
      service: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
  })

  return (
    <AdminGuard from="/admin/logs" allowedRoles={[AdminPermissionRole.SUPER_ADMIN]}>
      <div style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 1000 }}>Admin Logs</h1>

        <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid' }}>
            {logs.length === 0 ? (
              <div style={{ padding: 12, color: '#6b7280' }}>No logs yet.</div>
            ) : (
              logs.map((l) => (
                <div key={l.id} style={{ padding: 12, borderTop: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 1000 }}>{l.action}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {new Date(l.createdAt).toLocaleString()}
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                    By: {l.adminUser?.email ?? 'Unknown admin'}
                    {l.professional ? ` · Pro: ${l.professional.businessName || l.professional.id}` : ''}
                    {l.service ? ` · Service: ${l.service.name}` : ''}
                    {l.category ? ` · Category: ${l.category.name}` : ''}
                  </div>

                  {l.note ? <div style={{ fontSize: 13, marginTop: 6 }}>{l.note}</div> : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AdminGuard>
  )
}
