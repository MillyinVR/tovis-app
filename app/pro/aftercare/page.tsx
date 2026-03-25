// app/pro/aftercare/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { requirePro } from '@/app/api/_utils/auth/requirePro'

export const dynamic = 'force-dynamic'

function aftercareHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`
}

function formatDateTime(value: Date | null) {
  if (!value) return '—'

  return value.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatRebookMode(value: unknown) {
  const mode = typeof value === 'string' ? value : ''

  switch (mode) {
    case 'BOOKED_NEXT_APPOINTMENT':
      return 'Booked next appointment'
    case 'RECOMMENDED_WINDOW':
      return 'Recommended window'
    case 'NONE':
      return 'None'
    default:
      return '—'
  }
}

function getClientName(client: {
  firstName: string | null
  lastName: string | null
  user: { email: string | null } | null
}) {
  const fullName = `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim()
  if (fullName) return fullName
  if (client.user?.email) return client.user.email
  return 'Client'
}

function getStatus(summary: {
  draftSavedAt: Date | null
  sentToClientAt: Date | null
}) {
  if (summary.sentToClientAt) {
    return {
      icon: '✅',
      label: 'sent',
    }
  }

  if (summary.draftSavedAt) {
    return {
      icon: '📝',
      label: 'draft',
    }
  }

  return {
    icon: '❌',
    label: 'not started',
  }
}

function compareSummaries(
  a: {
    sentToClientAt: Date | null
    draftSavedAt: Date | null
    createdAt: Date
  },
  b: {
    sentToClientAt: Date | null
    draftSavedAt: Date | null
    createdAt: Date
  },
) {
  const aSent = a.sentToClientAt ? 1 : 0
  const bSent = b.sentToClientAt ? 1 : 0
  if (aSent !== bSent) return bSent - aSent

  const aSentAt = a.sentToClientAt?.getTime() ?? -1
  const bSentAt = b.sentToClientAt?.getTime() ?? -1
  if (aSentAt !== bSentAt) return bSentAt - aSentAt

  const aDraftAt = a.draftSavedAt?.getTime() ?? -1
  const bDraftAt = b.draftSavedAt?.getTime() ?? -1
  if (aDraftAt !== bDraftAt) return bDraftAt - aDraftAt

  return b.createdAt.getTime() - a.createdAt.getTime()
}

function MetaItem(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-bgPrimary px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-textSecondary/80">
        {props.label}
      </div>
      <div className="mt-1 text-[12px] font-black text-textPrimary">
        {props.value}
      </div>
    </div>
  )
}

export default async function ProAftercarePage() {
  const auth = await requirePro()

  if (!auth.ok) {
    redirect(`/login?from=${encodeURIComponent('/pro/aftercare')}`)
  }

  const professionalId = auth.professionalId

  const rows = await prisma.aftercareSummary.findMany({
    where: {
      booking: {
        is: {
          professionalId,
        },
      },
    },
    orderBy: [{ sentToClientAt: 'desc' }, { draftSavedAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      bookingId: true,
      draftSavedAt: true,
      sentToClientAt: true,
      rebookMode: true,
      createdAt: true,
      booking: {
        select: {
          id: true,
          service: {
            select: {
              name: true,
            },
          },
          client: {
            select: {
              firstName: true,
              lastName: true,
              user: {
                select: {
                  email: true,
                },
              },
            },
          },
        },
      },
    },
  })

  const summaries = [...rows].sort(compareSummaries)

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-black text-textPrimary">Aftercare</h1>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            Latest aftercare summaries for your bookings.
          </div>
        </div>

        <div className="text-[12px] font-semibold text-textSecondary">
          {summaries.length} shown
        </div>
      </header>

      {summaries.length === 0 ? (
        <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-5">
          <div className="text-[15px] font-black text-textPrimary">
            No aftercare summaries yet
          </div>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            Drafts and sent summaries will appear here once you start using
            aftercare on bookings.
          </div>
        </section>
      ) : (
        <section className="grid gap-3">
          {summaries.map((summary) => {
            const serviceName = summary.booking.service?.name ?? 'Service'
            const clientName = getClientName(summary.booking.client)
            const status = getStatus(summary)

            return (
              <Link
                key={summary.id}
                href={aftercareHref(summary.bookingId)}
                className="tovis-glass rounded-card block border border-white/10 bg-bgSecondary p-4 transition hover:bg-surfaceGlass"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-[16px] font-black text-textPrimary">
                        {serviceName}
                      </h2>

                      <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
                        <span aria-hidden>{status.icon}</span>
                        <span className="ml-1">{status.label}</span>
                      </span>
                    </div>

                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                      Client: {clientName}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary">
                      Open aftercare
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <MetaItem
                    label="Draft saved"
                    value={formatDateTime(summary.draftSavedAt)}
                  />
                  <MetaItem
                    label="Sent to client"
                    value={formatDateTime(summary.sentToClientAt)}
                  />
                  <MetaItem
                    label="Rebook mode"
                    value={formatRebookMode(summary.rebookMode)}
                  />
                  <MetaItem
                    label="Created"
                    value={formatDateTime(summary.createdAt)}
                  />
                </div>
              </Link>
            )
          })}
        </section>
      )}
    </main>
  )
}