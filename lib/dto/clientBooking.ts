// lib/dto/clientBooking.ts
import type { Prisma } from '@prisma/client'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'

export type ClientBookingItemDTO = {
  id: string
  type: 'BASE' | 'ADD_ON'
  serviceId: string
  name: string
  price: string // decimal string
  durationMinutes: number
  parentItemId: string | null
  sortOrder: number
}

export type ClientBookingDTO = {
  id: string
  status: string | null
  source: string | null
  sessionStep: string | null

  scheduledFor: string
  totalDurationMinutes: number
  bufferMinutes: number

  subtotalSnapshot: string | null

  locationType: string | null
  locationId: string | null

  // ✅ appointment timezone as determined by TimeZoneTruth
  timeZone: string | null
  // optional: where it came from (helps debugging / UI)
  timeZoneSource?: 'BOOKING' | 'HOLD' | 'LOCATION' | 'PRO' | 'FALLBACK'

  locationLabel: string | null

  professional: {
    id: string
    businessName: string | null
    location: string | null
    timeZone: string | null
  } | null

  bookedLocation: {
    id: string
    name: string | null
    formattedAddress: string | null
    city: string | null
    state: string | null
    timeZone: string | null
  } | null

  display: {
    title: string
    baseName: string
    addOnNames: string[]
    addOnCount: number
  }

  items: ClientBookingItemDTO[]

  hasUnreadAftercare: boolean
  hasPendingConsultationApproval: boolean

  consultation: any | null
}

function pickFormattedAddress(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const v = (snapshot as any)?.formattedAddress
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function decimalToString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'object' && v && typeof (v as any).toString === 'function') return (v as any).toString()
  return null
}

function buildLocationLabel(args: {
  locationAddressSnapshot: unknown
  location: { formattedAddress: string | null; name: string | null; city: string | null; state: string | null } | null
  proLocation: string | null
}) {
  const snap = pickFormattedAddress(args.locationAddressSnapshot)
  if (snap) return snap

  const formatted = args.location?.formattedAddress?.trim()
  if (formatted) return formatted

  const name = args.location?.name?.trim()
  if (name) return name

  const cityState = [args.location?.city, args.location?.state].filter(Boolean).join(', ').trim()
  if (cityState) return cityState

  const proLoc = args.proLocation?.trim()
  if (proLoc) return proLoc

  return null
}

export async function buildClientBookingDTO(input: {
  booking: Prisma.BookingGetPayload<{
    select: {
      id: true
      status: true
      source: true
      sessionStep: true
      scheduledFor: true
      finishedAt: true

      subtotalSnapshot: true
      totalDurationMinutes: true
      bufferMinutes: true

      locationType: true
      locationId: true
      locationTimeZone: true
      locationAddressSnapshot: true

      service: { select: { id: true; name: true } }

      professional: { select: { id: true; businessName: true; location: true; timeZone: true } }

      location: {
        select: {
          id: true
          name: true
          formattedAddress: true
          city: true
          state: true
          timeZone: true
        }
      }

      consultationNotes: true
      consultationPrice: true
      consultationConfirmedAt: true
      consultationApproval: {
        select: {
          status: true
          proposedServicesJson: true
          proposedTotal: true
          notes: true
          approvedAt: true
          rejectedAt: true
        }
      }

      serviceItems: {
        select: {
          id: true
          itemType: true
          parentItemId: true
          sortOrder: true
          durationMinutesSnapshot: true
          priceSnapshot: true
          serviceId: true
          service: { select: { name: true } }
        }
        orderBy: { sortOrder: 'asc' }
      }
    }
  }>
  unreadAftercare: boolean
  hasPendingConsultationApproval: boolean
}): Promise<ClientBookingDTO> {
  const { booking: b } = input

  const items: ClientBookingItemDTO[] = (b.serviceItems ?? []).map((it) => ({
    id: String(it.id),
    type: String(it.itemType || 'BASE').toUpperCase() === 'ADD_ON' ? 'ADD_ON' : 'BASE',
    serviceId: String(it.serviceId),
    name: it.service?.name ?? 'Service',
    price: decimalToString(it.priceSnapshot) ?? '0.00',
    durationMinutes: Number(it.durationMinutesSnapshot ?? 0),
    parentItemId: it.parentItemId ? String(it.parentItemId) : null,
    sortOrder: Number(it.sortOrder ?? 0),
  }))

  const baseItem = items.find((x) => x.type === 'BASE') ?? items[0] ?? null
  const baseName = baseItem?.name ?? (b.service?.name ?? 'Appointment')
  const addOnNames = items.filter((x) => x.type === 'ADD_ON').map((x) => x.name)
  const title = [baseName, ...addOnNames].join(' + ')

  const locationLabel = buildLocationLabel({
    locationAddressSnapshot: b.locationAddressSnapshot,
    location: b.location
      ? {
          formattedAddress: b.location.formattedAddress ?? null,
          name: b.location.name ?? null,
          city: b.location.city ?? null,
          state: b.location.state ?? null,
        }
      : null,
    proLocation: b.professional?.location ?? null,
  })

  // ✅ SINGLE SOURCE OF TRUTH for appointment timezone
  // Policy: never default to America/Los_Angeles. UTC is the only safe fallback.
  const tzRes = await resolveApptTimeZone({
    bookingLocationTimeZone: b.locationTimeZone ?? null,
    location: b.location ? { id: b.location.id, timeZone: b.location.timeZone } : null,
    locationId: b.locationId ?? null,
    professionalId: b.professional?.id ?? null,
    professionalTimeZone: b.professional?.timeZone ?? null,
    fallback: DEFAULT_TIME_ZONE,
    requireValid: false, // client view should still render even if tz missing
  })

  // If ok, it is already valid IANA. Still sanitize defensively to DEFAULT_TIME_ZONE.
  const timeZone = tzRes.ok ? sanitizeTimeZone(tzRes.timeZone, DEFAULT_TIME_ZONE) : DEFAULT_TIME_ZONE
  const timeZoneSource = tzRes.ok ? tzRes.source : 'FALLBACK'

  const consultBlobNeeded = Boolean(b.consultationApproval) || Boolean(b.consultationNotes) || b.consultationPrice != null

  const consultation = consultBlobNeeded
    ? {
        consultationNotes: b.consultationNotes ?? null,
        consultationPrice: decimalToString(b.consultationPrice),
        consultationConfirmedAt: b.consultationConfirmedAt ? b.consultationConfirmedAt.toISOString() : null,

        approvalStatus: b.consultationApproval?.status ?? null,
        approvalNotes: b.consultationApproval?.notes ?? null,
        proposedTotal: decimalToString(b.consultationApproval?.proposedTotal),
        proposedServicesJson: b.consultationApproval?.proposedServicesJson ?? null,
        approvedAt: b.consultationApproval?.approvedAt ? b.consultationApproval.approvedAt.toISOString() : null,
        rejectedAt: b.consultationApproval?.rejectedAt ? b.consultationApproval.rejectedAt.toISOString() : null,
      }
    : null

  return {
    id: String(b.id),
    status: (b.status as any) ?? null,
    source: (b.source as any) ?? null,
    sessionStep: (b.sessionStep as any) ?? null,

    scheduledFor: b.scheduledFor.toISOString(),
    totalDurationMinutes: Number(b.totalDurationMinutes ?? 0),
    bufferMinutes: Number(b.bufferMinutes ?? 0),

    subtotalSnapshot: decimalToString(b.subtotalSnapshot),

    locationType: (b.locationType as any) ?? null,
    locationId: String(b.locationId ?? '') || null,

    timeZone,
    timeZoneSource,

    locationLabel,

    professional: b.professional
      ? {
          id: String(b.professional.id),
          businessName: b.professional.businessName ?? null,
          location: b.professional.location ?? null,
          timeZone: b.professional.timeZone ?? null,
        }
      : null,

    bookedLocation: b.location
      ? {
          id: String(b.location.id),
          name: b.location.name ?? null,
          formattedAddress: b.location.formattedAddress ?? null,
          city: b.location.city ?? null,
          state: b.location.state ?? null,
          timeZone: b.location.timeZone ?? null,
        }
      : null,

    display: { title, baseName, addOnNames, addOnCount: addOnNames.length },

    items,

    hasUnreadAftercare: Boolean(input.unreadAftercare),
    hasPendingConsultationApproval: Boolean(input.hasPendingConsultationApproval),

    consultation,
  }
}
