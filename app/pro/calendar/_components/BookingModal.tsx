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

const DEFAULT_DURATION_MINUTES = 60
const TIME_INPUT_STEP_SECONDS = 15 * 60

function normalizeText(value: string | null | undefined) {
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

function mapsHref(location: BookingLocationMeta) {
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

function messageHrefForBooking(bookingId: string) {
  return `/messages/start?contextType=BOOKING&contextId=${encodeURIComponent(
    bookingId,
  )}`
}

function locationModeLabel(locationType: BookingDetails['locationType']) {
  return locationType === 'MOBILE' ? 'Mobile' : 'In-salon'
}

function isPendingBooking(booking: BookingDetails | null) {
  return booking?.status.toUpperCase() === 'PENDING'
}

function durationForBooking(args: {
  durationMinutes: number
  booking: BookingDetails | null
}) {
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

function formatMoneySnapshot(value: string | null | undefined) {
  const trimmed = normalizeText(value)
  if (!trimmed) return null

  return trimmed.startsWith('$') ? trimmed : `$${trimmed}`
}

function buildBookingLabel(args: {
  bookingServiceLabel?: string
  items: BookingDetails['serviceItems']
}) {
  const explicitLabel = normalizeText(args.bookingServiceLabel)
  if (explicitLabel) return explicitLabel

  const itemNames = args.items
    .map((item) => normalizeText(item.serviceName))
    .filter((name) => name.length > 0)

  return itemNames.length > 0 ? itemNames.join(' + ') : 'Appointment'
}

function buttonClassName(tone: ButtonTone = 'default') {
  const base = [
    'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')

  if (tone === 'primary') {
    return [
      base,
      'border border-accentPrimary/30 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
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
      'border border-[var(--line)] bg-transparent text-[var(--paper-mute)] hover:bg-[var(--paper)]/[0.05] hover:text-[var(--paper)]',
    ].join(' ')
  }

  return [
    base,
    'border border-[var(--line)] bg-[var(--paper)]/[0.04] text-[var(--paper)] hover:bg-[var(--paper)]/[0.07]',
  ].join(' ')
}

function fieldClassName() {
  return [
    'w-full rounded-xl border border-[var(--line)] bg-[var(--ink-2)] px-3 py-2',
    'text-sm font-semibold text-[var(--paper)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')
}

function checkboxClassName() {
  return 'h-4 w-4 rounded border-[var(--line)] bg-[var(--ink-2)]'
}

function lockBodyScroll(open: boolean) {
  if (!open) return

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
}) {
  const { open, saving, onClose } = args

  if (!open) return

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !saving) {
      onClose()
    }
  }

  window.addEventListener('keydown', onKeyDown)

  return () => window.removeEventListener('keydown', onKeyDown)
}

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
    Boolean(booking) && !saving && !noServicesSelected && !saveBlockedByOutsideHours

  const statusMeta = booking
    ? calendarStatusMeta({
        status: booking.status,
        isBlocked: false,
      })
    : null

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

  function close() {
    if (saving) return
    onClose()
  }

  function toggleService(serviceId: string, checked: boolean) {
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
    <div
      className="fixed inset-0 z-[999] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onMouseDown={close}
    >
      <div
        className={[
          'flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[24px]',
          'border border-[var(--line-strong)] bg-[var(--ink)]',
          'shadow-[0_28px_90px_rgb(0_0_0/0.62)]',
          'sm:max-w-[52rem] sm:rounded-[24px]',
        ].join(' ')}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
      >
        <header className="border-b border-[var(--line-strong)] bg-[var(--ink)]/92 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--paper)]/20 sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--terra-glow)]">
                ◆ Appointment
              </p>

              <h2
                id="booking-modal-title"
                className="mt-1 truncate font-display text-3xl font-semibold italic tracking-[-0.05em] text-[var(--paper)]"
              >
                {booking ? bookingLabel : 'Appointment details'}
              </h2>

              {booking && statusMeta ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--line)] bg-[var(--paper)]/[0.04] px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-[0.08em] text-[var(--paper)]">
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
              onClick={close}
              disabled={saving}
              className={buttonClassName('ghost')}
              aria-label="Close appointment details"
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {loading ? (
            <StateCard>Loading booking…</StateCard>
          ) : null}

          {error ? (
            <StateCard danger>{error}</StateCard>
          ) : null}

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
                <section className="rounded-2xl border border-toneWarn/25 bg-toneWarn/10 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-toneWarn">
                        Pending request
                      </p>
                      <p className="mt-1 text-sm leading-6 text-[var(--paper-dim)]">
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
              ) : null}

              <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/[0.03] p-4">
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

                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--ink-2)] px-3 py-2">
                    <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
                      Total duration
                    </p>
                    <p className="mt-1 text-sm font-black text-[var(--paper)]">
                      {totalDuration} minutes
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-sm font-semibold text-[var(--paper-dim)]">
                    <input
                      type="checkbox"
                      checked={notifyClient}
                      onChange={(event) =>
                        onToggleNotifyClient(event.target.checked)
                      }
                      disabled={saving}
                      className={checkboxClassName()}
                    />
                    Notify client about changes
                  </label>
                </div>

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

        <footer className="border-t border-[var(--line-strong)] bg-[var(--ink)]/92 px-4 py-4 backdrop-blur-xl sm:px-5">
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
              onClick={close}
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
              title={
                noServicesSelected
                  ? 'Select at least one service before saving.'
                  : saveBlockedByOutsideHours
                    ? 'Enable override to save outside working hours.'
                    : ''
              }
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

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
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/[0.03] p-4">
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
          <div className="rounded-xl border border-[var(--line)] bg-[var(--ink-2)] p-3">
            <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
              Mobile destination
            </p>

            <p className="mt-1 text-sm font-semibold text-[var(--paper)]">
              {locationMeta.address ||
                'Address will appear here when booking location snapshots are returned.'}
            </p>

            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className={[
                  'mt-3 inline-flex',
                  buttonClassName('default'),
                ].join(' ')}
              >
                Open in Maps
              </a>
            ) : null}
          </div>
        ) : null}

        {subtotal ? <SummaryRow label="Subtotal">{subtotal}</SummaryRow> : null}
      </div>
    </section>
  )
}

function SectionHeading(props: {
  title: string
  description?: string
}) {
  const { title, description } = props

  return (
    <div>
      <h3 className="font-display text-2xl font-semibold italic tracking-[-0.04em] text-[var(--paper)]">
        {title}
      </h3>

      {description ? (
        <p className="mt-1 text-sm leading-6 text-[var(--paper-dim)]">
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
    <div className="rounded-xl border border-[var(--line)] bg-[var(--ink-2)] px-3 py-2 text-sm font-semibold text-[var(--paper-dim)]">
      <span className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
        {label}
      </span>

      <div className="mt-1 text-[var(--paper)]">{children}</div>
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
      <span className="mb-1 block font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
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

      <p className="mt-1 text-sm leading-6 text-[var(--paper-dim)]">
        This change falls outside your configured hours. You can still schedule
        it with a pro override.
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-[var(--paper-dim)]">
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
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
          Select services
        </p>

        <span className="font-mono text-[9px] font-black uppercase tracking-[0.08em] text-[var(--paper-mute)]">
          {selectedDraftServiceIds.length} selected
        </span>
      </div>

      {services.length > 0 ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--ink-2)] p-3">
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
                  className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)]/[0.025] px-3 py-2"
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
                    <span className="block truncate text-sm font-black text-[var(--paper)]">
                      {service.name}
                    </span>

                    <span className="block text-xs font-semibold text-[var(--paper-mute)]">
                      {duration !== null ? `${duration} min` : 'Duration not set'}
                      {price ? ` · ${price}` : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      ) : (
        <StateCard>No active services available for this booking type.</StateCard>
      )}
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
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
          Current service items
        </p>

        {hasChanges ? (
          <span className="rounded-full border border-[var(--line)] bg-[var(--paper)]/[0.04] px-2 py-1 font-mono text-[9px] font-black uppercase tracking-[0.08em] text-[var(--paper)]">
            Unsaved changes
          </span>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--ink-2)] p-3">
          <div className="grid gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)]/[0.025] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-[var(--paper)]">
                    {item.serviceName}
                  </p>

                  <p className="text-xs font-semibold text-[var(--paper-mute)]">
                    {item.itemType === 'BASE' ? 'Base service' : 'Add-on'}
                  </p>
                </div>

                <div className="shrink-0 text-right text-xs font-semibold text-[var(--paper-mute)]">
                  <p>{item.durationMinutesSnapshot} min</p>
                  <p>{formatMoneySnapshot(item.priceSnapshot)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <StateCard>No service items selected.</StateCard>
      )}
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
          : 'border-[var(--line)] bg-[var(--paper)]/[0.03] text-[var(--paper-dim)]',
      ].join(' ')}
    >
      {children}
    </div>
  )
}