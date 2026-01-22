import AdminGuard from '../_components/AdminGuard'
import { prisma } from '@/lib/prisma'
import { AdminPermissionRole } from '@prisma/client'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function formatLogTimeUtc(d: Date) {
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
      <main className="mx-auto w-full max-w-960px px-4 pb-10 pt-6">
        <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="m-0 text-[18px] font-black text-textPrimary">Admin Logs</h1>
            <div className="text-[12px] font-semibold text-textSecondary">Times shown in UTC</div>
          </div>
        </div>

        <section className="tovis-glass mt-4 rounded-card border border-white/10 bg-bgSecondary overflow-hidden">
          {logs.length === 0 ? (
            <div className="p-4 text-[13px] font-semibold text-textSecondary">No logs yet.</div>
          ) : (
            <div className="divide-y divide-white/10">
              {logs.map((l) => {
                const who = l.adminUser?.email ?? 'Unknown admin'
                const pro = l.professional ? l.professional.businessName || l.professional.id : null
                const svc = l.service ? l.service.name : null
                const cat = l.category ? l.category.name : null

                return (
                  <div key={l.id} className="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div className="text-[13px] font-black text-textPrimary">{l.action}</div>
                      <div className="text-[12px] font-semibold text-textSecondary">
                        {formatLogTimeUtc(new Date(l.createdAt))}
                      </div>
                    </div>

                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                      By: {who}
                      {pro ? ` · Pro: ${pro}` : ''}
                      {svc ? ` · Service: ${svc}` : ''}
                      {cat ? ` · Category: ${cat}` : ''}
                    </div>

                    {l.note ? <div className="mt-2 text-[13px] text-textPrimary">{l.note}</div> : null}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </AdminGuard>
  )
}
