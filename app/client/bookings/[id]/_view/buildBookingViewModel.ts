// app/client/bookings/[id]/_view/buildBookingViewModel.ts
import { COPY } from '@/lib/copy'
import { buildClientBookingDTO } from '@/lib/dto/clientBooking'
import { sanitizeTimeZone } from '@/lib/timeZone'

import { loadClientBookingPage } from '../_data/loadClientBookingPage'

export type StepKey = 'overview' | 'consult' | 'aftercare'

type LoadedClientBookingPage = Awaited<ReturnType<typeof loadClientBookingPage>>
type ClientBookingDTO = Awaited<ReturnType<typeof buildClientBookingDTO>>
type LoadedRawBooking = LoadedClientBookingPage['raw']
type LoadedAftercare = LoadedClientBookingPage['aftercare']
type ClientBookingItem = ClientBookingDTO['items'][number]

type TimelineItem = {
  key: 'requested' | 'confirmed' | 'consult' | 'completed'
  label: string
  on: boolean
}

const PENDING_CONSULTATION_STATUSES = new Set([
  'PENDING',
  'PENDING_CLIENT',
  'PENDING_CLIENT_APPROVAL',
  'AWAITING_CLIENT',
  'WAITING_CLIENT',
  'SENT',
])

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatMoney(value: unknown): string | null {
  if (value == null) return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `$${value.toFixed(2)}`
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return `$${parsed.toFixed(2)}`
    return trimmed.startsWith('$') ? trimmed : `$${trimmed}`
  }

  if (typeof value === 'object' && value !== null) {
    const asString = value.toString()
    return typeof asString === 'string' ? formatMoney(asString) : null
  }

  return null
}

function formatWhen(date: Date, timeZone: string): string {
  const safeTimeZone = sanitizeTimeZone(timeZone, 'UTC')
  return new Intl.DateTimeFormat(undefined, {
    timeZone: safeTimeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function sumPricedItems(items: ClientBookingItem[]): {
  subtotal: number
  hasAnyPrice: boolean
} {
  let subtotal = 0
  let hasAnyPrice = false

  for (const item of items) {
    const numericPrice = Number(item.price)
    if (Number.isFinite(numericPrice)) {
      subtotal += numericPrice
      hasAnyPrice = true
    }
  }

  return { subtotal, hasAnyPrice }
}

export function computePendingConsultation(raw: {
  status: LoadedRawBooking['status']
  sessionStep: LoadedRawBooking['sessionStep']
  finishedAt: LoadedRawBooking['finishedAt']
  consultationApproval: LoadedRawBooking['consultationApproval']
}): boolean {
  const status = upper(raw.status)
  if (status === 'CANCELLED' || status === 'COMPLETED') return false
  if (raw.finishedAt) return false

  const sessionStep = upper(raw.sessionStep)
  if (sessionStep === 'CONSULTATION_PENDING_CLIENT') return true

  const approvalStatus = upper(raw.consultationApproval?.status)
  return PENDING_CONSULTATION_STATUSES.has(approvalStatus)
}

function buildTimeline(raw: LoadedRawBooking, statusUpper: string): TimelineItem[] {
  return [
    {
      key: 'requested',
      label: 'Requested',
      on:
        statusUpper === 'PENDING' ||
        statusUpper === 'ACCEPTED' ||
        statusUpper === 'COMPLETED',
    },
    {
      key: 'confirmed',
      label: 'Confirmed',
      on: statusUpper === 'ACCEPTED' || statusUpper === 'COMPLETED',
    },
    {
      key: 'consult',
      label: 'Consultation confirmed',
      on: Boolean(raw.consultationConfirmedAt) || statusUpper === 'COMPLETED',
    },
    {
      key: 'completed',
      label: 'Completed',
      on: statusUpper === 'COMPLETED',
    },
  ]
}

export function buildBookingViewModel(input: {
  step: StepKey
  booking: ClientBookingDTO
  raw: LoadedRawBooking
  aftercare: LoadedAftercare
}) {
  const statusUpper = upper(input.booking.status)
  const sessionStepUpper = upper(input.booking.sessionStep)

  const appointmentTz = sanitizeTimeZone(input.booking.timeZone, 'UTC')
  const scheduled = toDate(input.booking.scheduledFor)
  const whenLabel = scheduled
    ? formatWhen(scheduled, appointmentTz)
    : COPY.common.unknownTime

  const rawPendingConsultation = computePendingConsultation(input.raw)
  const dtoPendingConsultation = Boolean(
    input.booking.hasPendingConsultationApproval,
  )
  const pendingConsultation =
    dtoPendingConsultation || rawPendingConsultation

  const showConsultationApproval =
    pendingConsultation &&
    statusUpper !== 'CANCELLED' &&
    statusUpper !== 'COMPLETED'

  const canShowConsultTab =
    statusUpper !== 'CANCELLED' &&
    statusUpper !== 'COMPLETED' &&
    statusUpper !== 'PENDING' &&
    (sessionStepUpper === 'CONSULTATION_PENDING_CLIENT' ||
      showConsultationApproval)

  const canShowAftercareTab =
    statusUpper === 'COMPLETED' || Boolean(input.aftercare?.id)

  const { subtotal, hasAnyPrice } = sumPricedItems(input.booking.items)
  const breakdownTotalLabel = hasAnyPrice
    ? `$${subtotal.toFixed(2)}`
    : formatMoney(input.booking.subtotalSnapshot)

  const timeline = buildTimeline(input.raw, statusUpper)

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