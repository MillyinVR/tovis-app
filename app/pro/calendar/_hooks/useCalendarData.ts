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

import { useLiveChanged } from '@/app/_components/live/LiveRefresh'

import { useCalendarLocations } from './useCalendarLocations'
import { useCalendarFetch } from './useCalendarFetch'
import { useManagementPanel } from './useManagementPanel'
import { useBlockActions, nextStepStartFromNow } from './useBlockActions'
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

/**
 * The seed for `/pro/bookings/new` — one builder for both entry points (the "+"
 * action and click-to-create), which had drifted into two identical copies.
 *
 * ⚠️ `locationId` is omitted when the calendar shows ALL locations: there is no
 * selected location to carry, and the new-booking form has its own location
 * select that resolves — and shows — an explicit one. Sending a guess would
 * commit the pro to a location they never picked (K3).
 */
function buildNewBookingQuery(args: {
  locationId: string | null
  locationType: LocationType
  scheduledAt: string
}): string {
  const query = new URLSearchParams({
    locationType: args.locationType,
    scheduledAt: args.scheduledAt,
  })

  if (args.locationId) {
    query.set('locationId', args.locationId)
  }

  return query.toString()
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

      // The ANCHOR, not the filter: with all locations shown there is no active
      // location, and the server resolves its viewport from the primary one —
      // guessing anything else here makes every load refetch (see
      // shouldRefetchForApiTimeZone).
      const anchorLocationTimeZone = validTimeZoneOrNull(
        loc.anchorLocation?.timeZone,
      )

      if (anchorLocationTimeZone) {
        return sanitizeTimeZone(anchorLocationTimeZone, fallbackTimeZone)
      }

      return fallbackTimeZone
    },
    [loc.anchorLocation?.timeZone],
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

  // Live-sync: the calendar's rows live in this hook's state, so the pro shell's
  // `router.refresh()` never reaches them — a client approving a consultation
  // (or confirming, declining, rescheduling, cancelling) left the grid stale
  // until a manual reload. Re-run the same fetch the pro's own actions use.
  // No-ops when the shell has no live subscription; load-on-mount and the focus
  // refresh still keep the grid correct, just not instant.
  useLiveChanged(cal.reload)

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
    [cal],
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
    [cal, loc],
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
    [cal, loc, resolveBookingSchedulingContext],
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
    // The ANCHOR, not the filter: blocked time must post a real location
    // (`POST /api/v1/pro/calendar/blocked` requires one), and with all
    // locations shown there is no filter to take it from. The block modal
    // displays the resolved location, so the pro sees which one they are
    // blocking rather than having it chosen behind them.
    activeLocationId: loc.anchorLocation?.id ?? null,
    activeStepMinutes: loc.activeStepMinutes,
    resolveActiveCalendarTimeZone,
    reloadCalendar: cal.loadCalendar,
    forceProFooterRefresh,
    setError: cal.setError,
    setLoading: cal.setLoading,
  })

  useEffect(() => {
    mgmt.setManagement(cal.management)
  }, [cal, mgmt])

  const [showHoursForm, setShowHoursForm] = useState(false)

  // Zone + step of the block currently open in the editor, captured from the
  // event itself so a cross-location block edits in its own local time.
  const [editBlockContext, setEditBlockContext] = useState<{
    timeZone: string
    stepMinutes: number
  } | null>(null)

  // Click-to-create: the clicked slot's start instant while the pro is choosing
  // between adding an appointment and blocking personal time. Non-null = the
  // choice sheet is open.
  const [createChoiceStart, setCreateChoiceStart] = useState<Date | null>(null)

  const isOverlayOpen = useMemo(
    () =>
      Boolean(
        confirm.confirmOpen ||
          confirm.pendingChange ||
          bookingModal.openBookingId ||
          mgmt.managementOpen ||
          blocks.blockCreateOpen ||
          blocks.editBlockOpen ||
          createChoiceStart,
      ),
    [
      blocks.blockCreateOpen,
      blocks.editBlockOpen,
      bookingModal.openBookingId,
      confirm.confirmOpen,
      confirm.pendingChange,
      createChoiceStart,
      mgmt.managementOpen,
    ],
  )

  const openBookingOrBlock = useCallback(
    (id: string): void => {
      const event = cal.eventsRef.current.find((entry) => entry.id === id)

      if (event && isBlockedEvent(event)) {
        // Give the editor the block's OWN zone and step rather than switching
        // the whole calendar to that block's location to borrow them. Under a
        // single-location feed those were the same thing; with every location
        // on one grid, the old move would silently narrow the pro's view to
        // whichever block they happened to open.
        const context = resolveEventSchedulingContext(event)

        setEditBlockContext({
          timeZone: context.timeZone,
          stepMinutes: context.stepMinutes,
        })

        blocks.openEditBlockFromEvent(event)

        return
      }

      if (confirm.confirmOpen || confirm.pendingChange) return
      if (mgmt.managementOpen) return
      if (blocks.blockCreateOpen || blocks.editBlockOpen) return

      void bookingModal.openBooking(id)
    },
    [
      blocks,
      bookingModal,
      cal,
      confirm,
      mgmt,
      resolveEventSchedulingContext,
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

      // Gated on having ANY bookable location, not on one being filtered to:
      // all-locations is now the default view, and refusing to create there
      // would make the default view read-only.
      if (!loc.anchorLocation) {
        showTemporaryError(NO_LOCATION_SELECTED_MESSAGE)
        return
      }

      const y = clientY - columnTop
      const minutes = snapMinutes(y / PX_PER_MINUTE, loc.activeStepMinutes)
      const timeZone = resolveActiveCalendarTimeZone()
      const startUtc = utcFromDayAndMinutesInTimeZone(day, minutes, timeZone)

      setCreateChoiceStart(startUtc)
    },
    [
      blocks.blockCreateOpen,
      blocks.editBlockOpen,
      bookingModal.openBookingId,
      confirm.confirmOpen,
      confirm.pendingChange,
      loc.anchorLocation,
      loc.activeStepMinutes,
      mgmt.managementOpen,
      resolveActiveCalendarTimeZone,
      showTemporaryError,
    ],
  )

  const closeCreateChoice = useCallback((): void => {
    setCreateChoiceStart(null)
  }, [])

  const chooseCreateAppointment = useCallback((): void => {
    if (!createChoiceStart) return

    setCreateChoiceStart(null)

    if (!loc.anchorLocation) {
      showTemporaryError(NO_LOCATION_SELECTED_MESSAGE)
      return
    }

    const timeZone = resolveActiveCalendarTimeZone()
    const scheduledAt = toDatetimeLocalValueInTimeZone(
      createChoiceStart,
      timeZone,
    )

    router.push(
      `/pro/bookings/new?${buildNewBookingQuery({
        locationId: loc.activeLocationId,
        locationType: loc.activeLocationType,
        scheduledAt,
      })}`,
    )
  }, [
    createChoiceStart,
    loc.activeLocationId,
    loc.activeLocationType,
    loc.anchorLocation,
    resolveActiveCalendarTimeZone,
    router,
    showTemporaryError,
  ])

  const chooseCreateBlock = useCallback((): void => {
    if (!createChoiceStart) return

    setCreateChoiceStart(null)

    blocks.setBlockCreateInitialStart(createChoiceStart)
    blocks.setBlockCreateOpen(true)
  }, [blocks, createChoiceStart])

  const openCreateAppointment = useCallback((): void => {
    if (
      confirm.confirmOpen ||
      confirm.pendingChange ||
      bookingModal.openBookingId
    ) {
      return
    }

    if (mgmt.managementOpen) return
    if (blocks.blockCreateOpen || blocks.editBlockOpen) return

    if (!loc.anchorLocation) {
      showTemporaryError(NO_LOCATION_SELECTED_MESSAGE)
      return
    }

    // Seed the new-booking form to the viewed day at the next open step (never a
    // past time when viewing today). The route + intercept modal read this via
    // the `scheduledAt` query param.
    const timeZone = resolveActiveCalendarTimeZone()
    const startUtc = nextStepStartFromNow({
      now: new Date(),
      day: currentDate,
      timeZone,
      stepMinutes: loc.activeStepMinutes,
    })
    const scheduledAt = toDatetimeLocalValueInTimeZone(startUtc, timeZone)

    router.push(
      `/pro/bookings/new?${buildNewBookingQuery({
        locationId: loc.activeLocationId,
        locationType: loc.activeLocationType,
        scheduledAt,
      })}`,
    )
  }, [
    blocks.blockCreateOpen,
    blocks.editBlockOpen,
    bookingModal.openBookingId,
    confirm.confirmOpen,
    confirm.pendingChange,
    currentDate,
    loc.activeLocationId,
    loc.activeLocationType,
    loc.anchorLocation,
    loc.activeStepMinutes,
    mgmt.managementOpen,
    resolveActiveCalendarTimeZone,
    router,
    showTemporaryError,
  ])

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

    // All-locations view (K3): no filter, every location's occupancy at once.
    isAllLocations: loc.isAllLocations,
    // Where a create action lands when nothing is filtered. Named separately
    // from the filter so no surface can mistake one for the other.
    createLocationId: loc.anchorLocation?.id ?? null,
    createLocationLabel: loc.anchorLocationLabel,
    // Per-location chip labels for event cards; empty unless the grid mixes
    // locations.
    eventLocationLabels: loc.eventLocationLabels,

    editBlockTimeZone: editBlockContext?.timeZone ?? null,
    editBlockStepMinutes: editBlockContext?.stepMinutes ?? null,

    professionalId: cal.professionalId,

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
    startSession: bookingModal.startSession,

    bookingOverridePrompt: bookingModal.bookingOverridePrompt,
    bookingOverrideIntent: bookingModal.bookingOverrideIntent,
    bookingOverrideReason: bookingModal.bookingOverrideReason,
    setBookingOverrideReason: bookingModal.setBookingOverrideReason,
    confirmBookingOverride: bookingModal.confirmBookingOverride,
    cancelBookingOverride: bookingModal.cancelBookingOverride,

    approveBookingById: mgmt.approveBookingById,
    denyBookingById: mgmt.denyBookingById,
    managementActionBusyId: mgmt.managementActionBusyId,
    managementActionError: mgmt.managementActionError,

    managementOverridePrompt: mgmt.managementOverridePrompt,
    managementOverrideBusy: mgmt.managementOverrideBusy,
    managementOverrideReason: mgmt.managementOverrideReason,
    setManagementOverrideReason: mgmt.setManagementOverrideReason,
    confirmManagementOverride: mgmt.confirmManagementOverride,
    cancelManagementOverride: mgmt.cancelManagementOverride,

    openBookingOrBlock,
    closeBooking: bookingModal.closeBooking,

    pendingChange: confirm.pendingChange,
    confirmOpen: confirm.confirmOpen,
    applyingChange: confirm.applyingChange,
    cancelConfirm: confirm.cancelConfirm,
    applyConfirm: confirm.applyConfirm,
    pendingOutsideWorkingHours: confirm.pendingOutsideWorkingHours,
    pendingOverlapName: confirm.pendingOverlapName,
    overrideReason: confirm.overrideReason,
    setOverrideReason: confirm.setOverrideReason,

    changeOverridePrompt: confirm.changeOverridePrompt,
    changeOverrideReason: confirm.changeOverrideReason,
    setChangeOverrideReason: confirm.setChangeOverrideReason,
    confirmChangeOverride: confirm.confirmChangeOverride,
    cancelChangeOverride: confirm.cancelChangeOverride,

    ui: {
      suppressClickRef: dragDrop.ui.suppressClickRef,
      suppressClickBriefly: dragDrop.ui.suppressClickBriefly,
      isOverlayOpen,
    },

    drag: dragDrop.drag,
    resize: dragDrop.resize,

    openCreateForClick,
    openCreateAppointment,

    createChoiceStart,
    closeCreateChoice,
    chooseCreateAppointment,
    chooseCreateBlock,

    utils,

    reload: cal.reload,
  }
}

export type CalendarData = ReturnType<typeof useCalendarData>