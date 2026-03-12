// app/pro/calendar/_hooks/useCalendarData.ts
//
// Thin orchestrator that composes focused hooks into the same flat
// return shape consumed by page.tsx and its child components.
'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CalendarEvent,
  EntityType,
  ViewMode,
  WorkingHoursJson,
} from '../_types'
import { startOfMonth, startOfWeek } from '../_utils/date'
import {
  normalizeStepMinutes,
  computeDurationMinutesFromIso,
  isBlockedEvent,
} from '../_utils/calendarMath'
import {
  locationTypeFromProfessionalType,
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

type Args = { view: ViewMode; currentDate: Date }

/** must match ProSessionFooter/useProSession.ts */
const PRO_SESSION_FORCE_EVENT = 'tovis:pro-session:force'

function forceProFooterRefresh() {
  try {
    window.dispatchEvent(new Event(PRO_SESSION_FORCE_EVENT))
  } catch {
    // ignore
  }
}

function eventDurationMinutes(ev: CalendarEvent) {
  return typeof ev.durationMinutes === 'number' &&
    Number.isFinite(ev.durationMinutes) &&
    ev.durationMinutes > 0
    ? ev.durationMinutes
    : computeDurationMinutesFromIso(ev.startsAt, ev.endsAt)
}

export function useCalendarData({ view, currentDate }: Args) {
  const router = useRouter()

  // ── Locations ─────────────────────────────────────────────────────

  const loc = useCalendarLocations()

  function resolveActiveCalendarTimeZone(fallback?: string) {
    const fallbackTz = sanitizeTimeZone(
      fallback ?? cal.timeZoneRef.current,
      DEFAULT_TIME_ZONE,
    )

    if (loc.activeLocation?.timeZone && isValidIanaTimeZone(loc.activeLocation.timeZone)) {
      return sanitizeTimeZone(loc.activeLocation.timeZone, fallbackTz)
    }

    return fallbackTz
  }

  function resolveBookingSchedulingContext(args: {
    locationId: string | null
    locationType: LocationType
    fallbackTimeZone: string
  }) {
    const location = loc.resolveLocationById(args.locationId)

    const resolvedTimeZone =
      location?.timeZone && isValidIanaTimeZone(location.timeZone)
        ? sanitizeTimeZone(location.timeZone, args.fallbackTimeZone)
        : sanitizeTimeZone(args.fallbackTimeZone, DEFAULT_TIME_ZONE)

    const resolvedWorkingHours =
      location?.workingHours ??
      (args.locationType === 'MOBILE' ? cal.workingHoursMobile : cal.workingHoursSalon)

    const resolvedStepMinutes = normalizeStepMinutes(location?.stepMinutes)

    return {
      timeZone: resolvedTimeZone,
      workingHours: resolvedWorkingHours,
      stepMinutes: resolvedStepMinutes,
    }
  }

  function resolveEventSchedulingContext(ev: CalendarEvent) {
    if (ev.kind === 'BOOKING') {
      return resolveBookingSchedulingContext({
        locationId: ev.locationId ?? null,
        locationType: locationTypeFromBookingValue(ev.locationType),
        fallbackTimeZone: cal.timeZoneRef.current,
      })
    }

    if (ev.locationId) {
      return resolveBookingSchedulingContext({
        locationId: ev.locationId,
        locationType: loc.resolveLocationTypeFromId(ev.locationId, loc.activeLocationType),
        fallbackTimeZone: cal.timeZoneRef.current,
      })
    }

    return {
      timeZone: sanitizeTimeZone(cal.timeZoneRef.current, DEFAULT_TIME_ZONE),
      workingHours: cal.workingHoursActive,
      stepMinutes: loc.activeStepMinutes,
    }
  }

  // ── Calendar fetch ────────────────────────────────────────────────

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

  // ── Services (load when active location type changes) ─────────────

  useEffect(() => {
    void bookingModal.loadServicesForLocation(loc.activeLocationType)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.activeLocationType])

  // ── Confirm change (drag/resize) ─────────────────────────────────

  const confirm = useConfirmChange({
    eventsRef: cal.eventsRef,
    setEvents: cal.setEvents,
    resolveBookingSchedulingContext,
    timeZoneRef: cal.timeZoneRef,
    reloadCalendar: cal.loadCalendar,
    forceProFooterRefresh,
    setError: cal.setError,
  })

  // ── Drag & drop / resize ─────────────────────────────────────────

  const dragDrop = useDragDrop({
    eventsRef: cal.eventsRef,
    setEvents: cal.setEvents,
    resolveEventSchedulingContext,
    activeStepMinutes: loc.activeStepMinutes,
    openConfirm: confirm.openConfirm,
  })

  // ── Block actions ─────────────────────────────────────────────────

  const blocks = useBlockActions({
    activeLocationId: loc.activeLocationId,
    activeStepMinutes: loc.activeStepMinutes,
    resolveActiveCalendarTimeZone,
    reloadCalendar: cal.loadCalendar,
    forceProFooterRefresh,
    setError: cal.setError,
    setLoading: cal.setLoading,
  })

  // ── Management panel ──────────────────────────────────────────────

  const mgmt = useManagementPanel({
    eventsRef: cal.eventsRef,
    reloadCalendar: cal.loadCalendar,
    forceProFooterRefresh,
  })

  // Sync management data from calendar fetch
  useEffect(() => {
    mgmt.setManagement(cal.management)
  }, [cal.management])

  // ── Booking modal ─────────────────────────────────────────────────

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

  // ── Shared UI state ──────────────────────────────────────────────

  const [showHoursForm, setShowHoursForm] = useMemo(() => {
    // This needs to be regular state, not a memo. Use the pattern from below.
    return [false, () => {}] as const
  }, [])

  // ── Composite helpers ─────────────────────────────────────────────

  function openBookingOrBlock(id: string) {
    const ev = cal.eventsRef.current.find((x) => x.id === id)
    if (ev && isBlockedEvent(ev)) {
      const locationId = blocks.openEditBlockFromEvent(ev)
      if (locationId) {
        loc.setActiveLocationId(locationId)
      }
      return
    }

    if (confirm.confirmOpen || confirm.pendingChange) return
    if (mgmt.managementOpen) return
    if (blocks.blockCreateOpen || blocks.editBlockOpen) return

    void bookingModal.openBooking(id)
  }

  function openCreateForClick(day: Date, clientY: number, columnTop: number) {
    if (confirm.confirmOpen || confirm.pendingChange || bookingModal.openBookingId) return
    if (mgmt.managementOpen) return
    if (blocks.blockCreateOpen || blocks.editBlockOpen) return

    if (!loc.activeLocationId) {
      cal.setError('Select a location first.')
      window.setTimeout(() => cal.setError(null), 3000)
      return
    }

    const { snapMinutes } = require('../_utils/calendarMath')
    const y = clientY - columnTop
    const mins = snapMinutes(y / 1.5, loc.activeStepMinutes) // PX_PER_MINUTE = 1.5
    const tz = resolveActiveCalendarTimeZone()

    const startUtc = utcFromDayAndMinutesInTimeZone(day, mins, tz)
    const scheduledAt = toDatetimeLocalValueInTimeZone(startUtc, tz)

    const qs = new URLSearchParams({
      locationId: loc.activeLocationId,
      locationType: loc.activeLocationType,
      scheduledAt,
    })

    router.push(`/pro/bookings/new?${qs.toString()}`)
  }

  const isOverlayOpen = Boolean(
    confirm.confirmOpen ||
      confirm.pendingChange ||
      bookingModal.openBookingId ||
      mgmt.managementOpen ||
      blocks.blockCreateOpen ||
      blocks.editBlockOpen,
  )

  const utils = useMemo(
    () => ({
      startOfWeek,
      startOfMonth,
    }),
    [],
  )

  // ── Return the same flat shape consumed by page.tsx ───────────────

  return {
    view,
    currentDate,
    events: cal.events,
    setEvents: cal.setEvents,

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
