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
  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid #eee',
        background: '#fff',
        borderRadius: 12,
        padding: 14,
      }}
    >
      {children}
    </div>
  )
}

function Badge({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 900,
        padding: '3px 10px',
        borderRadius: 999,
        border: '1px solid #e5e7eb',
        background: '#f9fafb',
        color: '#111827',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
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
    const notes = typeof notesRaw === 'string' ? notesRaw.trim() : ''

    // ✅ Save onto AftercareSummary.serviceNotes (already exists in your schema)
    await prisma.aftercareSummary.upsert({
      where: { bookingId },
      create: { bookingId, serviceNotes: notes || null },
      update: { serviceNotes: notes || null },
      select: { id: true },
    })

    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session/service?saved=1`)
  }

  return (
    <main style={{ maxWidth: 960, margin: '24px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a
        href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
        style={{ fontSize: 12, color: '#555', textDecoration: 'none' }}
      >
        ← Back to session
      </a>

      <h1 style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }}>Service: {serviceName}</h1>
      <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>Client: {clientName}</div>

      <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge label={`Scheduled: ${scheduledFor || '—'}`} />
        <Badge label={`Step: ${step || 'UNKNOWN'}`} />
        <Badge label={`Status: ${st || 'UNKNOWN'}`} />
      </div>

      <Card>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>During-service hub</div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          Leave this open during the appointment. Save notes anytime. These feed straight into aftercare.
        </div>
      </Card>

      <section style={{ marginTop: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 900 }}>Live service notes</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          Formulas, adjustments, client requests, anything you’ll want remembered.
        </div>

        <form action={saveNotes} style={{ marginTop: 10 }}>
          <textarea
            name="notes"
            defaultValue={existingNotes}
            placeholder="Type notes during the service..."
            style={{
              width: '100%',
              minHeight: 180,
              borderRadius: 12,
              border: '1px solid #e5e7eb',
              padding: 12,
              fontSize: 13,
              fontFamily: 'system-ui',
              outline: 'none',
            }}
          />

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              type="submit"
              style={{
                border: '1px solid #111',
                background: '#111',
                color: '#fff',
                borderRadius: 999,
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Save notes
            </button>

            <a
              href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
              style={{
                display: 'inline-block',
                textDecoration: 'none',
                border: '1px solid #e5e7eb',
                borderRadius: 999,
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 900,
                color: '#111',
                background: '#fff',
              }}
            >
              Back to session
            </a>
          </div>
        </form>
      </section>
    </main>
  )
}
