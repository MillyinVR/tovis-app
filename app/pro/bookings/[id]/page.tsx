// app/pro/bookings/[id]/page.tsx
import React from 'react'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ConsultationForm from './ConsultationForm'
import { moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

type StepKey = 'consult' | 'session' | 'aftercare'
type SearchParams = Record<string, string | string[] | undefined>

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

function normalizeStep(raw: unknown): StepKey {
  const s = String(raw || '').toLowerCase().trim()
  if (s === 'consult' || s === 'consultation') return 'consult'
  if (s === 'session') return 'session'
  if (s === 'aftercare') return 'aftercare'
  return 'consult'
}

function toDate(value: Date | string) {
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatStatus(status: string) {
  switch (status) {
    case 'PENDING':
      return 'Pending'
    case 'ACCEPTED':
      return 'Accepted'
    case 'COMPLETED':
      return 'Completed'
    case 'CANCELLED':
      return 'Cancelled'
    default:
      return status
  }
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid #ddd',
    textDecoration: 'none',
    color: active ? '#fff' : '#111',
    background: active ? '#111' : '#fafafa',
    fontSize: 12,
    fontWeight: 900,
  }
}

function moneyNumber(maybeMoneyString: string | null) {
  if (!maybeMoneyString) return 0
  const n = Number(String(maybeMoneyString).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export default async function BookingDetailPage(props: {
  params: Promise<{ id: string }>
  searchParams?: Promise<SearchParams>
}) {
  const { id } = await props.params

  const sp =
    (await props.searchParams?.catch(() => ({} as SearchParams))) ?? ({} as SearchParams)

  const step = normalizeStep(firstParam(sp.step))

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect(`/login?from=/pro/bookings/${encodeURIComponent(id)}`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      professionalId: true,
      status: true,
      scheduledFor: true,
      startedAt: true,
      finishedAt: true,
      durationMinutesSnapshot: true,
      priceSnapshot: true,
      discountAmount: true,
      totalAmount: true,
      consultationNotes: true,
      consultationPrice: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          user: { select: { email: true } },
        },
      },
      service: { select: { name: true } },
    },
  })


  if (!booking) notFound()
  if (booking.professionalId !== user.professionalProfile.id) redirect('/pro')

  const scheduled = toDate(booking.scheduledFor)
  if (!scheduled) notFound()

  const now = new Date()
  const isToday = scheduled.toDateString() === now.toDateString()

  const startedAt = booking.startedAt ? toDate(booking.startedAt) : null
  const finishedAt = booking.finishedAt ? toDate(booking.finishedAt) : null

  const baseStr = moneyToString(booking.priceSnapshot) ?? '0.00'
  const discountStr =
    booking.discountAmount != null ? moneyToString(booking.discountAmount) ?? '0.00' : null
  const totalStr =
    booking.totalAmount != null ? moneyToString(booking.totalAmount) ?? baseStr : baseStr

  const hasDiscount = booking.discountAmount != null && moneyNumber(discountStr) > 0

  const duration =
    typeof booking.durationMinutesSnapshot === 'number' && Number.isFinite(booking.durationMinutesSnapshot)
      ? Math.round(booking.durationMinutesSnapshot)
      : null

  const baseHref = `/pro/bookings/${encodeURIComponent(booking.id)}`

  return (
    <main style={{ maxWidth: 960, margin: '24px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <a
          href="/pro/bookings"
          style={{ fontSize: 12, color: '#555', textDecoration: 'none', display: 'inline-block' }}
        >
          ← Back to bookings
        </a>

        <a
          href="/pro/bookings/new"
          style={{
            display: 'inline-block',
            padding: '8px 12px',
            borderRadius: 999,
            border: '1px solid #111',
            textDecoration: 'none',
            color: '#111',
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          + New booking
        </a>
      </div>

      <section
        style={{
          marginTop: 12,
          borderRadius: 12,
          border: '1px solid #eee',
          padding: 16,
          marginBottom: 16,
          background: '#fff',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#777', marginBottom: 4 }}>
            {isToday ? 'Today' : 'Appointment'}
          </div>

          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
            {booking.service?.name ?? 'Appointment'}
          </h1>

          <div style={{ fontSize: 13, color: '#555', marginTop: 6 }}>
            {formatDateTime(scheduled)}
            {duration != null ? ` • ${duration} min` : ''}
          </div>

          <div style={{ fontSize: 13, color: '#555', marginTop: 6 }}>
            {booking.client?.firstName ?? ''} {booking.client?.lastName ?? ''}
            {booking.client?.user?.email ? ` • ${booking.client.user.email}` : ''}
            {booking.client?.phone ? ` • ${booking.client.phone}` : ''}
          </div>
        </div>

        <div style={{ textAlign: 'right', fontSize: 12, minWidth: 220 }}>
          <div
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 999,
              border: '1px solid #ddd',
              marginBottom: 8,
              fontSize: 11,
            }}
          >
            {formatStatus(String(booking.status || ''))}
          </div>

          <div style={{ color: '#6b7280', display: 'grid', gap: 4, justifyItems: 'end' }}>
            {hasDiscount ? (
              <>
                <div>
                  Base: <span style={{ textDecoration: 'line-through' }}>${baseStr}</span>
                </div>
                <div>Last-minute discount: -${discountStr}</div>
                <div style={{ color: '#111', fontWeight: 900 }}>Total: ${totalStr}</div>
              </>
            ) : (
              <div style={{ color: '#777' }}>Total: ${totalStr}</div>
            )}
          </div>

          {startedAt && !finishedAt && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#16a34a' }}>
              Session started {formatTime(startedAt)} (in progress)
            </div>
          )}

          {finishedAt && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
              Session finished {formatTime(finishedAt)}
            </div>
          )}
        </div>
      </section>

      {/* Tabs */}
      <nav style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <a href={`${baseHref}?step=consult`} style={tabStyle(step === 'consult')}>
          Consultation
        </a>
        <a href={`${baseHref}?step=session`} style={tabStyle(step === 'session')}>
          Session
        </a>
        <a href={`${baseHref}?step=aftercare`} style={tabStyle(step === 'aftercare')}>
          Aftercare
        </a>

        <a
          href={`/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`}
          style={{
            marginLeft: 'auto',
            display: 'inline-block',
            textDecoration: 'none',
            border: '1px solid #111',
            borderRadius: 999,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 900,
            color: '#fff',
            background: '#111',
          }}
        >
          Open aftercare
        </a>
      </nav>

      {step === 'consult' ? (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Consultation</h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
            Capture what you agreed on before starting the service: look goals, techniques, and pricing.
          </p>

          <ConsultationForm
            bookingId={booking.id}
            initialNotes={booking.consultationNotes ?? ''}
            initialPrice={moneyToString(booking.consultationPrice) ?? ''}
          />
        </section>
      ) : null}

      {step === 'session' ? (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Session</h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
            Run the appointment flow, capture before/after, and advance the session steps.
          </p>

          <a
            href={`/pro/bookings/${encodeURIComponent(booking.id)}/session`}
            style={{
              display: 'inline-block',
              textDecoration: 'none',
              border: '1px solid #111',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
              color: '#fff',
              background: '#111',
            }}
          >
            Open session flow
          </a>
        </section>
      ) : null}

      {step === 'aftercare' ? (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Aftercare</h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
            Write aftercare, set rebook guidance, and notify the client.
          </p>

          <a
            href={`/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`}
            style={{
              display: 'inline-block',
              textDecoration: 'none',
              border: '1px solid #111',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
              color: '#fff',
              background: '#111',
            }}
          >
            Open aftercare
          </a>
        </section>
      ) : null}
    </main>
  )
}
