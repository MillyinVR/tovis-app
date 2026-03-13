// app/pro/calendar/_hooks/useBookingModal.ts
'use client'

import { useMemo, useState } from 'react'
import type {
  BookingDetails,
  BookingServiceItem,
  CalendarEvent,
  ServiceOption,
  WorkingHoursJson,
} from '../_types'
import {
  roundDurationMinutes,
  isOutsideWorkingHours,
} from '../_utils/calendarMath'
import {
  apiMessage,
  locationTypeFromBookingValue,
  parseBookingDetails,
  parseServiceOptions,
  type LocationType,
} from '../_utils/parsers'
import {
  serviceItemsTotalDuration,
  serviceItemsLabel,
  buildDraftItemFromServiceOption,
  normalizeDraftServiceItems,
  sameServiceItems,
} from '../_utils/serviceItems'
import { anchorDayLocalNoon } from '../_utils/calendarRange'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import {
  utcIsoToDateInputValue,
  utcIsoToTimeInputValue,
  dateTimeLocalToUtcIso,
  combineDateAndTimeInput,
} from '@/lib/bookingDateTimeClient'
import { isRecord } from '@/lib/guards'
import { safeJson, errorMessageFromUnknown } from '@/lib/http'

type BookingModalDeps = {
  eventsRef: React.RefObject<CalendarEvent[]>
  activeStepMinutes: number
  activeLocationType: LocationType
  timeZone: string
  resolveLocationStepMinutes: (
    locationId: string | null,
    fallback?: number | null,
  ) => number
  resolveBookingSchedulingContext: (args: {
    locationId: string | null
    locationType: LocationType
    fallbackTimeZone: string
  }) => {
    timeZone: string
    workingHours: WorkingHoursJson
    stepMinutes: number
  }
  reloadCalendar: () => Promise<void>
  forceProFooterRefresh: () => void
  locations: { id: string; stepMinutes: number | null }[]
}

type BookingPatchServiceItem = {
  serviceId: string
  offeringId: string
  sortOrder: number
}

type BookingPatchPayload = {
  scheduledFor?: string
  notifyClient?: boolean
  allowOutsideWorkingHours?: boolean
  status?: 'ACCEPTED' | 'CANCELLED'
  serviceItems?: BookingPatchServiceItem[]
}

function normalizeUiTimeZone(value: string | null | undefined): string {
  return sanitizeTimeZone(value ?? DEFAULT_TIME_ZONE, DEFAULT_TIME_ZONE)
}

function parseDateParts(value: string): {
  yyyy: number
  mm: number
  dd: number
} | null {
  const [yyyy, mm, dd] = value.split('-').map(Number)
  if (!yyyy || !mm || !dd) return null
  return { yyyy, mm, dd }
}

function parseTimeParts(value: string): {
  hh: number
  mi: number
} | null {
  const [hh, mi] = value.split(':').map(Number)
  if (!Number.isFinite(hh) || !Number.isFinite(mi)) return null
  return { hh, mi }
}

function toPatchServiceItems(
  items: BookingServiceItem[],
): BookingPatchServiceItem[] {
  return normalizeDraftServiceItems(items).map((item) => ({
    serviceId: item.serviceId,
    offeringId: item.offeringId ?? '',
    sortOrder: Number(item.sortOrder),
  }))
}

export function useBookingModal(deps: BookingModalDeps) {
  const {
    eventsRef,
    activeStepMinutes,
    timeZone,
    resolveLocationStepMinutes,
    resolveBookingSchedulingContext,
    reloadCalendar,
    forceProFooterRefresh,
  } = deps

  const [openBookingId, setOpenBookingId] = useState<string | null>(null)
  const [bookingLoading, setBookingLoading] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [booking, setBooking] = useState<BookingDetails | null>(null)
  const [openBookingLocationId, setOpenBookingLocationId] = useState<
    string | null
  >(null)
  const [openBookingLocationType, setOpenBookingLocationType] =
    useState<LocationType>('SALON')

  const [serviceItemsDraft, setServiceItemsDraft] = useState<
    BookingServiceItem[]
  >([])
  const [manualDurationMinutes, setManualDurationMinutes] = useState<number>(60)

  const [reschedDate, setReschedDate] = useState<string>('')
  const [reschedTime, setReschedTime] = useState<string>('')
  const [notifyClient, setNotifyClient] = useState(true)
  const [savingReschedule, setSavingReschedule] = useState(false)
  const [allowOutsideHours, setAllowOutsideHours] = useState(false)

  const [services, setServices] = useState<ServiceOption[]>([])

  const bookingAppointmentTimeZone = useMemo(() => {
    return normalizeUiTimeZone(booking?.timeZone ?? timeZone)
  }, [booking?.timeZone, timeZone])

  const openBookingStepMinutes = useMemo(() => {
    return resolveLocationStepMinutes(openBookingLocationId, activeStepMinutes)
  }, [resolveLocationStepMinutes, openBookingLocationId, activeStepMinutes])

  const activeSchedulingContext = useMemo(() => {
    return resolveBookingSchedulingContext({
      locationId: openBookingLocationId,
      locationType: openBookingLocationType,
      fallbackTimeZone: bookingAppointmentTimeZone,
    })
  }, [
    resolveBookingSchedulingContext,
    openBookingLocationId,
    openBookingLocationType,
    bookingAppointmentTimeZone,
  ])

  const hasDraftServiceItemsChanges = useMemo(() => {
    if (!booking) return false

    return !sameServiceItems(
      normalizeDraftServiceItems(serviceItemsDraft),
      normalizeDraftServiceItems(booking.serviceItems),
    )
  }, [serviceItemsDraft, booking])

  const bookingServiceLabel = useMemo(() => {
    const source =
      serviceItemsDraft.length > 0 ? serviceItemsDraft : booking?.serviceItems ?? []
    return serviceItemsLabel(source)
  }, [serviceItemsDraft, booking])

  const durationMinutes = useMemo(() => {
    const draftComputed = serviceItemsTotalDuration(serviceItemsDraft)

    if (hasDraftServiceItemsChanges && draftComputed > 0) {
      return draftComputed
    }

    const persisted = Number(booking?.totalDurationMinutes ?? 0)
    if (persisted > 0) return persisted
    if (draftComputed > 0) return draftComputed

    const fallback = Number(manualDurationMinutes || 60)
    return roundDurationMinutes(fallback, openBookingStepMinutes)
  }, [
    serviceItemsDraft,
    hasDraftServiceItemsChanges,
    booking?.totalDurationMinutes,
    manualDurationMinutes,
    openBookingStepMinutes,
  ])

  const selectedDraftServiceIds = useMemo(
    () => serviceItemsDraft.map((item) => item.serviceId),
    [serviceItemsDraft],
  )

  function resetBookingState() {
    setOpenBookingId(null)
    setBooking(null)
    setOpenBookingLocationId(null)
    setOpenBookingLocationType('SALON')
    setServiceItemsDraft([])
    setBookingError(null)
    setSavingReschedule(false)
    setAllowOutsideHours(false)
    setManualDurationMinutes(60)
    setReschedDate('')
    setReschedTime('')
    setNotifyClient(true)
  }

  function setDraftServiceIds(nextServiceIds: string[]) {
    const uniqueIds = Array.from(
      new Set(nextServiceIds.map((id) => id.trim()).filter(Boolean)),
    )

    const stepMinutes = openBookingId ? openBookingStepMinutes : activeStepMinutes

    const nextItems = uniqueIds
      .map((serviceId, index) => {
        const option = services.find((service) => service.id === serviceId)
        return option
          ? buildDraftItemFromServiceOption(option, index, stepMinutes)
          : null
      })
      .filter((item): item is BookingServiceItem => Boolean(item))

    setServiceItemsDraft(normalizeDraftServiceItems(nextItems))
  }

  async function loadServicesForLocation(
    locationType: LocationType,
  ): Promise<ServiceOption[]> {
    try {
      const res = await fetch(
        `/api/pro/services?locationType=${encodeURIComponent(locationType)}`,
        { cache: 'no-store' },
      )
      const data: unknown = await safeJson(res)

      if (!res.ok || !isRecord(data)) {
        setServices([])
        return []
      }

      const parsed = parseServiceOptions(data.services)
      setServices(parsed)
      return parsed
    } catch {
      setServices([])
      return []
    }
  }

  function editWouldBeOutsideHours() {
    if (!booking) return false

    const dateParts = parseDateParts(reschedDate || '')
    if (!dateParts) return false

    const timeParts = parseTimeParts(reschedTime || '')
    if (!timeParts) return false

    const startMinutes = timeParts.hh * 60 + timeParts.mi
    const endMinutes = startMinutes + durationMinutes
    const dayAnchor = anchorDayLocalNoon(dateParts.yyyy, dateParts.mm, dateParts.dd)

    return isOutsideWorkingHours({
      day: dayAnchor,
      startMinutes,
      endMinutes,
      workingHours: activeSchedulingContext.workingHours,
      timeZone: activeSchedulingContext.timeZone,
    })
  }

  async function patchBooking(
    bookingId: string,
    payload: BookingPatchPayload,
    fallbackError: string,
  ) {
    const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data: unknown = await safeJson(res)
    if (!res.ok) {
      throw new Error(apiMessage(data, fallbackError))
    }
  }

  const editOutside = booking ? editWouldBeOutsideHours() : false

  async function openBooking(id: string) {
    setOpenBookingId(id)
    setBooking(null)
    setOpenBookingLocationId(null)
    setOpenBookingLocationType('SALON')
    setServiceItemsDraft([])
    setBookingError(null)
    setBookingLoading(true)
    setAllowOutsideHours(false)

    try {
      const maybeEvent = eventsRef.current.find((event) => event.id === id)
      if (maybeEvent && maybeEvent.kind === 'BOOKING') {
        setOpenBookingLocationId(maybeEvent.locationId ?? null)
        setOpenBookingLocationType(
          locationTypeFromBookingValue(maybeEvent.locationType),
        )
      }

      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(id)}`, {
        method: 'GET',
        cache: 'no-store',
      })
      const data: unknown = await safeJson(res)

      if (!res.ok) {
        throw new Error(apiMessage(data, `Failed to load booking (${res.status}).`))
      }
      if (!isRecord(data)) {
        throw new Error('Malformed booking response.')
      }

      const parsed = parseBookingDetails(data.booking)
      if (!parsed) {
        throw new Error('Malformed booking response.')
      }

      const parsedLocationType: LocationType =
        parsed.locationType === 'MOBILE' ? 'MOBILE' : 'SALON'

      setBooking(parsed)
      setServiceItemsDraft(parsed.serviceItems)
      setManualDurationMinutes(Number(parsed.totalDurationMinutes || 60))
      setNotifyClient(true)

      setOpenBookingLocationId(parsed.locationId ?? maybeEvent?.locationId ?? null)
      setOpenBookingLocationType(parsedLocationType)

      const appointmentTimeZone = normalizeUiTimeZone(parsed.timeZone)
      setReschedDate(
        utcIsoToDateInputValue(parsed.scheduledFor, appointmentTimeZone),
      )
      setReschedTime(
        utcIsoToTimeInputValue(parsed.scheduledFor, appointmentTimeZone),
      )

      await loadServicesForLocation(parsedLocationType)
    } catch (error: unknown) {
      console.error(error)
      setBookingError(errorMessageFromUnknown(error))
    } finally {
      setBookingLoading(false)
    }
  }

  function closeBooking() {
    resetBookingState()
  }

  async function submitChanges() {
    if (!booking || savingReschedule) return

    setSavingReschedule(true)
    setBookingError(null)

    try {
      const dateParts = parseDateParts(reschedDate || '')
      if (!dateParts) throw new Error('Pick a valid date.')

      const timeParts = parseTimeParts(reschedTime || '')
      if (!timeParts) throw new Error('Pick a valid time.')

      const localDateTime = combineDateAndTimeInput(reschedDate, reschedTime)
      const nextStartIso = dateTimeLocalToUtcIso(
        localDateTime,
        activeSchedulingContext.timeZone,
      )

      const effectiveDuration =
        hasDraftServiceItemsChanges && serviceItemsDraft.length > 0
          ? serviceItemsTotalDuration(serviceItemsDraft)
          : Number(booking.totalDurationMinutes || durationMinutes || 60)

      const snappedDuration = roundDurationMinutes(
        effectiveDuration,
        activeSchedulingContext.stepMinutes,
      )

      const dayAnchor = anchorDayLocalNoon(
        dateParts.yyyy,
        dateParts.mm,
        dateParts.dd,
      )

      const outside = isOutsideWorkingHours({
        day: dayAnchor,
        startMinutes: timeParts.hh * 60 + timeParts.mi,
        endMinutes: timeParts.hh * 60 + timeParts.mi + snappedDuration,
        workingHours: activeSchedulingContext.workingHours,
        timeZone: activeSchedulingContext.timeZone,
      })

      const payload: BookingPatchPayload = {
        scheduledFor: nextStartIso,
        notifyClient,
        allowOutsideWorkingHours: outside ? Boolean(allowOutsideHours) : false,
      }

      if (hasDraftServiceItemsChanges) {
        payload.serviceItems = toPatchServiceItems(serviceItemsDraft)
      }

      await patchBooking(booking.id, payload, 'Failed to save changes.')

      closeBooking()
      await reloadCalendar()
      forceProFooterRefresh()
    } catch (error: unknown) {
      console.error(error)
      setBookingError(errorMessageFromUnknown(error))
    } finally {
      setSavingReschedule(false)
    }
  }

  async function approveBooking() {
    if (!booking) return

    setSavingReschedule(true)
    setBookingError(null)

    try {
      await patchBooking(
        booking.id,
        { status: 'ACCEPTED', notifyClient: true },
        'Failed to approve booking.',
      )

      closeBooking()
      await reloadCalendar()
      forceProFooterRefresh()
    } catch (error: unknown) {
      setBookingError(errorMessageFromUnknown(error))
    } finally {
      setSavingReschedule(false)
    }
  }

  async function denyBooking() {
    if (!booking) return

    setSavingReschedule(true)
    setBookingError(null)

    try {
      await patchBooking(
        booking.id,
        { status: 'CANCELLED', notifyClient: true },
        'Failed to deny booking.',
      )

      closeBooking()
      await reloadCalendar()
      forceProFooterRefresh()
    } catch (error: unknown) {
      setBookingError(errorMessageFromUnknown(error))
    } finally {
      setSavingReschedule(false)
    }
  }

  return {
    openBookingId,
    bookingLoading,
    bookingError,
    booking,
    bookingServiceLabel,
    serviceItemsDraft,
    setServiceItemsDraft,
    selectedDraftServiceIds,
    setDraftServiceIds,
    hasDraftServiceItemsChanges,
    reschedDate,
    reschedTime,
    durationMinutes,
    notifyClient,
    allowOutsideHours,
    savingReschedule,
    editOutside,

    setReschedDate,
    setReschedTime,
    setDurationMinutes: setManualDurationMinutes,
    setNotifyClient,
    setAllowOutsideHours,

    services,
    setServices,
    loadServicesForLocation,

    openBooking,
    closeBooking,
    submitChanges,
    approveBooking,
    denyBooking,
  }
}

export type BookingModalState = ReturnType<typeof useBookingModal>