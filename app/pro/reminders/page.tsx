// app/pro/reminders/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'

import ClientNameLink from '@/app/_components/ClientNameLink'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const REMINDER_INCLUDE = {
  client: {
    include: {
      user: true,
    },
  },
  booking: {
    include: {
      service: true,
    },
  },
} satisfies Prisma.ReminderInclude

const CLIENT_INCLUDE = {
  user: true,
} satisfies Prisma.ClientProfileInclude

type ReminderWithRelations = Prisma.ReminderGetPayload<{
  include: typeof REMINDER_INCLUDE
}>

type ClientWithUser = Prisma.ClientProfileGetPayload<{
  include: typeof CLIENT_INCLUDE
}>

function formatDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value

  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function clientDisplayName(client: ClientWithUser): string {
  return `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim()
}

function reminderClientDisplayName(
  client: ReminderWithRelations['client'],
): string {
  if (!client) return ''

  return `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim()
}

function sortCompletedReminders(
  reminders: ReminderWithRelations[],
): ReminderWithRelations[] {
  return [...reminders].sort((first, second) => {
    const firstCompletedAt = first.completedAt
      ? new Date(first.completedAt).getTime()
      : 0

    const secondCompletedAt = second.completedAt
      ? new Date(second.completedAt).getTime()
      : 0

    return secondCompletedAt - firstCompletedAt
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
   * Visibility set: which client charts are linkable for this pro.
   * Same rule used elsewhere.
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

  const visibleClientIdSet = new Set<string>(
    visibleRows.map((row) => String(row.clientId)),
  )

  const reminders = await prisma.reminder.findMany({
    where: { professionalId: proId },
    include: REMINDER_INCLUDE,
    orderBy: { dueAt: 'asc' },
    take: 2000,
  })

  const clients =
    visibleClientIdSet.size === 0
      ? []
      : await prisma.clientProfile.findMany({
          where: { id: { in: Array.from(visibleClientIdSet) } },
          include: CLIENT_INCLUDE,
          orderBy: { firstName: 'asc' },
          take: 5000,
        })

  const openReminders = reminders.filter((reminder) => !reminder.completedAt)

  const completedReminders = sortCompletedReminders(
    reminders.filter((reminder) => reminder.completedAt),
  ).slice(0, 20)

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-black text-textPrimary">
              Reminders
            </h1>

            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Follow-ups, rebooks, product check-ins — all the stuff Future You
              would forget.
            </div>
          </div>

          <Link
            href="/pro"
            className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
          >
            ← Back to dashboard
          </Link>
        </div>
      </header>

      {/* CREATE */}
      <section className="mb-6">
        <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-3">
            <div className="text-[15px] font-black text-textPrimary">
              Add a reminder
            </div>

            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Example: “Check in on color fade”, “DM bridal party count”,
              “Follow up on retail purchase”.
            </div>
          </div>

          <form method="post" action="/api/pro/reminders" className="grid gap-3">
            <div className="grid gap-1">
              <label
                className="text-[12px] font-black text-textSecondary"
                htmlFor="title"
              >
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
              <label
                className="text-[12px] font-black text-textSecondary"
                htmlFor="body"
              >
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
                <label
                  className="text-[12px] font-black text-textSecondary"
                  htmlFor="dueAt"
                >
                  Due date &amp; time *
                </label>

                <input
                  id="dueAt"
                  name="dueAt"
                  type="datetime-local"
                  required
                  className="w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-[13px] font-semibold text-textPrimary"
                />

                <div className="text-[11px] font-semibold text-textSecondary/80">
                  Uses your browser timezone.
                </div>
              </div>

              <div className="grid gap-1">
                <label
                  className="text-[12px] font-black text-textSecondary"
                  htmlFor="clientId"
                >
                  Linked client (optional)
                </label>

                <select
                  id="clientId"
                  name="clientId"
                  className="w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-[13px] font-semibold text-textPrimary"
                >
                  <option value="">No specific client</option>

                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {clientDisplayName(client)}
                      {client.user?.email ? ` • ${client.user.email}` : ''}
                    </option>
                  ))}
                </select>

                {visibleClientIdSet.size === 0 ? (
                  <div className="text-[11px] font-semibold text-textSecondary/80">
                    No currently visible clients. Link becomes available when
                    you have a pending / active / upcoming accepted booking.
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
          <h2 className="text-[15px] font-black text-textPrimary">
            Upcoming &amp; open reminders
          </h2>

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
            {openReminders.map((reminder) => {
              const canLink = reminder.client
                ? visibleClientIdSet.has(String(reminder.client.id))
                : false

              return (
                <div
                  key={reminder.id}
                  className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-black text-textPrimary">
                        {reminder.title}
                      </div>

                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        {formatDateTime(reminder.dueAt)}
                      </div>

                      {reminder.client ? (
                        <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                          Client:{' '}
                          <ClientNameLink
                            canLink={canLink}
                            clientId={reminder.client.id}
                          >
                            {reminderClientDisplayName(reminder.client)}
                          </ClientNameLink>
                        </div>
                      ) : null}

                      {reminder.booking ? (
                        <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                          Booking:{' '}
                          {reminder.booking.service?.name || 'Service'} on{' '}
                          {formatDateTime(reminder.booking.scheduledFor)}
                        </div>
                      ) : null}

                      {reminder.body ? (
                        <div className="mt-3 text-[12px] font-semibold text-textSecondary">
                          {reminder.body}
                        </div>
                      ) : null}
                    </div>

                    <div className="shrink-0 md:text-right">
                      <span className="inline-flex rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textSecondary">
                        {String(reminder.type || 'GENERAL').toLowerCase()}
                      </span>

                      <form
                        method="post"
                        action={`/api/pro/reminders/${encodeURIComponent(
                          reminder.id,
                        )}/complete`}
                        className="mt-2"
                      >
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
          <h2 className="text-[15px] font-black text-textPrimary">
            Recently completed
          </h2>

          <div className="text-[12px] font-semibold text-textSecondary">
            {completedReminders.length
              ? `${completedReminders.length} shown`
              : ''}
          </div>
        </div>

        {completedReminders.length === 0 ? (
          <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[12px] font-semibold text-textSecondary">
            Once you start completing reminders, they&apos;ll show up here.
          </div>
        ) : (
          <div className="grid gap-3">
            {completedReminders.map((reminder) => (
              <div
                key={reminder.id}
                className="rounded-card border border-white/10 bg-bgSecondary p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-black text-textPrimary">
                      {reminder.title}
                    </div>

                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                      Due {formatDateTime(reminder.dueAt)}
                    </div>

                    {reminder.completedAt ? (
                      <div className="mt-1 text-[11px] font-semibold text-textSecondary/80">
                        Completed {formatDateTime(reminder.completedAt)}
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right text-[11px] font-semibold text-textSecondary/80">
                    {reminder.client ? (
                      <div>{reminderClientDisplayName(reminder.client)}</div>
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