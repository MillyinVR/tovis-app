// app/pro/calendar/_hooks/useBookingModal.ts
'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RefObject } from 'react'

import type {
  BookingDetails,
  BookingServiceItem,
  CalendarEvent,
  ServiceOption,
  WorkingHoursJson,
} from '../_types'

import {
  isOutsideWorkingHours,
  roundDurationMinutes,
} from '../_utils/calendarMath'

import {
  apiMessage,
  locationTypeFromBookingValue,
  parseBookingDetails,
  parseServiceOptions,
  type LocationType,
} from '../_utils/parsers'

import {
  buildDraftItemFromServiceOption,
  normalizeDraftServiceItems,
  sameServiceItems,
  serviceItemsLabel,
  serviceItemsTotalDuration,
} from '../_utils/serviceItems'

import { anchorDayLocalNoon } from '../_utils/calendarRange'

import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'

import {
  combineDateAndTimeInput,
  dateTimeLocalToUtcIso,
  utcIsoToDateInputValue,
  utcIsoToTimeInputValue,
} from '@/lib/bookingDateTimeClient'

import { isRecord } from '@/lib/guards'
import { errorMessageFromUnknown, safeJson } from '@/lib/http'

type BookingModalDeps = {
  eventsRef: RefObject<CalendarEvent[]>
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

type DateParts = {
  yyyy: number
  mm: number
  dd: number
}

type TimeParts = {
  hh: number
  mi: number
}

type BookingStatusMutation = {
  status: 'ACCEPTED' | 'CANCELLED'
  fallbackError: string
}

const DEFAULT_DURATION_MINUTES = 60

function normalizeUiTimeZone(value: string | null | undefined) {
  return sanitizeTimeZone(value ?? DEFAULT_TIME_ZONE, DEFAULT_TIME_ZONE)
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function parseDateParts(value: string): DateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const yyyy = Number(match[1])
  const mm = Number(match[2])
  const dd = Number(match[3])

  if (!Number.isInteger(yyyy) || yyyy < 1900 || yyyy > 3000) return null
  if (!Number.isInteger(mm) || mm < 1 || mm > 12) return null
  if (!Number.isInteger(dd) || dd < 1 || dd > 31) return null

  const check = new Date(Date.UTC(yyyy, mm - 1, dd))

  const valid =
    check.getUTCFullYear() === yyyy &&
    check.getUTCMonth() === mm - 1 &&
    check.getUTCDate() === dd

  return valid ? { yyyy, mm, dd } : null
}

function parseTimeParts(value: string): TimeParts | null {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null

  const hh = Number(match[1])
  const mi = Number(match[2])

  if (!Number.isInteger(hh) || hh < 0 || hh > 23) return null
  if (!Number.isInteger(mi) || mi < 0 || mi > 59) return null

  return { hh, mi }
}

function bookingEndpoint(bookingId: string) {
  return `/api/pro/bookings/${encodeURIComponent(bookingId)}`
}

function servicesEndpoint(locationType: LocationType) {
  const params = new URLSearchParams({ locationType })
  return `/api/pro/services?${params.toString()}`
}

function bookingLocationTypeFromDetails(booking: BookingDetails): LocationType {
  return booking.locationType === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function eventLocationContext(event: CalendarEvent | undefined) {
  if (!event || event.kind !== 'BOOKING') {
    return {
      locationId: null,
      locationType: 'SALON' as const,
    }
  }

  return {
    locationId: event.locationId ?? null,
    locationType: locationTypeFromBookingValue(event.locationType),
  }
}

function toPatchServiceItems(
  items: BookingServiceItem[],
): BookingPatchServiceItem[] {
  const normalized = normalizeDraftServiceItems(items)
  const payload: BookingPatchServiceItem[] = []

  for (const item of normalized) {
    payload.push({
      serviceId: item.serviceId,
      offeringId: item.offeringId ?? '',
      sortOrder: Number(item.sortOrder),
    })
  }

  return payload
}

function uniqueServiceIds(serviceIds: string[]) {
  const ids: string[] = []
  const seen = new Set<string>()

  for (const serviceId of serviceIds) {
    const trimmed = serviceId.trim()
    if (!trimmed || seen.has(trimmed)) continue

    seen.add(trimmed)
    ids.push(trimmed)
  }

  return ids
}

function draftItemsFromServiceIds(args: {
  serviceIds: string[]
  services: ServiceOption[]
  stepMinutes: number
}) {
  const items: BookingServiceItem[] = []

  for (const [index, serviceId] of args.serviceIds.entries()) {
    const option = args.services.find((service) => service.id === serviceId)
    if (!option) continue

    const draftItem = buildDraftItemFromServiceOption(
      option,
      index,
      args.stepMinutes,
    )

    if (draftItem) {
      items.push(draftItem)
    }
  }

  return normalizeDraftServiceItems(items)
}

function dateAndTimeParts(args: {
  date: string
  time: string
}) {
  const dateParts = parseDateParts(args.date)
  if (!dateParts) throw new Error('Pick a valid date.')

  const timeParts = parseTimeParts(args.time)
  if (!timeParts) throw new Error('Pick a valid time.')

  return {
    dateParts,
    timeParts,
  }
}

function outsideWorkingHoursForEdit(args: {
  dateParts: DateParts
  timeParts: TimeParts
  durationMinutes: number
  workingHours: WorkingHoursJson
  timeZone: string
}) {
  const startMinutes = args.timeParts.hh * 60 + args.timeParts.mi
  const endMinutes = startMinutes + args.durationMinutes
  const dayAnchor = anchorDayLocalNoon(
    args.dateParts.yyyy,
    args.dateParts.mm,
    args.dateParts.dd,
  )

  return isOutsideWorkingHours({
    day: dayAnchor,
    startMinutes,
    endMinutes,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
  })
}

async function patchBooking(args: {
  bookingId: string
  payload: BookingPatchPayload
  fallbackError: string
}) {
  const response = await fetch(bookingEndpoint(args.bookingId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args.payload),
  })

  const data: unknown = await safeJson(response)

  if (!response.ok) {
    throw new Error(apiMessage(data, args.fallbackError))
  }
}

function parsedBookingFromResponse(data: unknown): BookingDetails {
  if (!isRecord(data)) {
    throw new Error('Malformed booking response.')
  }

  const parsed = parseBookingDetails(data.booking)

  if (!parsed) {
    throw new Error('Malformed booking response.')
  }

  return parsed
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

  const [openBookingLocationId, setOpenBookingLocationId] =
    useState<string | null>(null)
  const [openBookingLocationType, setOpenBookingLocationType] =
    useState<LocationType>('SALON')

  const [serviceItemsDraft, setServiceItemsDraft] = useState<
    BookingServiceItem[]
  >([])
  const [manualDurationMinutes, setManualDurationMinutes] = useState(
    DEFAULT_DURATION_MINUTES,
  )

  const [reschedDate, setReschedDate] = useState('')
  const [reschedTime, setReschedTime] = useState('')
  const [notifyClient, setNotifyClient] = useState(true)
  const [savingReschedule, setSavingReschedule] = useState(false)
  const [allowOutsideHours, setAllowOutsideHours] = useState(false)
  const [services, setServices] = useState<ServiceOption[]>([])

  const bookingLoadControllerRef = useRef<AbortController | null>(null)
  const servicesLoadControllerRef = useRef<AbortController | null>(null)

  const bookingAppointmentTimeZone = useMemo(
    () => normalizeUiTimeZone(booking?.timeZone ?? timeZone),
    [booking?.timeZone, timeZone],
  )

  const openBookingStepMinutes = useMemo(
    () => resolveLocationStepMinutes(openBookingLocationId, activeStepMinutes),
    [activeStepMinutes, openBookingLocationId, resolveLocationStepMinutes],
  )

  const activeSchedulingContext = useMemo(
    () =>
      resolveBookingSchedulingContext({
        locationId: openBookingLocationId,
        locationType: openBookingLocationType,
        fallbackTimeZone: bookingAppointmentTimeZone,
      }),
    [
      bookingAppointmentTimeZone,
      openBookingLocationId,
      openBookingLocationType,
      resolveBookingSchedulingContext,
    ],
  )

  const hasDraftServiceItemsChanges = useMemo(() => {
    if (!booking) return false

    return !sameServiceItems(
      normalizeDraftServiceItems(serviceItemsDraft),
      normalizeDraftServiceItems(booking.serviceItems),
    )
  }, [booking, serviceItemsDraft])

  const bookingServiceLabel = useMemo(() => {
    const source =
      serviceItemsDraft.length > 0
        ? serviceItemsDraft
        : booking?.serviceItems ?? []

    return serviceItemsLabel(source)
  }, [booking?.serviceItems, serviceItemsDraft])

  const durationMinutes = useMemo(() => {
    const draftDuration = serviceItemsTotalDuration(serviceItemsDraft)

    if (hasDraftServiceItemsChanges && draftDuration > 0) {
      return draftDuration
    }

    const persistedDuration = Number(booking?.totalDurationMinutes ?? 0)
    if (persistedDuration > 0) return persistedDuration

    if (draftDuration > 0) return draftDuration

    return roundDurationMinutes(
      Number(manualDurationMinutes || DEFAULT_DURATION_MINUTES),
      openBookingStepMinutes,
    )
  }, [
    booking?.totalDurationMinutes,
    hasDraftServiceItemsChanges,
    manualDurationMinutes,
    openBookingStepMinutes,
    serviceItemsDraft,
  ])

  const selectedDraftServiceIds = useMemo(
    () => serviceItemsDraft.map((item) => item.serviceId),
    [serviceItemsDraft],
  )

  const editOutside = useMemo(() => {
    if (!booking) return false

    const dateParts = parseDateParts(reschedDate)
    const timeParts = parseTimeParts(reschedTime)

    if (!dateParts || !timeParts) return false

    return outsideWorkingHoursForEdit({
      dateParts,
      timeParts,
      durationMinutes,
      workingHours: activeSchedulingContext.workingHours,
      timeZone: activeSchedulingContext.timeZone,
    })
  }, [
    activeSchedulingContext.timeZone,
    activeSchedulingContext.workingHours,
    booking,
    durationMinutes,
    reschedDate,
    reschedTime,
  ])

  const resetBookingState = useCallback(() => {
    bookingLoadControllerRef.current?.abort()
    servicesLoadControllerRef.current?.abort()

    setOpenBookingId(null)
    setBooking(null)
    setOpenBookingLocationId(null)
    setOpenBookingLocationType('SALON')
    setServiceItemsDraft([])
    setBookingError(null)
    setBookingLoading(false)
    setSavingReschedule(false)
    setAllowOutsideHours(false)
    setManualDurationMinutes(DEFAULT_DURATION_MINUTES)
    setReschedDate('')
    setReschedTime('')
    setNotifyClient(true)
  }, [])

  const loadServicesForLocation = useCallback(
    async (locationType: LocationType): Promise<ServiceOption[]> => {
      servicesLoadControllerRef.current?.abort()

      const controller = new AbortController()
      servicesLoadControllerRef.current = controller

      try {
        const response = await fetch(servicesEndpoint(locationType), {
          cache: 'no-store',
          signal: controller.signal,
        })

        const data: unknown = await safeJson(response)

        if (controller.signal.aborted) return []

        if (!response.ok || !isRecord(data)) {
          setServices([])
          return []
        }

        const parsed = parseServiceOptions(data.services)
        setServices(parsed)

        return parsed
      } catch (caught) {
        if (!isAbortError(caught)) {
          setServices([])
        }

        return []
      } finally {
        if (servicesLoadControllerRef.current === controller) {
          servicesLoadControllerRef.current = null
        }
      }
    },
    [],
  )

  const setDraftServiceIds = useCallback(
    (nextServiceIds: string[]) => {
      const serviceIds = uniqueServiceIds(nextServiceIds)
      const stepMinutes = openBookingId
        ? openBookingStepMinutes
        : activeStepMinutes

      setServiceItemsDraft(
        draftItemsFromServiceIds({
          serviceIds,
          services,
          stepMinutes,
        }),
      )
    },
    [
      activeStepMinutes,
      openBookingId,
      openBookingStepMinutes,
      services,
    ],
  )

  const openBooking = useCallback(
    async (id: string) => {
      bookingLoadControllerRef.current?.abort()

      const controller = new AbortController()
      bookingLoadControllerRef.current = controller

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
        const eventContext = eventLocationContext(maybeEvent)

        setOpenBookingLocationId(eventContext.locationId)
        setOpenBookingLocationType(eventContext.locationType)

        const response = await fetch(bookingEndpoint(id), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })

        const data: unknown = await safeJson(response)

        if (controller.signal.aborted) return

        if (!response.ok) {
          throw new Error(
            apiMessage(data, `Failed to load booking (${response.status}).`),
          )
        }

        const parsed = parsedBookingFromResponse(data)
        const parsedLocationType = bookingLocationTypeFromDetails(parsed)
        const appointmentTimeZone = normalizeUiTimeZone(parsed.timeZone)

        setBooking(parsed)
        setServiceItemsDraft(parsed.serviceItems)
        setManualDurationMinutes(
          Number(parsed.totalDurationMinutes || DEFAULT_DURATION_MINUTES),
        )
        setNotifyClient(true)
        setOpenBookingLocationId(
          parsed.locationId ?? eventContext.locationId,
        )
        setOpenBookingLocationType(parsedLocationType)
        setReschedDate(
          utcIsoToDateInputValue(parsed.scheduledFor, appointmentTimeZone),
        )
        setReschedTime(
          utcIsoToTimeInputValue(parsed.scheduledFor, appointmentTimeZone),
        )

        await loadServicesForLocation(parsedLocationType)
      } catch (caught) {
        if (!isAbortError(caught)) {
          setBookingError(errorMessageFromUnknown(caught))
        }
      } finally {
        if (bookingLoadControllerRef.current === controller) {
          bookingLoadControllerRef.current = null
        }

        if (!controller.signal.aborted) {
          setBookingLoading(false)
        }
      }
    },
    [eventsRef, loadServicesForLocation],
  )

  const closeBooking = useCallback(() => {
    resetBookingState()
  }, [resetBookingState])

  const submitChanges = useCallback(async () => {
    if (!booking || savingReschedule) return

    setSavingReschedule(true)
    setBookingError(null)

    try {
      const { dateParts, timeParts } = dateAndTimeParts({
        date: reschedDate,
        time: reschedTime,
      })

      const localDateTime = combineDateAndTimeInput(reschedDate, reschedTime)
      const nextStartIso = dateTimeLocalToUtcIso(
        localDateTime,
        activeSchedulingContext.timeZone,
      )

      const effectiveDuration =
        hasDraftServiceItemsChanges && serviceItemsDraft.length > 0
          ? serviceItemsTotalDuration(serviceItemsDraft)
          : Number(
              booking.totalDurationMinutes ||
                durationMinutes ||
                DEFAULT_DURATION_MINUTES,
            )

      const snappedDuration = roundDurationMinutes(
        effectiveDuration,
        activeSchedulingContext.stepMinutes,
      )

      const outside = outsideWorkingHoursForEdit({
        dateParts,
        timeParts,
        durationMinutes: snappedDuration,
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

      await patchBooking({
        bookingId: booking.id,
        payload,
        fallbackError: 'Failed to save changes.',
      })

      resetBookingState()
      await reloadCalendar()
      forceProFooterRefresh()
    } catch (caught) {
      setBookingError(errorMessageFromUnknown(caught))
    } finally {
      setSavingReschedule(false)
    }
  }, [
    activeSchedulingContext.stepMinutes,
    activeSchedulingContext.timeZone,
    activeSchedulingContext.workingHours,
    allowOutsideHours,
    booking,
    durationMinutes,
    forceProFooterRefresh,
    hasDraftServiceItemsChanges,
    notifyClient,
    reloadCalendar,
    resetBookingState,
    reschedDate,
    reschedTime,
    savingReschedule,
    serviceItemsDraft,
  ])

  const mutateBookingStatus = useCallback(
    async (mutation: BookingStatusMutation) => {
      if (!booking || savingReschedule) return

      setSavingReschedule(true)
      setBookingError(null)

      try {
        await patchBooking({
          bookingId: booking.id,
          payload: {
            status: mutation.status,
            notifyClient: true,
          },
          fallbackError: mutation.fallbackError,
        })

        resetBookingState()
        await reloadCalendar()
        forceProFooterRefresh()
      } catch (caught) {
        setBookingError(errorMessageFromUnknown(caught))
      } finally {
        setSavingReschedule(false)
      }
    },
    [
      booking,
      forceProFooterRefresh,
      reloadCalendar,
      resetBookingState,
      savingReschedule,
    ],
  )

  const approveBooking = useCallback(async () => {
    await mutateBookingStatus({
      status: 'ACCEPTED',
      fallbackError: 'Failed to approve booking.',
    })
  }, [mutateBookingStatus])

  const denyBooking = useCallback(async () => {
    await mutateBookingStatus({
      status: 'CANCELLED',
      fallbackError: 'Failed to deny booking.',
    })
  }, [mutateBookingStatus])

  useEffect(() => {
    return () => {
      bookingLoadControllerRef.current?.abort()
      servicesLoadControllerRef.current?.abort()
    }
  }, [])

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