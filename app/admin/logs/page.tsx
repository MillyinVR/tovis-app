// app/admin/logs/page.tsx

import { AdminPermissionRole } from '@prisma/client'

import AdminGuard from '../_components/AdminGuard'
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function formatLogTimeUtc(date: Date): string {
  const timeZone = sanitizeTimeZone('UTC', 'UTC')

  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatNullableId(label: string, value: string | null): string | null {
  return value ? `${label}: ${value}` : null
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
      adminUserId: true,
      professionalId: true,
      serviceId: true,
      categoryId: true,
    },
  })

  return (
    <AdminGuard
      from="/admin/logs"
      allowedRoles={[AdminPermissionRole.SUPER_ADMIN]}
    >
      <main className="mx-auto w-full max-w-960px px-4 pb-10 pt-6">
        <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="m-0 text-[18px] font-black text-textPrimary">
              Admin Logs
            </h1>

            <div className="text-[12px] font-semibold text-textSecondary">
              Times shown in UTC
            </div>
          </div>
        </div>

        <section className="tovis-glass mt-4 overflow-hidden rounded-card border border-white/10 bg-bgSecondary">
          {logs.length === 0 ? (
            <div className="p-4 text-[13px] font-semibold text-textSecondary">
              No logs yet.
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {logs.map((log) => {
                const scopeParts = [
                  formatNullableId('Admin ID', log.adminUserId),
                  formatNullableId('Pro ID', log.professionalId),
                  formatNullableId('Service ID', log.serviceId),
                  formatNullableId('Category ID', log.categoryId),
                ].filter(Boolean)

                return (
                  <div key={log.id} className="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div className="text-[13px] font-black text-textPrimary">
                        {log.action}
                      </div>

                      <div className="text-[12px] font-semibold text-textSecondary">
                        {formatLogTimeUtc(log.createdAt)}
                      </div>
                    </div>

                    {scopeParts.length > 0 ? (
                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        {scopeParts.join(' · ')}
                      </div>
                    ) : null}

                    {log.note ? (
                      <div className="mt-2 text-[13px] text-textPrimary">
                        {log.note}
                      </div>
                    ) : null}
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