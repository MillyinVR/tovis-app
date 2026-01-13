// app/pro/bookings/[id]/session/service/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function fullName(first?: string | null, last?: string | null) {
  return `${first ?? ''} ${last ?? ''}`.trim()
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function fmtDateTime(v: any) {
  try {
    const d = v instanceof Date ? v : new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary">{children}</div>
}

function Badge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
      {label}
    </span>
  )
}

export default async function ProServicePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
  if (!proId) redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session/service`)

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
      status: true,
      scheduledFor: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,

      service: { select: { name: true } },
      client: { select: { firstName: true, lastName: true } },
      aftercareSummary: { select: { serviceNotes: true } },
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== proId) redirect('/pro')

  const st = upper(booking.status)
  if (st === 'CANCELLED' || st === 'COMPLETED' || booking.finishedAt) {
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }
  if (!booking.startedAt) {
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  const serviceName = booking.service?.name ?? 'Service'
  const clientName = fullName(booking.client?.firstName, booking.client?.lastName) || 'Client'
  const scheduledFor = fmtDateTime(booking.scheduledFor)
  const step = upper(booking.sessionStep)

  const existingNotes = String(booking.aftercareSummary?.serviceNotes ?? '').trim()

  async function saveNotes(formData: FormData) {
    'use server'

    const u = await getCurrentUser().catch(() => null)
    const uProId = u?.role === 'PRO' ? u.professionalProfile?.id : null
    if (!uProId) redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session/service`)

    const fresh = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true, status: true, startedAt: true, finishedAt: true },
    })
    if (!fresh) notFound()
    if (fresh.professionalId !== uProId) redirect('/pro')

    const freshStatus = upper(fresh.status)
    if (freshStatus === 'CANCELLED' || freshStatus === 'COMPLETED' || fresh.finishedAt || !fresh.startedAt) {
      redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    }

    const notesRaw = formData.get('notes')
    const notes = typeof notesRaw === 'string' ? notesRaw.trim().slice(0, 4000) : ''

    await prisma.aftercareSummary.upsert({
      where: { bookingId },
      create: { bookingId, serviceNotes: notes || null },
      update: { serviceNotes: notes || null },
      select: { id: true },
    })

    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session/service?saved=1`)
  }

  const btnPrimary =
    'inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover'
  const btnSecondary =
    'inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass'

  return (
    <main className="mx-auto mt-20 w-full max-w-3xl px-4 pb-10 text-textPrimary">
      <a href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`} className={btnSecondary}>
        ← Back to session
      </a>

      <h1 className="mt-4 text-xl font-black">Service: {serviceName}</h1>
      <div className="mt-1 text-sm font-semibold text-textSecondary">Client: {clientName}</div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge label={`Scheduled: ${scheduledFor || '—'}`} />
        <Badge label={`Step: ${step || 'UNKNOWN'}`} />
        <Badge label={`Status: ${st || 'UNKNOWN'}`} />
      </div>

      <Card>
        <div className="text-sm font-black">During-service hub</div>
        <div className="mt-1 text-sm font-semibold text-textSecondary">
          Leave this open during the appointment. Save notes anytime. These feed straight into aftercare.
        </div>
      </Card>

      <section className="mt-6">
        <div className="text-lg font-black">Live service notes</div>
        <div className="mt-1 text-sm font-semibold text-textSecondary">
          Formulas, adjustments, client requests, anything you’ll want remembered.
        </div>

        <form action={saveNotes} className="mt-4">
          <textarea
            name="notes"
            defaultValue={existingNotes}
            placeholder="Type notes during the service..."
            className="w-full min-h-[180px] rounded-card border border-white/10 bg-bgPrimary p-3 text-sm text-textPrimary outline-none focus:border-white/20"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary}>
              Save notes
            </button>

            <a href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`} className={btnSecondary}>
              Back to session
            </a>
          </div>
        </form>
      </section>
    </main>
  )
}
