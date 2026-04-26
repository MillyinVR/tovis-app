// app/pro/calendar/_hooks/useCalendarData.ts
//
// Thin orchestrator that composes focused hooks into the same flat
// return shape consumed by calendar shells and child components.
'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'

import type { CalendarEvent, ViewMode, WorkingHoursJson } from '../_types'

import { startOfMonth, startOfWeek } from '../_utils/date'
import {
  isBlockedEvent,
  normalizeStepMinutes,
  PX_PER_MINUTE,
  snapMinutes,
} from '../_utils/calendarMath'
import {
  locationTypeFromBookingValue,
  type LocationType,
} from '../_utils/parsers'
import { toDatetimeLocalValueInTimeZone } from '../_utils/calendarRange'

import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  utcFromDayAndMinutesInTimeZone,
} from '@/lib/timeZone'

import { useCalendarLocations } from './useCalendarLocations'
import { useCalendarFetch } from './useCalendarFetch'
import { useManagementPanel } from './useManagementPanel'
import { useBlockActions } from './useBlockActions'
import { useConfirmChange } from './useConfirmChange'
import { useDragDrop } from './useDragDrop'
import { useBookingModal } from './useBookingModal'

// ─── Types ────────────────────────────────────────────────────────────────────

type UseCalendarDataArgs = {
  view: ViewMode
  currentDate: Date
}

type BookingSchedulingContextArgs = {
  locationId: string | null
  locationType: LocationType
  fallbackTimeZone: string
}

type SchedulingContext = {
  timeZone: string
  workingHours: WorkingHoursJson
  stepMinutes: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRO_SESSION_FORCE_EVENT = 'tovis:pro-session:force'
const TEMPORARY_ERROR_MS = 3000
const NO_LOCATION_SELECTED_MESSAGE = 'Select a location first.'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function forceProFooterRefresh(): void {
  try {
    window.dispatchEvent(new Event(PRO_SESSION_FORCE_EVENT))
  } catch {
    // Best-effort UI refresh only.
  }
}

function validTimeZoneOrNull(value: string | null | undefined): string | null {
  const candidate = typeof value === 'string' ? value.trim() : ''

  if (!candidate) return null
  if (!isValidIanaTimeZone(candidate)) return null

  return candidate
}

function sanitizeFallbackTimeZone(value: string | null | undefined): string {
  return sanitizeTimeZone(value ?? DEFAULT_TIME_ZONE, DEFAULT_TIME_ZONE)
}

function clearTemporaryErrorTimeout(timeoutId: number | null): void {
  if (timeoutId !== null) {
    window.clearTimeout(timeoutId)
  }
}

// ─── Exported hook ────────────────────────────────────────────────────────────

export function useCalendarData(args: UseCalendarDataArgs) {
  const { view, currentDate } = args
  const router = useRouter()

  const loc = useCalendarLocations()

  const calendarTimeZoneFallbackRef = useRef(DEFAULT_TIME_ZONE)
  const temporaryErrorTokenRef = useRef(0)
  const temporaryErrorTimeoutRef = useRef<number | null>(null)

  const resolveActiveCalendarTimeZone = useCallback(
    (fallback?: string): string => {
      const fallbackTimeZone = sanitizeTimeZone(
        fallback ?? calendarTimeZoneFallbackRef.current,
        DEFAULT_TIME_ZONE,
      )

      const activeLocationTimeZone = validTimeZoneOrNull(
        loc.activeLocation?.timeZone,
      )

      if (activeLocationTimeZone) {
        return sanitizeTimeZone(activeLocationTimeZone, fallbackTimeZone)
      }

      return fallbackTimeZone
    },
    [loc.activeLocation?.timeZone],
  )

  const cal = useCalendarFetch({
    view,
    currentDate,
    activeLocationId: loc.activeLocationId,
    setActiveLocationId: loc.setActiveLocationId,
    locationsLoaded: loc.locationsLoaded,
    activeLocation: loc.activeLocation,
    activeLocationType: loc.activeLocationType,
    setCanSalon: loc.setCanSalon,
    setCanMobile: loc.setCanMobile,
    resolveActiveCalendarTimeZone,
  })

  useEffect(() => {
    calendarTimeZoneFallbackRef.current = sanitizeFallbackTimeZone(cal.timeZone)
  }, [cal.timeZone])

  useEffect(() => {
    return () => {
      clearTemporaryErrorTimeout(temporaryErrorTimeoutRef.current)
    }
  }, [])

  const showTemporaryError = useCallback(
    (message: string): void => {
      temporaryErrorTokenRef.current += 1
      const token = temporaryErrorTokenRef.current

      clearTemporaryErrorTimeout(temporaryErrorTimeoutRef.current)

      cal.setError(message)

      temporaryErrorTimeoutRef.current = window.setTimeout(() => {
        if (temporaryErrorTokenRef.current !== token) return

        cal.setError(null)
        temporaryErrorTimeoutRef.current = null
      }, TEMPORARY_ERROR_MS)
    },
    [cal.setError],
  )

  const resolveBookingSchedulingContext = useCallback(
    (contextArgs: BookingSchedulingContextArgs): SchedulingContext => {
      const location = loc.resolveLocationById(contextArgs.locationId)

      const locationTimeZone = validTimeZoneOrNull(location?.timeZone)
      const fallbackTimeZone = sanitizeFallbackTimeZone(
        contextArgs.fallbackTimeZone,
      )

      const resolvedTimeZone = locationTimeZone
        ? sanitizeTimeZone(locationTimeZone, fallbackTimeZone)
        : fallbackTimeZone

      const resolvedWorkingHours =
        location?.workingHours ??
        (contextArgs.locationType === 'MOBILE'
          ? cal.workingHoursMobile
          : cal.workingHoursSalon)

      const resolvedStepMinutes = normalizeStepMinutes(location?.stepMinutes)

      return {
        timeZone: resolvedTimeZone,
        workingHours: resolvedWorkingHours,
        stepMinutes: resolvedStepMinutes,
      }
    },
    [
      cal.workingHoursMobile,
      cal.workingHoursSalon,
      loc.resolveLocationById,
    ],
  )

  const resolveEventSchedulingContext = useCallback(
    (event: CalendarEvent): SchedulingContext => {
      if (event.kind === 'BOOKING') {
        return resolveBookingSchedulingContext({
          locationId: event.locationId ?? null,
          locationType: locationTypeFromBookingValue(event.locationType),
          fallbackTimeZone: cal.timeZoneRef.current,
        })
      }

      if (event.locationId) {
        return resolveBookingSchedulingContext({
          locationId: event.locationId,
          locationType: loc.resolveLocationTypeFromId(
            event.locationId,
            loc.activeLocationType,
          ),
          fallbackTimeZone: cal.timeZoneRef.current,
        })
      }

      return {
        timeZone: sanitizeFallbackTimeZone(cal.timeZoneRef.current),
        workingHours: cal.workingHoursActive,
        stepMinutes: loc.activeStepMinutes,
      }
    },
    [
      cal.timeZoneRef,
      cal.workingHoursActive,
      loc.activeLocationType,
      loc.activeStepMinutes,
      loc.resolveLocationTypeFromId,
      resolveBookingSchedulingContext,
    ],
  )

  const mgmt = useManagementPanel({
    eventsRef: cal.eventsRef,
    reloadCalendar: cal.loadCalendar,
    forceProFooterRefresh,
  })

  const bookingModal = useBookingModal({
    eventsRef: cal.eventsRef,
    activeStepMinutes: loc.activeStepMinutes,
    activeLocationType: loc.activeLocationType,
    timeZone: cal.timeZone,
    resolveLocationStepMinutes: loc.resolveLocationStepMinutes,
    resolveBookingSchedulingContext,
    reloadCalendar: cal.loadCalendar,
    forceProFooterRefresh,
    locations: loc.locations,
  })

  const loadServicesForLocationRef = useRef(
    bookingModal.loadServicesForLocation,
  )

  useEffect(() => {
    loadServicesForLocationRef.current = bookingModal.loadServicesForLocation
  }, [bookingModal.loadServicesForLocation])

  useEffect(() => {
    void loadServicesForLocationRef.current(loc.activeLocationType)
  }, [loc.activeLocationType])

  const confirm = useConfirmChange({
    eventsRef: cal.eventsRef,
    setEvents: cal.setEvents,
    resolveBookingSchedulingContext,
    timeZoneRef: cal.timeZoneRef,
    reloadCalendar: cal.loadCalendar,
    forceProFooterRefresh,
    setError: cal.setError,
  })

  const dragDrop = useDragDrop({
    eventsRef: cal.eventsRef,
    setEvents: cal.setEvents,
    resolveEventSchedulingContext,
    activeStepMinutes: loc.activeStepMinutes,
    openConfirm: confirm.openConfirm,
  })

  const blocks = useBlockActions({
    activeLocationId: loc.activeLocationId,
    activeStepMinutes: loc.activeStepMinutes,
    resolveActiveCalendarTimeZone,
    reloadCalendar: cal.loadCalendar,
    forceProFooterRefresh,
    setError: cal.setError,
    setLoading: cal.setLoading,
  })

  useEffect(() => {
    mgmt.setManagement(cal.management)
  }, [cal.management, mgmt.setManagement])

  const [showHoursForm, setShowHoursForm] = useState(false)

  const isOverlayOpen = useMemo(
    () =>
      Boolean(
        confirm.confirmOpen ||
          confirm.pendingChange ||
          bookingModal.openBookingId ||
          mgmt.managementOpen ||
          blocks.blockCreateOpen ||
          blocks.editBlockOpen,
      ),
    [
      blocks.blockCreateOpen,
      blocks.editBlockOpen,
      bookingModal.openBookingId,
      confirm.confirmOpen,
      confirm.pendingChange,
      mgmt.managementOpen,
    ],
  )

  const openBookingOrBlock = useCallback(
    (id: string): void => {
      const event = cal.eventsRef.current.find((entry) => entry.id === id)

      if (event && isBlockedEvent(event)) {
        const locationId = blocks.openEditBlockFromEvent(event)

        if (locationId) {
          loc.setActiveLocationId(locationId)
        }

        return
      }

      if (confirm.confirmOpen || confirm.pendingChange) return
      if (mgmt.managementOpen) return
      if (blocks.blockCreateOpen || blocks.editBlockOpen) return

      void bookingModal.openBooking(id)
    },
    [
      blocks.blockCreateOpen,
      blocks.editBlockOpen,
      blocks.openEditBlockFromEvent,
      bookingModal.openBooking,
      cal.eventsRef,
      confirm.confirmOpen,
      confirm.pendingChange,
      loc.setActiveLocationId,
      mgmt.managementOpen,
    ],
  )

  const openCreateForClick = useCallback(
    (day: Date, clientY: number, columnTop: number): void => {
      if (
        confirm.confirmOpen ||
        confirm.pendingChange ||
        bookingModal.openBookingId
      ) {
        return
      }

      if (mgmt.managementOpen) return
      if (blocks.blockCreateOpen || blocks.editBlockOpen) return

      if (!loc.activeLocationId) {
        showTemporaryError(NO_LOCATION_SELECTED_MESSAGE)
        return
      }

      const y = clientY - columnTop
      const minutes = snapMinutes(y / PX_PER_MINUTE, loc.activeStepMinutes)
      const timeZone = resolveActiveCalendarTimeZone()
      const startUtc = utcFromDayAndMinutesInTimeZone(day, minutes, timeZone)
      const scheduledAt = toDatetimeLocalValueInTimeZone(startUtc, timeZone)

      const query = new URLSearchParams({
        locationId: loc.activeLocationId,
        locationType: loc.activeLocationType,
        scheduledAt,
      })

      router.push(`/pro/bookings/new?${query.toString()}`)
    },
    [
      blocks.blockCreateOpen,
      blocks.editBlockOpen,
      bookingModal.openBookingId,
      confirm.confirmOpen,
      confirm.pendingChange,
      loc.activeLocationId,
      loc.activeLocationType,
      loc.activeStepMinutes,
      mgmt.managementOpen,
      resolveActiveCalendarTimeZone,
      router,
      showTemporaryError,
    ],
  )

  const utils = useMemo(
    () => ({
      startOfWeek,
      startOfMonth,
    }),
    [],
  )

  return {
    view,
    currentDate,

    events: cal.events,
    setEvents: cal.setEvents,

    range: cal.range,

    timeZone: cal.timeZone,
    needsTimeZoneSetup: cal.needsTimeZoneSetup,
    blockedMinutesToday: cal.blockedMinutesToday,

    locations: loc.locations,
    locationsLoaded: loc.locationsLoaded,
    scopedLocations: loc.scopedLocations,
    activeLocationId: loc.activeLocationId,
    setActiveLocationId: loc.setActiveLocationId,
    activeLocation: loc.activeLocation,
    activeLocationLabel: loc.activeLocationLabel,
    activeLocationType: loc.activeLocationType,
    activeStepMinutes: loc.activeStepMinutes,

    canSalon: loc.canSalon,
    canMobile: loc.canMobile,

    hoursEditorLocationType: loc.hoursEditorLocationType,
    setHoursEditorLocationType: loc.setHoursEditorLocationType,

    workingHoursSalon: cal.workingHoursSalon,
    setWorkingHoursSalon: cal.setWorkingHoursSalon,
    workingHoursMobile: cal.workingHoursMobile,
    setWorkingHoursMobile: cal.setWorkingHoursMobile,
    workingHoursActive: cal.workingHoursActive,

    stats: cal.stats,

    loading: cal.loading,
    error: cal.error,

    services: bookingModal.services,
    setServices: bookingModal.setServices,

    management: mgmt.management,
    managementOpen: mgmt.managementOpen,
    managementKey: mgmt.managementKey,
    setManagementKey: mgmt.setManagementKey,
    openManagement: mgmt.openManagement,
    closeManagement: mgmt.closeManagement,

    showHoursForm,
    setShowHoursForm,

    autoAccept: cal.autoAccept,
    savingAutoAccept: cal.savingAutoAccept,
    toggleAutoAccept: cal.toggleAutoAccept,

    blockCreateOpen: blocks.blockCreateOpen,
    setBlockCreateOpen: blocks.setBlockCreateOpen,
    blockCreateInitialStart: blocks.blockCreateInitialStart,
    setBlockCreateInitialStart: blocks.setBlockCreateInitialStart,
    editBlockOpen: blocks.editBlockOpen,
    setEditBlockOpen: blocks.setEditBlockOpen,
    editBlockId: blocks.editBlockId,
    setEditBlockId: blocks.setEditBlockId,
    openCreateBlockNow: blocks.openCreateBlockNow,
    oneClickBlockFullDay: blocks.oneClickBlockFullDay,

    openBookingId: bookingModal.openBookingId,
    bookingLoading: bookingModal.bookingLoading,
    bookingError: bookingModal.bookingError,
    booking: bookingModal.booking,
    bookingServiceLabel: bookingModal.bookingServiceLabel,
    serviceItemsDraft: bookingModal.serviceItemsDraft,
    setServiceItemsDraft: bookingModal.setServiceItemsDraft,
    selectedDraftServiceIds: bookingModal.selectedDraftServiceIds,
    setDraftServiceIds: bookingModal.setDraftServiceIds,
    hasDraftServiceItemsChanges: bookingModal.hasDraftServiceItemsChanges,
    reschedDate: bookingModal.reschedDate,
    reschedTime: bookingModal.reschedTime,
    durationMinutes: bookingModal.durationMinutes,
    notifyClient: bookingModal.notifyClient,
    allowOutsideHours: bookingModal.allowOutsideHours,
    savingReschedule: bookingModal.savingReschedule,
    editOutside: bookingModal.editOutside,

    setReschedDate: bookingModal.setReschedDate,
    setReschedTime: bookingModal.setReschedTime,
    setDurationMinutes: bookingModal.setDurationMinutes,
    setNotifyClient: bookingModal.setNotifyClient,
    setAllowOutsideHours: bookingModal.setAllowOutsideHours,

    submitChanges: bookingModal.submitChanges,
    approveBooking: bookingModal.approveBooking,
    denyBooking: bookingModal.denyBooking,

    approveBookingById: mgmt.approveBookingById,
    denyBookingById: mgmt.denyBookingById,
    managementActionBusyId: mgmt.managementActionBusyId,
    managementActionError: mgmt.managementActionError,

    openBookingOrBlock,
    closeBooking: bookingModal.closeBooking,

    pendingChange: confirm.pendingChange,
    confirmOpen: confirm.confirmOpen,
    applyingChange: confirm.applyingChange,
    cancelConfirm: confirm.cancelConfirm,
    applyConfirm: confirm.applyConfirm,
    pendingOutsideWorkingHours: confirm.pendingOutsideWorkingHours,
    overrideReason: confirm.overrideReason,
    setOverrideReason: confirm.setOverrideReason,

    ui: {
      suppressClickRef: dragDrop.ui.suppressClickRef,
      suppressClickBriefly: dragDrop.ui.suppressClickBriefly,
      isOverlayOpen,
    },

    drag: dragDrop.drag,
    resize: dragDrop.resize,

    openCreateForClick,

    utils,

    reload: cal.reload,
  }
}

export type CalendarData = ReturnType<typeof useCalendarData>