// app/pro/aftercare/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadBookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'
import AftercareBeforeAfter from '@/app/_components/aftercare/AftercareBeforeAfter'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  resolveApptTimeZoneFromValues,
} from '@/lib/time'

export const dynamic = 'force-dynamic'

function aftercareHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`
}

// These are administrative timestamps (draft saved / sent / created) in the
// pro's own management list, so we render them in the pro's timezone via the
// `@/lib/time` barrel rather than a raw, server-zone `toLocaleString`.
function formatDateTime(value: Date | null, timeZone: string) {
  if (!value) return '—'

  return formatInTimeZone(value, timeZone, {
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
      return 'Next booking'
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
  // Fallback only — the appointment's own location timezone wins per row below,
  // so timestamps read correctly even when the pro travels outside home base.
  const professionalTimeZone = auth.user.professionalProfile?.timeZone

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
          locationTimeZone: true,
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

  // Before/after photos are the primary way a pro recognizes an aftercare they
  // sent — load them for every listed booking and surface them at the top of
  // each card (mirrors the client-side aftercare view).
  const beforeAfterByBooking = await loadBookingBeforeAfterThumbs(
    summaries.map((summary) => summary.bookingId),
  )

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
            const beforeAfter = beforeAfterByBooking.get(summary.bookingId)
            // Appointment location timezone wins (pro timezone as fallback) so
            // these read in the zone where the appointment actually happened.
            const tzResult = resolveApptTimeZoneFromValues({
              bookingLocationTimeZone: summary.booking.locationTimeZone,
              professionalTimeZone,
              fallback: DEFAULT_TIME_ZONE,
            })
            const timeZone = tzResult.ok ? tzResult.timeZone : DEFAULT_TIME_ZONE

            return (
              <Link
                key={summary.id}
                href={aftercareHref(summary.bookingId)}
                className="tovis-glass rounded-card block border border-white/10 bg-bgSecondary p-4 transition hover:bg-surfaceGlass"
              >
                {beforeAfter ? (
                  <AftercareBeforeAfter
                    media={beforeAfter}
                    serviceName={serviceName}
                    className="mb-4"
                  />
                ) : null}

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
                    value={formatDateTime(summary.draftSavedAt, timeZone)}
                  />
                  <MetaItem
                    label="Sent to client"
                    value={formatDateTime(summary.sentToClientAt, timeZone)}
                  />
                  <MetaItem
                    label="Rebook mode"
                    value={formatRebookMode(summary.rebookMode)}
                  />
                  <MetaItem
                    label="Created"
                    value={formatDateTime(summary.createdAt, timeZone)}
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