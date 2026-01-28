// app/pro/clients/[id]/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import NewNoteForm from './NewNoteForm'
import NewAllergyForm from './NewAllergyForm'
import EditAlertBannerForm from './EditAlertBannerForm'
import { moneyToString } from '@/lib/money'
import ClientNameLink from '@/app/_components/ClientNameLink'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import type { ReactNode } from 'react'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

function formatDate(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function safeUpper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function buildProToClientMessageHref(args: { proId: string; clientId: string }) {
  const { proId, clientId } = args
  return `/messages/start?contextType=PRO_PROFILE&contextId=${encodeURIComponent(proId)}&clientId=${encodeURIComponent(
    clientId,
  )}`
}


function statusTone(status: unknown) {
  const s = safeUpper(status)
  if (s === 'COMPLETED') return 'border-toneSuccess/30 text-toneSuccess'
  if (s === 'CANCELLED') return 'border-toneDanger/30 text-toneDanger'
  if (s === 'ACCEPTED') return 'border-accentPrimary/30 text-textPrimary'
  if (s === 'PENDING') return 'border-white/10 text-textPrimary'
  return 'border-white/10 text-textSecondary'
}

function StatusPill({ status }: { status: unknown }) {
  const s = safeUpper(status) || 'UNKNOWN'
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border bg-bgPrimary px-2 py-1 text-[11px] font-black',
        statusTone(s),
      ].join(' ')}
    >
      {s}
    </span>
  )
}

function SectionCard({
  id,
  title,
  subtitle,
  right,
  children,
}: {
  id: string
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-black text-textPrimary">{title}</h2>
          {subtitle ? <div className="mt-1 text-[12px] font-semibold text-textSecondary">{subtitle}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">{children}</div>
    </section>
  )
}

type BookingFilter = 'ALL' | 'WITH_ME' | 'MATCHES_MY_SERVICES' | 'UPCOMING' | 'PAST' | 'COMPLETED' | 'CANCELLED'

function normalizeBookingFilter(raw: unknown): BookingFilter {
  const s = String(raw || '').trim().toUpperCase()
  if (s === 'ALL' || s === 'WITH_ME' || s === 'MATCHES_MY_SERVICES' || s === 'UPCOMING' || s === 'PAST' || s === 'COMPLETED' || s === 'CANCELLED') {
    return s as BookingFilter
  }
  return 'ALL'
}

function buildBookingSearchIndex(b: any) {
  const parts = [
    b?.service?.name,
    b?.service?.category?.name,
    b?.professional?.businessName,
    b?.professional?.user?.email,
    b?.status,
    b?.aftercareSummary?.notes,
    String(b?.totalDurationMinutes ?? ''),
    String(b?.totalAmount ?? b?.subtotalSnapshot ?? ''),
    b?.scheduledFor ? formatDate(b.scheduledFor) : '',
  ]

  return parts
    .filter(Boolean)
    .map((x) => String(x).toLowerCase())
    .join(' ')
}

export default async function ClientDetailPage(props: {
  params: Promise<{ id: string }>
  searchParams?: Promise<SearchParams>
}) {
  const { id } = await props.params
  const clientId = String(id || '').trim()
  if (!clientId) redirect('/pro/clients')

  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/clients')
  }

  const proId = user.professionalProfile.id

  // ✅ Hard gate (single source of truth)
  const gate = await assertProCanViewClient(proId, clientId)
  if (!gate.ok) redirect('/pro/clients')

  // On this page, since it's gated, internal linking is safe.
  const canSeeClient = true
  const messageHref = buildProToClientMessageHref({ proId, clientId })

  const sp = (await props.searchParams?.catch(() => ({} as SearchParams))) ?? ({} as SearchParams)
  const bookingQ = firstParam(sp.q).trim()
  const bookingFilter = normalizeBookingFilter(firstParam(sp.bookingFilter))

  const now = new Date()

  // Fetch "my services" first (only serviceId), to support MATCHES_MY_SERVICES
  const myOfferings = await prisma.professionalServiceOffering.findMany({
    where: { professionalId: proId, isActive: true },
    select: { serviceId: true },
    take: 500,
  })
  const myServiceIdSet = new Set<string>(myOfferings.map((o) => String(o.serviceId)).filter(Boolean))

  // Build booking where (apply filter at query-time when possible)
  const bookingWhere: any = { clientId } // note: booking model uses clientId
  if (bookingFilter === 'WITH_ME') bookingWhere.professionalId = proId
  if (bookingFilter === 'UPCOMING') bookingWhere.scheduledFor = { gte: now }
  if (bookingFilter === 'PAST') bookingWhere.scheduledFor = { lt: now }
  if (bookingFilter === 'COMPLETED') bookingWhere.status = 'COMPLETED'
  if (bookingFilter === 'CANCELLED') bookingWhere.status = 'CANCELLED'
  if (bookingFilter === 'MATCHES_MY_SERVICES') {
    bookingWhere.serviceId = { in: Array.from(myServiceIdSet) }
  }

  // Client core (tight select)
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      alertBanner: true,
      user: { select: { email: true } },

      // notes: private to this pro
      notes: {
        where: { professionalId: proId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, body: true, createdAt: true },
      },

      allergies: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          label: true,
          severity: true,
          description: true,
          createdAt: true,
          recordedBy: { select: { user: { select: { email: true } } } },
        },
      },
    },
  })

  if (!client) redirect('/pro/clients')

  // Bookings (tight select; filter applied in query)
  const bookingRowsAll = await prisma.booking.findMany({
    where: bookingWhere,
    orderBy: { scheduledFor: 'desc' },
    // cap if you want safety; keep high if you truly need “all time”
    take: 2000,
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      totalDurationMinutes: true,
      totalAmount: true,
      subtotalSnapshot: true,
      professionalId: true,
      serviceId: true,
      service: { select: { name: true, category: { select: { name: true } } } },
      professional: { select: { businessName: true, user: { select: { email: true } } } },
      aftercareSummary: { select: { notes: true } },
    },
  })

  // Product recs (tight select)
  const productRecs = await prisma.productRecommendation.findMany({
    where: { aftercareSummary: { booking: { clientId: client.id } } },
    select: {
      id: true,
      note: true,
      product: { select: { name: true, brand: true } },
      aftercareSummary: { select: { booking: { select: { scheduledFor: true } } } },
    },
    take: 2000,
  })

  // Reviews this client left (tight select)
  const clientLeftReviews = await prisma.review.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: 'desc' },
    take: 2000,
    select: {
      id: true,
      rating: true,
      headline: true,
      body: true,
      createdAt: true,
      professional: { select: { businessName: true, user: { select: { email: true } } } },
    },
  })

  // Pro feedback (tight select)
  const proFeedback = await prisma.clientProfessionalNote.findMany({
    where: { clientId: client.id, visibility: 'PROFESSIONALS_ONLY' as any },
    orderBy: { createdAt: 'desc' },
    take: 2000,
    select: {
      id: true,
      title: true,
      body: true,
      createdAt: true,
      professional: { select: { businessName: true, user: { select: { email: true } } } },
    },
  })

  // Derived summary
  const totalVisits = bookingRowsAll.length
  const lastVisit = totalVisits ? bookingRowsAll[0] : null
  const upcoming =
    bookingRowsAll
      .filter((b: any) => new Date(b.scheduledFor) > new Date())
      .sort((a: any, b: any) => +new Date(a.scheduledFor) - +new Date(b.scheduledFor))[0] ?? null

  const email = client.user?.email || ''
  const phone = client.phone || ''

  // Search (still in memory)
  const bookingRowsFiltered =
    bookingQ.length >= 1
      ? bookingRowsAll.filter((b: any) => buildBookingSearchIndex(b).includes(bookingQ.toLowerCase()))
      : bookingRowsAll

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      {/* Top nav */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <a
          href="/pro/clients"
          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
        >
          ← Back to clients
        </a>

        <div className="text-[11px] font-semibold text-textSecondary">
          Visibility: <span className="font-black text-textPrimary">Granted</span>
        </div>
      </div>

      {/* Header */}
      <header className="tovis-glass mb-6 rounded-card border border-white/10 bg-bgSecondary p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-black text-textPrimary">
              <ClientNameLink canLink={canSeeClient} clientId={client.id}>
                {client.firstName} {client.lastName}
              </ClientNameLink>
            </h1>

            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              {email ? email : 'No email on file'}
              {phone ? ` • ${phone}` : ''}
            </div>

            {client.alertBanner ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-toneWarning/30 bg-bgPrimary px-3 py-1 text-[11px] font-black text-toneWarning">
                <span aria-hidden>⚠</span>
                <span className="truncate">{client.alertBanner}</span>
              </div>
            ) : null}
          </div>

          <div className="grid gap-2 md:text-right">
            <div className="text-[12px] font-semibold text-textSecondary">
              <div>
                Total visits: <span className="font-black text-textPrimary">{totalVisits}</span>
              </div>
              {lastVisit ? (
                <div>
                  Last visit: <span className="font-black text-textPrimary">{formatDate(lastVisit.scheduledFor)}</span>
                </div>
              ) : null}
              {upcoming ? (
                <div>
                  Next visit: <span className="font-black text-textPrimary">{formatDate(upcoming.scheduledFor)}</span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 md:justify-end">
              <a
                href={messageHref}
                className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
              >
                Message
              </a>

              <a
                href={`/pro/bookings/new?clientId=${encodeURIComponent(client.id)}`}
                className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
              >
                + New booking
              </a>

              <div className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2">
                <EditAlertBannerForm clientId={client.id} initialAlertBanner={client.alertBanner ?? null} />
              </div>
            </div>

          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="mb-6 flex flex-wrap gap-2">
        {[
          { id: 'notes', label: 'Notes' },
          { id: 'allergies', label: 'Allergies' },
          { id: 'history', label: 'Service history' },
          { id: 'products', label: 'Products' },
          { id: 'reviews-left', label: 'Reviews they left' },
          { id: 'pro-feedback', label: 'Pro feedback' },
        ].map((tab) => (
          <a
            key={tab.id}
            href={`#${tab.id}`}
            className="rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
          >
            {tab.label}
          </a>
        ))}
      </nav>

      <div className="grid gap-6">
        {/* NOTES */}
        <SectionCard
          id="notes"
          title="Pro notes"
          subtitle="Private notes visible to you (and admins). Preferences, patterns, and anything you don’t want to forget."
        >
          <div className="mb-4">
            <NewNoteForm clientId={client.id} />
          </div>

          {client.notes.length === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
              No notes yet. Start the “professional memory” file.
            </div>
          ) : (
            <div className="grid gap-3">
              {client.notes.map((note: any) => (
                <div key={note.id} className="rounded-card border border-white/10 bg-bgPrimary p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 truncate text-[13px] font-black text-textPrimary">{note.title || 'Note'}</div>
                    <div className="shrink-0 text-[11px] font-semibold text-textSecondary">{formatDate(note.createdAt)}</div>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-[13px] font-semibold text-textSecondary">{note.body}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ALLERGIES */}
        <SectionCard
          id="allergies"
          title="Allergies & sensitivities"
          subtitle="Anything that could cause a reaction or needs extra care. The “do not fry their scalp” section."
        >
          <div className="mb-4">
            <NewAllergyForm clientId={client.id} />
          </div>

          {client.allergies.length === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
              No allergies recorded yet.
            </div>
          ) : (
            <div className="grid gap-3">
              {client.allergies.map((a: any) => (
                <div key={a.id} className="rounded-card border border-white/10 bg-bgPrimary p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-[13px] font-black text-textPrimary">{a.label}</div>
                    <span className="shrink-0 rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-[11px] font-black text-textSecondary">
                      {String(a.severity || '').toUpperCase()}
                    </span>
                  </div>

                  {a.description ? <div className="mt-2 text-[12px] font-semibold text-textSecondary">{a.description}</div> : null}

                  <div className="mt-2 text-[11px] font-semibold text-textSecondary/80">
                    Recorded {formatDate(a.createdAt)}
                    {a.recordedBy?.user?.email ? ` • by ${a.recordedBy.user.email}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* SERVICE HISTORY + SEARCH/FILTER */}
        <SectionCard
          id="history"
          title="Service history"
          subtitle="Search and filter all bookings for this client."
          right={
            <form className="flex flex-wrap items-center justify-end gap-2" method="GET" action="">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-black text-textSecondary" htmlFor="bookingFilter">
                  View
                </label>
                <select
                  id="bookingFilter"
                  name="bookingFilter"
                  defaultValue={bookingFilter}
                  className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary"
                >
                  <option value="ALL">All bookings</option>
                  <option value="WITH_ME">Only bookings with me</option>
                  <option value="MATCHES_MY_SERVICES">Only services I offer</option>
                  <option value="UPCOMING">Upcoming</option>
                  <option value="PAST">Past</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] font-black text-textSecondary" htmlFor="q">
                  Search
                </label>
                <input
                  id="q"
                  name="q"
                  defaultValue={bookingQ}
                  placeholder="Service, category, notes, status…"
                  className="w-56 rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-semibold text-textPrimary placeholder:text-textSecondary/70"
                />
              </div>

              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
              >
                Apply
              </button>

              {(bookingQ || bookingFilter !== 'ALL') ? (
                <a
                  href={`/pro/clients/${encodeURIComponent(client.id)}#history`}
                  className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                >
                  Clear
                </a>
              ) : null}
            </form>
          }
        >
          {bookingRowsFiltered.length === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
              No bookings match your search/filter.
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="text-[11px] font-semibold text-textSecondary">
                Showing <span className="font-black text-textPrimary">{bookingRowsFiltered.length}</span> of{' '}
                <span className="font-black text-textPrimary">{bookingRowsAll.length}</span>
              </div>

              {bookingRowsFiltered.map((b: any) => {
                const dur = Math.round(Number(b.totalDurationMinutes ?? 0))
                const total = moneyToString(b.totalAmount ?? b.subtotalSnapshot) ?? '0.00'
                const when = formatDate(b.scheduledFor)
                const proName = b?.professional?.businessName || b?.professional?.user?.email || 'Professional'

                return (
                  <a
                    key={b.id}
                    href={`/pro/bookings/${encodeURIComponent(b.id)}`}
                    className="block rounded-card border border-white/10 bg-bgPrimary p-4 hover:bg-surfaceGlass"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-[13px] font-black text-textPrimary">{b.service?.name ?? 'Service'}</div>
                          <StatusPill status={b.status} />
                        </div>

                        <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                          {b.service?.category?.name ? `${b.service.category.name} • ` : ''}
                          Pro: <span className="font-black text-textPrimary">{proName}</span>
                          {String(b?.professionalId || '') === proId ? (
                            <span className="ml-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textSecondary">
                              Me
                            </span>
                          ) : null}
                        </div>

                        {b.aftercareSummary?.notes ? (
                          <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                            <span className="font-black text-textPrimary">Aftercare:</span>{' '}
                            {String(b.aftercareSummary.notes).slice(0, 120)}
                            {String(b.aftercareSummary.notes).length > 120 ? '…' : ''}
                          </div>
                        ) : null}
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-[12px] font-semibold text-textSecondary">{when}</div>
                        <div className="mt-1 text-[12px] font-black text-textPrimary">
                          {dur ? `${dur} min` : '—'} • ${total}
                        </div>
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </SectionCard>

        {/* PRODUCTS */}
        <SectionCard id="products" title="Products recommended" subtitle="Recommendations tied to aftercare entries.">
          {productRecs.length === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
              No product recommendations recorded yet.
            </div>
          ) : (
            <div className="grid gap-3">
              {productRecs
                .sort((a: any, b: any) => +new Date(b.aftercareSummary.booking.scheduledFor) - +new Date(a.aftercareSummary.booking.scheduledFor))
                .map((r: any) => (
                  <div key={r.id} className="rounded-card border border-white/10 bg-bgPrimary p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black text-textPrimary">{r.product?.name ?? 'Product'}</div>
                        {r.product?.brand ? <div className="mt-1 text-[12px] font-semibold text-textSecondary">{r.product.brand}</div> : null}
                        {r.note ? <div className="mt-2 text-[12px] font-semibold text-textSecondary">{r.note}</div> : null}
                      </div>
                      <div className="shrink-0 text-[12px] font-semibold text-textSecondary">
                        {formatDate(r.aftercareSummary.booking.scheduledFor)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </SectionCard>

        {/* REVIEWS THEY LEFT */}
        <SectionCard id="reviews-left" title="Reviews they left" subtitle="All reviews this client has left (across any professional).">
          {clientLeftReviews.length === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
              This client hasn&apos;t left any reviews yet.
            </div>
          ) : (
            <div className="grid gap-3">
              {clientLeftReviews.map((rev: any) => {
                const proName = rev?.professional?.businessName || rev?.professional?.user?.email || 'Professional'
                return (
                  <div key={rev.id} className="rounded-card border border-white/10 bg-bgPrimary p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black text-textPrimary">{rev.headline || 'Review'}</div>
                        <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                          Rating: <span className="font-black text-textPrimary">{rev.rating}</span>/5 • For{' '}
                          <span className="font-black text-textPrimary">{proName}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] font-semibold text-textSecondary">{formatDate(rev.createdAt)}</div>
                    </div>

                    {rev.body ? <div className="mt-2 text-[13px] font-semibold text-textSecondary">{rev.body}</div> : null}
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>

        {/* PRO FEEDBACK ABOUT CLIENT */}
        <SectionCard id="pro-feedback" title="Pro feedback" subtitle="Notes from professionals who serviced this client in the past (shared with pros).">
          {proFeedback.length === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
              No pro feedback recorded yet.
            </div>
          ) : (
            <div className="grid gap-3">
              {proFeedback.map((n: any) => {
                const proName = n?.professional?.businessName || n?.professional?.user?.email || 'Professional'
                return (
                  <div key={n.id} className="rounded-card border border-white/10 bg-bgPrimary p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black text-textPrimary">{n.title || 'Feedback'}</div>
                        <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                          By <span className="font-black text-textPrimary">{proName}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] font-semibold text-textSecondary">{formatDate(n.createdAt)}</div>
                    </div>

                    <div className="mt-2 whitespace-pre-wrap text-[13px] font-semibold text-textSecondary">{n.body}</div>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </main>
  )
}
