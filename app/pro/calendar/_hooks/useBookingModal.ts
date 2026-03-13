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
  const [openBookingLocationId, setOpenBookingLocationId] = useState<string | null>(null)
  const [openBookingLocationType, setOpenBookingLocationType] =
    useState<LocationType>('SALON')

  const [serviceItemsDraft, setServiceItemsDraft] = useState<BookingServiceItem[]>([])
  const [manualDurationMinutes, setManualDurationMinutes] = useState<number>(60)

  const [reschedDate, setReschedDate] = useState<string>('')
  const [reschedTime, setReschedTime] = useState<string>('')
  const [notifyClient, setNotifyClient] = useState(true)
  const [savingReschedule, setSavingReschedule] = useState(false)
  const [allowOutsideHours, setAllowOutsideHours] = useState(false)

  const [services, setServices] = useState<ServiceOption[]>([])

  const bookingAppointmentTimeZone = useMemo(() => {
    return sanitizeTimeZone(booking?.timeZone ?? timeZone, DEFAULT_TIME_ZONE)
  }, [booking?.timeZone, timeZone])

  const openBookingStepMinutes = useMemo(() => {
    return resolveLocationStepMinutes(openBookingLocationId, activeStepMinutes)
  }, [resolveLocationStepMinutes, openBookingLocationId, activeStepMinutes])

  const hasDraftServiceItemsChanges = useMemo(() => {
    if (!booking) return false

    return !sameServiceItems(
      normalizeDraftServiceItems(serviceItemsDraft),
      normalizeDraftServiceItems(booking.serviceItems),
    )
  }, [serviceItemsDraft, booking])

  const bookingServiceLabel = useMemo(() => {
    const source =
      serviceItemsDraft.length ? serviceItemsDraft : booking?.serviceItems ?? []
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

    const [yyyy, mm, dd] = (reschedDate || '').split('-').map((x) => Number(x))
    if (!yyyy || !mm || !dd) return false

    const [hh, mi] = (reschedTime || '').split(':').map((x) => Number(x))
    if (!Number.isFinite(hh) || !Number.isFinite(mi)) return false

    const context = resolveBookingSchedulingContext({
      locationId: openBookingLocationId,
      locationType: openBookingLocationType,
      fallbackTimeZone: bookingAppointmentTimeZone,
    })

    const startMinutes = hh * 60 + mi
    const endMinutes = startMinutes + durationMinutes
    const dayAnchor = anchorDayLocalNoon(yyyy, mm, dd)

    return isOutsideWorkingHours({
      day: dayAnchor,
      startMinutes,
      endMinutes,
      workingHours: context.workingHours,
      timeZone: context.timeZone,
    })
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
      const maybeEv = eventsRef.current.find((x) => x.id === id)
      if (maybeEv && maybeEv.kind === 'BOOKING') {
        setOpenBookingLocationId(maybeEv.locationId ?? null)
        setOpenBookingLocationType(
          locationTypeFromBookingValue(maybeEv.locationType),
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

      setBooking(parsed)
      setServiceItemsDraft(parsed.serviceItems)
      setManualDurationMinutes(Number(parsed.totalDurationMinutes || 60))

      const bookingTz = sanitizeTimeZone(parsed.timeZone, DEFAULT_TIME_ZONE)
      setReschedDate(utcIsoToDateInputValue(parsed.scheduledFor, bookingTz))
      setReschedTime(utcIsoToTimeInputValue(parsed.scheduledFor, bookingTz))
      setNotifyClient(true)

      const editLocationType: LocationType =
        parsed.locationType === 'MOBILE' ? 'MOBILE' : 'SALON'

      if (!maybeEv || maybeEv.kind !== 'BOOKING') {
        setOpenBookingLocationType(editLocationType)
      }

      setOpenBookingLocationId(parsed.locationId ?? null)
      await loadServicesForLocation(editLocationType)
    } catch (e: unknown) {
      console.error(e)
      setBookingError(errorMessageFromUnknown(e))
    } finally {
      setBookingLoading(false)
    }
  }

  function closeBooking() {
    setOpenBookingId(null)
    setBooking(null)
    setOpenBookingLocationId(null)
    setOpenBookingLocationType('SALON')
    setServiceItemsDraft([])
    setBookingError(null)
    setSavingReschedule(false)
    setAllowOutsideHours(false)
    setManualDurationMinutes(60)
  }

  async function submitChanges() {
    if (!booking || savingReschedule) return

    setSavingReschedule(true)
    setBookingError(null)

    try {
      const [yyyy, mm, dd] = (reschedDate || '').split('-').map((x) => Number(x))
      if (!yyyy || !mm || !dd) throw new Error('Pick a valid date.')

      const [hh, mi] = (reschedTime || '').split(':').map((x) => Number(x))
      if (!Number.isFinite(hh) || !Number.isFinite(mi)) {
        throw new Error('Pick a valid time.')
      }

      const context = resolveBookingSchedulingContext({
        locationId: openBookingLocationId,
        locationType: openBookingLocationType,
        fallbackTimeZone: bookingAppointmentTimeZone,
      })

      const localDateTime = combineDateAndTimeInput(reschedDate, reschedTime)
      const nextStartIso = dateTimeLocalToUtcIso(localDateTime, context.timeZone)
      const nextStart = new Date(nextStartIso)

      const effectiveDuration =
        hasDraftServiceItemsChanges && serviceItemsDraft.length > 0
          ? serviceItemsTotalDuration(serviceItemsDraft)
          : Number(booking.totalDurationMinutes || durationMinutes || 60)

      const snappedDur = roundDurationMinutes(
        effectiveDuration,
        context.stepMinutes,
      )
      const dayAnchor = anchorDayLocalNoon(yyyy, mm, dd)

      const outside = isOutsideWorkingHours({
        day: dayAnchor,
        startMinutes: hh * 60 + mi,
        endMinutes: hh * 60 + mi + snappedDur,
        workingHours: context.workingHours,
        timeZone: context.timeZone,
      })

      const payload: {
        scheduledFor: string
        notifyClient: boolean
        allowOutsideWorkingHours: boolean
        serviceItems?: {
          serviceId: string
          offeringId: string
          durationMinutesSnapshot: number
          priceSnapshot: string
          sortOrder: number
        }[]
      } = {
        scheduledFor: nextStart.toISOString(),
        notifyClient,
        allowOutsideWorkingHours: outside ? Boolean(allowOutsideHours) : false,
      }

      if (hasDraftServiceItemsChanges) {
        payload.serviceItems = normalizeDraftServiceItems(serviceItemsDraft).map(
          (item) => ({
            serviceId: item.serviceId,
            offeringId: item.offeringId ?? '',
            durationMinutesSnapshot: Number(item.durationMinutesSnapshot),
            priceSnapshot: item.priceSnapshot,
            sortOrder: Number(item.sortOrder),
          }),
        )
      }

      const res = await fetch(
        `/api/pro/bookings/${encodeURIComponent(booking.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )

      const data: unknown = await safeJson(res)
      if (!res.ok) {
        throw new Error(apiMessage(data, 'Failed to save changes.'))
      }

      closeBooking()
      await reloadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      console.error(e)
      setBookingError(errorMessageFromUnknown(e))
    } finally {
      setSavingReschedule(false)
    }
  }

  async function approveBooking() {
    if (!booking) return

    setSavingReschedule(true)
    setBookingError(null)

    try {
      const res = await fetch(
        `/api/pro/bookings/${encodeURIComponent(booking.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ACCEPTED', notifyClient: true }),
        },
      )

      const data: unknown = await safeJson(res)
      if (!res.ok) {
        throw new Error(apiMessage(data, 'Failed to approve booking.'))
      }

      closeBooking()
      await reloadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      setBookingError(errorMessageFromUnknown(e))
    } finally {
      setSavingReschedule(false)
    }
  }

  async function denyBooking() {
    if (!booking) return

    setSavingReschedule(true)
    setBookingError(null)

    try {
      const res = await fetch(
        `/api/pro/bookings/${encodeURIComponent(booking.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'CANCELLED', notifyClient: true }),
        },
      )

      const data: unknown = await safeJson(res)
      if (!res.ok) {
        throw new Error(apiMessage(data, 'Failed to deny booking.'))
      }

      closeBooking()
      await reloadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      setBookingError(errorMessageFromUnknown(e))
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