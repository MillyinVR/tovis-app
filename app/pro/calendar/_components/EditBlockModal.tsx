// app/pro/calendar/_components/EditBlockModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  DEFAULT_TIME_ZONE,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
  ymdInTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { readErrorMessage, safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { parseHHMM } from '@/lib/scheduling/workingHours'
import { CALENDAR_MS_PER_MINUTE } from '@/lib/calendar/constants'

import { SECONDS_PER_MINUTE } from '../_constants'

import {
  computeDurationMinutesFromIso,
  MAX_DURATION,
  normalizeStepMinutes,
  roundDurationMinutes,
  snapMinutes,
} from '../_utils/calendarMath'

// ─── Types ────────────────────────────────────────────────────────────────────

type EditBlockModalProps = {
  open: boolean
  blockId: string | null
  timeZone: string
  stepMinutes?: number | null
  onClose: () => void
  onSaved: () => void

  /**
   * Bridge until edit-block modal copy moves fully into BrandProCalendarCopy.
   */
  copy?: Partial<EditBlockModalCopy>
}

type EditBlockModalCopy = {
  eyebrow: string
  title: string
  description: string

  closeLabel: string
  cancelLabel: string
  saveLabel: string
  savingLabel: string
  deleteLabel: string
  deletingLabel: string

  noBlockSelected: string
  loadingBlock: string

  blockDetailsTitle: string
  blockDetailsDescription: string
  timeZoneLabel: string

  timeTitle: string
  timeDescription: string
  dateLabel: string
  startTimeLabel: string
  durationMinutesLabel: string
  noteLabel: string
  notePlaceholder: string

  malformedPayloadError: string
  missingIdError: string
  missingStartError: string
  missingEndError: string

  invalidDateError: string
  invalidStartTimeError: string
  invalidDurationError: string
  invalidUtcStartError: string
  invalidEndTimeError: string

  loadFailedError: string
  saveFailedError: string
  deleteFailedError: string
}

type BlockDto = {
  id: string
  startsAt: string
  endsAt: string
  note: string | null
}

type DateParts = {
  year: number
  month: number
  day: number
}

type PatchBlockPayload = {
  startsAt: string
  endsAt: string
  note: string | null
}

type BuildPatchPayloadArgs = {
  date: string
  startTime: string
  durationInput: string
  note: string
  timeZone: string
  stepMinutes: number
  copy: EditBlockModalCopy
}

type ActionButtonProps = {
  children: ReactNode
  tone?: 'primary' | 'danger' | 'ghost'
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: () => void
}

type SectionHeadingProps = {
  title: string
  description: string
}

type FieldProps = {
  label: string
  children: ReactNode
}

type InfoRowProps = {
  label: string
  children: ReactNode
}

type StateCardProps = {
  children: ReactNode
  danger?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DURATION_MINUTES = 60
const MAX_NOTE_LENGTH = 160

const DEFAULT_COPY: EditBlockModalCopy = {
  eyebrow: '◆ Calendar block',
  title: 'Edit blocked time.',
  description: 'Adjust or remove the unavailable window from your calendar.',

  closeLabel: 'Close',
  cancelLabel: 'Cancel',
  saveLabel: 'Save',
  savingLabel: 'Saving…',
  deleteLabel: 'Delete block',
  deletingLabel: 'Deleting…',

  noBlockSelected: 'No block selected.',
  loadingBlock: 'Loading block…',

  blockDetailsTitle: 'Block details',
  blockDetailsDescription:
    'Edit the unavailable window using the calendar timezone and step size.',
  timeZoneLabel: 'Timezone',

  timeTitle: 'Time',
  timeDescription: 'Change when the block starts and how long it lasts.',
  dateLabel: 'Date',
  startTimeLabel: 'Start time',
  durationMinutesLabel: 'Duration minutes',
  noteLabel: 'Note optional',
  notePlaceholder: 'Lunch, admin time, school pickup…',

  malformedPayloadError: 'Malformed block payload.',
  missingIdError: 'Block payload was missing an id.',
  missingStartError: 'Block payload was missing a start time.',
  missingEndError: 'Block payload was missing an end time.',

  invalidDateError: 'Pick a valid date.',
  invalidStartTimeError: 'Pick a valid start time.',
  invalidDurationError: 'Pick a valid duration.',
  invalidUtcStartError: 'Invalid start time.',
  invalidEndTimeError: 'End time must be after start time.',

  loadFailedError: 'Failed to load block.',
  saveFailedError: 'Failed to save.',
  deleteFailedError: 'Failed to delete.',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function resolveCopy(
  copy: Partial<EditBlockModalCopy> | undefined,
): EditBlockModalCopy {
  return {
    ...DEFAULT_COPY,
    ...copy,
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

function parseBlockDto(
  data: unknown,
  copy: EditBlockModalCopy,
): BlockDto {
  const raw = isRecord(data) && isRecord(data.block) ? data.block : data

  if (!isRecord(raw)) {
    throw new Error(copy.malformedPayloadError)
  }

  return {
    id: requiredString(raw.id, copy.missingIdError),
    startsAt: requiredString(raw.startsAt, copy.missingStartError),
    endsAt: requiredString(raw.endsAt, copy.missingEndError),
    note: typeof raw.note === 'string' ? raw.note : null,
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function timeInputFromMinutes(minutes: number): string {
  const snapped = snapMinutes(minutes, 1)
  const hour = Math.floor(snapped / 60)
  const minute = snapped % 60

  return `${pad2(hour)}:${pad2(minute)}`
}

function parseDateInput(value: string): DateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (!Number.isInteger(year) || year < 1900 || year > 3000) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  const checkDate = new Date(Date.UTC(year, month - 1, day))
  const valid =
    checkDate.getUTCFullYear() === year &&
    checkDate.getUTCMonth() === month - 1 &&
    checkDate.getUTCDate() === day

  return valid ? { year, month, day } : null
}

function parseDurationInput(args: {
  value: string
  stepMinutes: number
  copy: EditBlockModalCopy
}): number {
  const raw = Number(args.value)

  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(args.copy.invalidDurationError)
  }

  return roundDurationMinutes(raw, args.stepMinutes)
}

function buildPatchPayload(args: BuildPatchPayloadArgs): PatchBlockPayload {
  const parsedDate = parseDateInput(args.date)

  if (!parsedDate) {
    throw new Error(args.copy.invalidDateError)
  }

  const parsedTime = parseHHMM(args.startTime)

  if (!parsedTime) {
    throw new Error(args.copy.invalidStartTimeError)
  }

  const durationMinutes = parseDurationInput({
    value: args.durationInput,
    stepMinutes: args.stepMinutes,
    copy: args.copy,
  })

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
  }
}

function blockEndpoint(blockId: string): string {
  return `/api/pro/calendar/blocked/${encodeURIComponent(blockId)}`
}

function readResponseError(data: unknown, fallback: string): string {
  return readErrorMessage(data) ?? fallback
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
  busy: boolean
  onClose: () => void
}): (() => void) | undefined {
  const { open, busy, onClose } = args

  if (!open) return undefined

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) {
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

export default function EditBlockModal(props: EditBlockModalProps) {
  const {
    open,
    blockId,
    timeZone,
    stepMinutes,
    onClose,
    onSaved,
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

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [block, setBlock] = useState<BlockDto | null>(null)

  const [dateInput, setDateInput] = useState('')
  const [startTimeInput, setStartTimeInput] = useState('')
  const [durationInput, setDurationInput] = useState(
    String(DEFAULT_DURATION_MINUTES),
  )
  const [note, setNote] = useState('')

  const busy = loading || saving || deleting
  const canEdit = open && blockId !== null && block !== null && !loading

  useEffect(() => lockBodyScroll(open), [open])

  useEffect(
    () =>
      closeOnEscape({
        open,
        busy,
        onClose,
      }),
    [open, busy, onClose],
  )

  useEffect(() => {
    if (!open) {
      setError(null)
      setBlock(null)
      return
    }

    if (!blockId) {
      setError(null)
      setBlock(null)
      setDateInput('')
      setStartTimeInput('')
      setDurationInput(String(DEFAULT_DURATION_MINUTES))
      setNote('')
      return
    }

    const selectedBlockId = blockId
    let cancelled = false

    async function loadBlock(): Promise<void> {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(blockEndpoint(selectedBlockId), {
          cache: 'no-store',
        })

        const data: unknown = await safeJson(response)

        if (!response.ok) {
          throw new Error(
            readResponseError(
              data,
              `${copy.loadFailedError} (${response.status}).`,
            ),
          )
        }

        const loadedBlock = parseBlockDto(data, copy)

        if (cancelled) return

        const startsAt = new Date(loadedBlock.startsAt)
        const startMinutes = minutesSinceMidnightInTimeZone(
          startsAt,
          resolvedTimeZone,
        )

        const durationMinutes = roundDurationMinutes(
          computeDurationMinutesFromIso(
            loadedBlock.startsAt,
            loadedBlock.endsAt,
          ),
          step,
        )

        setBlock(loadedBlock)
        setDateInput(ymdInTimeZone(startsAt, resolvedTimeZone))
        setStartTimeInput(timeInputFromMinutes(startMinutes))
        setDurationInput(String(durationMinutes))
        setNote(loadedBlock.note ?? '')
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : copy.loadFailedError,
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadBlock()

    return () => {
      cancelled = true
    }
  }, [blockId, copy, open, resolvedTimeZone, step])

  function close(): void {
    if (saving || deleting) return

    setError(null)
    onClose()
  }

  async function save(): Promise<void> {
    const selectedBlockId = blockId

    if (!selectedBlockId || !block || saving || deleting) return

    setSaving(true)
    setError(null)

    try {
      const payload = buildPatchPayload({
        date: dateInput,
        startTime: startTimeInput,
        durationInput,
        note,
        timeZone: resolvedTimeZone,
        stepMinutes: step,
        copy,
      })

      const response = await fetch(blockEndpoint(selectedBlockId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: unknown = await safeJson(response)

      if (!response.ok) {
        throw new Error(readResponseError(data, copy.saveFailedError))
      }

      onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.saveFailedError)
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    const selectedBlockId = blockId

    if (!selectedBlockId || deleting || saving) return

    setDeleting(true)
    setError(null)

    try {
      const response = await fetch(blockEndpoint(selectedBlockId), {
        method: 'DELETE',
      })

      const data: unknown = await safeJson(response)

      if (!response.ok) {
        throw new Error(readResponseError(data, copy.deleteFailedError))
      }

      onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.deleteFailedError)
    } finally {
      setDeleting(false)
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
          void save()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="brand-pro-calendar-block-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-block-modal-title"
      >
        <header className="brand-pro-calendar-block-header">
          <div className="brand-pro-calendar-block-drag-handle" />

          <div className="brand-pro-calendar-block-header-row">
            <div className="brand-pro-calendar-block-header-copy">
              <p className="brand-pro-calendar-block-eyebrow">
                {copy.eyebrow}
              </p>

              <h2
                id="edit-block-modal-title"
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
              disabled={saving || deleting}
            >
              {copy.closeLabel}
            </ActionButton>
          </div>
        </header>

        <div className="brand-pro-calendar-block-body">
          {!blockId ? <StateCard>{copy.noBlockSelected}</StateCard> : null}

          {blockId && loading ? <StateCard>{copy.loadingBlock}</StateCard> : null}

          {error ? <StateCard danger>{error}</StateCard> : null}

          {canEdit ? (
            <div className="brand-pro-calendar-block-content">
              <section className="brand-pro-calendar-block-section">
                <SectionHeading
                  title={copy.blockDetailsTitle}
                  description={copy.blockDetailsDescription}
                />

                <div className="brand-pro-calendar-block-section-grid">
                  <InfoRow label={copy.timeZoneLabel}>
                    {resolvedTimeZone} · {step} minute step
                  </InfoRow>
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
                      value={dateInput}
                      onChange={(event) => setDateInput(event.target.value)}
                      disabled={busy}
                      className="brand-pro-calendar-block-field brand-focus"
                    />
                  </Field>

                  <Field label={copy.startTimeLabel}>
                    <input
                      type="time"
                      step={step * SECONDS_PER_MINUTE}
                      value={startTimeInput}
                      onChange={(event) =>
                        setStartTimeInput(event.target.value)
                      }
                      disabled={busy}
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
                      max={MAX_DURATION}
                      value={durationInput}
                      onChange={(event) =>
                        setDurationInput(event.target.value)
                      }
                      disabled={busy}
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
                      disabled={busy}
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
          ) : null}
        </div>

        <footer className="brand-pro-calendar-block-footer">
          <div className="brand-pro-calendar-block-footer-split">
            <ActionButton
              tone="danger"
              onClick={() => void remove()}
              disabled={!blockId || saving || deleting || loading}
            >
              {deleting ? copy.deletingLabel : copy.deleteLabel}
            </ActionButton>

            <div className="brand-pro-calendar-block-footer-actions">
              <ActionButton
                tone="ghost"
                onClick={close}
                disabled={saving || deleting}
              >
                {copy.cancelLabel}
              </ActionButton>

              <ActionButton
                type="submit"
                tone="primary"
                disabled={!canEdit || saving || deleting}
              >
                {saving ? copy.savingLabel : copy.saveLabel}
              </ActionButton>
            </div>
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