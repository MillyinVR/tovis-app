// app/pro/calendar/_components/BookingModal.tsx
'use client'

import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'

import type { BookingDetails, ServiceOption } from '../_types'

import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'

import {
  calendarStatusMeta,
  eventBadgeClassName,
} from '../_utils/statusStyles'

// ─── Types ────────────────────────────────────────────────────────────────────

type BookingModalProps = {
  open: boolean
  loading: boolean
  error: string | null
  booking: BookingDetails | null
  services: ServiceOption[]
  appointmentTimeZone: string

  bookingServiceLabel?: string
  serviceItemsDraft?: BookingDetails['serviceItems']
  selectedDraftServiceIds: string[]
  hasDraftServiceItemsChanges?: boolean

  reschedDate: string
  reschedTime: string
  durationMinutes: number
  notifyClient: boolean
  allowOutsideHours: boolean
  editOutside: boolean
  saving: boolean

  onClose: () => void
  onChangeReschedDate: (value: string) => void
  onChangeReschedTime: (value: string) => void
  onChangeSelectedDraftServiceIds: (ids: string[]) => void
  onToggleNotifyClient: (value: boolean) => void
  onToggleAllowOutsideHours: (value: boolean) => void
  onSave: () => void
  onApprove: () => void
  onDeny: () => void
}

type BookingLocationMeta = {
  address: string | null
  lat: number | null
  lng: number | null
}

type ButtonTone = 'primary' | 'default' | 'danger' | 'ghost'

type BookingModalFrameProps = {
  saving: boolean
  onClose: () => void
  children: ReactNode
}

type ModalHeaderProps = {
  booking: BookingDetails | null
  bookingLabel: string
  modeLabel: string
  saving: boolean
  onClose: () => void
}

type ModalFooterProps = {
  booking: BookingDetails | null
  saving: boolean
  canSave: boolean
  noServicesSelected: boolean
  saveBlockedByOutsideHours: boolean
  onClose: () => void
  onSave: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DURATION_MINUTES = 60
const TIME_INPUT_STEP_SECONDS = 15 * 60

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readBookingLocationMeta(
  booking: BookingDetails | null,
): BookingLocationMeta {
  if (!booking) {
    return {
      address: null,
      lat: null,
      lng: null,
    }
  }

  return {
    address: normalizeText(booking.locationAddressSnapshot) || null,
    lat:
      typeof booking.locationLatSnapshot === 'number' &&
      Number.isFinite(booking.locationLatSnapshot)
        ? booking.locationLatSnapshot
        : null,
    lng:
      typeof booking.locationLngSnapshot === 'number' &&
      Number.isFinite(booking.locationLngSnapshot)
        ? booking.locationLngSnapshot
        : null,
  }
}

function mapsHref(location: BookingLocationMeta): string | null {
  if (location.lat !== null && location.lng !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${location.lat},${location.lng}`,
    )}`
  }

  if (location.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      location.address,
    )}`
  }

  return null
}

function messageHrefForBooking(bookingId: string): string {
  return `/messages/start?contextType=BOOKING&contextId=${encodeURIComponent(
    bookingId,
  )}`
}

function locationModeLabel(
  locationType: BookingDetails['locationType'] | null | undefined,
): string {
  return locationType === 'MOBILE' ? 'Mobile' : 'In-salon'
}

function isPendingBooking(booking: BookingDetails | null): boolean {
  return booking?.status.toUpperCase() === 'PENDING'
}

function durationForBooking(args: {
  durationMinutes: number
  booking: BookingDetails | null
}): number {
  const { durationMinutes, booking } = args

  if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return durationMinutes
  }

  if (
    typeof booking?.totalDurationMinutes === 'number' &&
    Number.isFinite(booking.totalDurationMinutes) &&
    booking.totalDurationMinutes > 0
  ) {
    return booking.totalDurationMinutes
  }

  return DEFAULT_DURATION_MINUTES
}

function formatMoneySnapshot(value: string | null | undefined): string | null {
  const trimmed = normalizeText(value)
  if (!trimmed) return null

  return trimmed.startsWith('$') ? trimmed : `$${trimmed}`
}

function buildBookingLabel(args: {
  bookingServiceLabel?: string
  items: BookingDetails['serviceItems']
}): string {
  const explicitLabel = normalizeText(args.bookingServiceLabel)
  if (explicitLabel) return explicitLabel

  const itemNames = args.items
    .map((item) => normalizeText(item.serviceName))
    .filter((name) => name.length > 0)

  return itemNames.length > 0 ? itemNames.join(' + ') : 'Appointment'
}

function saveButtonTitle(args: {
  noServicesSelected: boolean
  saveBlockedByOutsideHours: boolean
}): string {
  if (args.noServicesSelected) {
    return 'Select at least one service before saving.'
  }

  if (args.saveBlockedByOutsideHours) {
    return 'Enable override to save outside working hours.'
  }

  return ''
}

function buttonClassName(tone: ButtonTone = 'default'): string {
  const base = [
    'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')

  if (tone === 'primary') {
    return [
      base,
      'border border-accentPrimary/30 bg-accentPrimary text-ink hover:bg-accentPrimaryHover',
    ].join(' ')
  }

  if (tone === 'danger') {
    return [
      base,
      'border border-toneDanger/30 bg-toneDanger/10 text-toneDanger hover:bg-toneDanger/15',
    ].join(' ')
  }

  if (tone === 'ghost') {
    return [
      base,
      'border border-[var(--line)] bg-transparent text-paperMute',
      'hover:bg-paper/5 hover:text-paper',
    ].join(' ')
  }

  return [
    base,
    'border border-[var(--line)] bg-paper/[0.04] text-paper hover:bg-paper/[0.07]',
  ].join(' ')
}

function fieldClassName(): string {
  return [
    'w-full rounded-xl border border-[var(--line)] bg-ink2 px-3 py-2',
    'text-sm font-semibold text-paper',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')
}

function checkboxClassName(): string {
  return [
    'h-4 w-4 rounded border-[var(--line)] bg-ink2',
    'accent-accentPrimary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
  ].join(' ')
}

function lockBodyScroll(open: boolean): (() => void) | undefined {
  if (!open) return undefined

  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  return () => {
    document.body.style.overflow = previousOverflow
  }
}

function closeOnEscape(args: {
  open: boolean
  saving: boolean
  onClose: () => void
}): (() => void) | undefined {
  const { open, saving, onClose } = args

  if (!open) return undefined

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !saving) {
      onClose()
    }
  }

  window.addEventListener('keydown', onKeyDown)

  return () => window.removeEventListener('keydown', onKeyDown)
}

// ─── Exported component ───────────────────────────────────────────────────────

export function BookingModal(props: BookingModalProps) {
  const {
    open,
    loading,
    error,
    booking,
    services,
    appointmentTimeZone,

    bookingServiceLabel,
    serviceItemsDraft,
    selectedDraftServiceIds,
    hasDraftServiceItemsChanges,

    reschedDate,
    reschedTime,
    durationMinutes,
    notifyClient,
    allowOutsideHours,
    editOutside,
    saving,

    onClose,
    onChangeReschedDate,
    onChangeReschedTime,
    onChangeSelectedDraftServiceIds,
    onToggleNotifyClient,
    onToggleAllowOutsideHours,
    onSave,
    onApprove,
    onDeny,
  } = props

  const timeZone = useMemo(
    () =>
      sanitizeTimeZone(
        booking?.timeZone ?? appointmentTimeZone,
        DEFAULT_TIME_ZONE,
      ),
    [appointmentTimeZone, booking?.timeZone],
  )

  const serviceItems = useMemo(
    () =>
      Array.isArray(serviceItemsDraft)
        ? serviceItemsDraft
        : booking?.serviceItems ?? [],
    [booking?.serviceItems, serviceItemsDraft],
  )

  const bookingLabel = useMemo(
    () =>
      buildBookingLabel({
        bookingServiceLabel,
        items: serviceItems,
      }),
    [bookingServiceLabel, serviceItems],
  )

  const selectedServiceIds = useMemo(
    () => new Set(selectedDraftServiceIds),
    [selectedDraftServiceIds],
  )

  const locationMeta = useMemo(
    () => readBookingLocationMeta(booking),
    [booking],
  )

  const mapsUrl = useMemo(() => mapsHref(locationMeta), [locationMeta])

  const totalDuration = durationForBooking({ durationMinutes, booking })
  const modeLabel = locationModeLabel(booking?.locationType)
  const isPending = isPendingBooking(booking)
  const noServicesSelected = selectedDraftServiceIds.length === 0
  const saveBlockedByOutsideHours = editOutside && !allowOutsideHours

  const canSave =
    Boolean(booking) &&
    !saving &&
    !noServicesSelected &&
    !saveBlockedByOutsideHours

  useEffect(() => lockBodyScroll(open), [open])

  useEffect(
    () =>
      closeOnEscape({
        open,
        saving,
        onClose,
      }),
    [open, saving, onClose],
  )

  function close(): void {
    if (saving) return
    onClose()
  }

  function toggleService(serviceId: string, checked: boolean): void {
    if (
      !checked &&
      selectedDraftServiceIds.length === 1 &&
      selectedDraftServiceIds[0] === serviceId
    ) {
      return
    }

    if (checked) {
      const next = Array.from(new Set([...selectedDraftServiceIds, serviceId]))
      onChangeSelectedDraftServiceIds(next)
      return
    }

    onChangeSelectedDraftServiceIds(
      selectedDraftServiceIds.filter((id) => id !== serviceId),
    )
  }

  if (!open) return null

  return (
    <BookingModalFrame saving={saving} onClose={close}>
      <ModalHeader
        booking={booking}
        bookingLabel={bookingLabel}
        modeLabel={modeLabel}
        saving={saving}
        onClose={close}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        {loading ? <StateCard>Loading booking…</StateCard> : null}

        {error ? <StateCard danger>{error}</StateCard> : null}

        {!loading && !booking ? (
          <StateCard>Booking details are not available.</StateCard>
        ) : null}

        {booking ? (
          <div className="grid gap-5">
            <BookingSummary
              booking={booking}
              bookingLabel={bookingLabel}
              timeZone={timeZone}
              totalDuration={totalDuration}
              modeLabel={modeLabel}
              locationMeta={locationMeta}
              mapsUrl={mapsUrl}
            />

            {isPending ? (
              <PendingRequestSection
                saving={saving}
                onApprove={onApprove}
                onDeny={onDeny}
              />
            ) : null}

            <section className="rounded-2xl border border-[var(--line)] bg-paper/[0.03] p-4">
              <SectionHeading
                title="Edit appointment"
                description="Change the appointment time, services, and client notification settings."
              />

              {editOutside ? (
                <OutsideHoursNotice
                  allowOutsideHours={allowOutsideHours}
                  saving={saving}
                  onToggleAllowOutsideHours={onToggleAllowOutsideHours}
                />
              ) : null}

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Date">
                  <input
                    type="date"
                    value={reschedDate}
                    onChange={(event) =>
                      onChangeReschedDate(event.target.value)
                    }
                    disabled={saving}
                    className={fieldClassName()}
                  />
                </Field>

                <Field label="Time">
                  <input
                    type="time"
                    step={TIME_INPUT_STEP_SECONDS}
                    value={reschedTime}
                    onChange={(event) =>
                      onChangeReschedTime(event.target.value)
                    }
                    disabled={saving}
                    className={fieldClassName()}
                  />
                </Field>
              </div>

              <ServicePicker
                services={services}
                selectedServiceIds={selectedServiceIds}
                selectedDraftServiceIds={selectedDraftServiceIds}
                saving={saving}
                onToggleService={toggleService}
              />

              <CurrentServiceItems
                items={serviceItems}
                hasChanges={Boolean(hasDraftServiceItemsChanges)}
              />

              <AppointmentEditFooter
                totalDuration={totalDuration}
                notifyClient={notifyClient}
                saving={saving}
                onToggleNotifyClient={onToggleNotifyClient}
              />

              {noServicesSelected ? (
                <StateCard danger>
                  Select at least one service before saving.
                </StateCard>
              ) : null}

              {saveBlockedByOutsideHours ? (
                <StateCard danger>
                  Enable the outside-hours override before saving.
                </StateCard>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>

      <ModalFooter
        booking={booking}
        saving={saving}
        canSave={canSave}
        noServicesSelected={noServicesSelected}
        saveBlockedByOutsideHours={saveBlockedByOutsideHours}
        onClose={close}
        onSave={onSave}
      />
    </BookingModalFrame>
  )
}

// ─── Frame components ─────────────────────────────────────────────────────────

function BookingModalFrame(props: BookingModalFrameProps) {
  const { saving, onClose, children } = props

  return (
    <div
      className="fixed inset-0 z-[999] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onMouseDown={() => {
        if (!saving) onClose()
      }}
    >
      <div
        className={[
          'flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[24px]',
          'border border-[var(--line-strong)] bg-ink',
          'shadow-[0_28px_90px_rgb(0_0_0_/_0.62)]',
          'sm:max-w-[52rem] sm:rounded-[24px]',
        ].join(' ')}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
      >
        {children}
      </div>
    </div>
  )
}

function ModalHeader(props: ModalHeaderProps) {
  const { booking, bookingLabel, modeLabel, saving, onClose } = props

  const statusMeta = booking
    ? calendarStatusMeta({
        status: booking.status,
        isBlocked: false,
      })
    : null

  return (
    <header className="border-b border-[var(--line-strong)] bg-ink/95 px-4 py-4 backdrop-blur-xl sm:px-5">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-paper/20 sm:hidden" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-terraGlow">
            ◆ Appointment
          </p>

          <h2
            id="booking-modal-title"
            className="mt-1 truncate font-display text-3xl font-semibold italic tracking-[-0.05em] text-paper"
          >
            {booking ? bookingLabel : 'Appointment details'}
          </h2>

          {booking && statusMeta ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[var(--line)] bg-paper/[0.04] px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-[0.08em] text-paper">
                {modeLabel}
              </span>

              <span
                className={[
                  'rounded-full border px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-[0.08em]',
                  eventBadgeClassName({
                    status: booking.status,
                    isBlocked: false,
                  }),
                ].join(' ')}
              >
                {statusMeta.label}
              </span>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className={buttonClassName('ghost')}
          aria-label="Close appointment details"
        >
          Close
        </button>
      </div>
    </header>
  )
}

function ModalFooter(props: ModalFooterProps) {
  const {
    booking,
    saving,
    canSave,
    noServicesSelected,
    saveBlockedByOutsideHours,
    onClose,
    onSave,
  } = props

  return (
    <footer className="border-t border-[var(--line-strong)] bg-ink/95 px-4 py-4 backdrop-blur-xl sm:px-5">
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {booking ? (
          <a
            href={messageHrefForBooking(booking.id)}
            className={buttonClassName('ghost')}
          >
            Message client
          </a>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className={buttonClassName('ghost')}
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className={buttonClassName('primary')}
          title={saveButtonTitle({
            noServicesSelected,
            saveBlockedByOutsideHours,
          })}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </footer>
  )
}

// ─── Content components ───────────────────────────────────────────────────────

function BookingSummary(props: {
  booking: BookingDetails
  bookingLabel: string
  timeZone: string
  totalDuration: number
  modeLabel: string
  locationMeta: BookingLocationMeta
  mapsUrl: string | null
}) {
  const {
    booking,
    bookingLabel,
    timeZone,
    totalDuration,
    modeLabel,
    locationMeta,
    mapsUrl,
  } = props

  const subtotal = formatMoneySnapshot(booking.subtotalSnapshot)

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-paper/[0.03] p-4">
      <SectionHeading
        title={bookingLabel}
        description="Client, timing, location, and payment snapshot."
      />

      <div className="mt-4 grid gap-3">
        <SummaryRow label="Client">
          {booking.client.fullName}
          {booking.client.email ? ` · ${booking.client.email}` : ''}
          {booking.client.phone ? ` · ${booking.client.phone}` : ''}
        </SummaryRow>

        <SummaryRow label="When">
          {formatAppointmentWhen(new Date(booking.scheduledFor), timeZone)} ·{' '}
          {timeZone} · {totalDuration} min
        </SummaryRow>

        <SummaryRow label="Mode">{modeLabel}</SummaryRow>

        {booking.locationType === 'MOBILE' ? (
          <MobileDestination locationMeta={locationMeta} mapsUrl={mapsUrl} />
        ) : null}

        {subtotal ? <SummaryRow label="Subtotal">{subtotal}</SummaryRow> : null}
      </div>
    </section>
  )
}

function MobileDestination(props: {
  locationMeta: BookingLocationMeta
  mapsUrl: string | null
}) {
  const { locationMeta, mapsUrl } = props

  return (
    <div className="rounded-xl border border-[var(--line)] bg-ink2 p-3">
      <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
        Mobile destination
      </p>

      <p className="mt-1 text-sm font-semibold text-paper">
        {locationMeta.address ||
          'Address will appear here when booking location snapshots are returned.'}
      </p>

      {mapsUrl ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className={['mt-3 inline-flex', buttonClassName()].join(' ')}
        >
          Open in Maps
        </a>
      ) : null}
    </div>
  )
}

function PendingRequestSection(props: {
  saving: boolean
  onApprove: () => void
  onDeny: () => void
}) {
  const { saving, onApprove, onDeny } = props

  return (
    <section className="rounded-2xl border border-tonePending/25 bg-tonePending/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-tonePending">
            Pending request
          </p>

          <p className="mt-1 text-sm leading-6 text-paperDim">
            Approve this booking or deny it from here.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDeny}
            disabled={saving}
            className={buttonClassName('danger')}
          >
            Deny
          </button>

          <button
            type="button"
            onClick={onApprove}
            disabled={saving}
            className={buttonClassName('primary')}
          >
            Approve
          </button>
        </div>
      </div>
    </section>
  )
}

function AppointmentEditFooter(props: {
  totalDuration: number
  notifyClient: boolean
  saving: boolean
  onToggleNotifyClient: (value: boolean) => void
}) {
  const { totalDuration, notifyClient, saving, onToggleNotifyClient } = props

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="rounded-xl border border-[var(--line)] bg-ink2 px-3 py-2">
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
          Total duration
        </p>

        <p className="mt-1 text-sm font-black text-paper">
          {totalDuration} minutes
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold text-paperDim">
        <input
          type="checkbox"
          checked={notifyClient}
          onChange={(event) => onToggleNotifyClient(event.target.checked)}
          disabled={saving}
          className={checkboxClassName()}
        />
        Notify client about changes
      </label>
    </div>
  )
}

// ─── Shared content pieces ────────────────────────────────────────────────────

function SectionHeading(props: {
  title: string
  description?: string
}) {
  const { title, description } = props

  return (
    <div>
      <h3 className="font-display text-2xl font-semibold italic tracking-[-0.04em] text-paper">
        {title}
      </h3>

      {description ? (
        <p className="mt-1 text-sm leading-6 text-paperDim">
          {description}
        </p>
      ) : null}
    </div>
  )
}

function SummaryRow(props: {
  label: string
  children: ReactNode
}) {
  const { label, children } = props

  return (
    <div className="rounded-xl border border-[var(--line)] bg-ink2 px-3 py-2 text-sm font-semibold text-paperDim">
      <span className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
        {label}
      </span>

      <div className="mt-1 text-paper">{children}</div>
    </div>
  )
}

function Field(props: {
  label: string
  children: ReactNode
}) {
  const { label, children } = props

  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
        {label}
      </span>

      {children}
    </label>
  )
}

function OutsideHoursNotice(props: {
  allowOutsideHours: boolean
  saving: boolean
  onToggleAllowOutsideHours: (value: boolean) => void
}) {
  const { allowOutsideHours, saving, onToggleAllowOutsideHours } = props

  return (
    <div className="mt-4 rounded-2xl border border-toneWarn/25 bg-toneWarn/10 p-3">
      <p className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-toneWarn">
        Outside working hours
      </p>

      <p className="mt-1 text-sm leading-6 text-paperDim">
        This change falls outside your configured hours. You can still schedule
        it with a pro override.
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-paperDim">
        <input
          type="checkbox"
          checked={allowOutsideHours}
          onChange={(event) =>
            onToggleAllowOutsideHours(event.target.checked)
          }
          disabled={saving}
          className={checkboxClassName()}
        />
        Allow outside working hours
      </label>
    </div>
  )
}

function ServicePicker(props: {
  services: ServiceOption[]
  selectedServiceIds: Set<string>
  selectedDraftServiceIds: string[]
  saving: boolean
  onToggleService: (serviceId: string, checked: boolean) => void
}) {
  const {
    services,
    selectedServiceIds,
    selectedDraftServiceIds,
    saving,
    onToggleService,
  } = props

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
          Select services
        </p>

        <span className="font-mono text-[9px] font-black uppercase tracking-[0.08em] text-paperMute">
          {selectedDraftServiceIds.length} selected
        </span>
      </div>

      {services.length > 0 ? (
        <ServiceOptionList
          services={services}
          selectedServiceIds={selectedServiceIds}
          saving={saving}
          onToggleService={onToggleService}
        />
      ) : (
        <StateCard>No active services available for this booking type.</StateCard>
      )}
    </div>
  )
}

function ServiceOptionList(props: {
  services: ServiceOption[]
  selectedServiceIds: Set<string>
  saving: boolean
  onToggleService: (serviceId: string, checked: boolean) => void
}) {
  const { services, selectedServiceIds, saving, onToggleService } = props

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-ink2 p-3">
      <div className="grid gap-2">
        {services.map((service) => {
          const checked = selectedServiceIds.has(service.id)

          const duration =
            typeof service.durationMinutes === 'number' &&
            Number.isFinite(service.durationMinutes) &&
            service.durationMinutes > 0
              ? service.durationMinutes
              : null

          const price = formatMoneySnapshot(service.priceStartingAt)

          return (
            <label
              key={service.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-paper/[0.025] px-3 py-2"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  onToggleService(service.id, event.target.checked)
                }
                disabled={saving}
                className={checkboxClassName()}
              />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black text-paper">
                  {service.name}
                </span>

                <span className="block text-xs font-semibold text-paperMute">
                  {duration !== null ? `${duration} min` : 'Duration not set'}
                  {price ? ` · ${price}` : ''}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function CurrentServiceItems(props: {
  items: BookingDetails['serviceItems']
  hasChanges: boolean
}) {
  const { items, hasChanges } = props

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
          Current service items
        </p>

        {hasChanges ? (
          <span className="rounded-full border border-[var(--line)] bg-paper/[0.04] px-2 py-1 font-mono text-[9px] font-black uppercase tracking-[0.08em] text-paper">
            Unsaved changes
          </span>
        ) : null}
      </div>

      {items.length > 0 ? (
        <CurrentServiceItemList items={items} />
      ) : (
        <StateCard>No service items selected.</StateCard>
      )}
    </div>
  )
}

function CurrentServiceItemList(props: {
  items: BookingDetails['serviceItems']
}) {
  const { items } = props

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-ink2 p-3">
      <div className="grid gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-paper/[0.025] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-paper">
                {item.serviceName}
              </p>

              <p className="text-xs font-semibold text-paperMute">
                {item.itemType === 'BASE' ? 'Base service' : 'Add-on'}
              </p>
            </div>

            <div className="shrink-0 text-right text-xs font-semibold text-paperMute">
              <p>{item.durationMinutesSnapshot} min</p>
              <p>{formatMoneySnapshot(item.priceSnapshot)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StateCard(props: {
  children: ReactNode
  danger?: boolean
}) {
  const { children, danger = false } = props

  return (
    <div
      className={[
        'rounded-2xl border px-3 py-3 text-sm font-semibold',
        danger
          ? 'border-toneDanger/30 bg-toneDanger/10 text-toneDanger'
          : 'border-[var(--line)] bg-paper/[0.03] text-paperDim',
      ].join(' ')}
    >
      {children}
    </div>
  )
}