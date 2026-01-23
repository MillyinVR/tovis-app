// app/pro/reminders/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ClientNameLink from '@/app/_components/ClientNameLink'

export const dynamic = 'force-dynamic'

function formatDateTime(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default async function ProRemindersPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/reminders')
  }

  const proId = user.professionalProfile.id
  const now = new Date()

  /**
   * ✅ Visibility set: which client charts are linkable for this pro.
   * Same rule you’ve used elsewhere.
   */
  const visibleRows = await prisma.booking.findMany({
    where: {
      professionalId: proId,
      OR: [
        { status: 'PENDING' },
        { startedAt: { not: null }, finishedAt: null },
        { status: 'ACCEPTED', scheduledFor: { gte: now } },
      ],
    },
    select: { clientId: true },
    distinct: ['clientId'],
    take: 5000,
  })
  const visibleClientIdSet = new Set<string>(visibleRows.map((x) => String(x.clientId)))

  /**
   * ✅ Reminders
   */
  const reminders = await prisma.reminder.findMany({
    where: { professionalId: proId },
    include: {
      client: { include: { user: true } },
      booking: { include: { service: true } },
    },
    orderBy: { dueAt: 'asc' },
    take: 2000,
  })

  /**
   * ✅ Dropdown clients:
   * Professional long-term move: only show clients you can actually link to.
   * (If you WANT “any client in system”, tell me and I’ll swap it back.)
   */
  const clients =
    visibleClientIdSet.size === 0
      ? []
      : await prisma.clientProfile.findMany({
          where: { id: { in: Array.from(visibleClientIdSet) } },
          include: { user: true },
          orderBy: { firstName: 'asc' },
          take: 5000,
        })

  const openReminders = reminders.filter((r: any) => !r.completedAt)
  const completedReminders = reminders
    .filter((r: any) => r.completedAt)
    .sort((a: any, b: any) => +new Date(b.completedAt) - +new Date(a.completedAt))
    .slice(0, 20)

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-black text-textPrimary">Reminders</h1>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Follow-ups, rebooks, product check-ins — all the stuff Future You would forget.
            </div>
          </div>

          <a
            href="/pro"
            className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
          >
            ← Back to dashboard
          </a>
        </div>
      </header>

      {/* CREATE */}
      <section className="mb-6">
        <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-3">
            <div className="text-[15px] font-black text-textPrimary">Add a reminder</div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Example: “Check in on color fade”, “DM bridal party count”, “Follow up on retail purchase”.
            </div>
          </div>

          <form method="post" action="/api/pro/reminders" className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-[12px] font-black text-textSecondary" htmlFor="title">
                Title *
              </label>
              <input
                id="title"
                name="title"
                required
                placeholder="Follow up with client"
                className="w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-[13px] font-semibold text-textPrimary placeholder:text-textSecondary/70"
              />
            </div>

            <div className="grid gap-1">
              <label className="text-[12px] font-black text-textSecondary" htmlFor="body">
                Notes (optional)
              </label>
              <textarea
                id="body"
                name="body"
                rows={3}
                placeholder="E.g. ask how her scalp handled last lightening, remind about purple shampoo."
                className="w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-[13px] font-semibold text-textPrimary placeholder:text-textSecondary/70"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-[12px] font-black text-textSecondary" htmlFor="dueAt">
                  Due date &amp; time *
                </label>
                <input
                  id="dueAt"
                  name="dueAt"
                  type="datetime-local"
                  required
                  className="w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-[13px] font-semibold text-textPrimary"
                />
                <div className="text-[11px] font-semibold text-textSecondary/80">Uses your browser timezone.</div>
              </div>

              <div className="grid gap-1">
                <label className="text-[12px] font-black text-textSecondary" htmlFor="clientId">
                  Linked client (optional)
                </label>
                <select
                  id="clientId"
                  name="clientId"
                  className="w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-[13px] font-semibold text-textPrimary"
                >
                  <option value="">No specific client</option>
                  {clients.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                      {c.user?.email ? ` • ${c.user.email}` : ''}
                    </option>
                  ))}
                </select>
                {visibleClientIdSet.size === 0 ? (
                  <div className="text-[11px] font-semibold text-textSecondary/80">
                    No currently visible clients. Link becomes available when you have a pending / active / upcoming accepted booking.
                  </div>
                ) : null}
              </div>
            </div>

            <input type="hidden" name="type" value="GENERAL" />

            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
              >
                Save reminder
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* OPEN */}
      <section className="mb-6 grid gap-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-[15px] font-black text-textPrimary">Upcoming &amp; open reminders</h2>
          <div className="text-[12px] font-semibold text-textSecondary">
            {openReminders.length ? `${openReminders.length} total` : ''}
          </div>
        </div>

        {openReminders.length === 0 ? (
          <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[12px] font-semibold text-textSecondary">
            Nothing on your radar yet. Future you is suspicious.
          </div>
        ) : (
          <div className="grid gap-3">
            {openReminders.map((r: any) => {
              const canLink = r.client ? visibleClientIdSet.has(String(r.client.id)) : false
              return (
                <div key={r.id} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-black text-textPrimary">{r.title}</div>
                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">{formatDateTime(r.dueAt)}</div>

                      {r.client ? (
                        <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                          Client:{' '}
                          <ClientNameLink canLink={canLink} clientId={r.client.id}>
                            {r.client.firstName} {r.client.lastName}
                          </ClientNameLink>
                        </div>
                      ) : null}

                      {r.booking ? (
                        <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                          Booking: {r.booking.service?.name || 'Service'} on {formatDateTime(r.booking.scheduledFor)}
                        </div>
                      ) : null}

                      {r.body ? <div className="mt-3 text-[12px] font-semibold text-textSecondary">{r.body}</div> : null}
                    </div>

                    <div className="shrink-0 md:text-right">
                      <span className="inline-flex rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textSecondary">
                        {String(r.type || 'GENERAL').toLowerCase()}
                      </span>

                      <form method="post" action={`/api/pro/reminders/${encodeURIComponent(r.id)}/complete`} className="mt-2">
                        <button
                          type="submit"
                          className="inline-flex items-center rounded-full border border-toneSuccess/30 bg-bgPrimary px-4 py-2 text-[12px] font-black text-toneSuccess hover:bg-surfaceGlass"
                        >
                          Mark done
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* COMPLETED */}
      <section className="grid gap-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-[15px] font-black text-textPrimary">Recently completed</h2>
          <div className="text-[12px] font-semibold text-textSecondary">
            {completedReminders.length ? `${completedReminders.length} shown` : ''}
          </div>
        </div>

        {completedReminders.length === 0 ? (
          <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[12px] font-semibold text-textSecondary">
            Once you start completing reminders, they&apos;ll show up here.
          </div>
        ) : (
          <div className="grid gap-3">
            {completedReminders.map((r: any) => (
              <div key={r.id} className="rounded-card border border-white/10 bg-bgSecondary p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-black text-textPrimary">{r.title}</div>
                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">Due {formatDateTime(r.dueAt)}</div>
                    {r.completedAt ? (
                      <div className="mt-1 text-[11px] font-semibold text-textSecondary/80">
                        Completed {formatDateTime(r.completedAt)}
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right text-[11px] font-semibold text-textSecondary/80">
                    {r.client ? (
                      <div>
                        {r.client.firstName} {r.client.lastName}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
