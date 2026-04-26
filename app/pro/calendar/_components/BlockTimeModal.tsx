// app/pro/calendar/BlockTimeModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { parseHHMM } from '@/lib/scheduling/workingHours'
import { CALENDAR_MS_PER_MINUTE } from '@/lib/calendar/constants'

import { SECONDS_PER_MINUTE } from '../_constants'

import {
  normalizeStepMinutes,
  roundDurationMinutes,
  snapMinutes,
} from '../_utils/calendarMath'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlockRow = {
  id: string
  startsAt: string
  endsAt: string
  note: string | null
  locationId?: string | null
}

type BlockTimeModalProps = {
  open: boolean
  onClose: () => void
  initialStart: Date
  timeZone: string
  locationId: string | null
  locationLabel?: string | null
  stepMinutes?: number
  onCreated: (block: BlockRow) => void

  /**
   * Bridge until block modal copy moves fully into BrandProCalendarCopy.
   */
  copy?: Partial<BlockTimeModalCopy>
}

type BlockTimeModalCopy = {
  eyebrow: string
  title: string
  description: string

  closeLabel: string
  cancelLabel: string
  savingLabel: string
  createBlockLabel: string

  scopeTitle: string
  scopeDescription: string
  locationLabel: string
  timeZoneLabel: string
  allLocationsLabel: string
  selectedLocationFallback: string
  blockAllLocationsLabel: string
  noLocationSelectedMessage: string

  timeTitle: string
  timeDescription: string
  dateLabel: string
  startTimeLabel: string
  durationMinutesLabel: string
  noteLabel: string
  notePlaceholder: string

  invalidDateError: string
  invalidStartTimeError: string
  invalidDurationError: string
  locationRequiredError: string
  invalidUtcStartError: string
  invalidEndTimeError: string

  responseMissingDataError: string
  responseMissingIdError: string
  responseMissingStartError: string
  responseMissingEndError: string
  createFailedError: string
}

type DateParts = {
  year: number
  month: number
  day: number
}

type CreatedBlockPayload = {
  startsAt: string
  endsAt: string
  note: string | null
  locationId: string | null
}

type BuildPayloadArgs = {
  date: string
  time: string
  durationInput: string
  note: string
  timeZone: string
  stepMinutes: number
  blockAllLocations: boolean
  locationId: string | null
  copy: BlockTimeModalCopy
}

type ActionButtonProps = {
  children: ReactNode
  tone?: 'primary' | 'ghost'
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: () => void
}

type FieldProps = {
  label: string
  children: ReactNode
}

type InfoRowProps = {
  label: string
  children: ReactNode
}

type SectionHeadingProps = {
  title: string
  description: string
}

type StateCardProps = {
  children: ReactNode
  danger?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BLOCK_DURATION_MINUTES = 60
const MAX_NOTE_LENGTH = 160
const MAX_BLOCK_DURATION_MINUTES = 720

const DEFAULT_COPY: BlockTimeModalCopy = {
  eyebrow: '◆ Calendar block',
  title: 'Block personal time.',
  description:
    'Protect breaks, admin time, travel, or a full-on human reset. Revolutionary concept.',

  closeLabel: 'Close',
  cancelLabel: 'Cancel',
  savingLabel: 'Saving…',
  createBlockLabel: 'Create block',

  scopeTitle: 'Scope',
  scopeDescription:
    'Choose whether this block applies to the selected location or every location.',
  locationLabel: 'Location',
  timeZoneLabel: 'Timezone',
  allLocationsLabel: 'All locations',
  selectedLocationFallback: 'Selected location',
  blockAllLocationsLabel: 'Block all locations',
  noLocationSelectedMessage:
    'No location is selected, so this block will apply to all locations.',

  timeTitle: 'Time',
  timeDescription: 'Pick the start and duration for the unavailable window.',
  dateLabel: 'Date',
  startTimeLabel: 'Start time',
  durationMinutesLabel: 'Duration minutes',
  noteLabel: 'Note optional',
  notePlaceholder: 'Lunch, dentist, school pickup, deep sighing, etc.',

  invalidDateError: 'Pick a valid date.',
  invalidStartTimeError: 'Pick a valid start time.',
  invalidDurationError: 'Pick a valid duration.',
  locationRequiredError:
    'Select a location first, or choose "Block all locations".',
  invalidUtcStartError: 'Invalid start time.',
  invalidEndTimeError: 'End time must be after start time.',

  responseMissingDataError: 'Block created but response was missing data.',
  responseMissingIdError: 'Block created but response was missing an id.',
  responseMissingStartError:
    'Block created but response was missing a start time.',
  responseMissingEndError:
    'Block created but response was missing an end time.',
  createFailedError: 'Failed to create block.',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function resolveCopy(
  copy: Partial<BlockTimeModalCopy> | undefined,
): BlockTimeModalCopy {
  return {
    ...DEFAULT_COPY,
    ...copy,
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function dateInputFromParts(parts: DateParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

function timeInputFromMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60

  return `${pad2(hour)}:${pad2(minute)}`
}

function parseDateInput(value: string): DateParts | null {
  const parts = value.split('-')

  if (parts.length !== 3) return null

  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])

  if (!Number.isInteger(year) || year < 1900 || year > 3000) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  return {
    year,
    month,
    day,
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requiredString(value: unknown, errorMessage: string): string {
  const stringValue = optionalString(value)

  if (!stringValue) {
    throw new Error(errorMessage)
  }

  return stringValue
}

function errorFromResponse(data: unknown, fallback: string): string {
  if (!isRecord(data)) return fallback

  return optionalString(data.error) ?? optionalString(data.message) ?? fallback
}

function parseCreatedBlock(
  data: unknown,
  copy: BlockTimeModalCopy,
): BlockRow {
  if (!isRecord(data) || !isRecord(data.block)) {
    throw new Error(copy.responseMissingDataError)
  }

  const block = data.block

  return {
    id: requiredString(block.id, copy.responseMissingIdError),
    startsAt: requiredString(block.startsAt, copy.responseMissingStartError),
    endsAt: requiredString(block.endsAt, copy.responseMissingEndError),
    note: optionalString(block.note),
    locationId: optionalString(block.locationId),
  }
}

function buildPayload(args: BuildPayloadArgs): CreatedBlockPayload {
  const parsedDate = parseDateInput(args.date)

  if (!parsedDate) {
    throw new Error(args.copy.invalidDateError)
  }

  const parsedTime = parseHHMM(args.time)

  if (!parsedTime) {
    throw new Error(args.copy.invalidStartTimeError)
  }

  const rawDuration = Number(args.durationInput)

  if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
    throw new Error(args.copy.invalidDurationError)
  }

  const durationMinutes = roundDurationMinutes(rawDuration, args.stepMinutes)

  if (!args.blockAllLocations && !args.locationId) {
    throw new Error(args.copy.locationRequiredError)
  }

  const startsAt = zonedTimeToUtc({
    year: parsedDate.year,
    month: parsedDate.month,
    day: parsedDate.day,
    hour: parsedTime.hh,
    minute: parsedTime.mm,
    second: 0,
    timeZone: args.timeZone,
  })

  if (!Number.isFinite(startsAt.getTime())) {
    throw new Error(args.copy.invalidUtcStartError)
  }

  const endsAt = new Date(
    startsAt.getTime() + durationMinutes * CALENDAR_MS_PER_MINUTE,
  )

  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error(args.copy.invalidEndTimeError)
  }

  const trimmedNote = args.note.trim()

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    note: trimmedNote ? trimmedNote : null,
    locationId: args.blockAllLocations ? null : args.locationId,
  }
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

function noteCountLabel(note: string): string {
  return `${note.length}/${MAX_NOTE_LENGTH}`
}

// ─── Exported component ───────────────────────────────────────────────────────

export default function BlockTimeModal(props: BlockTimeModalProps) {
  const {
    open,
    onClose,
    initialStart,
    timeZone,
    locationId,
    locationLabel,
    stepMinutes,
    onCreated,
    copy: copyOverride,
  } = props

  const copy = useMemo(() => resolveCopy(copyOverride), [copyOverride])

  const resolvedTimeZone = useMemo(
    () => sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE),
    [timeZone],
  )

  const step = useMemo(
    () => normalizeStepMinutes(stepMinutes),
    [stepMinutes],
  )

  const initialInputs = useMemo(() => {
    const parts = getZonedParts(initialStart, resolvedTimeZone)
    const rawStartMinutes = parts.hour * 60 + parts.minute
    const snappedStartMinutes = snapMinutes(rawStartMinutes, step)

    return {
      date: dateInputFromParts({
        year: parts.year,
        month: parts.month,
        day: parts.day,
      }),
      time: timeInputFromMinutes(snappedStartMinutes),
    }
  }, [initialStart, resolvedTimeZone, step])

  const [date, setDate] = useState(initialInputs.date)
  const [time, setTime] = useState(initialInputs.time)
  const [durationInput, setDurationInput] = useState(
    String(DEFAULT_BLOCK_DURATION_MINUTES),
  )
  const [note, setNote] = useState('')
  const [blockAllLocations, setBlockAllLocations] = useState(locationId === null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    if (!open) return

    setError(null)
    setSaving(false)
    setDate(initialInputs.date)
    setTime(initialInputs.time)
    setDurationInput(String(DEFAULT_BLOCK_DURATION_MINUTES))
    setNote('')
    setBlockAllLocations(locationId === null)
  }, [initialInputs.date, initialInputs.time, locationId, open])

  function close(): void {
    if (saving) return

    setError(null)
    onClose()
  }

  async function submit(): Promise<void> {
    if (saving) return

    setSaving(true)
    setError(null)

    try {
      const payload = buildPayload({
        date,
        time,
        durationInput,
        note,
        timeZone: resolvedTimeZone,
        stepMinutes: step,
        blockAllLocations,
        locationId,
        copy,
      })

      const response = await fetch('/api/pro/calendar/blocked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: unknown = await safeJson(response)

      if (!response.ok) {
        throw new Error(errorFromResponse(data, copy.createFailedError))
      }

      const createdBlock = parseCreatedBlock(data, copy)

      onCreated(createdBlock)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.createFailedError)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="brand-pro-calendar-block-overlay"
      onMouseDown={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="brand-pro-calendar-block-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-time-modal-title"
      >
        <header className="brand-pro-calendar-block-header">
          <div className="brand-pro-calendar-block-drag-handle" />

          <div className="brand-pro-calendar-block-header-row">
            <div className="brand-pro-calendar-block-header-copy">
              <p className="brand-pro-calendar-block-eyebrow">
                {copy.eyebrow}
              </p>

              <h2
                id="block-time-modal-title"
                className="brand-pro-calendar-block-title"
              >
                {copy.title}
              </h2>

              <p className="brand-pro-calendar-block-description">
                {copy.description}
              </p>
            </div>

            <ActionButton
              tone="ghost"
              onClick={close}
              disabled={saving}
            >
              {copy.closeLabel}
            </ActionButton>
          </div>
        </header>

        <div className="brand-pro-calendar-block-body">
          {error ? <StateCard danger>{error}</StateCard> : null}

          <section className="brand-pro-calendar-block-section">
            <SectionHeading
              title={copy.scopeTitle}
              description={copy.scopeDescription}
            />

            <div className="brand-pro-calendar-block-section-grid">
              <InfoRow label={copy.locationLabel}>
                {blockAllLocations
                  ? copy.allLocationsLabel
                  : locationLabel || locationId || copy.selectedLocationFallback}
              </InfoRow>

              <InfoRow label={copy.timeZoneLabel}>
                {resolvedTimeZone} · {step} minute step
              </InfoRow>

              {locationId ? (
                <label className="brand-pro-calendar-block-checkbox-label">
                  <input
                    type="checkbox"
                    checked={blockAllLocations}
                    onChange={(event) =>
                      setBlockAllLocations(event.target.checked)
                    }
                    disabled={saving}
                    className="brand-pro-calendar-block-checkbox brand-focus"
                  />

                  {copy.blockAllLocationsLabel}
                </label>
              ) : (
                <StateCard>{copy.noLocationSelectedMessage}</StateCard>
              )}
            </div>
          </section>

          <section className="brand-pro-calendar-block-section">
            <SectionHeading
              title={copy.timeTitle}
              description={copy.timeDescription}
            />

            <div className="brand-pro-calendar-block-field-grid">
              <Field label={copy.dateLabel}>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  disabled={saving}
                  className="brand-pro-calendar-block-field brand-focus"
                />
              </Field>

              <Field label={copy.startTimeLabel}>
                <input
                  type="time"
                  step={step * SECONDS_PER_MINUTE}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  disabled={saving}
                  className="brand-pro-calendar-block-field brand-focus"
                />
              </Field>
            </div>

            <div className="brand-pro-calendar-block-field-single">
              <Field label={copy.durationMinutesLabel}>
                <input
                  type="number"
                  step={step}
                  min={step}
                  max={MAX_BLOCK_DURATION_MINUTES}
                  value={durationInput}
                  onChange={(event) => setDurationInput(event.target.value)}
                  disabled={saving}
                  inputMode="numeric"
                  className="brand-pro-calendar-block-field brand-focus"
                />
              </Field>
            </div>

            <div className="brand-pro-calendar-block-field-single">
              <Field label={copy.noteLabel}>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={saving}
                  maxLength={MAX_NOTE_LENGTH}
                  placeholder={copy.notePlaceholder}
                  className="brand-pro-calendar-block-field brand-pro-calendar-block-textarea brand-focus"
                />
              </Field>

              <p className="brand-pro-calendar-block-note-count">
                {noteCountLabel(note)}
              </p>
            </div>
          </section>
        </div>

        <footer className="brand-pro-calendar-block-footer">
          <div className="brand-pro-calendar-block-footer-actions">
            <ActionButton
              tone="ghost"
              onClick={close}
              disabled={saving}
            >
              {copy.cancelLabel}
            </ActionButton>

            <ActionButton
              type="submit"
              tone="primary"
              disabled={saving}
            >
              {saving ? copy.savingLabel : copy.createBlockLabel}
            </ActionButton>
          </div>
        </footer>
      </form>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeading(props: SectionHeadingProps) {
  const { title, description } = props

  return (
    <div className="brand-pro-calendar-block-section-heading">
      <h3 className="brand-pro-calendar-block-section-title">{title}</h3>

      <p className="brand-pro-calendar-block-section-description">
        {description}
      </p>
    </div>
  )
}

function Field(props: FieldProps) {
  const { label, children } = props

  return (
    <label className="brand-pro-calendar-block-label">
      <span className="brand-pro-calendar-block-kicker">{label}</span>
      {children}
    </label>
  )
}

function InfoRow(props: InfoRowProps) {
  const { label, children } = props

  return (
    <div className="brand-pro-calendar-block-info-row">
      <p className="brand-pro-calendar-block-kicker">{label}</p>

      <p className="brand-pro-calendar-block-info-value">{children}</p>
    </div>
  )
}

function StateCard(props: StateCardProps) {
  const { children, danger = false } = props

  return (
    <div
      className="brand-pro-calendar-block-state"
      data-danger={danger ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}

function ActionButton(props: ActionButtonProps) {
  const {
    children,
    tone = 'ghost',
    type = 'button',
    disabled = false,
    onClick,
  } = props

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="brand-pro-calendar-block-modal-button brand-focus"
      data-tone={tone}
    >
      {children}
    </button>
  )
}