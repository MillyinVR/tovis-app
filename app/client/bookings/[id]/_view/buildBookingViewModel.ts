// app/client/bookings/[id]/_view/buildBookingViewModel.ts
import { sanitizeTimeZone } from '@/lib/timeZone'
import { COPY } from '@/lib/copy'

export type StepKey = 'overview' | 'consult' | 'aftercare'

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function formatMoney(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    const n = Number(s)
    if (Number.isFinite(n)) return `$${n.toFixed(2)}`
    return s.startsWith('$') ? s : `$${s}`
  }
  if (typeof v === 'number' && Number.isFinite(v)) return `$${v.toFixed(2)}`
  return null
}

function formatWhen(d: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function computePendingConsultation(raw: {
  status: unknown
  sessionStep: unknown
  finishedAt: Date | null
  consultationApproval?: { status: unknown } | null
}) {
  const status = upper(raw.status)
  if (status === 'CANCELLED' || status === 'COMPLETED') return false
  if (raw.finishedAt) return false

  const step = upper(raw.sessionStep)
  if (step === 'CONSULTATION_PENDING_CLIENT') return true

  const approval = upper(raw.consultationApproval?.status)
  const PENDING_SET = new Set(['PENDING', 'PENDING_CLIENT', 'PENDING_CLIENT_APPROVAL', 'AWAITING_CLIENT', 'WAITING_CLIENT', 'SENT'])
  return PENDING_SET.has(approval)
}

export function buildBookingViewModel(input: {
  step: StepKey
  booking: any // ClientBookingDTO-ish
  raw: any
  aftercare: any | null
}) {
  const statusUpper = upper(input.booking?.status)
  const sessionStepUpper = upper(input.booking?.sessionStep)

  const appointmentTz = sanitizeTimeZone(input.booking?.timeZone, 'UTC')
  const scheduled = toDate(input.booking?.scheduledFor)
  const whenLabel = scheduled ? formatWhen(scheduled, appointmentTz) : COPY.common.unknownTime

  // Prefer DTO truth, but fall back to raw if needed
  const rawPending = computePendingConsultation(input.raw)
  const dtoPending = Boolean(input.booking?.hasPendingConsultationApproval)
  const pendingConsult = dtoPending || rawPending

  const showConsultationApproval =
    pendingConsult &&
    statusUpper !== 'CANCELLED' &&
    statusUpper !== 'COMPLETED'

  const canShowConsultTab =
    statusUpper !== 'CANCELLED' &&
    statusUpper !== 'COMPLETED' &&
    statusUpper !== 'PENDING' &&
    (sessionStepUpper === 'CONSULTATION_PENDING_CLIENT' || showConsultationApproval)

  const canShowAftercareTab = statusUpper === 'COMPLETED' || Boolean(input.aftercare?.id)

  const timeline = [
    { key: 'requested', label: 'Requested', on: statusUpper === 'PENDING' || statusUpper === 'ACCEPTED' || statusUpper === 'COMPLETED' },
    { key: 'confirmed', label: 'Confirmed', on: statusUpper === 'ACCEPTED' || statusUpper === 'COMPLETED' },
    { key: 'consult', label: 'Consultation confirmed', on: Boolean(input.raw?.consultationConfirmedAt) || statusUpper === 'COMPLETED' },
    { key: 'completed', label: 'Completed', on: statusUpper === 'COMPLETED' },
  ] as const

  const itemsSubtotal = (input.booking?.items || []).reduce((sum: number, it: any) => sum + (Number(it.price) || 0), 0)
  const hasItemPrices = (input.booking?.items || []).some((it: any) => Number.isFinite(Number(it.price)))
  const breakdownTotalLabel = hasItemPrices ? `$${itemsSubtotal.toFixed(2)}` : formatMoney(input.booking?.subtotalSnapshot)

  return {
    appointmentTz,
    whenLabel,
    breakdownTotalLabel,
    showConsultationApproval,
    canShowConsultTab,
    canShowAftercareTab,
    timeline,
  }
}