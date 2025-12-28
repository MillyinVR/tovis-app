// app/client/bookings/[id]/consultation/page.tsx
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCurrentUser } from '@/lib/currentUser'
import ClientApprovalButtons from './ClientApprovalButtons'

export const dynamic = 'force-dynamic'

type ApiResponse =
  | { ok: true; booking: any; approval: any }
  | { error: string }

function money(v: any) {
  if (v == null) return null
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? Number(v)
        : Number(String(v))
  if (!Number.isFinite(n)) return String(v)
  return `$${n.toFixed(2)}`
}

function prettyJson(v: any) {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function normalizeServices(
  servicesJson: any,
): Array<{ name?: string; price?: any; qty?: any; duration?: any }> {
  // Accept array or object and do something reasonable.
  if (Array.isArray(servicesJson)) return servicesJson
  if (servicesJson && typeof servicesJson === 'object') {
    if (Array.isArray((servicesJson as any).services)) return (servicesJson as any).services
  }
  return []
}

async function getOriginFromHeaders(): Promise<string> {
  // Next.js 16: headers() is async here
  const h = await headers()

  // Prefer proxy headers when deployed
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host')

  if (!host) return ''
  return `${proto}://${host}`
}

export default async function ClientConsultationApprovalPage(props: {
  params: Promise<{ id: string }>
}) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(`/client/bookings/${bookingId}/consultation`)}`)
  }

  const origin = await getOriginFromHeaders()
  const url = origin
    ? `${origin}/api/client/bookings/${encodeURIComponent(bookingId)}/consultation`
    : `/api/client/bookings/${encodeURIComponent(bookingId)}/consultation`

  const res = await fetch(url, { cache: 'no-store' }).catch(() => null)

  if (!res) {
    return (
      <main style={{ maxWidth: 720, margin: '80px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>Approve consultation</h1>
        <div style={{ color: '#b91c1c', fontSize: 13 }}>
          Couldn’t reach the server. Try again in a moment.
        </div>
      </main>
    )
  }

  const data = (await res.json().catch(() => ({}))) as ApiResponse

  if (!res.ok) {
    const msg = (data as any)?.error || `Failed to load consultation (${res.status}).`
    return (
      <main style={{ maxWidth: 720, margin: '80px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
        <a
          href={`/client/bookings/${encodeURIComponent(bookingId)}`}
          style={{
            textDecoration: 'none',
            border: '1px solid #e5e7eb',
            background: '#fff',
            color: '#111',
            borderRadius: 999,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 900,
            display: 'inline-block',
            marginBottom: 14,
          }}
        >
          ← Back to booking
        </a>

        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>Approve consultation</h1>

        <section style={{ border: '1px solid #fee2e2', background: '#fff1f2', padding: 14, borderRadius: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Can’t load proposal</div>
          <div style={{ color: '#7f1d1d', fontSize: 13 }}>{msg}</div>
        </section>
      </main>
    )
  }

  const okData = data as any
  const booking = okData.booking
  const approval = okData.approval

  const approvalStatus = String(approval?.status || 'UNKNOWN').toUpperCase()
  const proposedTotal = approval?.proposedTotal ?? null
  const proposedNotes = approval?.notes ?? ''
  const servicesJson = approval?.proposedServicesJson

  const services = normalizeServices(servicesJson)

  return (
    <main style={{ maxWidth: 720, margin: '60px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a
        href={`/client/bookings/${encodeURIComponent(bookingId)}`}
        style={{
          textDecoration: 'none',
          border: '1px solid #e5e7eb',
          background: '#fff',
          color: '#111',
          borderRadius: 999,
          padding: '8px 12px',
          fontSize: 12,
          fontWeight: 900,
          display: 'inline-block',
          marginBottom: 14,
        }}
      >
        ← Back to booking
      </a>

      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Approve consultation</h1>
      <div style={{ marginTop: 6, color: '#6b7280', fontSize: 13 }}>
        Review what your pro confirmed. Approving unlocks the session and before photos.
      </div>

      <section
        style={{
          marginTop: 16,
          border: '1px solid #eee',
          borderRadius: 14,
          padding: 14,
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#111' }}>Proposal</div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 900,
              padding: '3px 10px',
              borderRadius: 999,
              border: '1px solid #e5e7eb',
              background:
                approvalStatus === 'PENDING'
                  ? '#fffbeb'
                  : approvalStatus === 'APPROVED'
                    ? '#ecfdf5'
                    : approvalStatus === 'REJECTED'
                      ? '#fff1f2'
                      : '#f3f4f6',
              color:
                approvalStatus === 'PENDING'
                  ? '#854d0e'
                  : approvalStatus === 'APPROVED'
                    ? '#065f46'
                    : approvalStatus === 'REJECTED'
                      ? '#9f1239'
                      : '#111827',
            }}
          >
            {approvalStatus}
          </div>
        </div>

        {services.length > 0 ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {services.map((s, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid #f3f4f6',
                  background: '#fafafa',
                  borderRadius: 12,
                  padding: 10,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 13, color: '#111' }}>
                    {s?.name ?? `Service ${i + 1}`}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {s?.duration ? `${s.duration} min` : null}
                    {s?.qty ? ` · qty ${s.qty}` : null}
                  </div>
                </div>
                <div style={{ fontWeight: 900, fontSize: 13, color: '#111' }}>
                  {s?.price != null ? money(s.price) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
            No service list provided (yet). We’ll still show total and notes.
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Total</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#111' }}>
            {proposedTotal != null ? money(proposedTotal) : '—'}
          </div>
        </div>

        {proposedNotes ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: '#111', marginBottom: 6 }}>Notes</div>
            <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' }}>{proposedNotes}</div>
          </div>
        ) : null}

        {/* Actions */}
        {approvalStatus === 'PENDING' ? (
          <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <ClientApprovalButtons bookingId={bookingId} />
          </div>
        ) : approvalStatus === 'APPROVED' ? (
          <div style={{ marginTop: 14, fontSize: 13, color: '#065f46', fontWeight: 900 }}>
            Approved. Your pro can proceed to before photos.
          </div>
        ) : approvalStatus === 'REJECTED' ? (
          <div style={{ marginTop: 14, fontSize: 13, color: '#9f1239', fontWeight: 900 }}>
            Rejected. Your pro will need to resend the consultation.
          </div>
        ) : (
          <div style={{ marginTop: 14, fontSize: 13, color: '#6b7280' }}>
            Unknown status. If this keeps happening, it’s a bug. Shocking, I know.
          </div>
        )}

        {/* Debug section (optional). Remove later. */}
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>Debug details</summary>
          <pre style={{ fontSize: 11, background: '#0b1020', color: '#e5e7eb', padding: 12, borderRadius: 12, overflow: 'auto' }}>
            {prettyJson({ booking, approval })}
          </pre>
        </details>
      </section>

      <style>{`
        button:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>
    </main>
  )
}
