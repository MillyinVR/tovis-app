// app/pro/calendar/_components/BookingModal.tsx
'use client'

import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'

import type { BookingDetails, ServiceOption } from '../_types'

import {
  DEFAULT_CALENDAR_STEP_MINUTES,
  SECONDS_PER_MINUTE,
} from '../_constants'

import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'

import { calendarStatusMeta } from '../_utils/statusStyles'

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

  /**
   * Bridge until booking modal copy moves fully into BrandProCalendarCopy.
   */
  copy?: Partial<BookingModalCopy>
}

type BookingModalCopy = {
  eyebrow: string
  closeLabel: string
  cancelLabel: string

  appointmentFallback: string
  appointmentDetailsFallback: string
  loadingBooking: string
  bookingUnavailable: string

  mobileModeLabel: string
  salonModeLabel: string

  editAppointmentTitle: string
  editAppointmentDescription: string

  clientLabel: string
  whenLabel: string
  modeLabel: string
  subtotalLabel: string
  summaryDescription: string

  dateLabel: string
  timeLabel: string

  pendingRequestLabel: string
  pendingRequestDescription: string
  approveLabel: string
  denyLabel: string

  mobileDestinationLabel: string
  mobileDestinationFallback: string
  openMapsLabel: string

  outsideHoursTitle: string
  outsideHoursDescription: string
  allowOutsideHoursLabel: string

  selectServicesLabel: string
  selectedLabel: string
  noActiveServices: string
  durationNotSet: string

  currentServiceItemsLabel: string
  unsavedChangesLabel: string
  noServiceItemsSelected: string
  baseServiceLabel: string
  addOnServiceLabel: string

  totalDurationLabel: string
  minutesLabel: string
  notifyClientLabel: string

  messageClientLabel: string
  saveChangesLabel: string
  savingLabel: string

  noServicesSelectedError: string
  outsideHoursSaveError: string
  noServicesSelectedTitle: string
  outsideHoursSaveTitle: string
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
  copy: BookingModalCopy
  onClose: () => void
}

type ModalFooterProps = {
  booking: BookingDetails | null
  saving: boolean
  canSave: boolean
  noServicesSelected: boolean
  saveBlockedByOutsideHours: boolean
  copy: BookingModalCopy
  onClose: () => void
  onSave: () => void
}

type ActionButtonProps = {
  children: ReactNode
  tone?: ButtonTone
  disabled?: boolean
  onClick?: () => void
  title?: string
  ariaLabel?: string
}

type StateCardProps = {
  children: ReactNode
  danger?: boolean
}

type FieldProps = {
  label: string
  children: ReactNode
}

type SectionHeadingProps = {
  title: string
  description?: string
}

type SummaryRowProps = {
  label: string
  children: ReactNode
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DURATION_MINUTES = 60
const TIME_INPUT_STEP_SECONDS =
  DEFAULT_CALENDAR_STEP_MINUTES * SECONDS_PER_MINUTE

const DEFAULT_COPY: BookingModalCopy = {
  eyebrow: '◆ Appointment',
  closeLabel: 'Close',
  cancelLabel: 'Cancel',

  appointmentFallback: 'Appointment',
  appointmentDetailsFallback: 'Appointment details',
  loadingBooking: 'Loading booking…',
  bookingUnavailable: 'Booking details are not available.',

  mobileModeLabel: 'Mobile',
  salonModeLabel: 'In-salon',

  editAppointmentTitle: 'Edit appointment',
  editAppointmentDescription:
    'Change the appointment time, services, and client notification settings.',

  clientLabel: 'Client',
  whenLabel: 'When',
  modeLabel: 'Mode',
  subtotalLabel: 'Subtotal',
  summaryDescription: 'Client, timing, location, and payment snapshot.',

  dateLabel: 'Date',
  timeLabel: 'Time',

  pendingRequestLabel: 'Pending request',
  pendingRequestDescription: 'Approve this booking or deny it from here.',
  approveLabel: 'Approve',
  denyLabel: 'Deny',

  mobileDestinationLabel: 'Mobile destination',
  mobileDestinationFallback:
    'Address will appear here when booking location snapshots are returned.',
  openMapsLabel: 'Open in Maps',

  outsideHoursTitle: 'Outside working hours',
  outsideHoursDescription:
    'This change falls outside your configured hours. You can still schedule it with a pro override.',
  allowOutsideHoursLabel: 'Allow outside working hours',

  selectServicesLabel: 'Select services',
  selectedLabel: 'selected',
  noActiveServices: 'No active services available for this booking type.',
  durationNotSet: 'Duration not set',

  currentServiceItemsLabel: 'Current service items',
  unsavedChangesLabel: 'Unsaved changes',
  noServiceItemsSelected: 'No service items selected.',
  baseServiceLabel: 'Base service',
  addOnServiceLabel: 'Add-on',

  totalDurationLabel: 'Total duration',
  minutesLabel: 'minutes',
  notifyClientLabel: 'Notify client about changes',

  messageClientLabel: 'Message client',
  saveChangesLabel: 'Save changes',
  savingLabel: 'Saving…',

  noServicesSelectedError: 'Select at least one service before saving.',
  outsideHoursSaveError: 'Enable the outside-hours override before saving.',
  noServicesSelectedTitle: 'Select at least one service before saving.',
  outsideHoursSaveTitle: 'Enable override to save outside working hours.',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function resolveCopy(
  copy: Partial<BookingModalCopy> | undefined,
): BookingModalCopy {
  return {
    ...DEFAULT_COPY,
    ...copy,
  }
}

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

function locationModeLabel(args: {
  locationType: BookingDetails['locationType'] | null | undefined
  copy: BookingModalCopy
}): string {
  return args.locationType === 'MOBILE'
    ? args.copy.mobileModeLabel
    : args.copy.salonModeLabel
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
  copy: BookingModalCopy
}): string {
  const explicitLabel = normalizeText(args.bookingServiceLabel)

  if (explicitLabel) return explicitLabel

  const itemNames = args.items
    .map((item) => normalizeText(item.serviceName))
    .filter((name) => name.length > 0)

  return itemNames.length > 0
    ? itemNames.join(' + ')
    : args.copy.appointmentFallback
}

function saveButtonTitle(args: {
  noServicesSelected: boolean
  saveBlockedByOutsideHours: boolean
  copy: BookingModalCopy
}): string {
  if (args.noServicesSelected) {
    return args.copy.noServicesSelectedTitle
  }

  if (args.saveBlockedByOutsideHours) {
    return args.copy.outsideHoursSaveTitle
  }

  return ''
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
    copy: copyOverride,
  } = props

  const copy = useMemo(() => resolveCopy(copyOverride), [copyOverride])

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
        copy,
      }),
    [bookingServiceLabel, copy, serviceItems],
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
  const modeLabel = locationModeLabel({
    locationType: booking?.locationType,
    copy,
  })

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
        copy={copy}
        onClose={close}
      />

      <div className="brand-pro-calendar-booking-body">
        {loading ? <StateCard>{copy.loadingBooking}</StateCard> : null}

        {error ? <StateCard danger>{error}</StateCard> : null}

        {!loading && !booking ? (
          <StateCard>{copy.bookingUnavailable}</StateCard>
        ) : null}

        {booking ? (
          <div className="brand-pro-calendar-booking-content">
            <BookingSummary
              booking={booking}
              bookingLabel={bookingLabel}
              timeZone={timeZone}
              totalDuration={totalDuration}
              modeLabel={modeLabel}
              locationMeta={locationMeta}
              mapsUrl={mapsUrl}
              copy={copy}
            />

            {isPending ? (
              <PendingRequestSection
                saving={saving}
                copy={copy}
                onApprove={onApprove}
                onDeny={onDeny}
              />
            ) : null}

            <section className="brand-pro-calendar-booking-section">
              <SectionHeading
                title={copy.editAppointmentTitle}
                description={copy.editAppointmentDescription}
              />

              {editOutside ? (
                <OutsideHoursNotice
                  allowOutsideHours={allowOutsideHours}
                  saving={saving}
                  copy={copy}
                  onToggleAllowOutsideHours={onToggleAllowOutsideHours}
                />
              ) : null}

              <div className="brand-pro-calendar-booking-field-grid">
                <Field label={copy.dateLabel}>
                  <input
                    type="date"
                    value={reschedDate}
                    onChange={(event) =>
                      onChangeReschedDate(event.target.value)
                    }
                    disabled={saving}
                    className="brand-pro-calendar-booking-field brand-focus"
                  />
                </Field>

                <Field label={copy.timeLabel}>
                  <input
                    type="time"
                    step={TIME_INPUT_STEP_SECONDS}
                    value={reschedTime}
                    onChange={(event) =>
                      onChangeReschedTime(event.target.value)
                    }
                    disabled={saving}
                    className="brand-pro-calendar-booking-field brand-focus"
                  />
                </Field>
              </div>

              <ServicePicker
                services={services}
                selectedServiceIds={selectedServiceIds}
                selectedDraftServiceIds={selectedDraftServiceIds}
                saving={saving}
                copy={copy}
                onToggleService={toggleService}
              />

              <CurrentServiceItems
                items={serviceItems}
                hasChanges={Boolean(hasDraftServiceItemsChanges)}
                copy={copy}
              />

              <AppointmentEditFooter
                totalDuration={totalDuration}
                notifyClient={notifyClient}
                saving={saving}
                copy={copy}
                onToggleNotifyClient={onToggleNotifyClient}
              />

              {noServicesSelected ? (
                <StateCard danger>{copy.noServicesSelectedError}</StateCard>
              ) : null}

              {saveBlockedByOutsideHours ? (
                <StateCard danger>{copy.outsideHoursSaveError}</StateCard>
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
        copy={copy}
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
      className="brand-pro-calendar-booking-overlay"
      onMouseDown={() => {
        if (!saving) onClose()
      }}
    >
      <div
        className="brand-pro-calendar-booking-panel"
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
  const { booking, bookingLabel, modeLabel, saving, copy, onClose } = props

  const statusMeta = booking
    ? calendarStatusMeta({
        status: booking.status,
        isBlocked: false,
      })
    : null

  return (
    <header className="brand-pro-calendar-booking-header">
      <div className="brand-pro-calendar-booking-drag-handle" />

      <div className="brand-pro-calendar-booking-header-row">
        <div className="brand-pro-calendar-booking-header-copy">
          <p className="brand-pro-calendar-booking-eyebrow">{copy.eyebrow}</p>

          <h2
            id="booking-modal-title"
            className="brand-pro-calendar-booking-title"
          >
            {booking ? bookingLabel : copy.appointmentDetailsFallback}
          </h2>

          {booking && statusMeta ? (
            <div className="brand-pro-calendar-booking-status-row">
              <span className="brand-pro-calendar-booking-chip">
                {modeLabel}
              </span>

              <span
                className="brand-pro-calendar-booking-status-badge"
                data-tone={statusMeta.tone}
              >
                {statusMeta.label}
              </span>
            </div>
          ) : null}
        </div>

        <ActionButton
          tone="ghost"
          onClick={onClose}
          disabled={saving}
          ariaLabel={copy.closeLabel}
        >
          {copy.closeLabel}
        </ActionButton>
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
    copy,
    onClose,
    onSave,
  } = props

  return (
    <footer className="brand-pro-calendar-booking-footer">
      <div className="brand-pro-calendar-booking-footer-actions">
        {booking ? (
          <a
            href={messageHrefForBooking(booking.id)}
            className="brand-pro-calendar-booking-button brand-focus"
            data-tone="ghost"
          >
            {copy.messageClientLabel}
          </a>
        ) : null}

        <ActionButton tone="ghost" onClick={onClose} disabled={saving}>
          {copy.cancelLabel}
        </ActionButton>

        <ActionButton
          tone="primary"
          onClick={onSave}
          disabled={!canSave}
          title={saveButtonTitle({
            noServicesSelected,
            saveBlockedByOutsideHours,
            copy,
          })}
        >
          {saving ? copy.savingLabel : copy.saveChangesLabel}
        </ActionButton>
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
  copy: BookingModalCopy
}) {
  const {
    booking,
    bookingLabel,
    timeZone,
    totalDuration,
    modeLabel,
    locationMeta,
    mapsUrl,
    copy,
  } = props

  const subtotal = formatMoneySnapshot(booking.subtotalSnapshot)

  return (
    <section className="brand-pro-calendar-booking-section">
      <SectionHeading
        title={bookingLabel}
        description={copy.summaryDescription}
      />

      <div className="brand-pro-calendar-booking-summary-list">
        <SummaryRow label={copy.clientLabel}>
          {booking.client.fullName}
          {booking.client.email ? ` · ${booking.client.email}` : ''}
          {booking.client.phone ? ` · ${booking.client.phone}` : ''}
        </SummaryRow>

        <SummaryRow label={copy.whenLabel}>
          {formatAppointmentWhen(new Date(booking.scheduledFor), timeZone)} ·{' '}
          {timeZone} · {totalDuration} min
        </SummaryRow>

        <SummaryRow label={copy.modeLabel}>{modeLabel}</SummaryRow>

        {booking.locationType === 'MOBILE' ? (
          <MobileDestination
            locationMeta={locationMeta}
            mapsUrl={mapsUrl}
            copy={copy}
          />
        ) : null}

        {subtotal ? (
          <SummaryRow label={copy.subtotalLabel}>{subtotal}</SummaryRow>
        ) : null}
      </div>
    </section>
  )
}

function MobileDestination(props: {
  locationMeta: BookingLocationMeta
  mapsUrl: string | null
  copy: BookingModalCopy
}) {
  const { locationMeta, mapsUrl, copy } = props

  return (
    <div className="brand-pro-calendar-booking-mobile-destination">
      <p className="brand-pro-calendar-booking-kicker">
        {copy.mobileDestinationLabel}
      </p>

      <p className="brand-pro-calendar-booking-mobile-address">
        {locationMeta.address || copy.mobileDestinationFallback}
      </p>

      {mapsUrl ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="brand-pro-calendar-booking-button brand-focus"
          data-tone="default"
        >
          {copy.openMapsLabel}
        </a>
      ) : null}
    </div>
  )
}

function PendingRequestSection(props: {
  saving: boolean
  copy: BookingModalCopy
  onApprove: () => void
  onDeny: () => void
}) {
  const { saving, copy, onApprove, onDeny } = props

  return (
    <section className="brand-pro-calendar-booking-pending-section">
      <div className="brand-pro-calendar-booking-pending-inner">
        <div>
          <p className="brand-pro-calendar-booking-pending-label">
            {copy.pendingRequestLabel}
          </p>

          <p className="brand-pro-calendar-booking-pending-description">
            {copy.pendingRequestDescription}
          </p>
        </div>

        <div className="brand-pro-calendar-booking-pending-actions">
          <ActionButton tone="danger" onClick={onDeny} disabled={saving}>
            {copy.denyLabel}
          </ActionButton>

          <ActionButton tone="primary" onClick={onApprove} disabled={saving}>
            {copy.approveLabel}
          </ActionButton>
        </div>
      </div>
    </section>
  )
}

function AppointmentEditFooter(props: {
  totalDuration: number
  notifyClient: boolean
  saving: boolean
  copy: BookingModalCopy
  onToggleNotifyClient: (value: boolean) => void
}) {
  const { totalDuration, notifyClient, saving, copy, onToggleNotifyClient } =
    props

  return (
    <div className="brand-pro-calendar-booking-edit-footer">
      <div className="brand-pro-calendar-booking-duration-card">
        <p className="brand-pro-calendar-booking-kicker">
          {copy.totalDurationLabel}
        </p>

        <p className="brand-pro-calendar-booking-duration-value">
          {totalDuration} {copy.minutesLabel}
        </p>
      </div>

      <label className="brand-pro-calendar-booking-checkbox-label">
        <input
          type="checkbox"
          checked={notifyClient}
          onChange={(event) => onToggleNotifyClient(event.target.checked)}
          disabled={saving}
          className="brand-pro-calendar-booking-checkbox brand-focus"
        />
        {copy.notifyClientLabel}
      </label>
    </div>
  )
}

// ─── Shared content pieces ────────────────────────────────────────────────────

function SectionHeading(props: SectionHeadingProps) {
  const { title, description } = props

  return (
    <div className="brand-pro-calendar-booking-section-heading">
      <h3 className="brand-pro-calendar-booking-section-title">{title}</h3>

      {description ? (
        <p className="brand-pro-calendar-booking-section-description">
          {description}
        </p>
      ) : null}
    </div>
  )
}

function SummaryRow(props: SummaryRowProps) {
  const { label, children } = props

  return (
    <div className="brand-pro-calendar-booking-summary-row">
      <span className="brand-pro-calendar-booking-kicker">{label}</span>

      <div className="brand-pro-calendar-booking-summary-value">
        {children}
      </div>
    </div>
  )
}

function Field(props: FieldProps) {
  const { label, children } = props

  return (
    <label className="brand-pro-calendar-booking-label">
      <span className="brand-pro-calendar-booking-kicker">{label}</span>
      {children}
    </label>
  )
}

function OutsideHoursNotice(props: {
  allowOutsideHours: boolean
  saving: boolean
  copy: BookingModalCopy
  onToggleAllowOutsideHours: (value: boolean) => void
}) {
  const { allowOutsideHours, saving, copy, onToggleAllowOutsideHours } = props

  return (
    <div className="brand-pro-calendar-booking-outside-notice">
      <p className="brand-pro-calendar-booking-outside-title">
        {copy.outsideHoursTitle}
      </p>

      <p className="brand-pro-calendar-booking-outside-description">
        {copy.outsideHoursDescription}
      </p>

      <label className="brand-pro-calendar-booking-checkbox-label">
        <input
          type="checkbox"
          checked={allowOutsideHours}
          onChange={(event) =>
            onToggleAllowOutsideHours(event.target.checked)
          }
          disabled={saving}
          className="brand-pro-calendar-booking-checkbox brand-focus"
        />
        {copy.allowOutsideHoursLabel}
      </label>
    </div>
  )
}

function ServicePicker(props: {
  services: ServiceOption[]
  selectedServiceIds: Set<string>
  selectedDraftServiceIds: string[]
  saving: boolean
  copy: BookingModalCopy
  onToggleService: (serviceId: string, checked: boolean) => void
}) {
  const {
    services,
    selectedServiceIds,
    selectedDraftServiceIds,
    saving,
    copy,
    onToggleService,
  } = props

  return (
    <div className="brand-pro-calendar-booking-service-picker">
      <div className="brand-pro-calendar-booking-service-heading">
        <p className="brand-pro-calendar-booking-kicker">
          {copy.selectServicesLabel}
        </p>

        <span className="brand-pro-calendar-booking-kicker">
          {selectedDraftServiceIds.length} {copy.selectedLabel}
        </span>
      </div>

      {services.length > 0 ? (
        <ServiceOptionList
          services={services}
          selectedServiceIds={selectedServiceIds}
          saving={saving}
          copy={copy}
          onToggleService={onToggleService}
        />
      ) : (
        <StateCard>{copy.noActiveServices}</StateCard>
      )}
    </div>
  )
}

function ServiceOptionList(props: {
  services: ServiceOption[]
  selectedServiceIds: Set<string>
  saving: boolean
  copy: BookingModalCopy
  onToggleService: (serviceId: string, checked: boolean) => void
}) {
  const { services, selectedServiceIds, saving, copy, onToggleService } = props

  return (
    <div className="brand-pro-calendar-booking-option-list">
      <div className="brand-pro-calendar-booking-option-grid">
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
              className="brand-pro-calendar-booking-option-row"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  onToggleService(service.id, event.target.checked)
                }
                disabled={saving}
                className="brand-pro-calendar-booking-checkbox brand-focus"
              />

              <span className="brand-pro-calendar-booking-option-copy">
                <span className="brand-pro-calendar-booking-option-name">
                  {service.name}
                </span>

                <span className="brand-pro-calendar-booking-option-meta">
                  {duration !== null
                    ? `${duration} min`
                    : copy.durationNotSet}
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
  copy: BookingModalCopy
}) {
  const { items, hasChanges, copy } = props

  return (
    <div className="brand-pro-calendar-booking-current-services">
      <div className="brand-pro-calendar-booking-service-heading">
        <p className="brand-pro-calendar-booking-kicker">
          {copy.currentServiceItemsLabel}
        </p>

        {hasChanges ? (
          <span className="brand-pro-calendar-booking-unsaved-badge">
            {copy.unsavedChangesLabel}
          </span>
        ) : null}
      </div>

      {items.length > 0 ? (
        <CurrentServiceItemList items={items} copy={copy} />
      ) : (
        <StateCard>{copy.noServiceItemsSelected}</StateCard>
      )}
    </div>
  )
}

function CurrentServiceItemList(props: {
  items: BookingDetails['serviceItems']
  copy: BookingModalCopy
}) {
  const { items, copy } = props

  return (
    <div className="brand-pro-calendar-booking-option-list">
      <div className="brand-pro-calendar-booking-option-grid">
        {items.map((item) => (
          <div
            key={item.id}
            className="brand-pro-calendar-booking-current-service-row"
          >
            <div className="brand-pro-calendar-booking-option-copy">
              <p className="brand-pro-calendar-booking-option-name">
                {item.serviceName}
              </p>

              <p className="brand-pro-calendar-booking-option-meta">
                {item.itemType === 'BASE'
                  ? copy.baseServiceLabel
                  : copy.addOnServiceLabel}
              </p>
            </div>

            <div className="brand-pro-calendar-booking-current-service-meta">
              <p>{item.durationMinutesSnapshot} min</p>
              <p>{formatMoneySnapshot(item.priceSnapshot)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StateCard(props: StateCardProps) {
  const { children, danger = false } = props

  return (
    <div
      className="brand-pro-calendar-booking-state"
      data-danger={danger ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}

function ActionButton(props: ActionButtonProps) {
  const {
    children,
    tone = 'default',
    disabled = false,
    onClick,
    title,
    ariaLabel,
  } = props

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className="brand-pro-calendar-booking-button brand-focus"
      data-tone={tone}
    >
      {children}
    </button>
  )
}