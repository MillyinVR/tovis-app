// app/client/components/_helpers.tsx

export type BookingStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | (string & {})

export type BookingSource =
  | 'REQUESTED'
  | 'DISCOVERY'
  | 'AFTERCARE'
  | (string & {})

export type ConsultationApprovalLike = {
  status?: string | null
} | null

export type BookingLike = {
  id: string
  status?: BookingStatus | null
  source?: BookingSource | null

  // ✅ new: session + consult approval visibility
  sessionStep?: string | null
  consultationApproval?: ConsultationApprovalLike

  // ✅ Policy A/B: badge support for “NEW aftercare”
  hasUnreadAftercare?: boolean

  // ✅ new: computed on API response for easy UI use
  hasPendingConsultationApproval?: boolean

  scheduledFor?: string | Date | null
  durationMinutesSnapshot?: number | null
  priceSnapshot?: unknown

  service?: { id?: string; name?: string | null } | null
  professional?: {
    id?: string
    businessName?: string | null
    location?: string | null
    city?: string | null
    state?: string | null
  } | null
}

export type WaitlistLike = {
  id: string
  createdAt?: string | Date | null
  notes?: string | null
  availability?: unknown
  service?: { id?: string; name?: string | null } | null
  professional?: {
    id?: string
    businessName?: string | null
    location?: string | null
    city?: string | null
    state?: string | null
  } | null
}

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export function prettyWhen(v: unknown) {
  const d = toDate(v)
  if (!d) return 'Unknown time'
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function locationLabel(p: BookingLike['professional'] | WaitlistLike['professional']) {
  if (!p) return ''
  const parts = [p.location, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean)
  return parts.join(' · ')
}

export function statusUpper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export function sourceUpper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 900,
        background: bg,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}
