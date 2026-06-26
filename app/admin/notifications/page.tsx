// app/admin/notifications/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { getCurrentUser } from '@/lib/currentUser'
import { formatInTimeZone } from '@/lib/time'
import {
  listAdminNotifications,
  markAllAdminNotificationsRead,
} from '@/lib/notifications/adminNotificationQueries'
import { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function requireAdminUser() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== Role.ADMIN) redirect('/forbidden')
  return user
}

export default async function AdminNotificationsPage() {
  const user = await requireAdminUser()

  const { items } = await listAdminNotifications({
    adminUserId: user.id,
    take: 60,
  })

  async function markAllRead() {
    'use server'
    const current = await getCurrentUser().catch(() => null)
    if (!current || current.role !== Role.ADMIN) redirect('/forbidden')
    await markAllAdminNotificationsRead({ adminUserId: current.id })
    revalidatePath('/admin/notifications')
  }

  const hasUnread = items.some((n) => n.readAt === null)

  return (
    <main className="mx-auto w-full max-w-1100px px-4 py-6 text-textPrimary">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-[22px] font-black">Notifications</h1>
          <p className="text-[13px] text-textSecondary">
            Operational alerts that need an admin’s attention.
          </p>
        </div>

        {hasUnread ? (
          <form action={markAllRead}>
            <button
              type="submit"
              className="inline-flex items-center rounded-full border border-white/12 bg-bgPrimary/55 px-3 py-2 text-[12px] font-black hover:border-white/22 hover:bg-bgPrimary/70"
            >
              Mark all read
            </button>
          </form>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
          You’re all caught up — no notifications.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((n) => {
            const unread = n.readAt === null
            return (
              <div
                key={n.id}
                className={[
                  'tovis-glass rounded-card border bg-bgSecondary p-4',
                  unread ? 'border-accentPrimary/40' : 'border-white/10',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {unread ? (
                        <span
                          aria-hidden="true"
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: 'rgb(var(--tone-danger))' }}
                        />
                      ) : null}
                      <span className="text-[13px] font-black">{n.title}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-textSecondary">
                      {formatInTimeZone(
                        n.createdAt,
                        'UTC',
                        { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
                        'en-US',
                      )}
                    </div>
                  </div>

                  {n.href ? (
                    <Link
                      href={n.href}
                      className="inline-flex items-center rounded-full border border-white/12 bg-bgPrimary/55 px-3 py-2 text-[12px] font-black hover:border-white/22 hover:bg-bgPrimary/70"
                    >
                      View
                    </Link>
                  ) : null}
                </div>

                {n.body ? (
                  <div className="mt-3 whitespace-pre-wrap text-[13px] text-textSecondary">
                    {n.body}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
